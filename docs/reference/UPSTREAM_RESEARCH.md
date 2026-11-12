# Sentinel PC：Pulse Diagnostics 与 PC-AI 复用研究

> 日期：2026-11-12  
> 对象：项目所有者与接手开发的 Codex。  
> 研究方式：固定提交、选择性源码审查、纯函数与模拟输入核验。  
> 状态：研究结论与迁移建议，尚未将任何上游模块集成进 Sentinel PC。

## 1. 先说结论

**两个项目都有值得复用的部分。建议保留 Sentinel PC 的 Tauri + Vue + Rust 方向，选择性迁移，不整仓接入。**

- **Pulse 提供解释层的起点**：事件解释、错误代码词典、事件关联、只读工具白名单、有限轮数 Agent 和脱敏测试。
- **PC-AI 提供采集层的起点**：PnP/USB 设备查询、CIM 数据结构、采集失败处理经验、工具注册表及报告分节思路。
- **仍需自行建设的核心**：第三方工具许可门禁、CrystalDiskInfo/smartctl 报告 Adapter、同意与计划绑定、统一证据模型、受控 Rust 执行器，以及中文问诊。

这里的“自行建设”是应用编排、解析与产品流程，不是重新开发硬件检测引擎。研究没有改变原规格“不造底层检测引擎”的原则。

最先复用四项：**Pulse 的事件解释/关联结构、Pulse 的脱敏规则与测试、PC-AI 的只读设备查询逻辑、两者的受限工具调用思路**。不先引入后台服务、完整本地推理栈或个人工作站修复脚本。

## 2. 核对范围与可信度

| 项目 | 本次固定提交 | 分支 | 主要技术 |
| --- | --- | --- | --- |
| Pulse Diagnostics | `682a3487328b1016e820ceef263b7417815edb01` | master | Flutter/Dart 界面 + C++20 Windows 服务 |
| PC-AI | `465518eeb4db6ba52d52654fc6229b5970041a42` | main | PowerShell 模块 + Rust/C# 原生层 + 本地模型路由 |

本次取得并检查了 **44 份选定源码、配置、测试和许可文件**，重点逐段审查下面涉及复用决策的实现。文件列表和提交见随附的 `Sentinel-PC-复用源码清单.json`。这里不是全仓安全审计，也未审完依赖锁文件、构建产物和所有 Windows 分支。

额外在 PowerShell 7.6.9 中完成 **6 项隔离核验**：只加载审阅过的函数，输入为合成数据；事件读取已替换为模拟函数，没有运行真实系统诊断、访问磁盘设备、修复系统、启动模型或消耗 API 额度。结果见 `Sentinel-PC-复用核验记录.json`。

明确未验证：两套应用能否在本机完整构建/安装、全量上游测试是否通过、Windows PowerShell 5.1 兼容性、真实故障判断准确率、长期运行性能。本机没有可直接使用的 Dart/Flutter 工具链，因此 Pulse 结论属于源码审查，未执行其原始测试。

### 2.1 本报告中的复用等级

| 等级 | 含义 |
| --- | --- |
| A 改造后迁入 | 存在可提取的具体代码/数据，但需适配接口、许可声明与测试 |
| B 移植逻辑 | 语言/架构不同，提取规则和算法，改写为 Rust/TypeScript/数据表 |
| C 借鉴设计 | 只采用职责划分或交互方式，不引入上游运行组件 |
| D 暂不采用 | 与首发范围不符、依赖太重，或验证不足 |

**没有任何条目被认定为“复制进去就已经可用于生产”。**

## 3. 许可是否允许复用

两个项目在固定提交中的主许可证均为 **MIT**：允许在满足条款的前提下使用、修改和分发，需保留版权与许可声明。[Pulse 许可证][P00]、[PC-AI 许可证][C00]

对 Sentinel PC 的具体影响：

1. 可以将符合条件的自有代码片段、规则结构和测试迁入项目，并注明来源；翻译、跨语言移植不意味着可以删除上游版权声明。
2. 在 `THIRD_PARTY_NOTICES.md` 和迁入目录中记录项目、作者、提交、文件与 MIT 文本；修改部分说明 Sentinel 的适配内容。
3. 不用上游产品名称、Logo、安装包身份和截图作为 Sentinel 的品牌资源。Pulse 的字体资源另有 OFL 声明，不能将“主仓库 MIT”理解为所有资产都没有其他义务。[Pulse 应用配置][P01]
4. PC-AI 的原生推理、模型权重、外部 CLI、下载的 DLL 和所有依赖要逐项检查；其项目许可不代替模型/第三方工具许可。
5. 本报告不授权打包 HWiNFO、OCCT 等工具；原项目文档中的逐工具审核要求仍然有效。

当前只是选择复用对象，尚未复制代码进入发布工程，因此不在此报告中假装已经完成发行级依赖许可审计。

