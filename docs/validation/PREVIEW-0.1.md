# 0.1.0 离线预览验证

2026-11-12（Asia/Hong_Kong），所有诊断内容为合成数据。

| 检查 | 结果 |
| --- | --- |
| npm run check | 24 项通过：16 Mock/规则、3 权限配置、5 Rust↔前端契约；类型检查通过 |
| cargo test -p sentinel-core --locked --offline | 18 项通过 |
| npm run build | 通过，113 个模块，JS 约 198 KB（未 gzip） |
| cargo build -p sentinel-pc --features custom-protocol --locked --offline | 通过，生成 debug EXE |
| Rust 契约 | example contract 实际输出至 tests/fixtures/rust-contract.json |
| npm 审计摘要 | 当时 78 包，0 vulnerabilities；不是完整供应链审计 |

Rust 测试覆盖：41 归因、provider/channel/schema、同实体/来源/启动和先后关联、窗口外事件、空/拒绝、引用、未知字段、范围/UUID、非主窗口、hash/计划变更、伪造/过期同意、重复启动、导出、删除、重启和新数据库版本拒绝。

浏览器实际走通重启、应用崩溃及 Markdown 预览。存储 JSON 中 serialNumber 为 REDACTED_1；实际下载至 D:/download/sentinel-synthetic-report.json，项目 synthetic-report.json 是其副本。弹窗 Tab 从末尾按钮回到关闭按钮；空事件显示 0 项证据/发现并说明不代表电脑正常。

原生首页与初始化 IPC 通过，完整操作受窗口激活失败限制，见 REAL_MACHINE_TESTS.md。开发期间工具链/target 变化曾导致 Vite 刷新，已加忽略；另起 1421 静态服务。旧 IAB 标签连接错误，新静态标签正常，未修改网络或安全设置。

补充：资料不足页面实际区分权限拒绝、截断与未提供；历史案例已重开。开发 HTTP 请求工具链和缓存路径均返回 403，静态预览 HTTP 200。PowerShell 三个脚本语法检查通过，五份原文哈希未变。

证据：native-home.png、browser-report.png、synthetic-report.json、BUILD.json。未验证真实采集/报告格式、完整脱敏、Runner、模型、安装、独立环境、性能和发行许可。
