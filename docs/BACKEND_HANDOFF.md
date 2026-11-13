# Sentinel PC 后端交接与需求校准说明（给接手 AI）

核对日期：2026-11-13。代码基线：`a6ec45d2fd2a0e87c299c2688da6f7c414a10103`。本文为该基线的说明文档，后续代码变化需重新核实。

仓库：<https://github.com/Wkey999/sentinel-pc>。本地目录：`D:\文档\ChatGPT\哨兵`。

## 1. 请先理解本次交接的目的

项目所有者反馈：“整体方向没问题，但细节好像有点分岔。”他需要把后端现状交给另一个 AI 审阅、讨论和校准需求；前端将由其他 Agent 升级。

**接手时先判断需求与实现的差别，不要把现有实现当成最终产品需求，也不要仅凭本文件立刻重写后端。**

请区分四件事：

| 类型 | 本项目中的含义 | 如何处理 |
| --- | --- | --- |
| 产品目标 | 面向普通游戏/办公用户的 Windows 桌面诊断 Agent，复用成熟工具，让用户看懂检测证据 | 作为讨论出发点 |
| 原规格设计 | 具体技术栈、首发工具、权限范围、预算、轮数、发布顺序 | 属于既有开发基线；所有者可以调整，不等于每项都是其亲口要求 |
| 当前实现 | 合成样本演示、SQLite、有限规则、两个未接入界面的 Parser | 作为代码事实，不能倒推产品只需要这些 |
| 待校准分歧 | Agent 应有多主动、工具应怎样运行、模型是否核心、首次体验怎样才有用 | 提供具体选择和影响，由所有者明确 |

原始用户对话全文并不在本仓库。`PROJECT_SPEC.md` §0.1 明确：规格依据可读取的用户发言编写，接口、排期、限额等包含当时提出的设计。不能把规格里的所有限制都称为“用户明确要求”。

## 2. 需求来源和阅读顺序

1. [PROJECT_SPEC.md](PROJECT_SPEC.md)：完整原规格。先看 §0–2 产品与范围、§7 Adapter、§8 数据、§9–11 规则/Agent/状态机、§16–17 任务和验收。
2. [ADR/0001-scope.md](ADR/0001-scope.md)：开始实现时采用的范围决策。
3. [ADR/0002-offline-preview.md](ADR/0002-offline-preview.md)：离线预览采取的实现简化。
4. 本文：把上述设计与实际源码对照，并列出需要重新校准的问题。
5. [PARSER_BACKEND.md](PARSER_BACKEND.md)、[ACCEPTANCE.md](ACCEPTANCE.md)：Parser 增量和历史验收记录。
6. [FRONTEND_HANDOFF.md](FRONTEND_HANDOFF.md)：前端接手约束；涉及接口变更时同步更新。

原资料由 `D:\codex\2026-11-12\referenced-chatgpt-conversation-this-is-an\outputs` 复制进仓库；对应关系和哈希在 [reference/IMPORT_MANIFEST.json](reference/IMPORT_MANIFEST.json)。`PROJECT_SPEC.md` 是其中主文档的原样复制件。

注意文档时间差：README 仍有“Parser 尚未实现”、18 项 Rust 测试等旧描述；Parser 增量实际已落地，原有 18 项加新增 30 项，历史记录合计 48 项。某些旧段落的“真实 Parser 未接入”指尚未串入完整流程，不代表没有纯解析函数。遇到冲突，以源码和对应增量记录为准，不直接改写原始规格。

## 3. 产品方向与当前缺口

原方向是：成熟工具或 Windows 系统提供检测数据，Sentinel 负责问诊、受控调度、解析、关联、解释和下一步指导，面向不会自行阅读日志的小白用户。不是自行开发底层硬件检测引擎。

原规格中的目标流程：

```text
用户描述问题/时间/近期变更
  → 选择有价值的检查并预览计划
  → 确认后采集本机证据，或引导取得并导入工具报告
  → 解析并保留来源
  → 规则分析，可选模型解释
  → 判断是否需要补充一轮检查
  → 输出发现、依据、限制、未知项与下一步
  → 保存、复测、脱敏导出
```

目前真正可运行的流程：

