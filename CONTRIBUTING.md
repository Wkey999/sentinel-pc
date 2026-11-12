# 开发约定

先读 docs/PROJECT_SPEC.md 与 docs/ACCEPTANCE.md。范围变更写 ADR；区分真实、模拟与待验证；自有许可证未确认，暂不公开发行。

- Rust 权威实现位于 crates/sentinel-core，语义 IPC 在 src-tauri；前端统一调用 diagnostics.ts。
- 禁止通用 shell/路径/URL 执行入口；DTO 拒绝未知字段，新增能力补权限与边界测试。
- 运行 npm run check、npm run test:core、npm run build；原生改动再做 npm run desktop:build。
- npm run format 格式化自有代码，不改 PROJECT_SPEC.md 或 docs/reference 的原始字节。
- 契约改变时实际运行 Rust example 重新生成契约样本，不手填假定输出。
- 不提交工具链、缓存、构建、数据库、私人报告和秘密。
- 上游迁入前核对固定提交/依赖/完整版权许可，更新声明。
