# 主体提取服务

这是小程序 P0 的真实图片处理后端；记忆、板面和照片的长期记录仍保存在用户设备上。默认引擎为 `nosh-mnn`：独立运行用户提供的 nosh 1.3.0 主体分割模型，并复现其原生两轮推理及 Java 遮罩/裁剪流程，无需小红书 SDK 或供应商 API。模型须从本地 APK 或已校验的 MNN 文件导入，不随源码发布。`FELT_MODEL=isnet-general-use` 可显式选择原有 rembg 引擎，失败时不会自动切换引擎。实现依据和限制见 [nosh 主体提取实现](../docs/nosh主体提取实现.md)。复杂植物、多主体、玻璃、毛发和低对比背景仍可能有残留或误透明，不能保证任意照片效果。

## 本地启动

Python 3.11–3.13，从项目根目录执行：

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-dev.txt
backend/.venv/Scripts/python.exe -m backend.prepare_nosh_model --apk "D:\path\to\nosh.apk.1"
backend/.venv/Scripts/python.exe -m uvicorn backend.app:app --host 127.0.0.1 --port 8787
```

`GET /health` 返回进程状态和纹理白边能力 `stickerStyle: nosh-textured-v2`，以及 `stickerTextures` 支持列表；`modelLoaded: false` 表示模型尚未初始化，不能据此宣称照片提取已验证。`nosh-mnn` 不下载模型，缺少或哈希不符时提取返回 503。默认缓存为 `backend/.runtime/nosh/main_segment.mnn`，可用 `FELT_NOSH_MODEL` 指定路径。导入工具校验原 asset 和解码模型 SHA-256。选择 rembg 时才保留原有首次下载和构建预下载行为。

真实模型与上传/下载检查（图片和报告仅写入被忽略的 `artifacts/nosh`）：

```powershell
backend/.venv/Scripts/python.exe -m unittest backend.test_app backend.test_nosh -v
backend/.venv/Scripts/python.exe -m backend.verify_nosh path/to/photo.jpg
```

对运行中的服务可加 `--url http://127.0.0.1:8787`。若使用其他测试端口，先将该服务的 `FELT_PUBLIC_BASE_URL` 设置为相同地址；验证器会检查引擎和下载 origin，避免误测旧服务。

## 接口

`POST /extract`，`multipart/form-data`，一项 `photo` 文件，可附带 `taskId` 字段。限制 15 MB、24 百万像素；接受 JPEG（含相机 MPO 容器的第一张 JPEG）、PNG、WEBP，应用 EXIF 方向。入口最长边 2048；nosh 流程再限制到 1600，模型每次输入 224×224，遮罩恢复到处理图尺寸。返回：

```json
{"cutoutUrl":"https://你的域名/cutouts/随机令牌.png","expiresIn":900,"stickerTexture":"linen","alignment":{"sourceWidth":800,"sourceHeight":600,"x":100,"y":60,"width":350,"height":380}}
```

`alignment` 用于原图到贴纸的原位显影：`sourceWidth/sourceHeight` 是应用 EXIF 方向、缩小后的原图尺寸；`x/y/width/height` 是最终 PNG（包括纸边）在该坐标系中的矩形，纸边超出原图时 `x/y` 可以为负。原图与该坐标系等比例映射，不能直接当作上传文件的原始像素坐标。Nosh 与 rembg 都保留这组信息；`GET /health` 的 `alignmentVersion: 1` 标识支持。旧服务不返回该字段时，小程序走柔和的兼容过渡；数据不写入历史记忆。

结果是真实透明 RGBA PNG，按主体边界裁切并依 APK 的纯白贴纸分支生成平滑轮廓（约主体长边 4%，小主体最少 9 像素）。每次提取随机选择 `cotton`（细棉纸）、`linen`（亚麻织纹）、`watercolor`（水彩纸）、`laid`（手工横纹）之一，并以独立随机种子生成浅白材质；这是本项目新增的装饰效果。材质只作为主体后方的轮廓层，保持原 alpha 轮廓和不透明主体像素，原半透明边缘按 alpha 正常混合。纹理直接写入 PNG，画板、预览和分享共用同一张图，不在显示时重新随机；已有贴纸不自动重写。纯白版本仍可通过 `backend.border.white_sticker` 用于对照验证。接触阴影由小程序共用渲染器绘制。