```text
用户选择五种内置合成场景之一并填写描述/时间
  → 保存案例
  → 生成唯一动作 demo.analyze_fixture
  → 一次性同意
  → 读取 resources/samples.json 中的样本
  → Rust 确定性规则分析
  → 保存合成报告
  → 返回 Markdown/JSON 文本供前端预览和下载
```

另有一条独立开发路径：`报告字节 → parse_report → ParseResult`。尚未与上述案例流程连接。

**当前没有诊断这台电脑，没有真实 Windows 采集，没有第三方工具调度，也没有大模型调用。** EXE 能打开、流程能走完，证明预览可运行，不证明诊断产品已完成。

## 4. 后端是什么、代码在哪里

这是本机 Rust 后端，通过 Tauri IPC 与 Vue 通信，没有独立 HTTP 后端或远程诊断服务器。浏览器预览使用 TypeScript 内存 Mock；桌面版使用 Rust/SQLite。

| 文件 | 当前职责 |
| --- | --- |
| [src-tauri/src/lib.rs](../src-tauri/src/lib.rs) | 九个 IPC 命令、主窗口检查、Mutex 包装 Store、应用数据目录初始化 |
| [crates/sentinel-core/src/lib.rs](../crates/sentinel-core/src/lib.rs) | SQLite、请求校验、案例、计划、同意、启动、删除和导出入口 |
| [crates/sentinel-core/src/domain.rs](../crates/sentinel-core/src/domain.rs) | 当前 Rust DTO；JSON 使用 camelCase，拒绝未知字段 |
| [crates/sentinel-core/src/rules.rs](../crates/sentinel-core/src/rules.rs) | 面向合成证据的确定性规则 |
| [crates/sentinel-core/src/parsers.rs](../crates/sentinel-core/src/parsers.rs) | smartctl/CDI 报告纯解析函数；不读文件、不运行进程、不联网 |
| [crates/sentinel-core/src/export.rs](../crates/sentinel-core/src/export.rs) | 预览范围内的字段替换、基础脱敏、Markdown/JSON 文本生成 |
| [resources/samples.json](../resources/samples.json) | 五种合成场景，不是真实日志或第三方报告 |
| [src/services/diagnostics.ts](../src/services/diagnostics.ts) | 前端统一语义入口；桌面 invoke，浏览器 Mock |
| [src/domain/contracts.ts](../src/domain/contracts.ts) | 前端 Zod 契约，当前仍只允许合成报告和演示动作 |
| [src/services/mock.ts](../src/services/mock.ts) | 浏览器预览，数据刷新即清空；不是 Rust 后端替代品 |
| [src-tauri/build.rs](../src-tauri/build.rs)、[capabilities/main.json](../src-tauri/capabilities/main.json) | 命令登记与主窗口权限 |

尚未出现完整模块化的 `PolicyEngine / ToolRegistry / Runner / ArtifactStore / AgentOrchestrator / ModelGateway`。现在部分校验集中在 Store 中，不能因为规格画了这些模块就认定已经实现。

## 5. 已实现的 IPC 契约

有请求体时，前端调用形式为 `invoke(command, { request: dto })`；没有请求体时传 `{}`。不是 REST API。

| 命令 | request 字段 | 成功返回 | 实际行为 |
| --- | --- | --- | --- |
| `get_app_status` | 无 | AppStatus | version=0.1.0，mode=native-synthetic，modelEnabled=false，realCollectionEnabled=false |
| `create_case` | scenarioId、symptom、incidentStartUtc、incidentEndUtc、displayTimezone、environment | CaseRecord | 新建合成场景案例 |
| `list_cases` | 无 | CaseRecord[] | 按插入顺序倒序列出；未分页 |
| `get_case` | caseId | CaseRecord | UUID 查案例 |
| `build_plan` | caseId | CaseRecord | 创建新 revision 的演示计划；有报告的案例不能覆盖 |
| `approve_plan` | caseId、planId、planHash | Consent | 发放十分钟有效的一次性 token |
| `start_plan` | caseId、planId、planHash、consentToken | CaseRecord | 同步完成合成分析并保存；不是启动真实后台作业 |
| `export_case` | caseId、format | ExportResult | format 仅 markdown/json；返回文本内容，不在 Rust 内弹保存框或写用户目标文件 |
| `delete_case` | caseId | 单元值，前端按 null 校验 | 删除案例及级联 consent/run；目前没有附件需要清理 |