## 4. Pulse Diagnostics：具体可用的部分

### P-A：事件解释与错误代码词典——B，最高优先级

重点源码：

- `service/pulse_service/src/intelligence/crash_explainer.cpp`：[源码][P02]
- `service/pulse_service/src/intelligence/bugcheck_catalog.cpp`：[源码][P03]
- `service/pulse_service/src/intelligence/app_crash_explainer.cpp`：[源码][P04]
- `service/pulse_service/src/intelligence/event_intelligence.cpp`：[源码][P05]

**实际看到的实现**：从事件 XML 取错误检查代码和其他数据，将异常重启、蓝屏、应用崩溃/挂起、服务异常、显示恢复等转成结构化说明。应用错误解释会读取应用名、模块名、异常码与路径，区分模块来源，而不是只显示“Event 1000”。

**我们可以迁移什么**：

- stop code → 符号名称的基础词典；未知代码保留原码。
- 应用错误字段提取、系统/驱动/应用模块来源分类。
- “发生了什么 / 有哪些可能 / 下一步”分开的输出结构。
- 蓝屏代码十进制/十六进制处理、未知值回退等测试场景。[相关测试][P06]

**如何落到 Sentinel**：将纯数据整理为带来源的 JSON，将字段解析和判定移到 Rust `rules/windows/`；中文解释放独立文案表。保留原始 Provider、Channel、Event ID、Version、Record ID 和 Evidence ID。

**必须修改**：

1. stop code 的类别只是排查方向，不能变成“该部件已坏”。例如 Memory 类不等于已经确认内存条损坏。
2. 上游有“检查供电/温度/超频”“重装驱动”等建议；我们应按证据和风险重写为逐步引导，不直接提供自动执行入口。
3. 上游使用的 Provider 子串识别应在我们这里收紧为受支持的来源与 schema，防止其他 Provider 的相同编号误命中。
4. XML 提取不能机械照搬字符串扫描。使用受限、安全的解析器，补齐转义、缺字段、格式损坏及版本差异测试。

**收益判断**：能减少从零收集常见事件字段和解释框架的工作；没有证据支持承诺节省多少百分比工时。

### P-B：事件关联与时间线——B，最高优先级

重点源码：`apps/pulse_app/lib/features/timeline/timeline_incident_engine.dart`。[源码][P07] 规则说明另有每项误报条件。[设计说明][P08]

**已有做法**：按事件类型建立候选索引，使用规则和时间窗口关联事件；已关联事件避免在列表中重复占位；结果记录规则 ID 和相关事件 ID。规则包括应用错误与 WER、蓝屏与重启、服务异常与后续状态变化、单条显示恢复记录等。

**适合迁移的结构**：

```text
CorrelationRule
  id / provider / eventId / window
  requiredIdentityFields
  supportedEvidenceKinds
  explanationKey / falsePositiveNotes

MatchedIncident
  ruleId / evidenceIds / observations / limitations
```

**不能原封不动沿用的点**：

- 当前匹配函数主要依据编号、Provider 子串和最近时间差，没有同时校验应用、服务身份、机器或启动会话。
- 例如多服务同时异常时，某服务的 7031 可能与另一服务的 7036 被配对；上游文档已承认这种误报条件。
- 源码使用时间差绝对值，规则文字中的“先后”不等于实现强制了该顺序。
- 异常关机配对窗口较长，不能直接用于我们面向“刚才发生的问题”的首轮诊断。
- high/medium/low 是规则自带级别，不是经实测校准的根因概率。

**Sentinel 的改造**：加入 case/machine/source/boot session 和实体身份约束；缺少同实体字段时只显示“可能相关”，保留未关联事件。不能为了把多条日志凑成故事而补造事件。相关上游测试可以迁移为回归场景，并新增“不同应用/不同服务/跨启动会话不关联”。[上游测试][P09]

### P-C：脱敏规则与测试——B，最高优先级

重点源码：`personal_data_redactor.dart` 及对应测试。[实现][P10]、[测试][P11]

**已有能力**：用户名、用户目录、电脑名、账户 SID、邮件、IPv4、MAC、显式提供的序列号脱敏；固件占位序列号不当成真实秘密；JSON 中递归处理字符串。还考虑了长名字优先、整词匹配和共享用户目录。

**我们最值得借的**：脱敏字段分类、固件占位值集合、递归处理结构化数据的方式、误伤普通词语和保留必要诊断信息的测试。

**改造要求**：

1. 放在 Rust 导出与模型发送的共同边界，不能只做 Vue 展示层替换。
2. 增加 IPv6、UNC/共享路径、URL 内凭据、令牌样式内容、中文/Unicode 账号名和 JSON 键名的处理。
3. 对有类型的字段按类型脱敏；无类型自由文本才用正则回退。
4. 源码的 IPv4 规则会把四段均在 0–255 内的版本样式文本也当作 IP，例如 `1.2.3.4`；这是静态分析推断，未运行 Dart。已有版本测试只覆盖了含大于 255 段的例子，不能证明所有版本号都安全保留。
5. 使用案例内稳定占位符 `USER_1 / DISK_1`，本机映射不导出；仍保留分享预览和手动删除能力。

