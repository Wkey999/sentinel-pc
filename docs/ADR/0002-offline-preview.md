# ADR 0002：离线预览实现

日期：2026-11-12。适用于 0.1.0 预览。

- Rust 1.99.1 MSVC 安装在项目 .tools，补 rustfmt；官方安装器与官方 SHA-256 匹配，Authenticode 为 NotSigned。没有修改系统 PATH、代理、ExecutionPolicy 或注册表。
- 初次并行编译出现元数据错误与 rustc ICE，单任务编译通过；项目固定 jobs=1。原因未定位，不归因于用户硬件。
- Vue 3.5.45 / Vite 8.3.8 / Tauri API、CLI 2.12.4，Rust tauri 2.12.5。具体依赖由两份锁文件固定。
- TypeScript 7.0.2 与 vue-tsc 实际不兼容，改为实测通过的 6.0.3；未跳过类型检查。
- 暂未引入 Router/Pinia：单根组件与阶段切换先完成体验，复杂任务状态接入时再拆分。CI 已写入但未远程运行。

crates/sentinel-core 是原生领域、SQLite、计划/同意、规则与导出的权威实现。Mock 仅用于浏览器；原生 IPC 失败不静默回退。实际 Rust example 输出五份契约样本，前端验证结构与 Mock 规则语义一致。

只允许 demo.analyze_fixture；无任意命令/路径/下载接口。AppManifest 登记全部命令，capability 只给主窗口，每个命令再检查窗口。DTO 拒绝未知字段，案例 ID 限 UUID。生产 CSP 禁远程脚本与普通远程请求；开发只加本机 HMR。Vite 忽略工具链、target、后端、文档/测试，拒绝 HTTP 读取工具链/缓存/构建与密钥样式文件。

samples.json 是新写的五类合成统一证据，磁盘样本不是实际 CDI/smartctl Parser 输出。规则只支持合成 schema 0；关联要求来源/实体/启动会话相同，WER 在异常后 120 秒内。实际 Windows schema 与完整 machine/artifact 模型待实现。

采用 Tauri app_local_data_dir（local.sentinelpc.desktop）命名空间，替代规格示意目录。schema 1 有 cases/consents/runs，案例体保存 JSON。启动使未用同意失效，未完成记录置 interrupted；拒绝新版本数据库。同意有效十分钟、一次性消费、绑定计划 hash；计划重建使旧同意失效，成功重复启动返回已有报告。

完整实体表、附件、备份迁移、空间预算、审计、自由文本脱敏尚未完成，C02/C10 只记部分实现。未接真实采集、第三方程序、模型或收款；自有许可待确认。
