# nosh 主体提取复用

2026-10-16：后端增加默认 `nosh-mnn` 引擎，独立运行用户提供的 nosh 1.3.0（132）包内模型，保留原有 `/extract` 接口，小程序无需增加大模型依赖。本功能只做主体提取和裁剪，不调用 nosh 服务端、不分析食物名称或热量。

## 模型与代码边界

- 原 APK SHA-256：`0828e1165b1fb809a2ac8d6605fdfc01faa82dcdfa07f3ae1586f6525db49af6`。
- 模型资源：`assets/main_segment.bin`，3,363,744 字节；原 SHA-256：`580071c82378562567b73fa7445b1b0c1b24796d147873a424268cf8f6810835`。
- 逐字节 XOR `0x91` 并移除 8 字节封装后，MNN payload SHA-256：`a8a1440ef66d6a99255a361b6884097a0a3da17ffcf720c655c72674ee9f7135`。
- 模型输入 `image`、输出 `mask`，声明 `[1,3,224,224]`，539 个算子。使用标准 MNN 3.6.1 CPU Module API，未调用 Android `.so`。
- 通过 `python -m backend.prepare_nosh_model --apk <本地APK>` 或 `--mnn <已解码模型>` 导入。只接受上述确定的模型，拒绝损坏或其他版本。缓存、照片、APK、权重和验收图片不进入 Git。
- `FELT_MODEL=isnet-general-use` 显式选择旧引擎；nosh 缺少模型或推理失败时返回提取失败，不以另一个模型的结果冒充成功。

## 复现的处理流程

1. 处理 EXIF 方向，最长边限制到 1600；模型输入经过 JPEG quality 90，与 SDK 接收 JPEG 文件的方式对齐。
2. RGB、OpenCV `INTER_AREA` 拉伸到 224×224，float32 `pixel * (4/255) - 2`，转换 NCHW/NC4HW4。
3. 首次推理，双边滤波 `d=3, sigmaColor=7, sigmaSpace=1, BORDER_DEFAULT`，`INTER_LINEAR` 恢复处理图尺寸。
4. `mask>0.1` 保留最大八连通组件；`mask>0.5` 定位主体框。框面积小于整图 2%时视为未找到主体。
5. 主体框每边外扩约 20%，对该 ROI 再次推理、平滑、恢复 ROI 尺寸。第二次结果覆盖第一次结果，保留最大的外轮廓支持区域。
6. 原生输出映射 `clip((mask-0.3)/0.4,0,1)*255`，生成八位灰度遮罩。
7. 对照 Java：遮罩最长边不超过 512，5×5 最大/最小滤波闭运算；工作图最长边不超过 1024；两遍整数 box blur，边界按实际有效像素数求平均。恢复图尺寸后应用 `alpha=clip(2*gray-64,0,255)`。
8. 将 alpha 合到原色图片，按 `alpha>10` 内容范围裁剪并外扩一像素。沿用毛毡手账的细窄暖白轮廓；阴影仍由小程序渲染器绘制。

保留高分辨率透明素材供板面导出；没有复制 nosh 的三分之一尺寸 UI 预览优化，也没有生成其用于云端食物识别的背景减暗 JPEG。几何比例和暖白细描边按本项目需要保留。

## 参数来源与复核位置

前期使用 REA 6.5.0 / JADX 0.7.1 检查 APK、引用与方法。Java 遮罩处理来自 `SubjectSegmentProcessor.a/b/c/d`，透明裁剪来自混淆后的 `com.google.common.util.concurrent.v.x`。

后续原生部分采用 Capstone 5.0.9 / pyelftools 0.33 做只读 ARM64 静态分析；这些是补充的分析派生结果，不是新生成的 REA Evidence 对象。

| 原生位置 | 结论 |
| --- | --- |
| `libares.so` AIMainSegmentProcessor，`0x7c2340..0x7c238c` | function ID `3300`，三个处理开关开启 |
| `libInsightWrapper.so` AIProcessor，`0x2e81b0..0x2e89d8` | ID 3300 绑定 MainSeg_Wrapper |
| MainSeg_Wrapper::Init，`0x30a4ec..0x30a728` | 创建 SegmentFunctionV2，模型 XOR 0x91 |
| SegmentFunctionV2::PreProcess，`0x7d774c` 起 | RGB、AREA、`4/255`、`-2`、NHWC→NCHW |
| MainSeg_Wrapper::Process，`0x30ac60..0x30ac8c`；SetVaryingConfig，`0x7d76fc` 起 | 双边滤波、ROI 细化、最大主体过滤均开启 |
| SegmentFunctionV2::PostProcess，`0x7d7c74..0x7d9074` | 双边滤波、最大连通区、第二轮 ROI、最大外轮廓和最终 alpha 映射 |

`libInsightWrapper.so` SHA-256：`387bc62b9eedef4b28d86c2433bb20e4d7af9713544669b3b0ac57d37eb99c5b`；`libares.so` SHA-256：`ff56a84c2322035cd71a20490a65e3fae7155c44f350dd063a306b91c40110b2`。

## 验证与限制

运行：

```powershell
backend/.venv/Scripts/python.exe -m unittest backend.test_app backend.test_nosh -v
backend/.venv/Scripts/python.exe -m backend.verify_nosh path/to/animal.jpg path/to/food.jpg path/to/plants.jpg
npm test
npm run check
```

已用公开动物、食物、植物样例执行真实 MNN 推理及 multipart 上传/PNG 下载检查；另在独立的本地 8788 服务完成真实 HTTP 验证，三次上传至下载耗时分别约 0.50、0.82、0.34 秒（包括解码、推理与 PNG 编码，只是本机少量样例）。PNG 有透明和不透明区域，模型对象复用；植物样例仍保留部分支架、桌面等背景，不能声称全面优于 ISNet。14 项后端测试、100 项小程序测试及路由/语法检查通过，Compose 配置校验通过。本机测试是 Windows CPU，Docker daemon 未运行，因此未验证本机 Linux 镜像构建；实际服务器部署、公网 HTTPS 和手机端总延迟仍需独立验收。

没有运行 Android APK 对同一张照片进行输出比对，因此这是按静态证据重建的流程，不能声称与原 SDK 逐像素一致。Android JPEG 编码、缩放和插值的舍入、原生推理后端精度仍可能造成边界差异。当前最大主体策略也会过滤一些彼此分离的物体，这是该流程的行为，不适合将每个物体都单独提取为贴纸。