错误目前是 `Result<T, String>` 的中文字符串，没有完整的结构化错误码、可重试标记和任务级错误对象。

创建案例的限制：

- scenarioId 仅 `restart / application / storage / empty / insufficient`，必须匹配内置样本。
- symptom 非空、Rust 按字符计数最多 1000；仅保存，**没有语义理解或根据描述选工具**。
- environment 仅 `personal / workplace / unknown`。
- displayTimezone 仅 `Asia/Hong_Kong / Asia/Shanghai / UTC`。
- 起止时间需可解析为 RFC3339，有序且跨度不超过 24 小时。前后端分别校验，边界实现仍需维护一致性。

无 `import_report / cancel_run / collect_events / run_tool / explain_with_model` 等 IPC。新增能力时须同步 Rust 命令、AppManifest、capability、前端 DTO、服务层与契约测试，不能只增加界面按钮。

## 6. 领域数据、计划和状态

### 6.1 当前数据模型

| 类型 | 已有字段概览 | 距原规格的差距 |
| --- | --- | --- |
| CaseRecord | id、title、symptom、scenarioId、时间窗口/时区、environment、createdAtUtc、status、plan、report | 缺频率、近期变更、复现条件、时间不确定度、复测关系等 |
| Plan | id、caseId、revision、hash、actionIds、dataScopes、policyVersion、adapterVersion、scenarioId、起止时间 | 没有完整的逐动作参数、风险/权限/费用、预算和依赖模型 |
| Evidence | id、kind、source、observedAtUtc、provider/channel/eventId/schemaVersion/recordId、entity、bootSession、fields | fields 为字符串 map；缺独立 artifactId、类型化单位、正式机器身份、结构化 locator 等 |
| Finding | id、ruleId、title、observation、evidenceIds、strength、limitations、nextStep | 不是完整假设/支持及反对证据/Recommendation 模型 |
| Report | schemaVersion、provenance、ruleVersion、generatedAtUtc、findings、evidence、coverage、unknowns | 当前固定 synthetic；未覆盖真实/导入混合来源 |
| Coverage | source、status、detail | 前端状态包含 available/empty/missing/unsupported/permission_denied/truncated；未形成完整任务状态体系 |

Parser 复用了 Evidence，但把字段定位和测量来源放在 `fields.locator / fields.measurementOrigin` 中。这是预览表示方式，不应无评估地固化为所有来源的最终数据协议。

### 6.2 计划与同意

- 计划 hash 为 SHA-256：将 Plan 的 hash 清空后序列化计算；覆盖计划 ID、revision、动作、范围、版本等字段。
- `valid_plan` 检查计划身份/hash 与当前案例参数，只放行 `demo.analyze_fixture` 和当前 preview 策略。
- 批准需处于 awaiting_consent。同意绑定 caseId/hash，十分钟到期，启动事务中消费。
- 重建计划使旧同意无法用于新计划。重启时删除未消费同意。
- 成功后的重复启动，在 token 仍能通过身份/到期检查且已有对应 run/report 时返回已有报告；并非永久有效的重复请求缓存。

这些是最小演示门禁，不能声称已经有通用工具策略引擎、跨进程认证或完整业务授权系统。

### 6.3 实际状态流

```text
draft → awaiting_consent → collecting → completed_partial
应用启动恢复：awaiting_consent / collecting → interrupted
```

所有预览案例都落到 completed_partial，因为没有本机覆盖。当前 start 在命令内同步分析；没有可订阅的长任务进度、取消入口、超时、进程树清理和后台调度。不可直接把这段同步逻辑扩成持锁运行长时间系统检查。

## 7. 存储、导出与隐私的实际范围

桌面通过 `app_local_data_dir()` 创建 `metadata.sqlite`，应用标识 `local.sentinelpc.desktop`。不要将某台开发机的完整路径写死到代码。数据库 user_version=1：

- cases：`id` 主键，`body` 保存整个 CaseRecord JSON。
- consents：token、case_id、plan_hash、expires_at、consumed；case_id 外键级联删除。
- runs：id、case_id、plan_hash、status；同一案例/hash 唯一，外键级联删除。

