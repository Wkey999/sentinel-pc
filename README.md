# Sentinel PC · 哨兵

面向游戏与办公用户的 Windows 故障诊断 Agent。通过问诊、读取已有系统证据、导入第三方报告和确定性规则，解释发现、未知项与下一步。

当前阶段：**0.1.0 合成样本预览**。已打通问诊 → 计划确认 → 合成证据 → 中文规则解释/关联 → Markdown/JSON 导出。桌面端接 Rust/SQLite，浏览器端接内存 Mock；真实采集、第三方报告 Parser 和模型尚未开放，不能据此诊断当前电脑。

后端新增 CrystalDiskInfo/smartctl 纯 Parser 与 30 项边界测试，尚未接入桌面导入。见 [Parser 进展](docs/PARSER_BACKEND.md)。前端待升级，接手入口见 [前端交接](docs/FRONTEND_HANDOFF.md)。GitHub 公开仓库为 [Wkey999/sentinel-pc](https://github.com/Wkey999/sentinel-pc)；自有代码许可待确认，不宣称已授予开源使用权。

## 开发入口

- [项目规格](docs/PROJECT_SPEC.md)：产品范围、架构、C00–C15 与 A01–A17 验收要求。
- [范围决策](docs/ADR/0001-scope.md)：本项目采用的基线与未确认事项。
- [当前验收状态](docs/ACCEPTANCE.md)：已做、未做及验证边界。
- [环境检查](docs/ENVIRONMENT.md)：工具链、权限观察及原生构建缺口。
- [复用登记](docs/UPSTREAM_REUSE.md)：Pulse/PC-AI 来源与迁移约束。
- [原始资料](docs/reference/IMPORT_MANIFEST.json)：5 份资料的来源、大小与 SHA-256；复制件保持原样。

## 开发方向

采用 Tauri 2 + Vue 3 + TypeScript + Rust；SQLite 保存案例元数据。先做合成事件/报告 → Evidence → 中文规则解释 → 同实体关联 → 脱敏 Markdown/JSON 的离线路径，再连接实际 Windows 采集。

本地规则独立工作，模型关闭。首发规划仅导入 CrystalDiskInfo 文本和 smartctl JSON，当前 Parser 尚未实现。普通权限运行，不实现管理员助手、自动修复、压力测试或第三方工具打包。

## 直接体验

双击 `target/debug/sentinel-pc.exe` 打开桌面预览。前端资源已嵌入，不依赖开发服务器；需要系统 WebView2。当前为未签名 debug EXE，没有安装器。

双击根目录 `启动预览.cmd` 打开浏览器演示：<http://127.0.0.1:1421/>。仅监听回环地址，案例只在内存中，刷新清空；此方式需要本机 Node 与已安装依赖。

建议依次体验异常重启、应用闪退、存储告警、空事件和资料不足。展开证据，核对未知项，再预览导出。问题描述、同意令牌和原始附件默认不导出；合成序列号会被替换。任意自由文本完整脱敏尚待 C10。

## 开发与检查

要求 Node >=24.12.0、Rust 1.99.1 x64 MSVC、C++ 工具、Windows SDK 和 WebView2。精确依赖见 package-lock.json 与 Cargo.lock。

```powershell
npm ci --ignore-scripts
npm run dev                # 127.0.0.1:1420，浏览器 Mock
npm run check              # 类型检查与前端/契约测试
npm run test:core          # Rust 合成数据与存储测试
npm run build              # 静态前端
npm run desktop:dev        # 原生开发模式
npm run desktop:build      # 内嵌前端的 debug EXE，不生成安装器
```

本机 Rust 仅安装于项目 .tools；脚本在子进程设置路径，不修改系统 PATH。干净检出需自行准备 Rust/MSVC；.tools 不提交。SQLite 使用 Tauri 应用本地数据目录（应用 ID：local.sentinelpc.desktop）；当前不做 30 天自动清理，可在案例页逐项删除。

验证：18 项 Rust 测试、24 项前端/跨语言/配置测试及前后端构建通过。浏览器已操作问诊、计划、结果、Markdown 预览和 JSON 实际下载；原生首页和初始化 IPC 成功，完整原生操作仍待验收。详见 [本轮验证](docs/validation/PREVIEW-0.1.md)、[实机记录](docs/REAL_MACHINE_TESTS.md) 和 [工程决策](docs/ADR/0002-offline-preview.md)。

下一步补 C02 的完整数据/恢复机制，并接入 C04/C05 的固定采集与受控 Runner。完整 MVP 验收仍未达到。

自有代码许可证待所有者确认，未写入 LICENSE。依赖和上游代码迁入时另行登记版权与完整许可文本。
