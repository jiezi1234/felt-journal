# 主体提取服务

这是小程序 P0 的真实图片处理后端；记忆、板面和照片的长期记录仍保存在用户设备上。实现使用 [rembg 的 Python 库接口](https://github.com/danielgatis/rembg#usage-as-a-library)，模型在本机/自有服务器执行，无需供应商 API 密钥。默认模型为 `isnet-general-use`，可以通过 `FELT_MODEL` 替换。对照公开样例后，当前模型比最初的轻量 `u2netp` 更好地保留了食物及植物主要轮廓，并加入孤立弱背景清理。复杂多主体、玻璃、毛发和低对比背景仍可能有残留或误透明，不能保证任意照片效果。

## 本地启动

Python 3.11–3.13，从项目根目录执行：

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-dev.txt
backend/.venv/Scripts/python.exe -m uvicorn backend.app:app --host 127.0.0.1 --port 8787
```

`GET /health` 返回进程状态；`modelLoaded: false` 表示模型尚未初始化，不能据此宣称照片提取已验证。缺少模型文件时，第一次处理会下载模型到 `backend/.runtime/models`，部署前应预热，避免首张照片超时。Dockerfile 默认在构建时预下载模型，也支持离线导入；模型准备层位于业务源码复制之前，源码修改不会导致该层重复下载。

## 接口

`POST /extract`，`multipart/form-data`，一项 `photo` 文件，可附带 `taskId` 字段。限制 15 MB、24 百万像素；接受 JPEG（含相机 MPO 容器的第一张 JPEG）、PNG、WEBP，应用 EXIF 方向并将最长边限制到 2048 后推理。返回：

```json
{"cutoutUrl":"https://你的域名/cutouts/随机令牌.png","expiresIn":900}
```

结果是真实透明 RGBA PNG，按主体边界裁切并添加细窄暖白轮廓；接触阴影由小程序共用渲染器绘制。原图仅在请求内存中处理。结果临时保留 15 分钟，到期不能读取；后续请求或健康检查清理过期文件。服务器的健康监控应定时访问 `/health`，以便空闲时也清理过期结果。一次处理一张，繁忙返回 503；413 为超限，415 为不支持的照片，失败不会返回成功结果。

## 部署接通小程序

1. 将服务部署到可达的 HTTPS 域名，设置环境变量 `FELT_PUBLIC_BASE_URL=https://你的域名`，由反向代理转发到 8787。代理上传限制设为 16 MB，并设置 60 秒以上处理超时。
2. 为处理服务设置适当的访问频率限制和资源额度。该服务无账户、无记录数据库，不能把公开推理接口当作无限资源使用。
3. 在微信小程序后台把同一服务域名加入 `uploadFile` 与 `downloadFile` 合法域名。
4. 修改 `miniprogram/core/config.js` 的 `extraction`：`mode: 'remote'`，`endpoint: 'https://你的域名/extract'`。不要将供应商密钥写入小程序。
5. 开发工具当前私有配置关闭了 URL 校验；正式验收须重新开启校验后在手机上测试。localhost、局域网 HTTP 和本地测试通过都不能替代 HTTPS 真机接通。

后端已完成服务器内部部署与真实推理验收，公网域名解析、ICP备案、HTTPS 签发及微信域名配置尚未完成，小程序仍保持 `unconfigured`。它会如实显示提取尚未配置，并允许明确选择使用原图；不会把矩形原图标记为提取成功。

## 小程序本机真实联网调试

启动上述本机服务，并用开发者工具 CLI 开启自动化后执行：

```powershell
npm run dev:extraction
```

这会为当前开发者工具设置显式本机服务开关；只有 `platform=devtools` 且 `envVersion=develop` 时允许访问 `127.0.0.1:8787`。手机、体验版和发布版均忽略该设置，返回到正式 HTTPS 配置。下载只允许同一个回环地址下的随机 PNG 令牌路径。

关闭本机开关：`npm run dev:extraction -- --off`。完整真实联网 E2E：

```powershell
$env:WECHAT_EXTRACTION_ENDPOINT='http://127.0.0.1:8787/extract'
npm run test:e2e
```

选图返回使用公开照片作为测试输入；`wx.uploadFile`、真实 CPU 模型、`wx.downloadFile`、持久文件、记忆提交和重新打开均为真实执行。报告为 `artifacts/wechat-real-extraction-e2e.json`。当前机器本地服务已运行，开发者工具本机开关已启用；重启电脑后需重新启动 Python 服务。

## 服务器部署与验收

已提供 `backend/compose.yaml`、`backend/Caddyfile` 和 `backend/.env.example`。服务器准备 Docker 后，将 `.env.example` 复制为 `.env`，填入计划使用的正式域名，然后从项目根目录执行内部部署：

如果腾讯云服务器访问 Docker Hub 超时，可按[腾讯云官方说明](https://cloud.tencent.com/document/product/1207/45596)在 Docker daemon 配置中添加 `https://mirror.ccs.tencentyun.com` 镜像加速地址。Python 包默认从官方 PyPI 下载；需要使用腾讯云官方软件源时，可在部署用的 `.env` 中增加 `PIP_INDEX_URL=https://mirrors.cloud.tencent.com/pypi/simple`，仅影响镜像构建，不修改依赖版本。

```sh
docker compose --env-file backend/.env -f backend/compose.yaml config --quiet
docker compose --env-file backend/.env -f backend/compose.yaml up -d --build
curl --fail http://127.0.0.1:8787/health
```

若 GitHub 模型下载不可达，可在 `.env` 设置 `FELT_PRELOAD_MODEL=0` 后构建并启动内部服务，再导入从 [rembg 官方发布页](https://github.com/danielgatis/rembg/releases/tag/v0.0.0)下载的 `isnet-general-use.onnx`。当前固定版本的文件 SHA-256 为 `60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a`，须先核验再导入：

```sh
printf '%s  %s\n' '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a' '/path/to/isnet-general-use.onnx' | sha256sum --check
docker compose --env-file backend/.env -f backend/compose.yaml exec -T --interactive=false extractor \
  mkdir -p /app/backend/.runtime/models/models/isnet-general-use
docker compose --env-file backend/.env -f backend/compose.yaml exec -T extractor \
  sh -c 'cat > /app/backend/.runtime/models/models/isnet-general-use/isnet-general-use.onnx' < /path/to/isnet-general-use.onnx
```

此导入路径与当前固定的 rembg 2.0.85 对应。模型保存在持久卷中，不进入 Git；不要把 `FELT_PRELOAD_MODEL=0` 当作已完成模型准备，导入后仍需执行下面的真实推理验收。

默认仅启动抠图服务，宿主机端口绑定 `127.0.0.1:8787`，不向公网开放。可以通过 SSH 隧道或容器内执行脚本进行内部验收；首次启动的健康检查不代表模型已加载。准备一张可用于测试的照片并复制进容器临时目录后，执行真实上传、推理和结果下载检查：

```sh
docker compose --env-file backend/.env -f backend/compose.yaml exec -T extractor \
  sh -c 'cat > /tmp/test-photo.jpg' < /path/to/test-photo.jpg
docker compose --env-file backend/.env -f backend/compose.yaml exec -T --interactive=false extractor python -m backend.verify_deployment \
  --photo /tmp/test-photo.jpg --expected-public-base https://你的域名 --internal-download
```

`--internal-download` 会校验返回的正式 HTTPS 地址，再通过回环地址下载同一个临时文件；报告明确标注为内部 HTTP 验收，不代替公网 HTTPS 和微信真机验收。脚本还会检查 PNG 格式、RGBA 透明通道和推理后的模型状态，不输出带令牌的下载链接。

域名解析、备案等上线条件就绪后，显式开启 `public` profile 才会启动 HTTPS 网关：

```sh
docker compose --env-file backend/.env -f backend/compose.yaml --profile public up -d --build
```

只有 Caddy 的 80/443 端口对外发布；配置使用 [Caddy 自动 HTTPS](https://caddyserver.com/docs/automatic-https) 和 [反向代理](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)，代理限制 16 MB 上传、90 秒响应头等待。服务器 DNS、防火墙、证书申请和微信合法域名仍须实际配置验证。模型缓存及临时结果放在命名卷中，健康检查每分钟触发过期结果清理；Docker 构建上下文排除了本机虚拟环境、运行图片和本地验收产物。

容器以 UID 10001 和只读根文件系统运行。Numba 编译缓存及 XDG 缓存显式放入可写的 `.runtime/cache` 持久卷；否则健康检查可能正常，但 rembg 首次导入时因缓存目录不可写而导致抠图返回 503。

仅省略 `--profile public` 不会停止已运行的 HTTPS 网关。如需退回内部运行状态，先执行 `docker compose --env-file backend/.env -f backend/compose.yaml --profile public stop https`。

公网接通后，将验收脚本的 `--url` 改为正式 HTTPS 域名，去掉 `--internal-download` 再执行，并按真实访问量设置访问频率限制和资源额度。

### 2026-10-15 服务器内部验收记录

腾讯云北京轻量服务器，2 vCPU / 4 GB，Ubuntu 24.04.4 LTS；Docker 29.9.1、Compose 5.6.0。构建并启动实际 Linux 镜像，使用默认 `isnet-general-use` CPU 模型，容器内存上限 3 GiB、重启策略 `unless-stopped`。

| 实测 | 结果 |
| --- | --- |
| 首次动物照片，包含首次编译缓存及模型初始化 | 54.57 秒，863×410 RGBA PNG |
| 2400 万像素食物照片，已加载模型 | 3.59 秒，966×849 RGBA PNG |
| 植物照片，已加载模型 | 2.33 秒，863×723 RGBA PNG |
| 容器重启后再处理动物照片 | 4.78 秒，863×410 RGBA PNG；模型和编译缓存保留 |
| 透明通道及模型状态 | 四次上传、真实推理及下载通过，alpha 均为 0–255，处理后 `modelLoaded: true` |
| 容器内存 | 前三次顺序请求的 cgroup 峰值约 2.16 GiB；未发生 OOM |
| HTTPS 网关配置 | 官方 Caddy 镜像离线配置校验通过；未启动公网网关，未申请证书 |

运行中的后端仅监听宿主机 `127.0.0.1:8787`；公网 80/443 尚未开启服务。以上仅是少量样例的服务器内部测量，不能推断并发容量、所有照片质量或手机公网耗时。首次部署须先执行真实照片预热，再开放访问。

## 验证

```powershell
backend/.venv/Scripts/python.exe -m unittest backend.test_app -v
backend/.venv/Scripts/python.exe -m backend.smoke path/to/a-real-photo.jpg
```

第一项测试接口边界与文件生命周期，推理器使用显式测试替身；第二项调用真实模型，通过完整 multipart 上传、提取和结果下载检查 RGBA 与透明度。已用 rembg 官方动物、食物、植物公开样例验证本机真实 HTTP 服务，结果在 `artifacts/rembg-*-cutout.png`，这些样例不进入用户记录。单主体食物轮廓清楚；复杂植物群仍有局部误透明，已如实保留为质量限制。不同用户照片的轮廓效果及手机网络端总耗时仍待验收。
