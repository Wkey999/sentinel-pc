# 报告 Parser 后端进展

2026-11-12，解析器版本 preview-0.2.0。只推进后端；现有 UI/IPC 契约未改变。

## 已实现

纯函数 parse_report(ReportFormat, bytes)，无文件、进程、网络或模型访问。统一输出来源 SHA-256、声明工具版本、编码、状态、警告、每盘 Evidence 和字段定位。provenance 为 imported_report_declared，不能当作 Sentinel 实测。

| 格式 | 当前预览支持 | 缺失/失败处理 |
| --- | --- | --- |
| smartctl JSON | json_format_version=[1,0]；工具声明 7.2–7.5；ATA/NVMe/SCSI；UTF-8/BOM | 未知版本 unsupported；未知协议/缺字段 partial；健康缺失为 unknown |
| CrystalDiskInfo 文本 | 声明 9.0–9.6；官方导出英文键；英文及已核对的简中健康值；UTF-8、带 BOM UTF-16 LE/BE；多盘 | 未知版本/无盘节 unsupported；未知健康 partial；重复节/字段拒绝；GBK 未支持 |

smartctl 退出码按 8 个位保留：8 不是启动失败，2 不能单独判盘坏；日志错误位不等同整体健康失败。冲突健康声明保留告警并标 partial。CDI 本地 Date 没有时区，observedAtUtc 保持 null；导入时间不冒充测试时间。同型号磁盘用来源哈希与节序号分开。

边界：单文件 20 MiB、JSON 最大嵌套 64、字段 4 KiB、CDI 最大 128 盘 / 10 万行、JSON 最大 20 万结构分隔符；递归拒绝 JSON 重复键，不执行/渲染内容。工具版本只是文件声明，未知版本不放行执行。后端保留序列号属于原始解析结果，后续导出/模型发送必须经过统一脱敏。

## 验证

新增 30 项 Parser 测试；原有 18 项 Rust 测试保留，共 48 项通过。六份样本均为本项目合成，UTF-16/恶意/缺失/超限由测试构造。formatAcceptance 始终为 synthetic_only，不宣称真实格式验收。

开发 CLI：cargo run -p sentinel-core --example parse_report -- smartctl（或 cdi），从 stdin 接收报告字节；只供开发验证，不是桌面导入接口。CLI 原始解析结果可能含报告声明的敏感字段，不应直接分享真实报告输出。

## 来源核对

以下本轮实际读取的官方源码仅用于理解格式/状态，不复制上游实现或品牌资产：

- [CDI 导出模板](https://github.com/hiyohiyo/CrystalDiskInfo/blob/99f885efb57bd98ccce8c2c24188f93c81383cec/DiskInfoDlgCopy.cpp)：英文导出键、磁盘节边界及无时区 Date。
- [CDI 简中语言字典](https://github.com/hiyohiyo/CrystalDiskInfo/blob/99f885efb57bd98ccce8c2c24188f93c81383cec/Language/Simplified%20Chinese.lang)：良好/警告/不良/未知。
- [smartctl JSON 入口](https://github.com/smartmontools/smartmontools/blob/4906177ebabfddcce50099c29e10557ae4a273c4/src/smartctl.cpp)、[NVMe 输出](https://github.com/smartmontools/smartmontools/blob/4906177ebabfddcce50099c29e10557ae4a273c4/src/nvmeprint.cpp)、[退出码手册](https://github.com/smartmontools/smartmontools/blob/4906177ebabfddcce50099c29e10557ae4a273c4/src/smartctl.8.in)。

发现原规格引用的 smartmontools master 已于 2025 年退役；本轮改读 main 固定提交，目录在 src/。原规格资料保持原样，后续核对优先以本记录为准。

## 尚未完成

安全文件选择/复制/重解析点和路径约束、ArtifactStore/数据库引用与空间预算、import_report IPC、前端联动、真实脱敏报告样本、真实格式验收，以及警告与完整 RuleEngine/导出串联。C07 标为部分实现，C04/C05 仍未完成。