### P-D：只读工具白名单与 Agent 循环——B/C，高优先级

重点源码：`diagnostic_tool_allowlist.dart`、`assistant_orchestrator.dart`、`ipc_assistant_tool_layer.dart`。[白名单][P12]、[编排器][P13]、[工具实现层][P14]

**实际有的东西**：明确列出可给模型使用的读取工具；Shell、安装、删除、服务变更等不在助手工具清单中；编排器限制工具循环轮数、支持取消和错误返回；工具层对列表数量等参数做具体约束。

**可以借鉴**：先枚举能力，再给模型；工具结果返回模型，而不是让模型自己构造终端操作。工具活动和错误状态能显示给用户。

**不能照搬成安全结论**：这些是 Pulse 的 Dart/IPC 架构中的控制。移植到 Tauri 后，必须在 Rust 后端重新做独立校验；前端白名单和“危险名字包含检查”都不能代替权限门禁。6 轮限制也不等于总工具调用数限制，我们还需限制每轮/总动作数、输出、时长、许可与同意令牌。

首发保留规格中的默认模型关闭、规则可独立完成；不因 Pulse 支持本地模型就立即扩展我们的网络策略和硬件依赖。

### P-E：Windows 原生日志采集和 EVTX 导入——C/P1

源码通过 Windows Event Log API 读取事件，按批次取得数据，并具备读取导出 EVTX 文件的路径。[采集器][P15]、[EVTX 读取][P16]

值得研究的点是系统字段提取、事件句柄生命周期、逐条失败继续、记录数上限和截断标记。实际复制会牵涉 C++ 公共类型、wevt helpers、IPC/日志工具，并非单文件独立库。

**建议**：P0 继续固定 PowerShell 只读 Adapter；需要摆脱 PowerShell 或支持 `.evtx` 时，再参考这些 Win32 API 路径写 Rust Adapter。不要为了复用一个采集器，把整个 C++ 服务和 Flutter 都带进来。

另需保留部分失败计数：上游部分读取错误可能在已得到数据后返回成功或只记日志；我们的导出报告仍应让用户看到“跳过/截断/未完整覆盖”。

### P-F：界面、后台服务和健康分——C/D

- 事件的“通俗解释 / 技术详情 / 原始 XML”层次可借鉴；中文问诊仍按 Sentinel 的场景设计。
- Flutter 页面不能直接作为 Vue 组件复用；重写页面时不照搬品牌、Logo、商店身份和安装配置。
- 不在首发引入 PulseService 常驻服务；原规格是普通权限、按需诊断。
- 不迁移一个整机健康总分作为首发卖点；我们优先展示覆盖度与证据强度。

## 5. PC-AI：具体可用的部分

### C-A：设备管理器异常与 USB 查询——A，高优先级

重点源码：`Get-DeviceErrors.ps1`、`Get-UsbStatus.ps1` 及私有格式化辅助函数。[设备查询][C01]、[USB 查询][C02]、[辅助函数][C03]

**已有实现**：查询 `Win32_PnPEntity`，输出设备名、设备类别、厂商、ConfigManagerErrorCode、状态、DeviceID 等结构化属性；设备异常查询还能尝试原生后端后回退 CIM。

**可提取边界**：只取固定 CIM 查询和数据映射。使用有边界的参数，不扫描整个机器找程序、不执行修复、不加载整套 PC-AI 模块。原有异常码说明作为初稿，逐项核对 Windows 定义再中文化，严重度重新按产品规则定义。

**需要补齐**：

- 移除首发不需要的 `PcaiNative` 依赖路径，避免隐式加载 DLL。
- 设备状态为 Unknown、禁用、未连接时，不自动解释为硬件损坏。
- 当前 USB 查询主要用 `PNPClass == USB` 或名字包含 USB 筛选，不等于覆盖所有 USB 端点、HID 或触控设备，不能拿它直接确诊断触。
- 加超时、输出大小、隐私字段、稳定设备标识和 `succeeded/partial/failed` 包装。
- 设备枚举不是报告导入；新增为一个明确动作，先走计划同意和限额，不悄悄扩大基础概况范围。

建议先作为 P1 `windows.device_status`，P0 继续做已确定的系统概况与事件窗口，避免研究导致首发失控。

### C-B：系统事件查询——A/B，需要明显改造

重点源码：`Get-SystemEvents.ps1`。[源码][C04]

值得复用的是 CIM/原生路径回退、按时间/级别查询、区分空结果和真正失败的意图，以及结构化对象输出。

