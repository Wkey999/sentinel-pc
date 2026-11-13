# Sentinel PC · 哨兵

面向游戏与办公用户的 Windows 故障诊断 Agent。通过问诊、读取已有系统证据、导入第三方报告和确定性规则，解释发现、未知项与下一步。

当前应用版本仍为 **0.1.0**，后端已加入 **v0.3 一键只读体检与 API v3**。桌面端支持 Windows 只读采集、问诊分类、固定套餐授权、后台运行与取消、案例保存/复测及脱敏导出；浏览器端使用内存 Mock，不采集电脑硬件。

一键体检读取显示输出归属、当前刷新率/可识别 EDID 时序、内存速率、电源计划和实际系统卷余量。XMP/EXPO 开关、实际通道、PCIe 链路和热节流没有可靠来源时明确显示未知/不支持，不自动改设置或保证提帧。支持手动导入 smartctl JSON/CDI 文本；运行本地 smartctl 需要单独确认，不捆绑第三方工具。可选模型默认兼容 DeepSeek Chat Completions，用户自行配置本地加密 Key；模型不可用时保留本地规则。

GitHub 公开仓库为 [Wkey999/sentinel-pc](https://github.com/Wkey999/sentinel-pc)；自有代码许可待确认，不宣称已授予开源使用权。最新验证与剩余问题见 [v0.3 修复复验](docs/validation/SETUP-AUDIT-0.3.md)，历史演示/Parser 文档保留当时基线，不代表当前全部能力。

## 开发入口

- [项目规格](docs/PROJECT_SPEC.md)：产品范围、架构、C00–C15 与 A01–A17 验收要求。
- [后端交接与需求校准](docs/BACKEND_HANDOFF.md)：给接手 AI 的源码、接口、实现缺口与需求分歧核对说明。
- [范围决策](docs/ADR/0001-scope.md)：本项目采用的基线与未确认事项。
- [当前验收状态](docs/ACCEPTANCE.md)：已做、未做及验证边界。
- [环境检查](docs/ENVIRONMENT.md)：工具链、权限观察及原生构建缺口。
- [复用登记](docs/UPSTREAM_REUSE.md)：Pulse/PC-AI 来源与迁移约束。
- [原始资料](docs/reference/IMPORT_MANIFEST.json)：5 份资料的来源、大小与 SHA-256；复制件保持原样。

## 开发方向

采用 Tauri 2 + React + Astryx + TypeScript + Rust，SQLite 保存案例元数据。证据保留来源与时间，确定性规则负责受限观察、关联、未知项和下一步；前端当前接口见 `src/domain/contracts.ts`，后端入口见 `src-tauri/src/lib.rs`。

本地规则独立工作，不配置 Key 也可体检；模型解释需用户明确允许发送。普通权限运行，不实现管理员助手、自动修复、压力测试或第三方工具打包。

## 直接体验

本机桌面快捷方式当前指向 `target/release/sentinel-pc.exe`；开发脚本也可生成 `target/debug/sentinel-pc.exe`。构建产物不提交到 GitHub，干净检出需按下方命令自行构建。前端资源嵌入 EXE，不依赖开发服务器；需要 WebView2，目前没有签名安装器。

双击根目录 `启动预览.cmd` 打开浏览器演示：<http://127.0.0.1:1421/>。仅监听回环地址，案例只在内存中，刷新清空；此方式需要本机 Node 与已安装依赖。

建议先运行“一键体检”并查看“覆盖与未知”，再体验故障问诊、导入报告和复测。双击 `运行测试实验室.cmd` 可重复 24 个合成场景及一次本机只读采集；结果保存在被 Git 忽略的 `private-reports/`。模拟场景验证当前源码规则与前后端契约，不是向 EXE 注入硬件环境，也不替代其他设备实测。导出前仍应预览核对。

## 开发与检查

要求 Node >=24.12.0、Rust 1.99.1 x64 MSVC、C++ 工具、Windows SDK 和 WebView2。精确依赖见 package-lock.json 与 Cargo.lock。

```powershell
npm ci --ignore-scripts
npm run dev                # 127.0.0.1:1420，浏览器 Mock
npm run check              # 类型检查与前端/契约测试
npm run test:core          # Rust 核心规则与存储测试
npm run build              # 静态前端
npm run desktop:dev        # 原生开发模式
npm run desktop:build      # 内嵌前端的 debug EXE，不生成安装器
powershell -NoProfile -File scripts/test-lab.ps1 -Live -Full # 完整回归与体检实验室
npx astryx doctor --built dist # 构建输出检查
```

本机 Rust 仅安装于项目 .tools；脚本在子进程设置路径，不修改系统 PATH。干净检出需自行准备 Rust/MSVC；.tools 不提交。SQLite 使用 Tauri 应用本地数据目录（应用 ID：local.sentinelpc.desktop）；当前不做 30 天自动清理，可在案例页逐项删除。

最新测试数量、封包 SHA256、实调路径和未完成项见 [v0.3 修复复验](docs/validation/SETUP-AUDIT-0.3.md)。旧 [预览验证](docs/validation/PREVIEW-0.1.md)、[实机记录](docs/REAL_MACHINE_TESTS.md) 和 [离线预览决策](docs/ADR/0002-offline-preview.md) 属于历史记录；单台笔记本上的通过结果不代表完整硬件矩阵或完整 MVP 验收。

自有代码许可证待所有者确认，未写入 LICENSE。依赖和上游代码迁入时另行登记版权与完整许可文本。