启动时拒绝打开版本高于 1 的数据库，失效未消费同意并标记中断记录。当前没有完整迁移/备份、Artifact 表及文件仓库、审计表、空间预算或 30 天自动保留策略；不能按原规格写成“已支持”。

导出只取 report，默认不含用户 symptom、同意 token、数据库元数据或原始附件。对部分敏感键替换，并处理有限的路径/邮箱样式；Markdown 做基础转义。**当前脱敏仅适用于受控合成预览，尚未完成任意真实报告的隐私边界。** 不应把 Parser 原始输出直接分享或直接送给模型。

## 8. 规则具体做了什么

入口是 `rules::analyze(&Scenario, start, end)`，不是通用诊断 Agent。主要行为：

1. 按时间窗口筛选参与规则的证据；无观测时间的证据仍参与。Report 保留原 Scenario 的完整 evidence，未全部删去窗口外证据。
2. 精确匹配 kind/provider/channel/eventId/schemaVersion。目前 Windows 事件规则只支持合成 schema 0，不代表真实各 Windows 版本已适配。
3. Kernel-Power 41 → 观察到未正常关机后的启动；不会据此确诊电源、主板或 CPU。
4. Application Error 1000 → 应用异常线索；系统 DLL 名称不当成根因。
5. 应用异常与 WER 1001 关联：来源相同、entity 和 bootSession 均有值且相同、WER 在其后 0–120 秒。现有 source 比较不等于已实现正式机器身份校验。
6. storage.health 的 declaredHealth=failed → 合成报告声明告警；没有厂商通用 SMART 阈值诊断或寿命预测。
7. 输出 unknowns 和覆盖缺口；空记录不等于电脑正常。

当前文案直接含“样本/合成”等字样，报告 provenance 固定 synthetic。**不能把新 Parser 输出直接包装成 Scenario 喂入后，就宣称真实报告分析已完成**：会混淆来源，丢掉警告/解析状态，且沿用合成文案。需要先设计来源、警告、覆盖、关联和报告契约。

WHEA、显示驱动、蓝屏转储、游戏性能诊断、USB/PnP、完整时间线以及依据症状动态选择检查均未完成。

## 9. 两个 Parser 的能力和边界

接口：

```rust
pub fn parse_report(
    format: ReportFormat,
    bytes: &[u8],
) -> Result<ParseResult, ParseError>
```

ReportFormat 序列化值：`smartctl_json / crystal_disk_info_text`。ParseStatus：`parsed / partial / unsupported`；空输入、非法编码/结构、超限或重复字段等可返回 ParseError。`parsed` 表示当前解析路径完成，不表示工具健康通过或设备健康。

ParseResult 含 schemaVersion、status、parserVersion、sourceSha256、provenance、formatAcceptance、declaredToolVersion、encoding、evidence、warnings。当前 parserVersion=preview-0.2.0，provenance=imported_report_declared，formatAcceptance=synthetic_only。

| 格式 | 代码当前识别范围 | 不应夸大的地方 |
| --- | --- | --- |
| smartctl JSON | json_format_version=[1,0]，声明工具 7.2–7.5；ATA/NVMe/SCSI；UTF-8 可带 BOM | 只有合成样本验收，版本字符串由文件声明，不代表核验过真实程序 |
| CrystalDiskInfo 文本 | 声明 9.0–9.6；英文导出键；英文及已核对简中健康值；多盘；UTF-8/BOM、带 BOM UTF-16 LE/BE | 非任意本地化文本或截图/OCR；GBK 未支持，也未完成真实报告格式验收 |

其他已实现规则：

- 原始字节 SHA-256；同型号磁盘按报告/盘节区分，不靠型号合并。
- smartctl 退出状态保留位语义；8 不简单当启动失败，2 不简单当磁盘损坏。
- 未知版本 unsupported，缺失健康不默认为正常，冲突/缺失保留 warnings/partial。
- 无时区的 CDI Date 不伪造 UTC；导入时间不冒充故障或测试时间。
- 输入限额：20 MiB；JSON 嵌套 64、结构分隔符计数 20 万；字段 4 KiB；CDI 128 盘、10 万行；拒绝 JSON 重复键等。
- 保留序列号等声明字段用于本地解析；完整导出/发送脱敏尚需后续统一边界。