但是该函数当前面向 System 日志中的存储/USB 等 Provider，使用按天回看，不是完整游戏/办公崩溃采集器。它没有覆盖我们的 Application 日志和分钟级事故窗口，也没有保留所需的全部 XML/Record ID/Channel/schema 信息。

**迁移做法**：将接口改成显式 UTC 起止范围和固定 channel/provider profile；保留 XML/系统字段；查询端过滤与条数/字节上限结合；空结果通过稳定错误标识判断。不能靠英文报错文案，也不能只留下 `Message` 第一行。

### C-C：磁盘状态的数据边界——C，保留概念，不迁入检测层

重点源码：`Get-DiskHealth.ps1` 以及 Rust `telemetry/disk_health.rs`。[PowerShell 包装][C05]、[Rust 采集][C06]

**这项需要纠正“看名字就以为完整”的印象**：当前检查到的 Rust 路径访问物理磁盘并调用 `SMART_GET_VERSION`，用来标识能力；返回的健康数据可用标志为 false，健康状态保留 Unknown。源码本身也有“能力不等于健康”的测试。

PowerShell 包装包含原生回退、CIM 和旧 WMIC operational status；并显式用 `HealthDataAvailable / HealthSource / IsSmartOK` 区分是否真的测得 SMART 健康。我们可以借这组“数据来源与测量状态”的表达，但不能把当前原生采集器当成完整 SMART/NVMe 检测方案。

其他迁移风险包括以 Model 辅助匹配可能混淆同型号多盘，以及缺失容量以 0 代替 null 等。Sentinel 应继续按原规格解析成熟工具报告，用稳定设备标识关联，不复制这条底层磁盘路径。

### C-D：工具目录与两阶段模型路由——C

重点源码：`Config/pcai-tools.json`、`Invoke-LLMChatRouted.ps1`、`Invoke-FunctionGemmaReAct.ps1`。[工具目录][C07]、[路由][C08]、[工具调用][C09]

有价值的设计：将工具名、输入 Schema、模块命令映射分开；先获得工具调用和结果，再让主模型解释；路由失败时记录 degraded mode；有调用数量和结果长度限制。

但不能原样导入整个目录：它同时包含其他领域工具、推理/媒体/虚拟化入口，而不是 Sentinel 已审的只读动作集。当前目录也没有我们的逐工具使用/分发许可字段、计划摘要与单次同意边界。

**推荐**：只借 Schema 和 registry 形式，使用 Rust 编译期动作注册，不让可编辑 JSON 直接决定任意 cmdlet。P0 不需要引入“路由模型 + 主模型”两套推理服务，先用确定性计划/一个可选解释 Provider 即可。

### C-E：报告分节和诊断 JSON——B/C

重点源码：`New-DiagnosticReport.ps1` 和 `DIAGNOSE_TEMPLATE.json`。[报告实现][C10]、[诊断模板][C11]

可以借“采集分节、某节失败不影响其他节、摘要/发现/建议/缺失项分离”的组织方式。不要沿用默认写用户桌面的路径，也不要用格式化表格文本作为内部数据协议。

原诊断模板的 evidence 是自由文本；我们的版本应改为 `evidenceIds`，加 Schema、版本、来源和引用校验。`ConvertFrom-LLMJson` 能帮助理解如何处理模型 JSON，但其 Strict 主要针对 JSON 解析，不等于模型结论真实、字段完整或引用有效。[解析代码][C12]

### C-F：测试场景——B，高优先级

`Tests/Unit/PC-AI.Hardware.Tests.ps1` 包含设备异常、空设备、磁盘状态、查询失败、USB 状态和报告局部失败等 Mock 场景。[测试][C13]

这些场景很适合转成 Sentinel Adapter 契约测试。但是旧测试的断言应重新评估：接受“发生错误后返回空数组”的断言，不能直接满足我们区分失败/空结果的需求。也不能把 Mock 返回健康磁盘当成真实硬件验证。

### C-G：不迁移的部分——D

- 完整本地模型推理、GPU/CUDA、训练和媒体管线：超出首发需要，部署和许可审核都会变重。
- 针对作者个人机器、进程调度软件、同步软件、触控固件的修复脚本：环境假设太多，且包含系统变更。
- 原有动态 PowerShell 模块执行器：不能替代 Sentinel 的固定 Rust 执行入口。
- 上游 Reports 中的真实工作站资料：公开可读不代表适合作为我们的样本包；不复制个人数据，也不当作故障标注真值。
- 所有性能倍数、质量评测结论：本次未复现，不写入 Sentinel 的宣传或验收结果。

## 6. 本次核验出的具体适配问题

下面区分“已隔离复现”与“仅源码判断”。这些是决定如何移植的证据，不是对两个项目整体安全性的结论，也不是已经执行了完整渗透测试。

### 6.1 六项已运行的隔离核验（PC-AI）

