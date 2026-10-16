# Nosh 识别界面与动画：REA 证据与小程序适配

分析日期：2026-10-16。对象为 Nosh 1.3.0 / versionCode 132，包名 `com.chaochaoshishi.nosh`。APK SHA-256：`0828e1165b1fb809a2ac8d6605fdfc01faa82dcdfa07f3ae1586f6525db49af6`。

本次使用 REA 的 `inspect_android_class`、`inspect_android_method`、`trace_android_references`，复用同一 APK 的 `decode_android_resources` 产物。引擎为 JADX headless MCP 0.7.1。这里的原版参数来自静态代码和资源，尚未在 Android 原程序录屏逐帧核对。混淆名是该 APK 的定位索引，不是原项目公开源码。

## 原版流程

```text
CaptureInputActivity / CaptureInputScreen
  相机、相册入口（另有文字/语音分支）
      ↓ 携带 capture_input_result_session_id
FoodResultActivity.onCreate
  消费拍摄会话，启动 x2.n 的图片/文字处理分支
      ↓
FoodResultScreen
  图片主体区 + 底部识别胶囊
      ↓ 返回识别信息后分阶段展开
  Waiting → Name → Calories → Nutrition → Tips
      ↓
  完整结果与底部「放弃 / 保存 / 编辑」操作
```

原版图片抠图、图片展示与服务端食物/营养分析分别进行。`y2.s0.b` 的展开节奏并不是实时服务进度：代码还包含约 400 ms 的首阶段等待、后续 1,000 / 1,200 ms 的展示间隔；文字结果另有 1,500 ms 分支。因此这些文案不能直接当作抠图 API 的进度。

### 开始识别

- 相机页面由 Compose 生成，并非一张 XML 布局。`T1.j0.a` 是相机底部控制条：左关闭、中拍摄、右相册。
- 尺寸按屏宽 / 390 缩放，上限约 1.05。控制条高 68 dp，左右留白 40 dp；中拍摄按钮 64 dp；两侧点击框 56 dp，图标 22 dp。禁用透明度 0.5。
- `nosh_camera_modal_enter/exit/hold.xml`：320 ms；进入从 Y=100% 到 0，退出反向，`fast_out_slow_in`。这是 Activity 页面切换，不是图像扫描。
- 相机界面背景初始化为 `#F5F4F0`，结果 Activity 基底为 `#F5F5F5`；后续内容还会使用结果状态中的配色。

### 识别中

`y2.w.b`（`FoodResultScreen.kt`）实际调用 `b1.b.a`（`AnalyzingPill.kt`），不是资源中另一套六瓣加载转圈。

| 元素 | 查证参数 |
|---|---|
| 识别胶囊 | 高 52 dp，圆角 26 dp，白色背景；背景层自身 blur 4 dp |
| 内部间距 | 左 20 dp / 右 24 dp，星与文字间距 4 dp |
| 星形 | 24 dp 容器，`ani_no_star.json`，无限播放 |
| 星形节奏 | 25 fps、24 帧，960 ms 一个资源周期；约 0–800 ms 旋转 0→180°，中点缩到约 75% 后回弹，黄色变色 |
| 文本 | 16 sp Medium；底层 `#0A0A0A`、透明度 0.16 |
| 文本扫光 | 1,250 ms Linear / Restart 无限重复；深色渐变带横向扫过文字 |
| 扫光带宽 | `clamp(textWidth × 0.55, 52 dp, 100 dp)`；中心最高透明度 0.4 |
| 放置 | 结果页底部居中，结合导航栏 inset 和约 140 dp 底部间距 |

`y2.w.j` 会依结果阶段切换“食物识别中…”“热量计算中…”“营养分析中…”“思考中…”等文案。原版没有在这些已检查代码中给出真实识别百分比。

`T1.j0.i` 的 36 dp 棕色六瓣 `loading_spinner` 加 28 sp “生成中”属于 **TextAnalyzingSurface 文字输入分支**；`zhuan_chang.json` 的红色双弧资源也不能据此认定为照片识别动画。本次没有把它们放进照片提取流程。

### 识别完毕

- `y2.w.f`：居中图片头图，从结果 Bitmap / 原图备用数据构建；通过 `b1.g1.b` 依宽高比决定尺寸，方图约 237.6 dp，横竖图分别约束到 264 dp 的尺度，再适配可用屏宽。
- `b1.g0.a` 是 `FoodStrokedImage`，负责主体贴纸式展示。抠图和描边参数另见既有抠图分析，本次不重新修改后端模型。
- `y2.w.o`：内容进入时 300 ms 淡入，同时垂直弹簧上移；阻尼比 0.72、刚度 90。`w1.l` case 3 将初始 Y 设为自身高度的 1/4。
- `y2.q.invoke`：普通照片结果先出现名称（32 sp、居中，图片后留白 32 dp），随后卡路里/营养等区块继续展开。
- `y2.w.d`：底部渐变遮罩与导航栏避让，左右 48 dp；放弃、保存、编辑横向布局，保存/编辑是否可点取决于保存和结果状态。
- 文字输入结果有另外的 `TextResultHero` 状态机，包含 120 ms 淡入、350 / 900 ms 阶段及延迟装饰出现；不将其误套为照片结果动画。

