# 第三方依赖与复用状态

2026-11-12。当前为本机开发预览，尚未完成发行级许可审计；下表来自实际包声明，不能代替许可证原文。

| npm 直接依赖 | 版本 | 声明许可 | 用途 |
| --- | --- | --- | --- |
| React / React DOM | 19.3.1 | MIT | 界面 |
| @astryxdesign/core | 0.7.15 | MIT | UI 组件库 |
| @heroicons/react | 2.2.0 | MIT | 图标 |
| Zod | 4.6.7 | MIT | 结构校验 |
| @tauri-apps/api / cli | 2.12.4 | Apache-2.0 OR MIT | IPC/构建 |
| Vite | 8.3.8 | MIT | 构建/服务 |
| TypeScript | 6.0.3 | Apache-2.0 | 类型工具链 |
| Vitest | 5.1.0 | MIT | 测试 |
| @types/node | 24.19.2 | MIT | 开发类型 |
| Prettier | 3.10.1 | MIT | 格式化 |

Rust 使用 tauri/tauri-build、serde/serde_json、sha2、uuid、chrono、rusqlite（bundled SQLite）和 regex。精确版本/校验和/传递依赖在 Cargo.lock；完整库版权、许可与发行义务待 C13 核对。

没有迁入 Pulse/PC-AI 代码或资产；研究不代替上游许可原文。没有分发/执行 CDI、smartctl、HWiNFO、OCCT、PresentMon 或 Sysinternals 工件。盾牌 SVG、CSS 图形和样本为本项目新建；自有代码采用 MIT License（见 `LICENSE`）。