| ID | 合成输入/检查 | 实际结果 | 对 Sentinel 的影响 |
| --- | --- | --- | --- |
| R01 | Schema 声明 `additionalProperties=false`，传入额外字段 | `Confirm-ToolParameters` 返回有效 | 不能直接用作封闭动作接口的校验器 |
| R02 | Schema 规定整数 1–30，传入 100000 | 返回有效 | 需真正执行上下界/长度约束 |
| R03 | 嵌套对象缺少 Schema 要求的 name | 返回有效 | 需递归校验嵌套 required/properties |
| R04 | 对照 USB 工具配置与函数参数 | 配置映射 `ErrorsOnly`，函数参数是 `OnlyErrors` | 导入目录前必须验证每个映射，不能仅按名字认为已打通 |
| R05 | 通过 PowerShell `Invoke-ToolByName` 执行只返回两行合成对象的函数 | 返回空白样式文本，未保留有效 JSON 两行数据 | 修复集合序列化，统一返回 envelope；不只校验“没抛异常” |
| R06 | 模拟英文/中文“没有匹配事件”报错 | 英文被视为空结果，中文进入外层查询失败分支 | 对中文系统必须换成稳定错误标识判断 |

R01–R03 对应的校验函数主要检查必需字段、类型与 enum；原测试还明确允许额外字段。[校验实现][C14]、[原测试][C15]

R05 只针对 `LLM-Helpers.ps1` 中的 PowerShell `Invoke-ToolByName` 路径。该函数将单个对象序列化，但集合进入字符串转换；**不代表另外的 C# ToolExecutor 也存在相同输出行为**。[具体执行函数][C16]

R06 使用相同含义的中英文合成错误消息，没有访问实际 Windows 日志。它证明这段文案分支依赖语言，不是对所有中文 Windows 版本实际错误格式的完整测量。[查询实现][C04]

这些检查在 PowerShell 7.6.9 运行；Windows PowerShell 5.1 还需单独验证。目标不是把上游所有问题修完，而是在迁移边界消除与我们要求不符的行为。

### 6.2 仅源码审查确认/推断的重点

| 对象 | 观察 | 迁移要求 |
| --- | --- | --- |
| Pulse 关联器 | 主要匹配 Provider 子串、编号和绝对时间差 | 加机器/实体/启动会话条件；不把配对当因果证明 |
| Pulse 脱敏 | 未见 IPv6 规则；四段短版本号可被 IPv4 规则误伤 | 有类型字段优先；补 Unicode/IPv6/版本号误伤用例 |
| Pulse Agent | 有轮数限制，但一轮内遍历模型返回的多个调用 | 另加动作数量、累计预算与后端策略 |
| PC-AI SMART 路径 | Rust 当前只验证能力，未测得完整健康状态 | 保留 Unknown；继续用成熟工具报告 |
| PC-AI 报告聚合 | 部分失败被替换为空数组，主要靠 warning 告知 | 把每节状态和错误保存到结构化报告 |
| PC-AI 模型 JSON | 可解析 JSON 不等于有效诊断 Schema 或真实证据 | 独立校验 Schema、证据 ID、动作许可与结论边界 |

## 7. 建议的复用组合与目标结构

```text
Sentinel PC（Tauri + Vue + Rust）
  ├─ Vue 问诊/计划/结果页：自行实现
  ├─ Rust Policy/Runner：按原规格自行实现
  ├─ Windows 日志 Adapter：参考 PC-AI，保留首发固定采集方案
  ├─ 设备/USB Adapter：提取 PC-AI 的只读 CIM 逻辑，后续新增
  ├─ 事件解释/关联：移植 Pulse 结构与测试，补身份关联和中文文案
  ├─ 脱敏：移植 Pulse 思路与测试，统一放 Rust 边界
  ├─ 第三方报告 Adapter：自行实现 CrystalDiskInfo/smartctl Parser
  └─ 可选模型：借鉴受限工具循环，保留自己的 Provider 与预算策略
```

建议布局：

```text
src-tauri/src/rules/windows/
  event_catalog.rs
  bugcheck_catalog.rs
  application_fault.rs
  incident_correlator.rs
src-tauri/src/redaction/
  typed_fields.rs
  text_fallback.rs
src-tauri/scripts/
  collect_event_window.ps1
  collect_device_status.ps1        # P1，独立计划动作
resources/rules/windows/
  explanations.zh-CN.json
resources/upstream-licenses/
  pulse-MIT.txt
  pc-ai-MIT.txt
docs/UPSTREAM_REUSE.md
tests/fixtures/synthetic/
```

原有 `Sentinel-PC-Codex开发项目文档.md` 仍是范围基线；本研究补充“从哪里取材”，不默认扩大 P0、不替换 Tool Adapter 接口。

### 7.1 三条路线比较

