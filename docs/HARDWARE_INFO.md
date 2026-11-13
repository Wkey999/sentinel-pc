# 启动硬件信息页

应用默认打开「硬件信息」。入口位于侧栏「一键体检」下方。首次成功采集后保存本地快照，重新打开应用或切换页面时优先展示快照，完整结果 24 小时内不重复采集；有分组不可读时，刷新间隔缩短为 5 分钟。过期先展示旧结果，再后台更新；刷新失败保留旧结果并提示错误。页面显示采集时间，磁盘余量、设备状态等均以该时间的快照为准。更换设备或需要最新状态时，点击「刷新信息」强制重采。并发请求合并成一次读取。不会因此创建案例、启动完整体检或发送模型请求；一键体检继续单独获取当前证据。

快照保存在应用 WebView 的本机 `localStorage`，键为 `sentinel.hardware.windows_native.v1`；浏览器演示使用独立键。缓存带版本、来源和严格 DTO 校验，损坏、未来时间或旧格式自动忽略；原生端不接受演示快照。缓存写入不可用时仍可读取设备并在内存复用，但退出后无法保留。不会上传硬件快照，也不存入案例库。

`get_hardware_info` 为主窗口专用的无参数 Tauri 命令。返回结构由 Rust `hardware::HardwareSnapshot` 与前端 `hardwareInfoSchema` 严格约束。Windows 使用内置 CIM/WMI 获取型号、系统、CPU、主板、内存模块、显示器 EDID 名称/尺寸、物理磁盘和固定分区余量、NPU 候选、音频设备、实体网卡及 BIOS。显卡专用显存使用 DXCore 的 64 位属性，不把 WMI 32 位 AdapterRAM 直接当成真实显存容量。

读取在后台执行；固定内嵌 PowerShell 脚本以 UTF-8 BOM 写入一次性目录，以可信系统 PowerShell 执行，沿用进程树约束、45 秒超时、512 KiB 输出上限和退出清理。脚本没有外部输入。不请求管理员权限，不修改系统设置，不枚举第三方工具，不采集序列号、MAC、IP、用户名或运行时间，也不持久化硬件快照到案例库。

每类信息分别处理读取失败。NPU 未枚举到可能是没有设备或驱动缺失；接口失败不等于硬件故障。设备管理器非零状态码、固定分区剩余不足 10% 仅作为基础提示，不构成整机健康认证。CPU 标称频率不等于睿频上限；内存配置速率不等于已验证 XMP/EXPO 或通道；EDID 未提供的面板商品名不会猜测。更深入检查仍由用户点击「一键体检」并确认原有套餐。

浏览器预览只显示明确标注的演示数据；原生读取失败不会静默降级成演示数据。

2026-11-14 验证：96 项 Rust 回归通过；另外显式执行一次 Windows 原生硬件采集，通过前端严格契约校验，合计 27 项前端测试通过。浏览器验证了默认首页、刷新、导航、体检入口和窄窗口排版；浏览器截图中的数据为演示数据。前端构建、正式版 EXE 构建和 Astryx 产物检查通过。机器原始快照与构建指纹保存在被 Git 忽略的 `.cache/`，不纳入公开源码。

参考：[DXCore 属性与专用显存](https://learn.microsoft.com/en-us/windows/win32/api/dxcore_interface/ne-dxcore_interface-dxcoreadapterproperty)、[WMI 显卡属性类型](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-videocontroller)、[EDID 基础尺寸](https://learn.microsoft.com/en-us/windows/win32/wmicoreprov/wmimonitorbasicdisplayparams)。