**尚未实现导入功能**：无文件选择授权、受控复制、重解析点/路径检查、ArtifactStore、数据库引用、一致性恢复、import_report IPC、UI 和真实报告验收。纯 Parser 不能证明这些已经具备。

## 10. 哪些是没做完，哪些可能是真正分歧

下面是待讨论点，**不是已经认定的用户立场或已确认的偏离**。请向所有者解释具体体验差别，再校准。

| 待核对点 | 原规格/当前选择 | 可能与期待的距离 | 性质 |
| --- | --- | --- | --- |
| 用户怎么开始 | 预览选择五类场景；描述只是保存 | 可能期待直接说“玩游戏黑屏”，Agent 追问和安排检查 | 当前实现缺口；最终问诊形态待确认 |
| Agent 主动程度 | 原规格有有界循环；目前只有固定单步 | 可能期待持续分析、补充检查、复测反馈 | 原规格未实现；自主范围待确认 |
| 第三方工具关系 | 首发基线为官网下载/用户导入；自动运行后移 | 可能期待工具箱式自动发现和一键受控运行 | 产品优先级/集成方式需校准 |
| AI 模型地位 | 原规格可选、默认关闭；目前无 Provider | 可能期待 AI 问诊和读报告是首要体验 | 产品设计选择与实现缺口同时存在 |
| 首个真实用途 | 先做日志和存储报告的窄范围闭环 | 可能更重视游戏卡顿、温度、内存、整机稳定性 | 首发场景与工具排序需校准 |
| 结果表达 | 确定性规则、限制和下一步 | 可能希望给排查优先级、候选原因和可操作路径 | 解释形式可改；不能虚构确诊或概率 |
| 修复与测试 | 首发基线无自动修复、压力测试、管理员助手 | 可能希望支持人工确认后的更多操作 | 范围决策；新增动作需独立设计权限/停止/恢复机制 |
| 数据与复测 | 最小案例历史，无真正复测对比 | 可能期待多份报告关联、改设置前后对照、长期记录 | 尚未实现；是否首发需确认 |

“还没实现”不等于产品方向有问题；“先不做”也不等于所有者永远不要。尤其不能把离线样本预览这一开发步骤当作最终产品收缩。

第三方工具许可应区分使用、自动化、打包与再分发。本文只说明既有基线，不提供新的授权结论；若改变集成方式，需针对实际工具/版本重新核实。公开 GitHub 仓库也不等于自有代码已经选定许可证。

## 11. 推荐向所有者集中校准的问题

建议先问前三项；其他项按回答继续，避免一次问完技术细节。

1. 你最希望演示的完整案例是什么？例如“游戏黑屏→问诊→拿到日志/工具报告→指出下一项检查”，还是“打开后先做整机概况/体检”？
2. 成熟工具在第一版需要做到哪一步：引导用户运行并导入报告、自动发现已安装工具并经确认运行，还是希望提供工具下载/管理？请区分运行与打包分发。
3. 模型是否必须成为第一版主体验？你希望它负责追问、读报告、解释还是选检查？本地规则和执行权限边界仍分别设计。
4. 第一版最重要的三个故障场景是什么？这决定采集来源和 Parser 优先级，不应由现有磁盘 Parser 倒推。
5. 每轮计划确认的体验可以接受吗？是否希望在一次明确授权范围内连续执行多个低风险检查？
6. 最后希望得到什么：简短建议、带证据的排查步骤、可分享报告，还是复测对比？哪些必须同时有？

请将回答整理成“保留 / 调整 / 暂缓 / 仍待确认”，再映射到任务。不要把本节示例替用户选为答案。

## 12. 校准后如何继续工程

以下只是依赖关系，不是未经确认的新排期：