| 路线 | 有利处 | 代价 | 建议 |
| --- | --- | --- | --- |
| 直接 fork Pulse | 已有桌面诊断、日志解释、时间线和报告形态 | 要接受 Flutter/C++/服务结构；第三方工具调度和我们的许可门禁仍需开发 | 如果愿意改技术栈，值得另做构建验证后再决定 |
| 直接 fork PC-AI | 已有大量模块与模型路由入口 | 范围宽、部署复杂、个人工作站脚本较多，面向小白的产品还需整理 | 不作为首发底座 |
| 选择性提取 | 保留 Tauri/Vue，复用最有价值的规则、脚本与场景 | 需做跨语言移植和边界测试 | **当前推荐** |

此结论是针对用户已选的技术路线和首发范围，不是声称其中某项目整体质量更好。

## 8. 给 Codex 的复用任务顺序

先完成原规格 C00/C01/C02 的工程与数据模型，再做以下迁移；不要先复制整个仓库。

| 任务 | 具体操作 | 对应原任务 | 验收 |
| --- | --- | --- | --- |
| U00 固定来源 | 依据随附清单获取指定提交；记录选中文件与依赖闭包，保存 MIT 文本 | C00/C06 | `UPSTREAM_REUSE.md` 可定位每项来源；不引入未审核二进制/模型/品牌资产 |
| U01 统一结果 | 定义采集 envelope、证据 ID、时间/来源/错误/截断；序列化数组与空值 | C02/C04/C05 | 0/1/多行对象都能保真；失败与空结果不同 |
| U02 事件采集 | 参考 PC-AI 重写固定窗口查询，加 System/Application/XML/Record ID 与稳定错误识别 | C04 | 中文/英文空结果、权限失败、无效范围、超限均有测试；5.1 实测 |
| U03 迁移解释 | 从 Pulse 选 41、错误检查、应用崩溃/挂起、显示恢复等首批数据结构与词典 | C08 | 只能输出已提供证据支持的观察；无硬件确诊；每项有来源和中文文案 |
| U04 迁移关联 | 移植事件索引/配对/去重，增加同实体、机器、启动会话条件 | C08 | 不同服务、不同进程、跨机器、跨启动不误配；缺身份时保留不确定性 |
| U05 迁移脱敏 | 参考 Pulse 实现 Rust 脱敏与测试，补 IPv6/UNC/Unicode/版本号/令牌 | C10 | 导出和模型发送均经过同一层；可预览；原始证据不被破坏 |
| U06 约束编排 | 借 Pulse 白名单与循环，但动作注册和策略在 Rust，默认规则模式 | C06/C09/C11 | 额外字段、超限、无许可、旧同意均拒绝；模型关闭仍完成诊断 |
| U07 可选设备扩展 | 选取 PC-AI 的 PnP/USB CIM 逻辑，移除原生 DLL 路径并修正参数映射 | P1 | 普通权限、缺字段、禁用/离线设备都有区别；不承诺检出所有断触 |

### 8.1 第一轮最小成果

第一轮只做一个可审查的闭环：**合成 Windows 事件 → 统一 Evidence → 中文解释 → 同实体事件关联 → 脱敏 Markdown 报告**。

这样可先验证复用价值和证据边界，不依赖安装第三方工具、真实制造故障或接通模型。随后接入实际只读日志采集；真实采集、真实报告格式与故障诊断准确性分别验收。

### 8.2 迁移后必须新增的回归样例

- 只有 41 且错误检查代码为 0：只能确认未正常关机迹象。
- 相同事件编号、不同 Provider：不混用规则。
- 两个不同应用各发生一次崩溃：不能按最近时间乱配 WER。
- 不同服务的异常与运行状态：不能形成“已自动恢复”结论。
- 型号相同的两块盘：不得合并健康状态。
- 无事件、读取拒绝、超时、截断：四种输出明确不同。
- 中文与英文系统错误：状态语义一致。
- 0/1/多条采集对象：JSON 中数量与字段一致。
- 未知字段、越界整数、嵌套缺字段：动作接口拒绝。
- 报告中的指令、恶意文件名和无效 Evidence ID：不改变执行与推理权限。
- IPv4、IPv6、中文用户名、UNC 路径、短四段版本号：隐私处理与诊断信息保留有明确策略。

## 9. 可复制给 Codex 的补充指令

```text
在 docs/PROJECT_SPEC.md 的 Sentinel PC 规格基础上，参考本研究做选择性复用。

上游固定为：
Pulse Diagnostics：682a3487328b1016e820ceef263b7417815edb01
PC-AI：465518eeb4db6ba52d52654fc6229b5970041a42

不要整仓导入或运行上游修复入口。
先建立 UPSTREAM_REUSE.md 和 MIT 版权/许可保留，再按 U00–U06 推进。
保留 Tauri + Vue + Rust、普通权限、规则离线可用和第三方报告导入的范围。

优先迁移 Pulse 的事件解释结构、错误代码词典、关联规则和脱敏测试。
PC-AI 只提取已审的只读采集逻辑；不要带入完整 DLL/推理/训练/媒体/修复栈。

必须处理研究中发现的问题：参数名不匹配、集合序列化、英文空事件文案、
参数校验不完整、时间关联缺身份约束、脱敏误伤与缺失字段。
不要把 SMART 能力探测当成 SMART 健康检测，不复制其底层磁盘探测路径。

第一轮做合成事件→Evidence→中文解释→关联→脱敏报告，再接真实日志。
分别记录来源审查、移植单测、Mock 流程、PowerShell 5.1 和真实 Windows 验收状态。
不得把本研究的源码检查或 6 个隔离用例写成上游软件已通过完整实机验收。
```

