# Nosh 美术分析与小程序适配

更新：2026-10-16。目标是在毛毡生活手账中适配 Nosh 的纸张、照片贴纸、圆润控件与暖色文字风格。

## 分析对象与工具

- 用户提供的 Android 安装包：Nosh 1.3.0，versionCode 132，包名 `com.chaochaoshishi.nosh`。
- APK SHA-256：`0828e1165b1fb809a2ac8d6605fdfc01faa82dcdfa07f3ae1586f6525db49af6`。
- 实际使用 [REA](https://github.com/morluto/rea) `rea-agents@6.5.0`，配合 Node 24.19.0、JDK 21、JADX headless MCP 0.7.1、Apktool 3.0.3。
- REA 的 `inspect-android-package`、`decode-android-resources`、`search-android-classes`、`inspect-android-class`、`inspect-android-method` 均成功返回分析证据。
- JADX 包清单报告 17,049 个类、2,633 个包条目；Apktool 解码生成 2,898 个文件。两者统计口径不同。
- REA 的通用 `extract-artifact` 因 ZIP 中大小写同名路径在 Windows 上冲突而失败；后续使用 REA 的 Android 专用资源解码成功，并用同版本 Apktool 保存可复查的资源目录。
- 工具和原始分析产物在项目外的 `D:\xuexi\app\nosh_analyse\rea-work`，不进入小程序或 GitHub。

分析依据为静态资源、包内功能引导图和入口方法。没有运行 Nosh，也没有把功能引导图当作当前账号的完整运行截图。页面精确尺寸、全部运行状态和动态动画尚未逐屏对照。

## 直接观察到的视觉证据

| 证据 | 观察 | 在毛毡手账中的适配 |
| --- | --- | --- |
| `MainActivity.onCreate` 的系统栏颜色参数 `-657931` | 转换为 ARGB `#FFF5F5F5`；资源 `food_edit_page_bg` 同为此值 | 页面使用 `#F5F5F5`，顶部过渡到奶白色 |
| `new_feature_voice_input.png` | 白色圆角纸页、左侧装订孔、横向虚线、照片贴纸；底部黑色胶囊主入口 | 首页的今日纸页、虚线分隔和黑色胶囊导航；照片仍使用已有主体提取结果 |
| `new_feature_weekly_report.png` | 暖棕文字、白纸、轻阴影、黄色边缘和强调 | 日期、说明和统计用暖灰棕；黄色仅作局部强调，卡片保持轻盈 |
| `new_feature_edit_recognition_results.png` | 大圆角纸页、圆形操作按钮、宽松间距 | 处理弹层、裁剪、记忆详情及导出页使用圆润按钮和白色容器 |
| `wy_tab_add.png` | 240×168，主要不透明黑色像素为 `#0A0A0A`，白色加号 | 主按钮选用近黑 `#171716`；中间导航仍标识“毛毡板”，与现有跳转含义一致 |
| `week_shengcheng.png`、`nosh_icon_background.png` | 主要不透明颜色分别为 `#FFC552`、`#FFBA27` | 将强调色调柔和至 `#FFCD64`，选中背景使用 `#FFF0CA` |
| `res/font` | 存在 `xiaolai_regular`、`xiaolai_mono` 和 `han_rounded_cn` 的 regular/medium/bold 字体 | 本次用系统中文字体、字号、字重、行距与暖色层次适配；不携带 APK 中的字体文件 |
| `nosh_record_entry_slide_in_bottom.xml` 等 | 录入入口上滑 450ms，普通转场/相机弹层 320ms | 保持微信原生转场；底部标签沿用缓存和 `switchTab`，不额外添加阻塞切换的动画 |

上述颜色和文件属性属于包内证据；小程序使用的色值、纸页布局和控件尺寸是根据其风格作出的设计选择。

## 页面覆盖

1. 首页：品牌标记、两行暖色标题、装订纸页、今日毛毡板、记录按钮、最近手账及收藏入口。
2. 今日板：白色大圆角画板容器、浅黄色编辑入口、黑色导出按钮。
3. 日期/主题板编辑：黄色选中描边、圆角色板与肌理控件、暖色操作手柄。
4. 月历：奶油黄今日标记、白色月历纸页、圆形翻月按钮、独立统计卡。
5. 记忆详情：圆角照片、浅暖色贴纸预览、虚线分隔、暖棕文字和分类标签。
6. 分类记忆库：白色分段筛选、浅黄色选中分类、暖色缩略图底和记忆列表。
7. 主题收藏：白色主题卡、柔和输入区域，继续使用原有木框预览。
8. 图片修正：中性棋盘格、金棕色手柄、胶囊比例控件。
9. 导出分享：浅暖白预览纸张、清晰的黑色主按钮及次要操作。

共享底部导航使用白色悬浮圆角底座、原创线条图标和黑色中央胶囊；保留“今天 / 毛毡板 / 月历时光”及已实现的标签缓存。照片处理弹层同步适配。

没有引入 Nosh 的标识、吉祥物、原始图片、字体或反编译代码。导航图标由 `scripts/navigation-icons.js` 生成。木框、毡面材质、照片和导出作品沿用现有渲染，改变的是周围界面和编辑选中提示。

## 验证

- 自动测试：100 项通过。
- 静态检查：52 个 JS/JSON 文件、9 个页面路由通过。
- 微信官方编译：14 个 WXML 模板、15 个 WXSS 样式通过。
- 微信模拟器排版：390px 视口，九个页面的 13 个状态均未发现横向溢出，无运行异常；调整首页首屏按钮位置和月历日期格密度后再次检查通过。
- 底部导航专项：固定位置、安全区、末尾操作可达性、重复切换保留页面/Canvas、首页滚动和月历月份均通过。
- 完整添加、编辑、裁剪、重进、导出流程通过：撤销重做、图层顺序、六色三种肌理、裁剪手势和 PNG 保存、原始照片保留、重进数据恢复、真实 Canvas 1800×1200 导出及月历返回均通过。照片选择使用本地测试样例，本次 UI 回归不调用公网提取服务。
- 页面截图在本地 `artifacts/ui-nosh-2026-10-16/index.html`；使用隔离的公开样例照片，原有记录在截图和导航测试结束后均已恢复。
- 真机验收尚未完成；开发者工具的原生 Canvas 截图存在已知层级/裁切差异，截图不替代手机实际显示验收。

工具说明参考：[REA Android 分析](https://github.com/morluto/rea/blob/main/docs/android-analysis.md)、[REA Apktool 资源解码](https://github.com/morluto/rea/blob/main/docs/apktool-resource-analysis.md)。