原图仅在请求内存中处理。结果临时保留 15 分钟，到期不能读取；后续请求或健康检查清理过期文件。服务器的健康监控应定时访问 `/health`，以便空闲时也清理过期结果。一次处理一张，繁忙返回 503；413 为超限，415 为不支持的照片，失败不会返回成功结果。

## 部署接通小程序

1. 将服务部署到可达的 HTTPS 域名，设置环境变量 `FELT_PUBLIC_BASE_URL=https://你的域名`，由反向代理转发到 8787。代理上传限制设为 16 MB，并设置 60 秒以上处理超时。
2. 为正式客户端实现用户会话鉴权，并设置适当的访问频率限制和资源额度。当前开发令牌只用于受限联调，不能写入公开小程序包；服务无账户、无记录数据库。
3. 在微信小程序后台把同一服务域名加入 `request`、`uploadFile` 与 `downloadFile` 合法域名。
4. 修改 `miniprogram/core/config.js` 的 `extraction`：`mode: 'remote'`，`endpoint: 'https://你的域名/extract'`。不要将供应商密钥写入小程序。
5. 开发工具须开启 URL、TLS 和 HTTPS 证书校验；私有配置 `project.private.config.json` 中的 `setting.urlCheck` 会覆盖公共配置，验收时应为 `true`。开启后还须在手机上测试。localhost、局域网 HTTP 和本地测试通过都不能替代 HTTPS 真机接通。

2026-10-19 接通服务器 IP 开发接口，2026-10-23 已迁移到下节的 HTTPS 接口，并通过开启域名校验后的模拟器上传/下载验证。正式配置仍保持 `unconfigured`；正式鉴权和手机发布链路尚待完成。没有显式开发配置的客户端会显示提取尚未配置，并允许明确选择使用原图。

## 服务器 HTTPS 开发联调（当前使用）

2026-10-23：用户确认 ICP 备案已通过；`api.jiejiezi.cn` 的 A 记录已指向 `82.157.170.254`。腾讯云防火墙已放通 TCP 443。当前提取地址为 `https://api.jiejiezi.cn/extract`，健康检查为 `https://api.jiejiezi.cn/health`。Caddy 已取得 Let's Encrypt 公有证书，当前证书到期时间为 2027-01-21 06:19:22 UTC，后续由 Caddy 自动续期；证书与账户数据保存在 `backend_caddy_data` 持久卷，勿删除该卷。HTTP 域名请求返回 308 跳转到 HTTPS。

HTTPS 入口继续要求现有开发凭证，上传和下载均受保护。`extractor` 只发布宿主机回环端口 8787，Caddy 发布 80/443；服务随 Docker 启动。当前是已接通公网 HTTPS 的开发联调部署，正式版用户会话鉴权、限流和手机发布验收尚未完成。

服务器 `/opt/felt-journal/backend/.env` 保持 `FELT_DOMAIN=api.jiejiezi.cn`。私有 `.env.development` 保持原令牌与已验证镜像，并把 `FELT_DEV_ORIGIN` 改成 `https://api.jiejiezi.cn`；本机同名忽略文件使用相同配置。令牌不写入源码、小程序包或 Git。

当前服务器启动/更新命令：

```sh
cd /opt/felt-journal
docker compose --env-file backend/.env --env-file backend/.env.development \
  -f backend/compose.yaml -f backend/compose.https-development.yaml \
  --profile public up -d --no-build --wait
```

该命令继续使用私有环境指定的 `FELT_DEV_IMAGE=felt-extractor-reveal:20261021`。后续后端代码改动须先构建并验证新镜像，再更新此变量；不要误用旧的默认镜像。不要叠加 `compose.development.yaml`，其 80 端口会与 Caddy 冲突；也不要省略 HTTPS 开发覆盖文件，否则会丢失开发访问保护。