## 10. 源码索引

以下链接全部指向本次固定提交。若后续选择不同提交，重新核对差异，不能直接沿用本报告的行为结论。

| 编号 | 文件 |
| --- | --- |
| P00 | [Pulse LICENSE][P00] |
| P01 | [Pulse pubspec.yaml][P01] |
| P02 | [crash_explainer.cpp][P02] |
| P03 | [bugcheck_catalog.cpp][P03] |
| P04 | [app_crash_explainer.cpp][P04] |
| P05 | [event_intelligence.cpp][P05] |
| P06 | [crash_explainer_test.cpp][P06] |
| P07 | [timeline_incident_engine.dart][P07] |
| P08 | [timeline correlation rules][P08] |
| P09 | [timeline_incident_engine_test.dart][P09] |
| P10 | [personal_data_redactor.dart][P10] |
| P11 | [personal_data_redactor_test.dart][P11] |
| P12 | [diagnostic_tool_allowlist.dart][P12] |
| P13 | [assistant_orchestrator.dart][P13] |
| P14 | [ipc_assistant_tool_layer.dart][P14] |
| P15 | [event_log_collector.cpp][P15] |
| P16 | [evtx_file_reader.cpp][P16] |
| C00 | [PC-AI LICENSE][C00] |
| C01 | [Get-DeviceErrors.ps1][C01] |
| C02 | [Get-UsbStatus.ps1][C02] |
| C03 | [Format-Helpers.ps1][C03] |
| C04 | [Get-SystemEvents.ps1][C04] |
| C05 | [Get-DiskHealth.ps1][C05] |
| C06 | [telemetry/disk_health.rs][C06] |
| C07 | [pcai-tools.json][C07] |
| C08 | [Invoke-LLMChatRouted.ps1][C08] |
| C09 | [Invoke-FunctionGemmaReAct.ps1][C09] |
| C10 | [New-DiagnosticReport.ps1][C10] |
| C11 | [DIAGNOSE_TEMPLATE.json][C11] |
| C12 | [ConvertFrom-LLMJson.ps1][C12] |
| C13 | [PC-AI.Hardware.Tests.ps1][C13] |
| C14 | [Validate-ToolParameters.ps1][C14] |
| C15 | [Validate-ToolParameters.Tests.ps1][C15] |
| C16 | [LLM-Helpers.ps1 / Invoke-ToolByName][C16] |

