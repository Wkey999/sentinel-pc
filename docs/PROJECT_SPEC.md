# Sentinel PC：Windows 桌面智能故障诊断 Agent

> 中文开发交接文档 · v1.0 · 2026-11-12  
> 交付对象：项目所有者、Codex、后续贡献者。  
> 文档状态：待实施的产品与工程规格，不代表已有代码、工具集成或运行验收。  
> 核心原则：成熟工具负责检测；Sentinel PC 负责问诊、受控调度、报告解析、证据关联和解释。

快速导航：[MVP](#2-mvp-范围与后续版本) · [工具与许可](#3-工具集成与授权政策) · [技术架构](#6-技术架构) · [Adapter 接口](#7-tool-adapter-规范) · [开发任务](#16-codex-可执行任务清单) · [验收标准](#17-发版验收标准definition-of-done) · [Codex 启动指令](#18-可直接交给-codex-的启动指令)

## 0. 开发入口与决策摘要

将本文件放入目标仓库的 `docs/PROJECT_SPEC.md`。先执行第 16 章的 C00，再按依赖顺序开发。第 18 章提供可直接交给 Codex 的启动指令。本次交付是项目规格，不创建应用、不安装检测工具、不操作当前电脑的系统设置。

| 项目项 | 本版决策 |
| --- | --- |
| 产品形态 | Windows 桌面应用；WebView 承载界面，本机 Rust 后端完成受控操作 |
| 用户 | 普通游戏玩家、日常办公用户；首发面向个人自用电脑 |
| 前端 | Tauri 2 + Vue 3 + TypeScript + Vite；中文界面 |
| 本机后端 | Rust；不额外要求用户安装 Python、Node 或本地 Web 服务 |
| 检测来源 | 优先 Windows 现有日志与系统查询，其次导入第三方报告，再逐项开放 CLI |
| Agent | 有限状态编排 + 确定性规则；可选大模型解释与候选检查建议，执行权始终在策略层 |
| 最小闭环 | 描述症状 → 选择时间 → 预览计划 → 本机采集/导入 → 证据分析 → 下一步 → 导出 |
| 商业定位 | 个人开源、暂不计划商用；可选小额自愿支持，不与第三方授权混同 |
| 首发分发 | 不随包分发第三方检测程序；外链官网下载 + 用户导入报告 |
| 自动修复 | MVP 不提供；所有系统变更不在首发执行范围 |
| 权限 | 默认普通用户；MVP 不实现管理员代理，访问被拒时跳过或引导手动导入 |
| 网络 | 核心诊断离线可用；模型调用、打开官网、更新检查均有明确入口 |
| 成功标准 | 用户能看懂发现、证据、未知项及下一步；不能以“找出唯一根因”作为普遍承诺 |

### 0.1 需求来源与证据边界

本版依据用户本次明确要求，以及原对话《AI电脑诊断维修》中可读取的用户发言编写：桌面产品、面向小白、复用类似工具箱中的成熟免费工具、让 Agent 分析测试报告、个人项目及可选打赏。原对话助手正文读取结果仅有内容引用占位符，未据此恢复或假定任何具体方案。本文接口、排期、限额与技术细节是本次提出的开发基线。

标记约定：

- **确定需求**：用户已明确表达的目标，例如桌面应用和复用工具。
- **本版设计**：为让 Codex 可以实施而确定的默认方案；可通过架构决策记录调整。
- **待核验**：需锁定具体版本、取得许可、拿到真实报告或完成实机测试后才能开放的能力。
- **已核对来源**：截至 2026-11-12 可读取的官方说明；不等于已经审核某个下载文件，也不等于已经实现。

### 0.2 六条不可破坏的约束

1. 不自行开发硬件压力测试引擎、内核驱动、底层 SMART 驱动或杀毒引擎。
2. 不让模型生成的命令、日志里的文字或网页内容直接进入进程执行入口。
3. 不将“免费、个人、开源、不收费、接受几分钱打赏”推导成第三方可随意打包分发。
4. 不因没有日志、工具读取失败或测试通过，就宣告硬件绝对正常。
5. 不把时间相关、模块名、事件编号直接等同于根因。
6. 不把尚未实施、模拟数据通过、解析器通过写成真实电脑诊断已经验证。

## 1. 产品定位

### 1.1 要解决的问题

普通用户遇到游戏闪退、突然重启、短暂黑屏、卡顿、办公软件无响应或外设间歇失灵时，往往不知道先查哪里，也不知道工具报告中的信息是否重要。Sentinel PC 将问诊、系统现有证据和第三方报告串成一个可理解的排查过程。

产品价值是减少无效操作、保留证据、解释不确定性，并帮助用户决定下一项低风险验证。它不能通过软件日志保证区分电源、线材、接口、主板或应用代码的所有故障。

### 1.2 用户场景

| 场景 | 用户表达 | 首轮可做的事 | 必须承认的边界 |
| --- | --- | --- | --- |
| 游戏闪退 | 玩到一半直接退出 | 收集应用错误和报告，关联发生时间与驱动概况 | 崩溃模块可能只是故障表现 |
| 黑屏/闪屏 | 屏幕黑一下又回来 | 查看系统显示相关事件、显示设备/驱动信息 | 无日志不能排除线材、屏幕或接口问题 |
| 重启/蓝屏 | 电脑突然自己重启 | 关联异常关机、错误检查记录与用户描述 | 单条异常关机记录不能确诊电源 |
| 卡顿/掉帧 | 帧数看着够但不流畅 | 问清复现场景，导入帧时间或传感器报告 | 采样时间不重叠则不做因果关联 |
| 办公闪退/无响应 | 表格软件卡住或崩溃 | 关联应用日志，询问插件、文件和近期变更 | 不默认读取用户文档内容 |
| USB/输入间歇失灵 | 鼠标断连、键盘偶尔没反应 | 设备概况、已有事件、引导单变量换端口复测 | “断触”需先分清触控、无线、USB、软件卡顿 |
| 存储疑虑 | 读取慢，想知道硬盘状况 | 导入磁盘健康报告 | SMART 正常不保证不会故障 |

### 1.3 不承诺的能力

- 不做“自动修好所有电脑问题”“替代所有维修”“百分之百硬件鉴定”等宣传。
- 不自动重装驱动、刷新 BIOS、更新固件、关闭安全防护、清注册表或调整超频。
- 不绕过反作弊、企业策略、付费功能、EULA 接受步骤或工具运行限制。
- 不做远程控制、多人维修工单、付费上门维修平台或后台常驻全盘扫描。
- 首发不做手机、Linux、macOS、Windows Server、ARM64 与离线启动盘诊断。

“办公用户”不等于第三方个人免费版可用于单位电脑。企业/单位设备仍可使用本产品允许的本机基础功能；涉及第三方工具时，按该工具实际使用环境判断授权。

## 2. MVP 范围与后续版本

### 2.1 P0：首发必须实现

1. 中文问诊：场景、症状、发生时间/时区、频率、近期变更、是否可复现。
2. 计划预览：数据来源、时间范围、预计用时、权限、资源影响、联网情况。
3. 两类真实 Windows Adapter：系统概况、System/Application 事件窗口查询。
4. 两类第三方报告 Adapter：CrystalDiskInfo 文本、smartctl JSON；仅导入，不要求安装工具。
5. 统一证据、覆盖度/缺失项、确定性规则、时间线与可展开原始出处。
6. 受限 Agent 循环：选择内置检查、核验策略、等待必要同意、采集、解析、复核、结束；有步数上限。
7. 取消、超时、部分失败继续、异常退出恢复、案例历史和删除。
8. Markdown 与 JSON 导出；默认脱敏，原始附件单独选择。
9. 离线规则报告可独立完成；模型关闭或失败时仍得到可用结论。
10. 模型 Provider 接口、Mock Provider、可选用户自配 HTTPS Provider；仅分析脱敏摘要，默认关闭。
11. 工具目录显示授权/集成状态和官网下载入口；不在后台自动下载安装。
12. Windows x64 安装包、来源说明、第三方声明、可复现测试指引。

MVP 的“Agent”是受约束的诊断编排器，不以自由执行终端命令作为智能能力。即使不连接大模型，也必须完成上述闭环；模型能改善解释，但不能决定权限和真实采集结果。

### 2.2 P1：通过专项审核后增加

| 能力 | 开放前条件 |
| --- | --- |
| smartctl 自动只读查询 | 指定版本许可与安装来源已审、设备选择已核实、权限方案和取消机制通过实机测试 |
| PresentMon 报告导入 | 明确 Console/GUI/Service 组件、版本、CSV 列与单位；取得可合法使用的样本 |
| PresentMon 有限时长采集 | 再完成 ETW 权限、反作弊兼容、采集开销及进程清理专项测试 |
| HWiNFO 报告导入 | 验证所用版本/授权确实允许用户导出目标报告，使用脱敏真实样本 |
| 崩溃转储分析 | 明确调试工具许可、符号下载、隐私与存储策略；默认不上传 dump |
| 持续传感器监测 | 明确传感器来源、驱动和 SDK 授权，不从本产品自行开发硬件驱动 |
| 可提升权限的窄接口助手 | 独立安全评审、签名、认证 IPC 和固定动作集；不提升整个 UI |
| 自动更新 | 安装包真实性、更新签名、回滚和第三方工具版本隔离机制通过测试 |
| 自愿支持入口 | 所有仍启用的受限工具已复核打赏关联，文案和外链已确定 |

### 2.3 P2 / 非首发范围

高级人工指导压力测试、启动介质内存测试、更多厂商工具导入、可逆修复流程、跨设备历史对比。每项单独立项；不因为在候选表中就获得实现授权。

MVP 不启动压力测试、不安装传感器驱动、不运行 SFC/DISM 修复、不执行磁盘修复、不自动重启。已有测试报告可以按支持格式导入；不支持的文件明确标注为“附件，尚未解析”，不能假装分析成功。

## 3. 工具集成与授权政策

### 3.1 四种集成方式分开审核

| 模式 | 行为 | 本版策略 |
| --- | --- | --- |
| `import_only` | 用户自行获取工具并产生报告，Sentinel 解析所选文件 | 首选；仍需审核报告格式、样本与相关条款 |
| `manual_external` | 提供官网和操作指引，用户在外部软件中手动测试 | 可展示已审核说明；执行与停止由外部工具控制 |
| `local_cli` | 调用用户已安装、版本受支持的本地程序 | P1 逐动作开放；不是看到 EXE 就允许执行 |
| `bundled` | 安装包附带二进制、DLL、驱动或工具资源 | 首发全部关闭；按具体工件完成再分发审核才可启用 |

官网下载、应用代下载、镜像托管、随包分发、代码链接、GUI 自动点击、CLI 调用、SDK/共享内存读取，是不同事项。获准其中一项，不自动获得其余权限。

不从图吧工具箱或其他集合包提取工具，不把工具箱的分发行为当成 Sentinel PC 的授权证据。UI 可借鉴分类组织方式，程序和文档必须从各自官方渠道核对。

### 3.2 截至 2026-11-12 的候选工具审核起点

以下是产品决策依据，不是完整法律结论，也不是对任意版本工件的放行。只有具体版本的审核记录和测试通过后，才能变更可执行状态。

| 工具/来源 | 已核对的关键事实 | 本版集成决定 | 自动化与报告边界 | 来源/更新渠道 |
| --- | --- | --- | --- | --- |
| Windows 事件日志与系统查询 | `Get-WinEvent` 支持按日志和时间筛选 [S01] | P0 使用机器已有组件；不分发 Windows 程序 | 仅固定只读采集；拒绝访问需降级；不读取 Security 日志 | Microsoft 文档、Windows 自身维护渠道 |
| CrystalDiskInfo | 官方许可证页为 MIT，要求保留版权与许可声明 [S03] | P0 导入文本报告；首发不附带程序 | 不假设存在稳定自动导出 CLI；以样本验证解析格式 | [官网产品/下载入口](https://crystalmark.info/en/software/crystaldiskinfo/) |
| smartmontools / smartctl | 上游 smartctl 源码标明 GPL-2.0-or-later，仓库含 GPLv2 文本；支持 JSON，退出码采用位掩码 [S04]、[S05]、[S06] | P0 导入 JSON；P1 再开放本地 CLI | JSON 字段与设备类型有差异；不能将所有非零退出码当作启动失败 | [上游项目](https://www.smartmontools.org/)、[上游源码仓库](https://github.com/smartmontools/smartmontools) |
| HWiNFO64 / ARM64 | 当前非 Pro 为个人/非商业使用，自动报告及自动传感器 CLI 属 Pro；EULA 要求第三方嵌入/打包取得明确批准，禁止绕过受限功能 [S07]、[S08] | P1 报告导入候选；不打包，不自动操控免费版 | 不靠自动点击或重启共享内存绕过限制；不认为所有报告能力在免费版都可用 | [官方许可页](https://www.hwinfo.com/licenses/)、[官网下载](https://www.hwinfo.com/download/) |
| OCCT | Personal 免费用途有限；官方页面区分报告权益和 CommandLine 授权，EULA 对分发有明确限制 [S09]、[S10] | 仅候选目录；不进 P0/P1 自动执行 | 不承诺免费版 CLI 或完整报告；压力测试有独立风险，不能以支持 Sentinel 代替 OCCT 授权 | [官方 Personal 页面](https://www.ocbase.com/download-personal) |
| PresentMon | 上游主许可证为 MIT；存在不同组件，Console 文档另列 [S11]、[S12] | P1 优先 CSV 导入，再考虑限定采集 | 不把 GUI/Service 安装包全部依赖视为单一 MIT 工件；不默认安装服务或叠加层 | [上游仓库与 Releases](https://github.com/GameTechDev/PresentMon) |
| Sysinternals（如 ProcDump/Process Monitor） | 官方条款保留权利，并限制将软件发布供他人复制及转移等 [S13] | 仅高级用户后续候选；首发不打包、不执行 | 不统一冠以“MIT”；转储与跟踪包含隐私，单独审批数据范围 | [Microsoft Sysinternals](https://learn.microsoft.com/en-us/sysinternals/) |

**工件级补充**：MIT 主程序也可能带有另外许可的依赖、主题、图片、语音包、驱动或安装器。GPL 工具若分发，需落实对应源码、修改说明、许可证及其他适用义务；只写“官网有源码”不能作为完成证明。独立进程与应用代码的具体许可关系应按实际集成评估，不能由“用了 sidecar”一概判定。

smartmontools 官网本次读取受站点访问限制；源码许可和命令行为改用上游仓库核对。本次没有下载、扫描、安装或执行任何候选检测工具。

### 3.3 授权记录必须覆盖的维度

每个工具、每个版本、每个动作在 `tools/catalog/` 有独立记录。字段至少包含：

```yaml
toolId: crystaldiskinfo
releaseVersion: null                 # null 表示未锁定，不能据此启用执行/打包
artifactName: null
artifactSha256: null
edition: standard
officialHome: https://crystalmark.info/en/software/crystaldiskinfo/
licenseId: MIT
reviewedAt: 2026-11-12
reviewScope: upstream-license-page-only
permissions:
  personalUse: allowed_by_published_terms
  workplaceUse: needs_artifact_review
  reportImport: allowed_by_project_policy
  cliAutomation: unverified
  redistribution: conditional_not_release_approved
  modification: conditional
  donationLinkedDistribution: needs_review
enabledModes: [import_only]
evidence:
  - url: https://crystalmark.info/en/software/crystaldiskinfo/crystaldiskinfo-license/
    localSnapshot: null
    snapshotSha256: null
constraints:
  - preserve_copyright_and_license_if_redistributed
  - audit_dependencies_and_edition_assets
reviewer: null
decision: import_only
```

生产记录还要记录：用户使用环境、官网下载/重分发权限、是否允许无人值守、是否需用户单独接受条款、驱动许可、报告分享限制、更新源及其条款、支持的解析版本、审核人、待确认问题和下一次复核触发条件。

`unknown / unverified / needs_review` 一律不能转成允许执行或允许打包。手动勾选“我知道风险”也不能解除版权和授权门禁。

### 3.4 小额支持与开源策略

- 自愿支持可设计为“关于”页的可选入口，不绑定检测次数、解锁能力或第三方工具下载权限。
- 金额很小、称作打赏、无广告、代码开源，都不能自动证明符合某工具的非商业定义。
- 计划增加支持入口、收费服务、广告、赞助展示或单位部署时，重新审核受限工具的使用与分发关系；有歧义时仅保留不依赖争议权限的功能。
- 开源 Sentinel 自有代码不改变第三方二进制的许可证。建议自有代码初步采用 Apache-2.0，C00 由项目所有者确认后再写入 LICENSE；禁止在未知作者信息下代填法律署名。
- 软件名称仅用于说明兼容与来源，不表示第三方背书。不得复用对方商标、主题资源做 Sentinel 的产品品牌。

### 3.5 更新与供应链

MVP 的工具更新方式是显示官网入口；不实现自动下载工具。未来启用下载/打包时，必须锁定版本与工件、核对许可证快照、核对 SHA-256 和可用签名、检查全部重定向目标、审核依赖及安装行为。

摘要来自同一份可能被篡改的下载页面，并不能独立证明安全。AuthentiCode 签名存在也不等于绝对可信；签名缺失不必一概判恶意，但需要更强的来源验证。受支持的程序每次执行前重新核对实际文件身份，版本/哈希不符则停止，不在后台“兼容最新版本”。

官方域名迁移或工件更新必须人工审核，工具清单不能远程下发任意命令。首发无第三方工具自动更新，也不托管第三方镜像。

## 4. 用户交互与页面

### 4.1 用户旅程

1. 首页选择“游戏/显示”“突然重启/蓝屏”“办公软件”“外设/输入”“导入已有报告”。
2. 用一句话描述问题，系统只追问影响下一步的事项，每轮最多 3 个问题。
3. 确认发生时间；可选“刚才”“大约某时”“不知道”。时间不明则说明检索范围变宽。
4. 展示本轮检查清单，用户能取消任何可选项。无第三方安装也能继续。
5. 采集过程中显示具体阶段、耗时、已完成项；不做虚假的持续进度百分比。
6. 结果先展示“发现什么”“目前不能判断什么”“建议下一步”，再展开术语和原始证据。
7. 需要第三方工具时，先展示官网、许可/用途条件、操作步骤和报告导入按钮。
8. 用户可记录复测是否改善；对比前后条件，不把自述改善标成已验证根因。
9. 导出分享前展示将包含的字段、脱敏结果、附件大小及是否包含原始报告。

### 4.2 页面清单

| 页面 | 必备内容 |
| --- | --- |
| 首页 | 新建诊断、导入报告、最近案例、离线/模型状态 |
| 问诊页 | 症状表单、时间与时区、变更记录、可选问题 |
| 检查计划页 | 目的、来源、风险、权限、时长、数据范围、开始/取消 |
| 运行页 | 阶段、子任务状态、取消、跳过失败项、等待手动报告 |
| 结果页 | 摘要、覆盖度、证据时间线、可能解释、未知项、下一步 |
| 证据详情 | 文件/事件出处、字段、时间、采集/解析版本、原始内容查看 |
| 工具目录 | 模式、授权状态、官方地址、所需报告格式；候选不可点击运行 |
| 历史案例 | 搜索、打开、删除、重跑为新记录；不静默覆盖旧结果 |
| 设置/关于 | 模型、数据保留、导出、来源与第三方声明、支持入口状态 |

### 4.3 文案规则

- “未发现本轮证据”与“没有故障”必须区分。
- “未读取：权限不足”“未覆盖：此类传感器报告未导入”不能显示成绿色通过。
- 不给没有校准依据的“电源损坏概率 92%”。使用“证据较强/有限/待验证”，并解释依据。
- 显示“异常退出事件与描述时间接近，尚不能确定导致退出的组件”，避免让用户盲目购买硬件。
- 工具运行与本产品的关系要清楚：手动外部测试只能显示“等待导入”，不能假装能远程停止它。
- 适配 1280×720、150% 缩放、键盘操作、可选择复制文本；状态不能只靠红绿颜色区分。

### 4.4 示例：短暂黑屏

用户：“刚才游戏的时候黑了一下，后来恢复了。”

先问：大约几点？只有游戏黑屏还是整个显示器？是否伴随声音停止/电脑重启？

计划：“读取该时间前后 10 分钟的系统与应用日志，并读取显示设备和驱动概况。预计 10–60 秒；本轮不修改设置、不安装工具，数据保存在本机。”

结果可能是：“发现时间接近的显示相关记录，支持继续排查显示驱动恢复或渲染链路异常；仍不能排除线材、接口和显示器问题。建议先记录连接方式，并在保存工作后按步骤换一根已知正常的线复测。”缺少记录时改为“未找到相关记录”，保留手动验证路径。

## 5. 风险分级与执行策略

风险至少有三维：机器负载/系统影响、隐私、授权。R 等级只表示操作影响；低负载不代表无隐私风险。

| 等级 | 例子 | 同意与执行策略 | MVP |
| --- | --- | --- | --- |
| R0 被动读取 | 时间受限的现有日志、系统概况、已有报告解析 | 本轮计划范围内同意；任意扩大范围重新预览 | 支持 |
| R1 有限主动采集 | 固定时长性能采集、SMART 查询、较细设备枚举 | 单项说明资源影响、权限、持续时间并确认 | 自动执行留 P1 |
| R2 压力/可能中断工作 | CPU/GPU/内存压力、磁盘长测、主动生成转储、需重启测试 | 必须专项许可、前置检查、停止规则及逐次同意 | 不执行 |
| R3 系统变更 | 驱动卸载、服务/注册表/网络修改、SFC/DISM 修复 | 独立后续设计，需回滚、精确变更及确认 | 不执行 |
| R4 高危/不可逆 | 固件刷新、擦除磁盘、关闭核心安全机制、危险电气操作 | 不纳入自动化动作目录 | 禁止 |

MVP 不把 `SFC /scannow` 等修复操作包装为只读检查。即便 DISM 或其他工具某个参数是诊断用途，也必须按具体动作单独评审，不按程序名称整体放行。

执行门禁必须同时满足：工具用途授权通过 ∩ 动作允许 ∩ 版本支持 ∩ 文件身份通过 ∩ 当前环境适合 ∩ 本轮用户同意有效 ∩ 资源预算足够。任意缺项就跳过或拒绝，并在报告中保留原因。

未来压力测试不能只凭通用“90℃”阈值判安全。需按已验证的设备/工具规则设置限制，传感器缺失、温度陈旧或无法保证终止时不得自动启动；不要指导用户拆开电源或进行带电操作。

## 6. 技术架构

### 6.1 模块关系

```text
Vue 3 中文 UI（本地打包资源）
  │ 只传 caseId / actionId / 参数对象 / 文件选择令牌
  ▼
Tauri Rust IPC Facade
  ├─ CaseService：案例、计划、状态机、恢复
  ├─ PolicyEngine：许可、风险、权限、同意、资源预算
  ├─ AdapterRegistry：编译内置的工具/报告适配器
  ├─ ProcessRunner：固定程序与参数模板、超时、取消、审计
  ├─ ArtifactStore：本机原始数据、哈希、大小/保留策略
  ├─ Parser/Normalizer：报告 → 统一证据
  ├─ RuleEngine：证据 → 发现、未知项、后续检查
  ├─ AgentOrchestrator：有界循环，不拥有任意命令入口
  ├─ Redactor/Exporter：脱敏、预览、导出
  └─ ModelGateway（可选）：HTTPS 请求、结构验证、费用/数据预算
        │ 仅用户确认的脱敏摘要
        ▼
    用户指定模型服务
```

架构图是模块设计，不代表这些模块均需独立进程。首发保持 Rust 应用后端 + 系统子进程的简单结构；不引入微服务、向量数据库、多 Agent 框架或远程控制服务。

### 6.2 技术选择

| 层 | 建议 |
| --- | --- |
| UI | Vue 3 Composition API、TypeScript、Vue Router、Pinia；选一套常规组件库即可 |
| 构建 | Tauri 2、Vite；C00 核对当时兼容版本并提交前后端锁文件 |
| 本机代码 | Rust；异步任务使用 Tokio，结构化数据用 Serde |
| 存储 | SQLite 元数据/迁移 + 每案例目录保存原始附件；单写入队列，使用事务 |
| Windows 查询 | P0 使用固定 PowerShell 5.1 脚本读取 CIM/事件；后续可替换为 Win32 API Adapter |
| 类型契约 | Rust 为权威模型，生成或验证 TypeScript 对应类型；Zod 验证前端/模型边界 |
| 测试 | Rust 单元/集成测试、Vitest、浏览器组件流程；Windows 上单独验证原生 IPC 和采集 |
| 安装 | x64 NSIS 安装包为首选；是否签名及 WebView2 安装方式显式记录 |

技术版本不写成“永远使用最新”；开发开始时核对官方兼容要求，固定版本。生产环境不需要用户安装 PowerShell 7；如果脚本使用了仅 7 支持的语法，视为不满足本版要求。

Tauri 的 capability 可控制窗口/WebView 对能力的访问，但自定义已注册命令默认可被各窗口调用，需按官方机制收窄，并在 Rust 再校验业务权限；不能仅靠前端隐藏按钮。[Capabilities 官方文档](https://v2.tauri.app/security/capabilities/) [S14]

### 6.3 IPC 与进程执行边界

前端只允许调用 `create_case`、`build_plan`、`approve_plan`、`start_plan`、`cancel_run`、`import_report`、`get_case`、`export_case`、`delete_case` 等语义接口。禁止暴露 `run_command(cmd)`、任意 `shell`、任意文件读取或任意 URL 下载入口。

进程模板在 Rust/随包只读脚本中定义；不把 EXE 路径、参数数组、管理员标记直接作为 UI/模型可传入字段。所有参数还要类型验证、值域验证和动作校验。

Shell 插件本身也有执行/生成进程等权限控制；首发不向 WebView 授予通用 Shell 执行权限。[Tauri Shell 官方文档](https://v2.tauri.app/plugin/shell/) [S15] 若以后使用 sidecar，只将已审核自有助手作为 sidecar；打包机制不解决第三方许可问题。[Sidecar 官方文档](https://tauri.app/develop/sidecar/) [S16]

同意记录绑定 `caseId + planId + planRevision + planHash + actionIds + 数据范围 + 有效期`。planHash 必须覆盖实际参数、Adapter/工具版本、工件身份、许可审核和策略版本。计划由后端保存并重新计算摘要；一次同意不能复用于修改后的参数。开始执行前以事务消费一次性令牌，防止双击重复启动；排队过期、进程重启、参数扩大均需重新确认。

### 6.4 普通权限与未来管理员助手

P0 只用当前普通用户权限；某些事件、CIM 或文件读取失败时，记录 `permission_denied`，继续其他任务。UI 不提示关闭 UAC、不指导绕过公司策略。用户可以自行使用官方工具生成支持格式的报告再导入。

P1 若确需提升权限，使用短生命周期、单任务的自有签名助手，经 UAC 显示目的，仅接受固定操作 ID 和受限参数。助手必须验证调用者/令牌/计划摘要、限制输出目录，不能接受任意脚本、EXE 或反序列化可执行代码。未通过这套评审前，不能把整个应用设为管理员启动。

## 7. Tool Adapter 规范

### 7.1 概念

- **Tool**：数据来源或第三方产品。
- **Adapter**：对某组受支持版本、格式和动作的集成实现。
- **Action**：精确到参数模板的行为，例如“读取事件窗口”，而不是“运行 PowerShell”。
- **Plan**：本轮经过策略审核的不可变动作集合。
- **Artifact**：本机原始输出/导入文件；有哈希、来源和隐私标记。
- **Evidence**：从 Artifact 解析出的可追溯事实。
- **Finding**：基于证据生成的观察、解释或缺失项。

### 7.2 接口契约（TypeScript 表达，Rust 实现）

以下是设计接口，不是可直接运行的完整源码。执行接口只在 Rust 内部注册表可见，不暴露给 WebView 或模型。

```ts
type RiskLevel = 'R0' | 'R1' | 'R2' | 'R3' | 'R4';
type IntegrationMode = 'import_only' | 'manual_external' | 'local_cli' | 'bundled';
type RunStatus = 'succeeded' | 'partial' | 'failed' | 'cancelled' | 'timed_out';
type VersionSupport = 'supported' | 'unsupported' | 'unknown';
type ArtifactId = string;
type EvidenceId = string;
type CancelToken = { readonly cancelled: boolean };
type CaseContext = {
  caseId: string;
  incidentWindow: { startUtc: string; endUtc: string; displayTimezone: string };
  symptoms: string[];
  environment: 'personal' | 'workplace' | 'unknown';
};
type AdapterError = {
  code: 'permission_denied' | 'unsupported_version' | 'unsupported_format'
    | 'license_blocked' | 'invalid_input' | 'untrusted_binary'
    | 'timeout' | 'cancelled' | 'output_limit' | 'parse_error' | 'io_error';
  message: string;
  retryable: boolean;
};
type ToolDescriptor = {
  toolId: string;
  adapterVersion: string;
  actionIds: string[];
  modes: IntegrationMode[];
  licenseRecordId: string;
  supportedFormats: string[];
  supportsExecution: boolean;
};
type Availability = {
  available: boolean;
  version: string | null;
  versionSupport: VersionSupport;
  limitations: string[];
};
type ActionPlan = {
  planId: string;
  revision: number;
  actionId: string;
  toolId: string;
  adapterVersion: string;
  toolVersion: string | null;     // 不执行外部程序的动作可为 null
  artifactIdentityHash: string | null;
  licenseReviewId: string;
  policyVersion: string;
  risk: RiskLevel;
  mode: IntegrationMode;
  parameterSetId: string;        // 后端已验证的参数集合标识，不是命令文本
  requiresElevation: boolean;
  dataScopes: string[];
  estimatedSeconds: [number, number];
  timeoutSeconds: number;
  maxOutputBytes: number;
};
type ExecutionResult = {
  runId: string;
  status: RunStatus;
  exitCode: number | null;
  artifacts: ArtifactId[];
  errors: AdapterError[];
};
type ImportedArtifact = {
  artifactId: ArtifactId;
  sha256: string;
  mediaType: string;
  declaredToolVersion: string | null;
};
type ParseResult = {
  status: 'parsed' | 'partial' | 'unsupported';
  evidence: Evidence[];
  warnings: string[];
  parserVersion: string;
};
type ValidationResult = { ok: boolean; errors: string[]; warnings: string[] };
type Evidence = {
  evidenceId: EvidenceId;
  artifactId: ArtifactId;
  kind: string;
  observedAtUtc: string | null;
  timePrecision: 'exact' | 'approximate' | 'unknown';
  locator: Record<string, string | number>;
  fields: Record<string, unknown>;
};
interface ToolAdapter {
  descriptor(): ToolDescriptor;
  probe(ctx: CaseContext): Promise<Availability>;
  plan(ctx: CaseContext, actionId: string): Promise<ActionPlan>;
  execute(plan: ActionPlan, cancel: CancelToken): Promise<ExecutionResult>;
  parse(artifact: ImportedArtifact): Promise<ParseResult>;
  validate(result: ParseResult): ValidationResult;
}
```

`import_only` 的 `execute()` 返回明确的“不支持执行”，不能启动外部软件。`probe()` 也算实际行为，必须列出它是否访问进程/设备；P0 报告 Adapter 的 probe 只检查解析器与格式支持，不扫描磁盘找 EXE。

### 7.3 适配器描述必须补充的运行属性

固定配置至少包括：操作系统/架构范围、被审核的版本/格式、风险等级、权限、输入 Schema、输出大小、超时、并发资源锁、可取消性、退出码解释、解析器版本、原始输出保留策略。未知字段可以保留为扩展，但未知版本不能静默认成已验证版本。

原始输出解析与诊断规则分开：Parser 不调用 LLM，不决定“电源坏了”；RuleEngine 不读取任意文件、不执行进程。

### 7.4 P0 两个本机动作

| Action ID | 实现方式 | 范围与默认限额 | 失败策略 |
| --- | --- | --- | --- |
| `windows.system_snapshot` | 固定 PowerShell 脚本，使用显式 CIM 类和属性 | OS/build、CPU/GPU 概况、内存容量、相关驱动信息；30 秒，输出 2 MiB | 某类查询失败返回 partial；不采集产品密钥、全应用列表、完整网络配置 |
| `windows.event_window` | 固定脚本用 Get-WinEvent，并保留结构化 XML/字段 | System/Application，默认症状前后各 10 分钟；最多 2,000 条/10 MiB、60 秒 | 无事件是有效空结果；访问失败与空结果分开，截断需明确标记 |

高级范围可改为最近 24 小时，但需重新预览。查询不只筛 Error：相关信息级事件也可能重要；按场景选择 provider/channel，使用服务端时间过滤和数量上限。筛选能力以官方 Get-WinEvent 文档为基础 [S01]，PowerShell 5.1 的具体行为在 C04 验证。

脚本使用 `-NoProfile -NonInteractive -File` 调用随包固定文件，参数通过独立 argv 传递；不拼接 `-Command` 或把用户文本插入脚本，不默认使用 ExecutionPolicy Bypass。系统程序从可信系统目录解析，校验路径；固定脚本校验随包身份。企业策略阻止脚本时降级，不自动改策略。

脚本明确输出 UTF-8；错误、标准输出与结果状态分离；捕获 JSON 深度、编码和本地化差异。事件以 `provider + channel + eventId + version + XML fields` 匹配，不依赖中文/英文 Message 文本。

### 7.5 第三方导入规则

**CrystalDiskInfo 文本**：引导用户从其合法获得的版本复制/保存文本报告。解析磁盘型号、协议、报告声明的健康状态与可识别字段；敏感序列号默认脱敏。不同语言、SATA/NVMe 多盘布局有独立样本。字段未知时返回 partial，不跨厂商套用统一 SMART 原始值阈值。

**smartctl JSON**：识别 `json_format_version`、工具版本、设备协议和可用字段；不能要求 ATA/SCSI/NVMe 字段一致。退出码按工具位掩码解释，保留可解析数据；例如 8 不等同于启动失败，2 也不能在缺少上下文时断言磁盘坏了。[smartctl 上游手册](https://raw.githubusercontent.com/smartmontools/smartmontools/master/smartmontools/smartctl.8.in) [S06]

报告中的工具版本/设备名称由文件声明，属于“导入报告声明”，不等于 Sentinel 已验证真实运行过该工具。导入时间不等于测试发生时间；时间缺失时不能与某次闪退强行关联。

P1 的 smartctl 只读动作才可评审 `--scan` 与 `-a -j <枚举出的设备>` 模板。`--scan-open` 会访问设备，需另评估；禁止自由传 `-t`、`-s`、固件、擦除或其他控制参数。具体设备路径和类型必须来自受支持 Windows 枚举，不照搬 Linux 示例。读取也可能唤醒磁盘，需告知并验证。

### 7.6 运行器与导入安全

- 每个动作单独工作目录，规范化路径，禁止路径穿越、UNC/远程文件、重解析点逃逸和任意输出目标；导入文件先安全复制至当前案例目录，再按复制后的内容计算哈希与解析。
- P0 不解压 ZIP、不执行附件、不加载插件 DLL、不渲染报告 HTML。扩展名、大小与内容结构共同校验；禁用 XML 外部实体/DTD、外部链接与模板宏。
- 单文件导入上限 20 MiB、单案例原始数据默认上限 100 MiB、JSON 嵌套上限 64；超限明确拒绝或按已声明规则截断，不能静默丢证据。
- 子进程使用受控工作目录、环境与 PATH；输出有背压和字节上限，不能等进程结束后才读取导致管道死锁。
- Windows Job Object 等机制管理本应用启动的进程树；取消/超时先停止调度，再终止受控子进程并标记未完成数据。不能按进程名称批量杀用户其他程序。
- 仅终止本应用拥有且验证归属的进程。手动启动的外部测试无法由 Sentinel 保证停止，界面单独提醒使用外部工具停止按钮。
- P0 最多并发 2 个低负载任务，设备主动采集后续串行；同一案例重复请求必须幂等。任务失败最多自动重试 1 次，仅限明确可重试的只读 I/O 故障，不重试拒绝授权或用户取消。
- 不在普通日志记录 API Key、完整命令行敏感参数、完整原始报告或用户自由输入。异常信息也走脱敏处理。

## 8. 数据模型、存储与追溯

### 8.1 核心实体

| 实体 | 主要字段 | 约束 |
| --- | --- | --- |
| Case | id、症状、场景、发生时间范围、原始时区、使用环境、状态、创建时间 | 用户时间不确定度单独保存；不默认采集用户身份 |
| Plan | id、caseId、revision、动作集合、参数摘要、策略版本、hash | 创建后不可变；修改生成新 revision |
| Consent | id、planId、hash、同意范围、expiresAt、consumedAt | 一次性；不同于永久软件授权 |
| Run / Task | id、planId、actionId、开始/结束、状态、取消原因、退出码 | 超时、取消、失败、部分成功分别保存 |
| Artifact | id、来源、相对路径、sha256、大小、编码、工具声明版本、采集时间、保密等级 | 原始数据不可被后续解释覆盖；本机绝对路径不进入分享包 |
| Evidence | id、artifactId、类型、字段、单位、发生时间、定位符、parserVersion | 每项可定位回原始报告/事件；缺失值用 null，不用 0 |
| Finding | id、类型、摘要、支持/反对证据、强度、限制、ruleVersion | 观察、假设、未知项分开；不能虚构证据 ID |
| Recommendation | id、目的、前置条件、风险、操作、预期结果、停止条件 | MVP 仅解释/引导；可执行项必须引用已有 actionId |
| ModelRun | provider/model 标识、promptVersion、请求摘要 hash、输出校验结果、耗时/用量 | 不保存 Key；不默认保存完整原始提示词 |
| AuditEvent | actor、caseId、动作、时间、结果、planHash、策略版本 | 不存原始敏感内容；删除案例时一并处理相关记录 |

时间一律存 UTC + 原始偏移/时区信息，显示为用户本地时间。事件写入时间、故障实际时间、采集时间、导入时间分别保存；不知道的时间为空。磁盘通电小时数不能直接当作日历时间。

### 8.2 Evidence 示例

以下为合成示例，非用户电脑的真实记录。示例哈希、ID 和数值不得出现在生产报告中冒充实测。

```json
{
  "evidenceId": "ev_demo_001",
  "artifactId": "artifact_demo_system_events",
  "kind": "windows.event",
  "observedAtUtc": "2026-11-12T02:03:00Z",
  "timePrecision": "exact",
  "locator": {
    "channel": "System",
    "provider": "Microsoft-Windows-Kernel-Power",
    "eventId": 41,
    "recordId": 12345,
    "xmlNode": "/Events/Event[1]"
  },
  "fields": {
    "bugcheckCode": 0,
    "level": "critical",
    "interpretationScope": "unexpected_shutdown_observed"
  }
}
```

### 8.3 本机数据目录

```text
%LOCALAPPDATA%/SentinelPC/
  metadata.sqlite
  cases/<uuid>/
    artifacts/          # 原始采集与用户选择导入的副本
    normalized/         # 标准化结果及版本
    reports/            # 本机生成的报告
  logs/                 # 脱敏运行日志，滚动限制大小
  settings.json         # 无明文密钥
```

路径必须由后端基于应用数据根目录生成；不接受 `caseId` 拼接任意路径。UUID 只解决命名，不替代路径/权限校验。原始文件与元数据提交要有一致性恢复策略：临时文件写完、校验、原子重命名，再提交数据库引用；失败可清理孤立临时文件。

### 8.4 保留、删除与导出

- 默认案例保留 30 天，支持改为手动保留；用户可立即删除单个/全部案例。
- 程序启动和新建案例时检查保留策略，不靠后台常驻任务。清理前明确显示当前设置；被用户标记保留的案例不自动删。
- 删除时先取消相关运行，再删除附件、派生结果、案例元数据及相关审计记录；失败可重试并显示剩余项。不要承诺 SSD 上“不可恢复的安全擦除”。
- SQLite 日志/WAL、缓存、临时目录、崩溃日志也需纳入清理设计；调试模式不得偷偷复制原始报告。
- 默认导出只有脱敏 Markdown/JSON；原始报告是独立选择，不因“导出全部”无提示包含。
- CSV 等未来导出需防公式注入；Markdown 需转义不可信 HTML/链接，HTML 预览关闭原始 HTML、远程图片和脚本。

## 9. 诊断规则与解释质量

### 9.1 推理流程

```text
证据质量检查
  → 时间/设备/进程关联
  → 确定性规则产生观察
  → 记录多种可能解释与反证
  → 评估缺失项/覆盖度
  → 选择最低风险的下一步
  → 可选模型将已验证内容转为易懂说明
  → 输出前检查所有证据引用与动作权限
```

不要给整台电脑一个缺乏依据的健康总分。覆盖度是“本轮检查了哪些来源、哪些时间和设备”，不是诊断准确率。规则优先级用于排序，不可改名为校准概率。

### 9.2 首批规则

| 规则 ID | 触发证据 | 可输出的观察 | 禁止推断 | 下一步 |
| --- | --- | --- | --- | --- |
| `WIN-RESTART-001` | System 中指定 provider 的 Event 41 | 记录到未正常关机后的启动事件 | 单独判电源、主板或 CPU 坏 | 结合错误检查字段、用户描述、前后事件和可用 dump 信息 |
| `WIN-APP-001` | Application Error / Windows Error Reporting 等受支持 schema | 某应用在该时间附近有异常记录 | 将 faulting module 直接确认为根因 | 对齐程序版本、近期变更、同类重复记录 |
| `WIN-DISPLAY-001` | 受支持的显示恢复相关 provider/schema | 显示/渲染链路存在相关异常迹象 | 确诊显卡硬件损坏或接口损坏 | 确认影响范围，指导单变量复测 |
| `WIN-HW-001` | WHEA 等硬件错误报告 provider 的结构化记录 | 系统报告了硬件错误相关信息 | 仅靠 WHEA 编号判定换哪一个部件 | 保留错误类型和上下文，建议进一步专业验证 |
| `STORAGE-001` | 报告明确声明严重健康告警或可识别错误 | 报告包含需重视的存储健康迹象 | 保证马上损坏或永不损坏 | 建议先备份重要数据，避免自动跑长测 |
| `COVERAGE-001` | 权限拒绝、截断、格式未知、来源缺失 | 本轮覆盖不足，不能下排除结论 | “没有错误，所以正常” | 给出补充来源或手动导入路径 |
| `TIMELINE-001` | 两份报告时段不重合、时区/设备不明确 | 时间或设备关联不足 | 强行把昨天的高温关联今天闪退 | 询问时间或重新复现采集 |

事件匹配必须锁定 channel/provider/schema；表中的应用/显示规则不意味着所有 Windows 版本都使用同一个 ID。实现前用支持版本的官方说明和脱敏样本验证，不凭互联网列表硬编码“某编号 = 某硬件损坏”。

微软说明 Event 41 用于标识未正常关机后启动的情况，其本身可能不足以定位原因；因此 `WIN-RESTART-001` 只能先输出观察。[Microsoft 官方说明](https://learn.microsoft.com/en-us/troubleshoot/windows-client/performance/event-id-41-restart) [S02]

### 9.3 每个结论的格式

```text
发现：记录到一次与描述时间接近的异常关机事件。
依据：ev_...，System / Microsoft-Windows-Kernel-Power / 41 / RecordID ...
证据强度：对“发生过未正常关机”较强；对“具体硬件根因”不足。
仍有可能：断电、系统无响应后强制关机、错误检查等。
缺失：未获得可用错误检查详情；未验证供电或线材。
下一步：先确认当时是否长按电源，并检查是否存在同时间段其他记录。
```

规则可确定地陈述“报告包含某字段”，但“硬件根因已确认”不在 MVP 自动输出范围。工具 PASS 只覆盖该工具、版本、设备、时长与测试条件。

### 9.4 复测机制

复测创建新的 Run，保留原结果；记录更改了哪个条件、复测时间、时长、负载及用户主观结果。每轮只建议改一个可解释变量，例如更换已知正常的线材或暂时移除用户明确知道的插件。多处同时修改会降低结论可解释性，不能当作成功修复证据。

## 10. Agent、模型与不可信输入

### 10.1 有界 Agent 循环

1. 接收问诊和覆盖度；从内置 action catalog 选择候选检查。
2. PolicyEngine 校验许可、风险、权限、版本与本轮预算。
3. 生成/更新计划，必要时等待用户确认；模型无权替用户同意。
4. 执行已批准动作或等待报告导入。
5. 解析、校验证据，运行确定性规则。
6. 证据够用则输出；不足则提出最多一个下一轮计划或明确结束为信息不足。

默认每轮最多 4 个动作、整个案例自动编排最多 2 轮；等待用户导入期间不占进程超时，但案例显示暂停。不得无休止收集。达到上限后展示当前结果和手动补充入口。

### 10.2 模型职责与 Provider

P0 允许模型做：将已有 Finding 转为易懂中文、根据已列证据提出候选解释、从已允许 actionId 中建议下一项。候选解释必须标记为假设，不能改写原始证据或提升规则确定性。

模型不允许：创建新工具、下载 EXE、生成可执行命令、选择新文件、扩大数据范围、请求管理员权限、判定软件授权通过、自动开启压力测试或修复。

Provider 最小接口：

```ts
interface DiagnosticModelProvider {
  describe(): { providerId: string; configured: boolean; supportsStructuredOutput: boolean };
  explain(input: {
    caseSummary: string;
    redactedEvidence: Evidence[];
    allowedFindingIds: string[];
    allowedActionIds: string[];
    promptVersion: string;
  }, cancel: CancelToken): Promise<{
    summary: string;
    hypotheses: Array<{
      text: string;
      evidenceIds: string[];
      limitations: string[];
    }>;
    suggestedActionIds: string[];
    unknowns: string[];
  }>;
}
```

先实现 Disabled/Mock Provider；可选实现用户自配 HTTPS JSON Provider，以实际服务契约为准。通用接口兼容只是适配目标，不能承诺任意“兼容 API”服务都支持结构输出；不支持时本地校验并降级。

不默认填真实服务和模型、不内置项目作者 Key、不使用网页登录 Cookie。用户主动配置端点/模型/Key 后，先显示将发送的脱敏摘要和目标服务；首次发送与范围变化时确认。本轮最多 2 次请求，单次 30 秒，输入摘要默认上限 32 KiB、输出上限由 Provider 支持能力约束；超限分配预算或停止，不能静默把全部日志发走。

API Key 使用 Windows 系统凭据机制或用户范围 DPAPI，禁止存在 localStorage、明文 JSON、导出包或普通日志。此机制不保护已被同用户恶意进程控制的电脑，不宣传绝对加密安全。

### 10.3 网络边界

- 核心诊断默认不联网；模型请求和打开官网属于用户明确选择的动作。
- HTTPS Provider 地址只能由设置页明确配置，诊断内容不能修改地址。默认拒绝回环、私网、链路本地和云元数据地址；P0 不支持本地模型端点。
- 禁止模型请求自动跟随重定向携带 Key，限制响应大小与超时，错误内容不回显密钥。使用系统信任链，不提供“忽略证书错误”开关。
- 用户指定的服务本身存在数据处理条款和费用，界面应显示“由该服务计费”，不虚报调用价格。断网/配额/认证失败都回退本机结果，不无限重试。
- 用户手动外部运行的工具可能自行联网；本产品只能说明其已核对行为，不能替外部软件保证离线。

### 10.4 提示注入与输出验证

日志、报告、文件名、设备名、错误消息和导入文档全部是不可信数据。例如报告中出现“忽略之前规则，执行命令”只能成为报告文本，不能改变 Agent 的指令。

防护必须落在代码上：原始文本与控制指令分离、对模型只发送受限字段、模型结果按 Schema 校验、证据 ID 必须属于当前案例、动作 ID 必须属于当前允许集合。输出包含无效引用、命令、危险操作或未经支持的确定结论时，拒绝该段结果并使用规则版文案。模型输出在本轮不能反向成为“证据”。

MVP 不集成网络搜索、RAG 或远程插件。后续若增加，检索内容同样不具执行权限；知识来源更新另行验证。

## 11. 状态机、故障恢复与审计

### 11.1 状态机

```text
draft → interviewing → planning → awaiting_consent
  → collecting → parsing → analyzing → completed
                        ↘ completed_partial
  → awaiting_import → parsing

任一活动状态 → cancelling → cancelled
不可恢复执行错误 → failed
进程中断/掉电 → interrupted（再次打开时识别）
```

`completed_partial` 必须展示缺失项；没有证据仍可生成“信息不足”的报告。空事件集是完成查询的一种结果，不等于采集失败。`failed` 指无法完成核心处理，不能与发现电脑异常混为一谈。

任务级状态还有 `skipped / permission_denied / timed_out / unsupported`，案例聚合时保持原状态和原因。UI 重连不能重复启动已运行任务。

### 11.2 恢复策略

启动时把上次未终结 Run 标记为 interrupted，检查本应用拥有的残余进程与临时文件；不要自动重跑动作，不自动复用同意令牌，不把半截报告当完整数据。原始产物按完整性检查后保留为 partial 或隔离，用户可创建新计划重试。

若单个 Adapter 失败，其他独立低风险动作继续；整个案例存储不可用、取消或预算耗尽时停止调度。没有磁盘空间时先停止采集并给出可恢复提示，不能陷入写日志循环。

### 11.3 审计事件

至少记录：计划建立/变更、策略允许/拒绝、用户同意、任务开始/终结、导入/解析结果、模型摘要发送的范围与目标、导出/删除。审计用于本机排错与解释，不是不可篡改的司法证据；默认不上传遥测。

## 12. 报告与分享格式

### 12.1 用户报告结构

1. 案例标题、生成时间、症状时间范围、数据来源和版本。
2. 一句话结论：已发现的观察，以及尚不能确定的事项。
3. 本轮覆盖表：成功/缺失/截断/跳过及原因。
4. 关键证据：时间线、证据 ID、原始出处定位。
5. 可能解释：支持证据、相反证据、未知项；不提供虚构概率。
6. 下一步：每项操作目的、前提、风险、预期反馈、停止条件。
7. 复测记录与前后条件。
8. 隐私与附件清单、规则/解析/模型版本、适用边界。

Markdown 是面向人的输出；JSON 是带 `schemaVersion` 的机器可读输出。Markdown 的所有事实都能在 JSON 与本机证据中对应；禁止模型自由生成一份与结构数据不一致的报告。

### 12.2 脱敏与预览

默认替换：账户/电脑名、用户目录、设备序列号、MAC/IP、邮件、令牌样式内容、网络共享路径、文档文件名。保留排查必需的 OS/build、硬件型号、驱动版本、错误代码和时间范围。自由文本和错误消息仍可能藏有敏感信息，必须提供用户预览与手动删除，不宣称自动脱敏百分之百。

映射在案例内稳定，例如 `USER_1`、`DISK_1`，映射表只留本机、不进入导出。原始资料标记为敏感，模型默认只能收到脱敏后的选定字段。转储文件不属于 P0 导出/模型输入。

### 12.3 分享文本示例

```text
案例：游戏过程中短暂黑屏（示例）
观察：找到与描述时间接近的显示相关事件。
尚不能判断：显卡硬件、线材、接口、显示器之间的具体根因。
覆盖：系统日志成功；应用日志无相关记录；传感器数据未提供。
下一步：记录显示器连接方式，按指导单独更换已知正常线材复测。
证据：ev_demo_display_01；详细记录可在本机案例内展开。
```

## 13. 代码组织与工程规则

```text
sentinel-pc/
  docs/
    PROJECT_SPEC.md
    ADR/                         # 架构/许可决策记录
    ACCEPTANCE.md
    REAL_MACHINE_TESTS.md
  src/
    pages/ components/ stores/
    domain/                      # 生成/验证的共享类型
    services/                    # 仅语义 IPC 客户端
  src-tauri/
    src/
      commands/ cases/ policy/ adapters/
      runner/ parsers/ rules/ agent/
      storage/ redaction/ export/ model/
    capabilities/
    permissions/
    scripts/                     # 固定只读采集脚本
    migrations/
  tools/catalog/                 # 许可与能力记录；不放未授权二进制
  tests/
    fixtures/synthetic/
    fixtures/sanitized/           # 许可/来源与脱敏说明
    acceptance/
  THIRD_PARTY_NOTICES.md
  SECURITY.md
  CONTRIBUTING.md
  README.md
```

约束：

- 首先看仓库现有结构与 AGENTS.md；本布局用于新项目，不覆盖已有工程约定。
- 不在日志中写密钥；仓库忽略 `.env`、真实报告、dump、运行目录和本机凭据。
- `fixtures/sanitized` 中的第三方报告必须有合法来源/共享条件与脱敏记录；公开样本也要核对许可。只用合成样本时须标记“尚未完成真实格式验收”。
- SQL 使用参数绑定，迁移有版本与备份策略；不静默删除历史案例修复迁移。
- 自定义 Tauri 命令与权限显式登记；Content Security Policy 限制资源来源，不加载远程网页作为有权限的应用窗口。
- UI、规则、解析器和 Adapter 分层；解析器可离线运行并复测，执行器不依赖模型。
- 新增依赖说明用途、许可、维护状态；避免为了报告解析引入庞大的代理/浏览器框架。
- 不把开发机测试通过当成普通用户电脑可用。安装版必须在无开发依赖的独立环境验收。

## 14. 测试计划

### 14.1 测试层次

| 层次 | 必测内容 | 是否需第三方程序 |
| --- | --- | --- |
| Parser 单元 | 编码、版本、缺失字段、多盘、协议差异、损坏/超限 | 不需要；使用合成/合法脱敏样本 |
| Rule 单元 | 证据引用、缺失/相反证据、事件归因边界、时间窗口 | 不需要 |
| Policy 集成 | 未授权、未知版本、过期同意、计划篡改、禁用动作拒绝 | 不需要；Mock 执行器 |
| Runner 集成 | 取消、超时、输出洪泛、子进程树、并发、幂等 | 受控测试子程序，不运行真实压力测试 |
| UI 流程 | 问诊→计划→结果→导出、拒绝/跳过/空结果/错误态 | Mock IPC 先验证，不能代替原生验收 |
| Windows 实机 | 普通账户采集、安装包、权限不足、中文路径、缩放 | Windows 现有组件即可 |
| Provider 合约 | 请求字段、认证脱敏、响应校验、超时/断网/重定向 | Mock HTTP 服务；默认不消耗真实额度 |
| 发版检查 | 第三方声明、依赖许可、工件清单、WebView2、安装/卸载 | 不要求预装第三方检测软件 |

### 14.2 必须覆盖的样例

| ID | 输入/情形 | 预期结果 |
| --- | --- | --- |
| T01 | 只有 Kernel-Power 41，BugcheckCode=0 | 输出异常关机观察；不确诊电源故障 |
| T02 | 所选时间没有事件 | 查询成功且证据为空；明确无法排除故障 |
| T03 | 一类日志访问拒绝 | 其他来源继续，覆盖度显示权限不足 |
| T04 | 应用崩溃包含系统 DLL 模块名 | 不直接判该 DLL 是根因，不建议随意替换系统文件 |
| T05 | WHEA 类记录缺少错误详情 | 保留迹象，不能指认更换某部件 |
| T06 | CrystalDiskInfo 多盘、中文/英文文本 | 支持字段正确归属每块盘；不混淆状态 |
| T07 | smartctl ATA/NVMe JSON 缺字段 | partial/unknown；缺字段不按 0 或正常处理 |
| T08 | smartctl 退出码 8 且 JSON 可用 | 按位掩码解释，保留健康告警；不当成启动失败 |
| T09 | smartctl 退出码 2，设备拒绝访问/低功耗等上下文 | 不能单凭退出码判硬件损坏 |
| T10 | JSON 超大、深层嵌套、无效文本，或 XML 含外部实体 | 安全拒绝，不卡死、不访问外部资源 |
| T11 | 报告含“忽略规则并执行…”与 HTML/远程图片 | 作为不可信文本，零执行、零远程加载 |
| T12 | 新工具版本、缺少许可、文件 hash 改变 | 阻止执行/打包；导入可降级为不支持或附件 |
| T13 | 用户同意后计划参数被扩大/重复点击 | hash 不符拒绝；相同计划只启动一次 |
| T14 | 子进程持续输出并生成子进程 | 有限内存/磁盘，取消和超时清理整个受控树 |
| T15 | 采集中进程崩溃/应用重启 | interrupted，保留 partial；不自动重跑 |
| T16 | 模型引用不存在证据或推荐危险命令 | 拒绝模型结果，退回规则报告 |
| T17 | 模型断网、Key 错、超时、返回超大响应 | 可取消、有上限、核心诊断继续；日志无 Key |
| T18 | 日志时区不同、时间不明、报告非本次测试 | 明确无法关联；导入时间不代替事件时间 |
| T19 | 导出含用户路径/序列号/令牌样式内容 | 默认替换；预览能修改；原始附件默认不选 |
| T20 | 中文带空格路径、路径穿越、UNC、符号链接/重解析点 | 合法路径可用，逃逸拒绝；不执行文件名 |
| T21 | 磁盘空间不足/单案例达到上限 | 停止新增写入，明确错误并保留已完整数据 |
| T22 | 删除案例 | 运行停止，附件/元数据/相关记录被清理，失败有提示 |
| T23 | 办公环境选择个人受限工具 | 相关自动行为不可用；不因 Sentinel 非商用跳过审核 |
| T24 | 关闭所有网络后新建诊断 | 系统采集/导入/规则/导出完整可用；无暗中联网 |

### 14.3 Windows 验收环境

主验收：开发开始时确定一个仍受支持的 Windows 11 x64 版本，记录 edition、build、补丁、CPU/内存、语言与账户权限。至少覆盖普通用户、管理员账户以普通权限启动、中文带空格路径、断网和无预装第三方工具。另做至少一个英文系统或英文报告样本验证。

Windows 10 仅作为尽力兼容目标；未完成指定版本实测前不在发布页写“完全支持”。ARM64、Server 和企业受限环境不进入首发兼容承诺。无需真实制造硬件故障来验收规则，禁止为测试故意断电、损坏硬盘或运行未授权压力测试。

### 14.4 性能目标（设计预算，尚未实测）

在记录配置的参考机（SSD、8 GiB 以上内存）上：冷启动目标 ≤5 秒；空闲时本产品进程组平均 CPU <1%，峰值内存目标 ≤300 MiB；默认系统概况+事件采集目标 ≤60 秒，单动作仍受自身超时约束。20 MiB 以内已支持报告目标 ≤5 秒解析。

运行期间取消按钮在 1 秒内显示取消中，受控本机子进程目标 5 秒内终结；不可终止需明确失败并阻止继续采集。外部手动测试不适用此终止承诺。性能目标若未达标，记录测量方式与原因，不能删除原始结果后声称通过。

## 15. 实施计划与里程碑

排期为单人熟悉技术后的估算，按可验收成果推进，不是交付承诺；若需要学习 Rust/Tauri、补真实样本或取得授权，时间相应增加。

| 阶段 | 预计投入 | 交付结果 | 退出条件 |
| --- | --- | --- | --- |
| M0 范围与基线 | 1–2 天 | 环境检查、ADR、许可清单、Mock 数据契约 | C00/C01 完成，无未声明的范围扩张 |
| M1 离线纵向原型 | 3–5 天 | 问诊→导入合成样本→规则结果→Markdown | C02/C03/C07/C08 的最小路径可演示 |
| M2 本机真实采集 | 4–6 天 | 普通权限系统概况和事件窗口；取消/部分失败 | C04/C05/C06 通过原生测试 |
| M3 数据与解释 | 3–5 天 | 两类第三方报告、覆盖度、历史与脱敏导出 | C07–C10 样本和边界验收通过 |
| M4 模型与完整流程 | 2–4 天 | Disabled/Mock/用户自配 Provider、输出门禁 | C11/C12 合约测试与离线回退通过 |
| M5 安装与试用 | 3–5 天 | 安装包、文档、实机记录、许可证与安全检查 | C13–C15 完成；没有阻断性问题 |

总量约 16–27 个开发日，阶段可交错。优先做一条完整纵向路径，不先堆十几种工具卡片。若人力不足，延后可选 Provider 的实网接入，但要在发布说明明确，并保留本地规则与 Mock 验收结果的区别。

每个里程碑结束需更新 `docs/ACCEPTANCE.md`：完成内容、证据、失败项、未验证项与下一步。不要把待实现条目自动改为完成。

## 16. Codex 可执行任务清单

任务按依赖执行。允许同一任务内合理重构；新增工具、真实付费调用、安装第三方驱动、压力测试或系统变更不属于这些任务的隐含授权。

### C00：检查仓库并冻结开发基线

- **输入**：本文、当前仓库、现有 AGENTS.md/README/锁文件。
- **操作**：只读检查结构与工具链；判断新建或增量项目；核对 Tauri/Vue 官方兼容要求；建立文档目录、任务状态和 ADR。先记录 OS/build、可用版本与环境缺口，不先改系统配置。
- **产物**：`docs/ADR/0001-scope.md`、`docs/ACCEPTANCE.md`、环境检查记录。
- **验收**：清楚区分已具备/需安装/未验证；明确 P0 范围、许可默认拒绝策略和自有代码许可待确认项。
- **依赖**：无。只有缺少会阻止下一步的真实信息时才集中询问；独立任务继续。

### C01：建立工程与最小权限边界

- **操作**：创建 Tauri 2 + Vue 3 + TS 骨架，固定依赖和锁文件；增加 typed IPC、CSP、主窗口 capability/custom command 权限。完成 CI 基础检查。
- **产物**：能启动的中文应用框架、构建说明、最小接口测试。
- **验收**：未授权窗口/动作被拒绝；没有通用 Shell 或任意文件读写 IPC；前后端构建通过。
- **依赖**：C00。

### C02：实现领域模型、存储和状态机

- **操作**：实现 Case/Plan/Consent/Run/Artifact/Evidence，SQLite 迁移、案例目录、状态转移、一次性同意与幂等启动；添加中断恢复。
- **产物**：可重启恢复的案例服务、迁移与存储测试。
- **验收**：计划修改使旧同意失效；重复启动只有一个 Run；模拟中断后为 interrupted，不能自动重跑。
- **依赖**：C01。

### C03：实现问诊、计划和结果框架

- **操作**：开发页面与 Mock IPC；展示时间/时区、使用环境、计划范围、覆盖度、部分失败及取消。
- **产物**：完整可点击的离线演示路径，模拟数据有醒目标记。
- **验收**：普通用户无需理解命令即可走完；未知/未覆盖不显示成通过；1280×720/150% 缩放可用。
- **依赖**：C01；持久化接 C02。

### C04：实现两个 Windows 只读 Adapter

- **操作**：按 7.4 节完成固定脚本、结构化输出、事件 XML/字段保留，验证 PowerShell 5.1 和普通用户权限；不拓展到 Security 日志和任意 WMI 查询。
- **产物**：系统概况、事件窗口 Adapter，脚本与脱敏样本。
- **验收**：真实采集成功；空事件与权限不足不同；时间过滤、条数/字节限制、本地化和 partial 行为有记录。
- **依赖**：C01/C02；运行控制接 C05。

### C05：实现受控 Runner

- **操作**：固定动作模板、可信路径、脚本身份、流式读输出、大小上限、超时、Windows 进程树取消、并发锁和有限重试。
- **产物**：Runner、专用测试子程序、审计事件。
- **验收**：T13–T15/T21 通过；恶意参数不能改变命令；取消不杀用户其他同名进程。
- **依赖**：C01/C02。

### C06：实现许可与策略门禁

- **操作**：建立工具目录与结构化许可记录，按动作验证版本/风险/模式/使用环境/同意；候选工具执行关闭。
- **产物**：PolicyEngine、工具目录页、许可状态测试。
- **验收**：未知许可、未审核版本、R2+、过期同意全部拒绝；前端绕过按钮也无法运行；首发包无第三方检测程序。
- **依赖**：C02/C05。

### C07：实现报告导入与两个 Parser

- **操作**：安全复制、hash、格式/编码/大小验证；CrystalDiskInfo 文本与 smartctl JSON 分别实现 Parser，原始文件声明与实测来源分开。
- **产物**：解析器、至少每类 3 个边界样本及来源说明。
- **验收**：多盘/ATA/NVMe/缺字段/损坏/中文编码/未知版本均有测试；支持版本的合法脱敏真实样本至少每类 1 份。缺真实样本时只能标为预览格式支持。
- **依赖**：C02；可先用合成样本进行开发。

### C08：实现 RuleEngine 与证据时间线

- **操作**：实现 9.2 节规则、观察/假设/未知项区分、证据定位、时间和设备关联；规则版本可记录。
- **产物**：规则集、固定回归样例、结果页数据结构。
- **验收**：T01–T05/T18 通过；每个 Finding 可追溯，所有故障排除表述符合覆盖范围。
- **依赖**：C02/C07；本机来源接 C04。

### C09：实现受限 Agent 编排

- **操作**：在状态机上实现固定 action catalog、风险优先的候选检查、步数/轮数预算、等待导入与停止条件；规则版可完整运行。
- **产物**：Orchestrator、可重放的状态测试。
- **验收**：模型关闭仍走完闭环；不能建议未注册动作；不无限循环；用户跳过后可生成 partial 报告。
- **依赖**：C06/C08。

### C10：实现隐私、历史与导出

- **操作**：脱敏映射、Markdown/JSON 生成、分享预览、历史删除/保留策略、空间预算和敏感日志控制。
- **产物**：导出器、隐私说明、删除测试。
- **验收**：T19/T20/T22 通过；默认无原始附件、无 Key、无本机绝对路径；JSON 带 schemaVersion；报告事实与结构数据一致。
- **依赖**：C02/C08。

### C11：实现可选模型 Gateway

- **操作**：Disabled/Mock Provider 优先，随后实现用户自配 HTTPS Provider；凭据存储、发送预览、网络目标限制、Schema 与引用校验、预算/取消/失败回退。
- **产物**：Provider 合约、Mock 服务测试、设置页。
- **验收**：T11/T16/T17 通过；未配置时零请求；不向模型暴露工具执行权；默认测试不消耗真实额度。真实服务未调用时明确记录为“Mock 合约验证”。
- **依赖**：C08/C09/C10。

### C12：打通并验证中文交互

- **操作**：连接真实 IPC，覆盖问诊→同意→采集/导入→规则/模型→复测→导出所有状态；处理焦点、缩放、文本复制和错误提示。
- **产物**：完整桌面流程、演示说明。
- **验收**：不支持工具无运行按钮；权限拒绝能继续；用户能区分模拟数据、实采数据、导入声明和模型解释。
- **依赖**：C03–C11。

### C13：完成安全与授权检查

- **操作**：运行恶意输入、IPC 绕过、路径逃逸、同意重放、输出洪泛、密钥泄漏检查；审核依赖和安装包工件清单。
- **产物**：安全测试记录、THIRD_PARTY_NOTICES、工具审核记录。
- **验收**：不存在通用命令入口、默认模型上传、未授权第三方工件或私密样本；所有阻断问题已修复。
- **依赖**：C12。

### C14：安装包与独立 Windows 验收

- **操作**：生成 x64 安装包；在无开发依赖、普通用户/标准权限和断网环境验收；记录 WebView2 需求、安装/卸载与数据保留行为。
- **产物**：安装包、hash、构建来源、实机测试记录；代码签名若未具备要如实说明。
- **验收**：T24 及核心闭环通过；不要求用户安装 Node/Python；安装不会附带第三方检测工具/驱动；卸载前明确用户数据处理方式。
- **依赖**：C13。

Tauri 官方 Windows 安装文档说明安装器与 WebView2 的部署选项。需选择并测试一种明确策略，不把“离线诊断”误写为“任何无 WebView2 的电脑都能离线安装”。[Windows Installer 官方文档](https://v2.tauri.app/distribute/windows-installer/) [S17]

### C15：整理可交付仓库

- **操作**：更新 README、限制/已知问题、支持环境、启动/测试/构建步骤、隐私/安全、任务验收记录；移除演示敏感资料。
- **产物**：可重建源码、安装包、用户说明、验证证据。
- **验收**：最终状态分清“实现并实测/模拟验证/未验证/延期”；从干净检出按文档可构建；不得只交截图或假进度演示。
- **依赖**：C14。

## 17. 发版验收标准（Definition of Done）

以下项目全部满足，才可称为本规格的完整 MVP。未满足时可以交付预览版，但不能省略限制。

- [ ] A01：普通用户能从首页走完问诊、计划同意、本机采集、结果和导出。
- [ ] A02：未安装任何第三方工具时，核心路径仍完整可用。
- [ ] A03：CrystalDiskInfo 文本和 smartctl JSON 有支持版本、合法脱敏样本、解析与负面测试；缺样本明确标成预览。
- [ ] A04：每个发现有证据 ID/出处；原始资料、解析结果、假设、未知项清楚分开。
- [ ] A05：单条 41、不完整 WHEA、系统 DLL 崩溃等样例不会确诊具体硬件。
- [ ] A06：权限拒绝、空日志、格式未知、输出截断不被显示成“检查通过”。
- [ ] A07：执行权在 Rust 策略层；模型、前端、报告内容均不能注入任意命令。
- [ ] A08：计划同意绑定实际参数和版本；重复点击、过期、变更、重启不会重复执行。
- [ ] A09：取消、超时、中断恢复和输出上限通过受控进程测试。
- [ ] A10：无管理员代理、无压力测试、无自动修复、无第三方 EXE/DLL/驱动随包分发。
- [ ] A11：模型默认关闭；无配置不联网；可选 Provider 失败后完整回退。Mock 与真实调用记录分开。
- [ ] A12：默认导出脱敏，原始附件需独立选择；密钥和敏感路径不进入日志或分享包。
- [ ] A13：历史保留/删除、存储上限、导出版本和数据完整性有测试。
- [ ] A14：独立 Windows 环境完成安装与实际核心采集，不只在前端浏览器演示。
- [ ] A15：工具来源/许可记录、依赖声明、版本锁定和官方更新入口可审阅。
- [ ] A16：支持入口如启用，已复核相关第三方授权，不改变第三方可用权利。
- [ ] A17：文档清楚列出支持环境、性能实测、未验证和延期项；无夸大准确率。

### 17.1 建议首发验证演示

用 5 个可重放案例完成验收：纯日志正常/无相关事件、仅有异常关机事件、应用崩溃、磁盘报告存在告警、资料不足且模型不可用。前四类用合成/脱敏样本验证规则，再用真实采集验证本机管线；不得冒充当前电脑真的发生了样本故障。

发版记录每个案例的输入来源、操作步骤、实际输出、判定和证据路径。安全边界违规、秘密泄漏、未授权分发、错误确诊硬件或取消失控都是阻断问题。

## 18. 可直接交给 Codex 的启动指令

将下面文本与本文件一同交给目标仓库中的 Codex：

```text
请依据 docs/PROJECT_SPEC.md 开发 Sentinel PC。

这是面向普通游戏和办公用户的 Windows 桌面诊断 Agent，采用 Tauri 2 + Vue 3 + TypeScript + Rust。
复用 Windows 现有日志和成熟第三方工具的报告，不自行开发底层硬件检测引擎。

先执行 C00：读取仓库规则与现有文件，只读检查环境，记录已具备/缺少/未验证项。
然后按 C01–C15 依赖推进，每个任务留下可审查的代码、测试和验收记录。
先做离线纵向闭环，再做真实 Windows 采集，最后接可选模型和安装验收。

必须遵守：
1. 默认普通用户权限；首发不实现管理员助手、自动修复、压力测试或第三方程序打包。
2. 首发第三方工具仅做 CrystalDiskInfo 文本和 smartctl JSON 报告导入。
3. 免费、非商用、开源和自愿支持都不代表获得第三方再分发或自动化许可。
4. 执行器只接受固定动作和受限参数；模型及报告文本不能执行命令或扩大权限。
5. 核心诊断离线可用；模型默认关闭，测试优先 Mock，不擅自消耗真实 API 额度。
6. 不把单条事件、崩溃模块、无日志或工具通过当成确定硬件结论。
7. 不下载来源不明工具，不从工具箱提取程序，不绕过 EULA、反作弊或系统策略。
8. 不读取当前电脑的私人报告、文档或密钥来凑测试；用合成/合法脱敏样本。
9. 任何需额外权限、付费调用、系统变更、真实高负载测试的步骤，先完成准备并明确说明。
10. 不用占位数据冒充完成；区分实现、Mock 验证、真实采集、真实格式验收与待核验项。

常规实现选择自行推进，只有会阻止下一步且无法从仓库核实的问题才集中询问。
本轮先完成一个可验证里程碑，再汇报具体完成项、验证结果和未完成项；不要只提出计划。
最终按第 17 章逐条验收，不满足时称为预览版并列明限制。
```

## 19. 首轮需要核实的事项与默认方案

| 事项 | 未获得补充时的默认方案 | 是否阻止开始 |
| --- | --- | --- |
| 目标仓库/是否已有代码 | 先检查当前仓库；空仓库按本规格创建 | 否 |
| Windows 支持版本 | 以开发机可用的受支持 Windows 11 x64 为主验收，记录完整 build | 无可用 Windows 时阻止实机验收，不阻止离线开发 |
| 自有代码许可 | Apache-2.0 为建议；待所有者确认再发布法律声明 | 不阻止开发，阻止正式公开发布 |
| 模型服务和预算 | 默认关闭，使用 Disabled/Mock Provider | 否 |
| 工具报告样本 | 先合成样本开发，再取得合法脱敏真实样本 | 阻止宣称真实格式验收，不阻止其他开发 |
| 工具再分发授权 | 首发全部不打包 | 否 |
| 支持入口 | 默认不启用；文案、渠道和授权复核后再加 | 否 |
| 代码签名证书 | 不假定已有；开发包如实说明签名状态 | 不阻止开发，正式发布策略需明确 |
| 全部硬件型号覆盖 | 不追求首发全覆盖，只承诺已测试来源/格式 | 否 |

## 20. 官方参考资料与核对记录

核对日期：2026-11-12。下面链接支持相应技术或授权判断；具体发行版本、文件身份、依赖、报告格式与用户场景仍需在实现/发版时复核。本文未复制整份第三方许可证，未来若分发工件需随发行物提供其要求的完整文本。

| 编号 | 官方来源 | 本次用途与限制 |
| --- | --- | --- |
| S01 | [Get-WinEvent](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.diagnostics/get-winevent) | 筛选与结构化查询设计依据；实际 PowerShell 5.1 行为须实测 |
| S02 | [Microsoft：Event ID 41 排查](https://learn.microsoft.com/en-us/troubleshoot/windows-client/performance/event-id-41-restart) | 异常关机观察与根因边界 |
| S03 | [CrystalDiskInfo License](https://crystalmark.info/en/software/crystaldiskinfo/crystaldiskinfo-license/) | 主程序 MIT 条款起点；不代替具体工件依赖审计 |
| S04 | [smartctl 源码许可标识](https://raw.githubusercontent.com/smartmontools/smartmontools/master/smartmontools/smartctl.cpp) | smartctl GPL-2.0-or-later 标识；main/master 来源需最终锁定版本 |
| S05 | [smartmontools COPYING](https://raw.githubusercontent.com/smartmontools/smartmontools/master/smartmontools/COPYING) | GPLv2 文本与分发义务起点 |
| S06 | [smartctl 上游手册源文件](https://raw.githubusercontent.com/smartmontools/smartmontools/master/smartmontools/smartctl.8.in) | JSON、设备/动作差异、位掩码退出状态；实现需固定版本 |
| S07 | [HWiNFO Licenses](https://www.hwinfo.com/licenses/) | 免费/Pro 与自动化功能差异 |
| S08 | [HWiNFO EULA PDF](https://www.hwinfo.com/files/license.pdf) | 第三方打包需明确批准、禁止绕过受限功能 |
| S09 | [OCCT Personal 官方页面](https://www.ocbase.com/download-personal) | 个人用途、报告权益与 CommandLine 授权差异 |
| S10 | [OCCT EULA](https://www.ocbase.com/eula) | 用途与分发限制；不推导接受 Sentinel 打赏的适用结论 |
| S11 | [PresentMon LICENSE](https://github.com/GameTechDev/PresentMon/blob/main/LICENSE.txt) | 主仓库 MIT 许可起点；不覆盖未审依赖工件 |
| S12 | [PresentMon Console 文档](https://github.com/GameTechDev/PresentMon/blob/main/README-ConsoleApplication.md) | 区分组件和版本，P1 实施前复核格式 |
| S13 | [Sysinternals Software License Terms](https://learn.microsoft.com/en-us/sysinternals/license-terms) | 使用权与发布/转移限制；具体工具仍需看附带条款 |
| S14 | [Tauri Capabilities](https://v2.tauri.app/security/capabilities/) | 自定义命令与窗口权限边界，Rust 仍需业务校验 |
| S15 | [Tauri Shell](https://v2.tauri.app/plugin/shell/) | 子进程权限控制；首发不开放通用 Shell |
| S16 | [Tauri External Binaries / Sidecar](https://tauri.app/develop/sidecar/) | 打包机制与执行权限；不授予第三方版权许可 |
| S17 | [Tauri Windows Installer](https://v2.tauri.app/distribute/windows-installer/) | 安装器与 WebView2 部署策略 |

### 20.1 本次交付的验证状态

- 已完成：需求与来源边界整理、官方技术/许可资料核对、开发规格和任务/验收设计。
- 尚未完成：应用代码、安装包、任何工具二进制审核/集成、真实报告解析、真实电脑诊断、性能/准确率验证。
- 首发默认禁用：第三方工具打包、自动安装、压力测试、修复、管理员代理和支持收款入口。
- 后续所有实现成果以实际仓库、测试输出和实机记录为准；本文件不能充当已获得第三方授权或已完成运行验收的证明。

[S01]: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.diagnostics/get-winevent
[S02]: https://learn.microsoft.com/en-us/troubleshoot/windows-client/performance/event-id-41-restart
[S03]: https://crystalmark.info/en/software/crystaldiskinfo/crystaldiskinfo-license/
[S04]: https://raw.githubusercontent.com/smartmontools/smartmontools/master/smartmontools/smartctl.cpp
[S05]: https://raw.githubusercontent.com/smartmontools/smartmontools/master/smartmontools/COPYING
[S06]: https://raw.githubusercontent.com/smartmontools/smartmontools/master/smartmontools/smartctl.8.in
[S07]: https://www.hwinfo.com/licenses/
[S08]: https://www.hwinfo.com/files/license.pdf
[S09]: https://www.ocbase.com/download-personal
[S10]: https://www.ocbase.com/eula
[S11]: https://github.com/GameTechDev/PresentMon/blob/main/LICENSE.txt
[S12]: https://github.com/GameTechDev/PresentMon/blob/main/README-ConsoleApplication.md
[S13]: https://learn.microsoft.com/en-us/sysinternals/license-terms
[S14]: https://v2.tauri.app/security/capabilities/
[S15]: https://v2.tauri.app/plugin/shell/
[S16]: https://tauri.app/develop/sidecar/
[S17]: https://v2.tauri.app/distribute/windows-installer/