本机执行 `npm run dev:server` 可将模拟器切换到 HTTPS；手机独立存储须执行 `npm run dev:phone`。尚未连接手机时扫描真机调试二维码；已经连接 iOS/Android 开发版时，脚本直接更新当前手机，无需再次扫码或启动另一轮真机调试。配置脚本只修改服务连接设置，不修改记录、草稿或当前页面；若探测期间手机断开，不写入配置。旧 IP HTTP 配置不再适用于当前部署，手机尚未重新配置时须执行上述手机连接命令。体验版/正式版继续忽略这些开发配置。

微信公众平台的“开发管理 → 开发设置 → 服务器域名”中，`request`、`uploadFile`、`downloadFile` 三项均应添加 `https://api.jiejiezi.cn`（不带 `/extract` 等路径）。当前应用未使用 WebSocket，无需配置 `socket` 域名。后台保存后，在开发者工具“详情 → 项目配置 → 域名信息”刷新，核对三项域名与当前 AppID；开启域名校验并重新编译，再做手机实测。若出现 `url not in domain list`，先核对后台是否保存成功、是否配置在同一个小程序，以及开发者工具是否已刷新；保留域名校验，不通过关闭校验完成 HTTPS 验收。服务器 HTTPS 通过不能代替这些步骤。正式发布还需实现正式鉴权并配置发布接口，不能把开发令牌打进小程序包。

部署验证脚本支持从进程环境 `FELT_DEVELOPMENT_TOKEN` 读取令牌，拒绝跟随重定向，检查未授权上传/下载返回 401，然后执行真实照片推理和 HTTPS PNG 下载。令牌不得作为命令行参数或写进报告。`--internal-download` 仅可用于回环服务验收。

2026-10-23 公网验收：系统信任链与主机名校验通过（TLS 1.3、Let's Encrypt YE1）；公开动物样例返回 938×454 RGBA PNG、alpha 0–255，首次模型加载在内全流程约 1.62 秒，上传和下载未携带凭证时均返回 401。该时间仅代表单个样例，不是并发或手机网络保证。报告保存在被忽略的 `artifacts/https-verification-20261023.json`。

同日微信模拟器通过已编译适配器的真实 `wx.uploadFile` → 服务器推理 → `wx.downloadFile`，获得相同尺寸与透明度的 PNG、有效裁切坐标，以及“自然”自动分类，样例约 1.22 秒。模拟器服务配置已迁到 HTTPS；手机尚未重新连接。联调脚本统一使用与应用源码一致的不带扩展名模块路径，避免开发工具中两种模块引用读取不同的缓存版本。

同日合法域名验收补充：用户确认 `request`、`uploadFile`、`downloadFile` 三项均已保存并刷新为 `https://api.jiejiezi.cn`。私有配置保持 `urlCheck: true`；刷新域名列表后，旧模拟器运行环境一度仍返回 `url not in domain list`，通过开发者工具的 `simulator_refresh` 重新编译/刷新后恢复。真实 `wx.request` 健康检查返回 200，未配置的 `https://example.com/` 仍被合法域名校验拦截；公开动物样例经真实上传、抠图、下载得到 938×454 RGBA PNG、alpha 0–255、“自然”分类及有效裁切坐标，样例全流程约 1.25 秒。验收前后核对本地记录、草稿及现存照片字节均未改变。报告为本机忽略文件 `artifacts/legal-domain-verification-20261023.json` 与 `artifacts/server-extraction-verification.json`；本次仅覆盖模拟器，手机 HTTPS 和正式发布鉴权继续待验收。

回滚材料在服务器 `/home/ubuntu/felt-deployments/20261023-https/backup`。需要退回旧 IP 开发方式时，先用当前 HTTPS Compose 命令的相同参数执行 `stop https`，恢复备份 `.env.development`，再用下节的旧开发 Compose 命令启动。保留所有持久卷。本机/手机也需要同步恢复旧 IP 配置；正常运行无需回滚。