`y2.w.k` 的 JADX Java 还原失败，因此图片头图纵向位置的全部状态映射未精确复原。这里不声称整页像素、所有位置插值或每一帧与原 APK 完全一致。

## 当前小程序实现

本应用只提取图片主体，不调用 Nosh 的食物名称、热量或营养接口。

```text
首页记录卡 → 微信拍照/相册 → 原图预览
    → 用户点击开始提取
    → 上传 → 提取/下载 → 保存
    → 主体已保存（停留，可对比原图）
    → 用户点击继续 → 在原记录卡里布置
```

- 共用 `photo-panel` 服务于首页记录卡、独立板面、记忆详情替换照片。单张大图、白色胶囊、黄色星形、扫光文字及结果淡入/上移延续已查证的视觉特征。
- 微信系统拍照/相册选择器仍由平台提供；没有伪造相机画面，也没有把 Android CameraX 页面直接移植成小程序相机。
- `preview` 的确认步骤是本应用的适配选择，避免用户选图后立即上传。不是对原版存在该额外页面的断言。
- 上传、提取、保存的文案直接绑定真实任务状态；没有编造百分比或营养分析进度。完成按钮只在持久化与原子提交成功后出现。
- 保持本应用既有自动保存语义：完成页明确“已保存”，用户继续后进入布置。原版结果页的“保存”按钮不照搬为本应用的假保存步骤。
- 抠图成功可以切换原图与透明主体；使用原图支路显示“照片已保存”，不会假称已抠图。
- 取消、失败、权限、重试保存、卸载仍有完整处理；旧任务迟到回调不能覆盖新任务。完成页关闭不删除已保存图片。
- 动画使用 WXSS 实现，Android dp/sp 到 CSS 尺寸、Lottie 插值到 CSS 关键帧为适配近似。没有复制 APK 字体、品牌图标或图片资源。

## 关键 REA 证据

| 位置 | 证据 ID（REA） |
|---|---|
| CaptureInputActivity.onCreate | `ev_0d5ff1c16d10b2d64b65bb1021a12dd1a538e38da0eaee3f4064612c1b92f89f` |
| FoodResultActivity.onCreate | `ev_d8b25c7f2c2482e54bcc4c482b62c235cea579c6146b4cece4bc386c56d84500` |
| AnalyzingPill / b1.b.a | `ev_d8cbc7764dd43e1918462b965f9d4a72c5ae865f7268e2295bd8a503bc37cdef` |
| SweepingText / b1.b.b | `ev_62cba1c34f99f39baf5d35070ab46aa34dd04f2905e1fc0eb22f8fb0340b3cd0` |
| 识别文案 / y2.w.j | `ev_1a2bf450a653b711ab90eeeb75d97b88a2aad01cefc2cfe99745f5af6b3d1ffd` |
| 展开阶段 / y2.u0 | `ev_fa7d495dd3f8382c38234578cff1143d5a2089561a1e1b06ca8aeb31e6989cc4` |
| 展开时间 / y2.s0.b | `ev_0f29162b3a95f59a7aff8962b81f4481a4cfc9bf62916d7cd80e4b70abbc6d5f` |
| 结果图片 / y2.w.f | `ev_441dac2f6d93699bf0078f33adf1d0d30dfa55a1ac83a981308729e61d573078` |
| 图片尺寸 / b1.g1.b | `ev_417078b11e0939dd46c56ffb716e4808c465c806a0888bfb3ebf9c866fa4da42` |
| 结果淡入/弹簧 / y2.w.o | `ev_a10eed5304100e160b3c58804fac92803656a61065ed826a2622f3a47961399c` |
| 上移距离 / w1.l.invoke | `ev_a43b572f45ca41aef7f5191c927675713a293605d151e6e9d685fd9aff8960c9` |
| 结果底栏 / y2.w.d | `ev_03dca2df32f929c6cc7d790511c9e026e3a73a8c17f391dd9aa6f30f6a26187d` |
| 资源解码 | `ev_7524c94175b31c3cfafb136e053e86417fb912316c7799ed0e0ce148a2d591a2` |

## 验证方式

- `node --test tests/*.test.js`：状态机、取消、保存幂等、替换安全等行为。
- `node scripts/check.js` 与 `scripts/compile-wechat.ps1`：项目与微信 WXML / WXSS 编译。
- `node tests/record-card-e2e.js`：同页记录卡、原图支路、布置、撤销/重做、关闭与主题页。
- `node tests/recognition-e2e.js`：需明确指定测试图片及本地测试端点；实际 wx.uploadFile → 服务推理 → wx.downloadFile → 保存 → 完成停留 → 继续布置。临时隔离后恢复用户存储。
- 原版 Android 录屏、实体手机相机/相册权限、公开 HTTPS 域名联调不由静态分析或模拟器截图替代。

2026-10-16 本轮结果：120 项单元测试通过；56 个 JS/JSON 文件与 9 条原生路由检查通过；18 个 WXML 模板、16 个 WXSS 样式经微信官方编译器通过。`record-card-e2e` 和 `recognition-e2e` 均通过，用户存储已恢复。后者通过临时 SSH / 本机转发桥调用已部署的 `nosh-mnn` 服务，取得真实透明 PNG；测试桥增加 8 秒响应延迟用于观察慢请求动画，不计作模型推理耗时。完成页截图、原图对比、继续布置、取消请求和重新打开均已检查。
