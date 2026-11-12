# 原生与实机验证

日期：2026-11-12。Windows x64、Rust 1.99.1 MSVC、VS 2022 C++/SDK、WebView2 157.0.4341.46。OS 差异与 CIM 拒绝见 ENVIRONMENT.md，未冻结正式支持版本。

| 检查 | 本轮结果 |
| --- | --- |
| 前端类型检查/构建 | 通过 |
| Rust 核心与存储 | 18 项测试通过 |
| Tauri x64 构建 | 通过，debug + custom-protocol，资源内嵌 |
| 原生窗口/初始化 IPC | 已打开，显示桌面端 · SQLite 与案例 0；get_app_status/list_cases 成功；见 validation/native-home.png |
| 原生完整流程 | 未完成：捕获后点击及一次重新绑定/激活均返回 failed to activate captured window，停止自动化；不认定应用交互已通过或失败 |
| 浏览器流程 | 问诊、同意、规则、预览和实际 JSON 下载通过；不替代原生流程 |
| 标准账户独立环境 | 未验收 |
| PowerShell 5.1 采集/真实日志 | 未实现/未读取 |
| CDI/smartctl 真实格式 | 未实现/未验收 |
| 1280×720 / 150% 缩放 | CSS 有窄屏处理，指定环境未验收 |
| 安装/卸载、断网独立环境 | 未验证，无安装器 |
| 签名/性能/兼容承诺 | 未验证，EXE 未签名 |

不代表完整 MVP、维修准确率或发行质量；不为验收制造故障或压力负载。