2026-10-23 手机连接补充：安卓开发版出现“照片处理服务暂时不可用”时，实测手机仍持有旧的 `http://82.157.170.254/extract`，模拟器的 HTTPS 配置不会自动同步到手机。已在现有真机调试连接中切换到 `https://api.jiejiezi.cn/extract`，从安卓手机发送不含照片的鉴权探测并核对配置读取通过；迁移前后 6 条记录、板面及其他业务存储保持一致。`npm run dev:phone` 复验成功复用当前手机连接。后续自动照片验证遇到真机调试响应超时/连接断开，不能据此认定手机完整上传、抠图和下载已验收，仍待手机重新选图确认。

## 服务器 IP 开发调试（历史方式，仅回滚使用）

2026-10-19 至 2026-10-23 切换 HTTPS 前，接口为 `http://82.157.170.254/extract`，运行在腾讯云 Ubuntu 服务器。本机 Python 已停止。以下配置供回滚参考，当前部署请使用上一节 HTTPS 命令。Docker 随服务器启动，容器配置 `restart: unless-stopped`。

服务器 `/opt/felt-journal/backend/.env.development` 保存开发环境变量，权限为 600，不进入 Git：

```dotenv
FELT_DEV_ORIGIN=http://服务器公网IPv4
FELT_DEV_PORT=80
FELT_DEVELOPMENT_TOKEN=使用随机生成的32至128位URL安全字符
```

当前部署在私有环境中指定 `FELT_DEV_IMAGE=felt-extractor-reveal:20261021`，使用已验证的镜像；新机器可省略此项并从完整源码构建。`FELT_DEV_ORIGIN` 的端口必须与 `FELT_DEV_PORT` 一致；默认 80 可以在地址中省略。基础 `.env` 中的 `FELT_DOMAIN` 仍保留未来正式域名。

服务器启动或更新（必须同时指定两份环境和 Compose 文件）：

```sh
cd /opt/felt-journal
docker compose --env-file backend/.env --env-file backend/.env.development \
  -f backend/compose.yaml -f backend/compose.development.yaml up -d --build --wait extractor
```

已有已验证镜像时，用 `--no-build` 替换 `--build`。迁移到 HTTPS 时应改用上一节的 `compose.https-development.yaml` 覆盖文件及 `public` profile，保留开发令牌，同时移除 IP HTTP 映射。不能同时使用两份开发覆盖文件。

开发接口要求上传和下载都带 `Authorization: Bearer <开发令牌>`；未授权返回 401，`/health` 保留无凭证健康检查。只有设置有效随机令牌时，后端才允许公开 IPv4 HTTP 地址。令牌只用于有限范围的开发联调；HTTP 不加密照片与令牌，正式使用须切换 HTTPS 及正式鉴权。

本机被 Git 忽略的 `backend/.env.development` 保存相同 origin 和令牌。微信开发者工具开启自动化和“不校验合法域名、TLS 版本以及 HTTPS 证书”后，在项目根目录执行：

```powershell
npm run dev:server
# 使用允许上传的测试照片验证完整链路，不创建或修改手账记录
npm run test:server -- path/to/test-photo.jpg
```

连接命令会先检查服务器模型版本和凭证，再把配置写入当前开发者工具的本地存储，并移除旧的本机接口配置；不会跳转用户页面。存储保留时，重启电脑或开发工具无需再次运行，也无需启动本机 Python。清空开发工具存储后需重新执行 `npm run dev:server`。关闭此开发配置用 `npm run dev:server -- --off`。

开发配置仅对 `envVersion=develop` 生效；体验版和正式版始终忽略它，下载仅允许返回到同一服务器 origin 的随机 PNG 路径。模拟器与手机的存储独立，`npm run dev:server` 配置模拟器后，普通扫码预览不会获得该配置。

### 手机提示“主体提取服务尚未配置”

这条提示发生在上传之前：正式地址尚未配置，而当前手机没有开发服务配置。服务器正常运行也不会自动把地址和开发凭证同步到手机。