[P00]: https://github.com/Regncreative/PulseDiagnostics/blob/682a3487328b1016e820ceef263b7417815edb01/LICENSE
[P01]: https://github.com/Regncreative/PulseDiagnostics/blob/682a3487328b1016e820ceef263b7417815edb01/apps/pulse_app/pubspec.yaml
[P02]: https://github.com/Regncreative/PulseDiagnostics/blob/682a3487328b1016e820ceef263b7417815edb01/service/pulse_service/src/intelligence/crash_explainer.cpp
[P03]: https://github.com/Regncreative/PulseDiagnostics/blob/682a3487328b1016e820ceef263b7417815edb01/service/pulse_service/src/intelligence/bugcheck_catalog.cpp
[P04]: https://github.com/Regncreative/PulseDiagnostics/blob/682a3487328b1016e820ceef263b7417815edb01/service/pulse_service/src/intelligence/app_crash_explainer.cpp
[P05]: https://github.com/Regncreative/PulseDiagnostics/blob/682a3487328b1016e820ceef263b7417815edb01/service/pulse_service/src/intelligence/event_intelligence.cpp
[P06]: https://github.com/Regncreative/PulseDiagnostics/blob/682a3487328b1016e820ceef263b7417815edb01/service/pulse_service/test/crash_explainer_test.cpp
[P07]: https://github.com/Regncreative/PulseDiagnostics/blob/682a3487328b1016e820ceef263b7417815edb01/apps/pulse_app/lib/features/timeline/timeline_incident_engine.dart
[P08]: https://github.com/Regncreative/PulseDiagnostics/blob/682a3487328b1016e820ceef263b7417815edb01/docs/architecture/37-timeline-correlation-rules.md
[P09]: https://github.com/Regncreative/PulseDiagnostics/blob/682a3487328b1016e820ceef263b7417815edb01/apps/pulse_app/test/timeline_incident_engine_test.dart
[P10]: https://github.com/Regncreative/PulseDiagnostics/blob/682a3487328b1016e820ceef263b7417815edb01/apps/pulse_app/lib/features/privacy/personal_data_redactor.dart
[P11]: https://github.com/Regncreative/PulseDiagnostics/blob/682a3487328b1016e820ceef263b7417815edb01/apps/pulse_app/test/personal_data_redactor_test.dart
[P12]: https://github.com/Regncreative/PulseDiagnostics/blob/682a3487328b1016e820ceef263b7417815edb01/apps/pulse_app/lib/assistant/diagnostic_tool_allowlist.dart
[P13]: https://github.com/Regncreative/PulseDiagnostics/blob/682a3487328b1016e820ceef263b7417815edb01/apps/pulse_app/lib/assistant/assistant_orchestrator.dart
[P14]: https://github.com/Regncreative/PulseDiagnostics/blob/682a3487328b1016e820ceef263b7417815edb01/apps/pulse_app/lib/assistant/ipc_assistant_tool_layer.dart
[P15]: https://github.com/Regncreative/PulseDiagnostics/blob/682a3487328b1016e820ceef263b7417815edb01/service/pulse_service/src/collectors/event_log_collector.cpp
[P16]: https://github.com/Regncreative/PulseDiagnostics/blob/682a3487328b1016e820ceef263b7417815edb01/service/pulse_service/src/collectors/evtx_file_reader.cpp
[C00]: https://github.com/David-Martel/PC-AI/blob/465518eeb4db6ba52d52654fc6229b5970041a42/LICENSE
[C01]: https://github.com/David-Martel/PC-AI/blob/465518eeb4db6ba52d52654fc6229b5970041a42/Modules/PC-AI.Hardware/Public/Get-DeviceErrors.ps1
[C02]: https://github.com/David-Martel/PC-AI/blob/465518eeb4db6ba52d52654fc6229b5970041a42/Modules/PC-AI.Hardware/Public/Get-UsbStatus.ps1
[C03]: https://github.com/David-Martel/PC-AI/blob/465518eeb4db6ba52d52654fc6229b5970041a42/Modules/PC-AI.Hardware/Private/Format-Helpers.ps1
[C04]: https://github.com/David-Martel/PC-AI/blob/465518eeb4db6ba52d52654fc6229b5970041a42/Modules/PC-AI.Hardware/Public/Get-SystemEvents.ps1
[C05]: https://github.com/David-Martel/PC-AI/blob/465518eeb4db6ba52d52654fc6229b5970041a42/Modules/PC-AI.Hardware/Public/Get-DiskHealth.ps1
[C06]: https://github.com/David-Martel/PC-AI/blob/465518eeb4db6ba52d52654fc6229b5970041a42/Native/pcai_core/pcai_core_lib/src/telemetry/disk_health.rs
[C07]: https://github.com/David-Martel/PC-AI/blob/465518eeb4db6ba52d52654fc6229b5970041a42/Config/pcai-tools.json
[C08]: https://github.com/David-Martel/PC-AI/blob/465518eeb4db6ba52d52654fc6229b5970041a42/Modules/PC-AI.LLM/Public/Invoke-LLMChatRouted.ps1
[C09]: https://github.com/David-Martel/PC-AI/blob/465518eeb4db6ba52d52654fc6229b5970041a42/Modules/PC-AI.LLM/Public/Invoke-FunctionGemmaReAct.ps1
[C10]: https://github.com/David-Martel/PC-AI/blob/465518eeb4db6ba52d52654fc6229b5970041a42/Modules/PC-AI.Hardware/Public/New-DiagnosticReport.ps1
[C11]: https://github.com/David-Martel/PC-AI/blob/465518eeb4db6ba52d52654fc6229b5970041a42/Config/DIAGNOSE_TEMPLATE.json
[C12]: https://github.com/David-Martel/PC-AI/blob/465518eeb4db6ba52d52654fc6229b5970041a42/Modules/PC-AI.LLM/Private/ConvertFrom-LLMJson.ps1
[C13]: https://github.com/David-Martel/PC-AI/blob/465518eeb4db6ba52d52654fc6229b5970041a42/Tests/Unit/PC-AI.Hardware.Tests.ps1
[C14]: https://github.com/David-Martel/PC-AI/blob/465518eeb4db6ba52d52654fc6229b5970041a42/Modules/PC-AI.LLM/Private/Validate-ToolParameters.ps1
[C15]: https://github.com/David-Martel/PC-AI/blob/465518eeb4db6ba52d52654fc6229b5970041a42/Tests/Unit/Validate-ToolParameters.Tests.ps1
[C16]: https://github.com/David-Martel/PC-AI/blob/465518eeb4db6ba52d52654fc6229b5970041a42/Modules/PC-AI.LLM/Private/LLM-Helpers.ps1#L472-L610