- 若先解决“导入报告真能用”：补 ArtifactStore/安全导入/引用恢复与来源模型 → import_report IPC/契约 → 规则与警告接入 → 脱敏导出 → 真实脱敏报告验收。
- 若先解决“根据描述查本机”：补问诊结构与计划动作模型 → 固定 Windows 只读 Adapter 和受控 Runner → 覆盖/失败/取消/进度 → 真实事件规则 → 原生验收。
- 若先解决“AI 问诊/读报告”：先明确模型职责和数据发送范围 → Provider/密钥保护/脱敏/引用校验与调用预算 → 离线降级 → 与已存在证据和动作连接。不可让模型虚构已经运行过的检测。
- 自动发现/运行第三方工具、提权、压力测试和修复均属于新的动作路径，不能通过开放通用 Shell 代替设计。

原规格预算示例（**设计值，当前未实现对应 Runner/Agent**）：system_snapshot 30 秒/2 MiB；event_window 60 秒/2000 条/10 MiB；每轮最多 4 动作、案例最多自动 2 轮、最多并发 2 个低负载任务。若改变需求可以调整，但须与实现和验收一致。

前后端交接注意：现有 Zod 将 Report.provenance 固定为 synthetic、Plan.actionIds 固定为演示动作；新来源或动作必须显式扩展契约，不能强制类型转换、静默回退 Mock 或删除校验来让界面通过。

## 13. 验证证据与复现入口

历史记录：48 项 Rust 测试（18 离线/存储/规则 + 30 Parser），24 项前端/契约/配置测试通过；前端和原生 debug EXE 曾构建成功。浏览器演示操作有记录，原生只验证首页/初始化 IPC，完整原生流程与独立安装尚未验收。

**本次仅核对源码并编写文档，没有重跑以上测试、访问真实报告、采集当前电脑或核验远程 CI 状态。** 历史证据在 [validation/PREVIEW-0.1.md](validation/PREVIEW-0.1.md)、[REAL_MACHINE_TESTS.md](REAL_MACHINE_TESTS.md)、[PARSER_BACKEND.md](PARSER_BACKEND.md)。接手后按变更范围复验。

```powershell
npm ci --ignore-scripts   # 新检出时安装；已有依赖无需为了读文档重装
npm run check            # 类型与前端/契约测试
npm run test:core        # Rust 核心；scripts/desktop.ps1 优先采用本地 .tools
npm run build            # 前端
npm run desktop:build    # 内嵌前端的未签名 debug EXE，无安装器
```

本地 .tools、target、node_modules 和用户案例数据不入库。新环境需自行准备 Node、Rust MSVC、C++/Windows SDK、WebView2；版本及构建方式见锁文件和脚本。不要把开发机存在的 EXE 当作 GitHub 已提供安装包。

主要测试入口：[offline.rs](../crates/sentinel-core/tests/offline.rs)、[parsers.rs](../crates/sentinel-core/tests/parsers.rs)、[native-contract.test.ts](../tests/native-contract.test.ts)、[mock.test.ts](../tests/mock.test.ts)、[security-config.test.ts](../tests/security-config.test.ts)。

## 14. 可直接交给另一个 AI 的指令

```text
请阅读这份 Sentinel PC 后端交接文档。项目所有者认为整体方向正确，但部分细节可能偏离期待。

你的第一项任务是帮助校准需求，不是马上写代码。
如果能访问仓库，请先读 PROJECT_SPEC.md §0.1、§2、§7–11，再核对本文列出的 Rust/IPC/前端契约。
如果不能访问仓库，请明确仅基于本文分析；需要某段代码时再指出具体文件，不要假装检查过。

请先输出：
1. 用自己的话解释你理解的产品目标和用户体验。
2. 区分“原规格计划但尚未实现”“开发预览的临时简化”“真正需要所有者决定的产品分歧”。
3. 列出最值得核对的 3–5 个分歧；每项给出具体体验例子、可选方向和对后端的影响。
4. 先向所有者确认最影响方向的三个问题，再根据回答整理保留/调整/暂缓项。
5. 校准完成后，输出后端修改范围、受影响接口/数据迁移和可验收的一条真实路径。

请不要把现有五类合成场景当作完整需求，不要把两个纯 Parser 当作已经完成导入，
不要把固定样本规则当作已有自主 Agent，也不要把规格中的所有默认限制说成用户亲口要求。
事实不足就标记未知；不要承诺已经支持真实诊断、真实格式、工具自动运行或模型能力。
前端将由另一个 Agent 升级；涉及契约变化请明确写成交接事项。
```