保持开发者工具自动化端口开启。当前 HTTPS 接口应完成上节的合法域名配置，并取消勾选“不校验合法域名、TLS 版本以及 HTTPS 证书”；只有历史 HTTP IP 开发方式需要临时跳过校验。然后在项目根目录执行：

```powershell
npm run dev:phone
```

用手机微信扫描命令生成的**真机调试二维码**，保持手机小程序打开。命令最多等待 3 分钟；连接后核对实际运行环境为 iOS/Android 开发版，从手机发送不含照片的鉴权探测，再写入手机本地存储并验证小程序配置读取。只有看到“手机已连接服务器”的对应平台提示才算完成配置；然后点击“重新提取”或重新选图。网络或鉴权失败不会覆盖旧配置，也不会操作照片、记忆或画板。凭证从本机忽略文件读取，不写入源码或小程序包。

清空手机小程序数据、更换手机或更换开发令牌后，重新执行此命令并扫码。关闭手机配置用 `npm run dev:phone -- --off` 并扫码；它只删除开发服务配置。鉴权探测通过不等于照片端到端验收，实际手机仍须完成一次选图、提取、下载和贴到画板的检查。体验版和正式版继续使用正式 HTTPS 配置；此命令不改变它们的行为。

2026-10-19 验收：服务器候选容器真实推理通过；公网未授权上传和候选容器未授权下载均返回 401。已编译的小程序通过自身提取适配器执行真实 `wx.uploadFile` 和 `wx.downloadFile`，获得 938×454、alpha 0–255 的 RGBA PNG，并自动分类为“自然”。停止本机 8788 服务并重启服务器容器后再次通过，样例全流程约 0.94 秒；这不是并发或任意网络下的性能保证。服务器状态 healthy、无 OOM、Docker 开机启动已启用，容器重启策略为 unless-stopped。报告仅保存在被忽略的 `artifacts/server-extraction-verification.json`。

2026-10-21 背景柔退更新：候选容器先通过真实模型推理与 PNG 对齐坐标检查，再切换开发服务；旧镜像和配置留作回滚。当前健康检查返回 `alignmentVersion: 1`。微信模拟器中已编译的小程序通过实际上传、推理、下载链路，收到 938×454 RGBA PNG 及匹配的裁切坐标；公开动物样例全流程约 1.49 秒，未授权上传仍返回 401。28 项后端测试通过，原有记录未修改；此项为模拟器联网验收。

## 小程序本机真实联网调试

启动上述本机服务，并用开发者工具 CLI 开启自动化后执行：

```powershell
npm run dev:extraction
```

这会为当前开发者工具设置显式本机服务开关，并移除服务器开发配置；只有 `platform=devtools` 且 `envVersion=develop` 时允许访问 `127.0.0.1:8787`。手机、体验版和发布版均忽略本机开关。下载只允许同一个回环地址下的随机 PNG 令牌路径。

启用前会检查 `model: nosh-mnn` 和 `stickerStyle: nosh-white-v1`，仅有 `status: ok` 的旧进程会被拒绝。更新 Python 后端文件或服务器不会自动更新已经运行的本机进程；须重启本机服务后再运行本命令。开发工具已保存的旧照片也不会因后端更新而改变，需要重新提取才能获得新白边。

关闭本机开关：`npm run dev:extraction -- --off`。完整真实联网 E2E：

```powershell
$env:WECHAT_EXTRACTION_ENDPOINT='http://127.0.0.1:8787/extract'
npm run test:e2e
```

选图返回使用公开照片作为测试输入；`wx.uploadFile`、真实 CPU 模型、`wx.downloadFile`、持久文件、记忆提交和重新打开均为真实执行。报告为 `artifacts/wechat-real-extraction-e2e.json`。只有选择本机模式时，重启电脑后才需重新启动 Python；当前使用上面的服务器开发模式。

### 本机服务停止后的恢复

开发者工具会保留本机接口地址，但不会自动启动 Python 服务。电脑重启或服务退出后，端口无人监听会导致照片提取失败；重新编译前端不能代替启动后端。现在本机连接失败与处理超时会分别提示，原图仍由用户明确选择保留。

