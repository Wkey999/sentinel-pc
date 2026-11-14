# 前端升级交接

> 2026-11-14：普通输入已接入 `send_chat` 多轮对话；最近对话与体检案例分开保存。新增工具补证与 HWiNFO 导入，未知项使用“待补证”，见 [AI 问答与工具补证](AI_CHAT_AND_TOOLS.md)。

> 下文是最初 Vue/合成预览的历史交接。当前已迁至 React/Astryx 并接入 API v3，最新实现和复验结果见 [v0.3 修复复验](validation/SETUP-AUDIT-0.3.md) 与 README。不要按本页的旧文件名重建前端。

目标：在保留后端能力、证据边界与 IPC 契约的前提下，升级 Sentinel PC 中文桌面体验。当前前端为 0.1.0 合成样本预览，后端新增了尚未接入 UI 的报告 Parser。

## 先读和先跑

阅读 PROJECT_SPEC.md、ACCEPTANCE.md、ADR/0002-offline-preview.md 与 PARSER_BACKEND.md。

```powershell
npm ci --ignore-scripts
npm run dev
npm run check
npm run build
```

浏览器 Mock 访问 127.0.0.1:1420，静态演示见 README；桌面开发是 npm run desktop:dev。本机 .tools 只用于本地，不在 GitHub；新环境先准备 Rust/MSVC/WebView2。

## 可升级的部分

- src/App.vue 当前集中承载工作台、问诊、计划、结果、证据、历史、目录与设置，可拆 pages/components 与状态模块。
- src/style.css 是现有主题、布局和窄屏样式，允许全面改版。图标源在 src-tauri/icons/source.svg。
- 优先改善信息层级、表单追问、证据展开、空/错误/权限状态、键盘焦点、1280×720 与 150% 缩放。
- 保留可运行体验，不用截图或占位页面代替工作流程。

## 契约与实际能力

src/services/diagnostics.ts 是统一语义 IPC；src/domain/contracts.ts 是前端 Zod 契约；src/services/mock.ts 仅为浏览器演示。Rust 原生失败不得自动退回 Mock。

当前 IPC：get_app_status、create_case、list_cases、get_case、build_plan、approve_plan、start_plan、export_case、delete_case。只允许 demo.analyze_fixture。新 Parser 位于 crates/sentinel-core/src/parsers.rs，尚无 import_report IPC、文件选择令牌、ArtifactStore 或 UI 导入按钮。

Parser 输出 provenance=imported_report_declared、formatAcceptance=synthetic_only；当前 UI 报告契约仍限制 provenance=synthetic。不能把新输出强行 cast 成现有 Report，也不能在界面假装已经导入了用户报告。真实导入须先与后端补齐安全复制/哈希/存储/引用/脱敏，并新增契约测试。

## 必须保留的行为

1. 页面明确区分浏览器 Mock、原生合成、真实采集和导入声明；尚未实现的能力不用可运行按钮冒充。
2. 先预览计划再确认；同意绑定版本/hash/范围，前端不持有执行权。
3. 未提供、拒绝访问、空结果、截断和失败分别呈现，不能统一为绿色通过。
4. 单条 41 不确诊电源，系统 DLL 不直接当根因，时间接近不当因果；未知项必须显眼。
5. 使用 Vue 文本绑定，不用 v-html/远程图片/不可信链接渲染报告。模型保持关闭；不添加 Key 到 localStorage。
6. 默认导出不含原始附件、问题描述或凭据；预览可编辑。浏览器内存刷新清空，原生 SQLite 持久化。
7. 不随前端升级改 Rust Policy/Runner、Tauri capability/CSP 或增加 shell/fs/network 权限。

## 验收与已知限制

24 项前端/契约测试、48 项 Rust 测试已在本机通过。tests/fixtures/rust-contract.json 来自实际 Rust 输出，不能随意手改。原生首页及初始化 IPC 已验证，原生完整操作曾受窗口激活失败限制；浏览器通过不等于原生验收。CI 与安装验证分别看 ACCEPTANCE.md。

建议交付：修改后的源码、构建/测试结果、真实浏览器/原生截图、指定分辨率/缩放/键盘记录，以及更新后的限制清单。不要改变未完成项的验证口径。