先核对已启用开关的端口，再用相同端口启动服务。例如本机开关为 `http://127.0.0.1:8788/extract` 时，在项目根目录执行并保持该服务运行：

```powershell
$env:FELT_PUBLIC_BASE_URL = 'http://127.0.0.1:8788'
$env:FELT_MODEL = 'nosh-mnn'
backend/.venv/Scripts/python.exe -m uvicorn backend.app:app --host 127.0.0.1 --port 8788
```

`FELT_PUBLIC_BASE_URL` 与监听端口必须一致，否则上传可能成功而主体下载失败。若要改用默认 8787 端口，先启动对应服务，再运行 `npm run dev:extraction` 更新本机开关；未改端口时，启动服务后直接点击“重新提取”即可。此流程仅恢复开发者工具联调，手机仍需要正式 HTTPS 服务。

2026-10-19 早前的本机恢复记录：开发者工具开关曾指向 8788，该端口最初拒绝连接。恢复本机 `nosh-mnn` 后，公开动物样例通过真实模型上传与下载，返回 938×454 RGBA PNG；另在微信运行环境执行真实 `wx.uploadFile` 和 `wx.downloadFile`，两者均返回 200，解码检查 alpha 为 0–255。网络检查只创建并清理测试文件，未修改记忆记录或切换用户页面。同日后续已切换服务器模式并停止本机服务。

## nosh 模型离线部署

Compose 与 Docker 默认选择 `nosh-mnn`，构建镜像不含 APK 或模型权重。先在本机运行上面的导入工具，再将校验后的模型导入服务器持久卷：

```sh
docker compose --env-file backend/.env -f backend/compose.yaml up -d --build
docker compose --env-file backend/.env -f backend/compose.yaml exec -T extractor \
  sh -c 'cat > /tmp/main_segment.mnn' < backend/.runtime/nosh/main_segment.mnn
docker compose --env-file backend/.env -f backend/compose.yaml exec -T extractor python -m backend.prepare_nosh_model --mnn /tmp/main_segment.mnn
```

以上输入文件位于执行 Docker 命令的主机上，需先安全传入自己的服务器；模型不通过 Git 传输。使用标准输入写入可写的 `/tmp`，因为 Docker 会拒绝向此只读根文件系统执行 `docker cp`；导入目的为持久卷。然后执行真实照片预热与下文的部署验收。

## 服务器部署与验收

已提供 `backend/compose.yaml`、`backend/Caddyfile` 和 `backend/.env.example`。服务器准备 Docker 后，将 `.env.example` 复制为 `.env`，填入计划使用的正式域名，然后从项目根目录执行内部部署：

如果腾讯云服务器访问 Docker Hub 超时，可按[腾讯云官方说明](https://cloud.tencent.com/document/product/1207/45596)在 Docker daemon 配置中添加 `https://mirror.ccs.tencentyun.com` 镜像加速地址。Python 包默认从官方 PyPI 下载；需要使用腾讯云官方软件源时，可在部署用的 `.env` 中增加 `PIP_INDEX_URL=https://mirrors.cloud.tencent.com/pypi/simple`，仅影响镜像构建，不修改依赖版本。

Debian 软件包下载也可单独配置 `DEBIAN_MIRROR=https://mirrors.cloud.tencent.com`，镜像源须提供 `/debian` 和 `/debian-security`。构建为 APT 设置 30 秒下载超时及两次重试。MNN 3.6.1 的 Linux wheel 带有可执行栈标记，实际在 glibc 2.41 上导入失败；Docker 构建使用 [patchelf 的 `--clear-execstack`](https://github.com/NixOS/patchelf/blob/master/patchelf.1) 清除此标记并执行 MNN 导入检查，保留栈不可执行和非 root、只读容器配置。

```sh
docker compose --env-file backend/.env -f backend/compose.yaml config --quiet
docker compose --env-file backend/.env -f backend/compose.yaml up -d --build
curl --fail http://127.0.0.1:8787/health
```

以下 ISNet 步骤仅在 `.env` 明确设置 `FELT_MODEL=isnet-general-use` 时适用。若 GitHub 模型下载不可达，可设置 `FELT_PRELOAD_MODEL=0` 后构建并启动内部服务，再导入从 [rembg 官方发布页](https://github.com/danielgatis/rembg/releases/tag/v0.0.0)下载的 `isnet-general-use.onnx`。当前固定版本的文件 SHA-256 为 `60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a`，须先核验再导入：

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

域名解析、备案等上线条件就绪后，显式开启 `public` profile 才会启动 HTTPS 网关。当前受凭证保护的部署使用下列命令（完整说明见前文 HTTPS 开发联调）：

```sh
docker compose --env-file backend/.env --env-file backend/.env.development \
  -f backend/compose.yaml -f backend/compose.https-development.yaml --profile public up -d --no-build --wait
```

只有 Caddy 的 80/443 端口对外发布；配置使用 [Caddy 自动 HTTPS](https://caddyserver.com/docs/automatic-https) 和 [反向代理](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)，代理限制 16 MB 上传、90 秒响应头等待。服务器 DNS、防火墙、证书申请和微信合法域名仍须实际配置验证。模型缓存及临时结果放在命名卷中，健康检查每分钟触发过期结果清理；Docker 构建上下文排除了本机虚拟环境、运行图片和本地验收产物。

容器以 UID 10001 和只读根文件系统运行。Numba 编译缓存及 XDG 缓存显式放入可写的 `.runtime/cache` 持久卷；否则健康检查可能正常，但 rembg 首次导入时因缓存目录不可写而导致抠图返回 503。

仅省略 `--profile public` 不会停止已运行的 HTTPS 网关。如需退回内部运行状态，先执行 `docker compose --env-file backend/.env -f backend/compose.yaml --profile public stop https`。

公网接通后，将验收脚本的 `--url` 改为正式 HTTPS 域名，去掉 `--internal-download` 再执行，并按真实访问量设置访问频率限制和资源额度。

### 2026-10-16 nosh 服务器部署记录

在原腾讯云 2 vCPU / 4 GB 服务器构建实际 Linux 镜像，先以候选容器通过 8 项 nosh 测试及三张真实照片，再切换原 `extractor` 服务。模型在持久卷中按 SHA-256 校验；旧 ISNet 镜像及原环境配置另存为回滚备份，未触发回滚。

| 正式容器实测 | 结果 |
| --- | --- |
| 动物照片，包含模型初始化 | 0.54 秒，879×395 RGBA PNG |
| 2400 万像素食物照片 | 1.38 秒，767×673 RGBA PNG |
| 植物照片 | 0.69 秒，997×1017 RGBA PNG |
| 重启后动物照片 | 0.55 秒，879×395 RGBA PNG；持久卷模型正常重载 |
| 引擎与透明度 | 四次真实上传、推理及下载通过；明确校验 `nosh-mnn`、`modelLoaded: true`、alpha 0–255 |
| 容器资源 | 前三次请求 cgroup 峰值 448,290,816 字节（约 428 MiB），未发生 OOM；限制 2 CPU / 3 GiB |
| 运行状态 | `healthy`；UID 10001、只读根文件系统、`unless-stopped`；仅绑定 `127.0.0.1:8787` |

实际使用 Python 3.13、glibc 2.41、MNN 3.6.1、NumPy 2.3.2、OpenCV 4.13.0.92、Pillow 12.2.0。MNN 的两个共享库清除可执行栈标记后，ELF `GNU_STACK` 权限为读写，真实推理通过。模型权重、测试照片、报告与部署环境变量均未提交 Git。

以上为服务器内部顺序请求的少量样例测量，耗时包含上传、处理和结果下载，不含手机公网链路，不能推断并发容量。植物复杂背景残留等质量限制仍存在。域名解析、HTTPS、微信合法域名及手机接入尚未完成，因此未启用公网网关，也未把小程序配置改为可用。

### 2026-10-15 原 ISNet 服务器内部验收记录

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
