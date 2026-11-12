# C00 环境检查

> 后续更新：2026-11-12 已在项目 .tools 安装 Rust 1.99.1 MSVC/rustfmt，未改系统 PATH；前后端与 Tauri debug 构建通过。下文保留 C00 初次检查事实，不代表当前仍缺 Rust。具体兼容调整见 ADR/0002-offline-preview.md，运行边界见 REAL_MACHINE_TESTS.md。

检查日期：2026-11-12（Asia/Hong_Kong）。仅检查仓库、开发工具、系统版本注册表及安装组件记录，未安装软件、修改系统设置或读取私人报告/密钥。

## 仓库

- 路径：D:/文档/ChatGPT/哨兵。
- 初始状态：只有 .git，master 尚无提交；无受跟踪文件、锁文件或应用代码。
- 所检查的祖先目录和项目根无 AGENTS.md。
- Git 2.55.0.windows.3 可运行；git status 曾提示无法读取用户全局 ignore 文件。仓库状态查询仍返回，未修改用户 Git 配置。

## 工具链

| 项目 | 实际观察 | 判定 |
| --- | --- | --- |
| Node.js | 24.16.0，C:/Program Files/nodejs/node.exe | 已验证命令可运行 |
| npm | 11.13.0，使用 npm.cmd 检查 | 已验证命令可运行 |
| pnpm | Codex bundled fallback 命令存在，未执行版本检查 | 不作为项目环境保证；优先 npm |
| Rust / Cargo / rustup | PATH 均未发现，用户默认 .cargo/bin 不存在 | 当前不可用，需核实或安装；不排除非默认位置 |
| VS 2022 Community | vswhere 返回完整安装 17.14.37027.9；VC.Tools.x86.x64 组件匹配 | 有安装记录，编译/链接未验证 |
| VS 2026 | Community 有完整安装记录；另一个 BuildTools 实例不完整 | 不依赖不完整实例 |
| cl / link | 当前 PATH 未发现 | 不能据此断言 C++ 工具缺失；开发命令环境未验证 |
| Windows SDK | 安装根存在；Include/10.0.26100.0 可见 | 文件目录已观察，链接未验证 |
| WebView2 | 安装注册记录 157.0.4341.46 | 原生创建窗口未验证 |
| Windows PowerShell | 系统 powershell.exe 实际返回 5.1.26100.9444 | 版本可运行；采集脚本尚不存在 |
| 检查宿主 PowerShell | 7.6.9（Codex bundled） | 不能代替生产 PowerShell 5.1 验收 |

## 系统与权限

- 架构 X64；注册表 DisplayVersion=26H2、CurrentBuild=26300、UBR=9457、EditionID=CoreCountrySpecific。
- 同一注册表 ProductName 为 Windows 10 Home China。保留原始差异，不只凭此字段断言 Windows 10，也不将本机认定为已核验受支持 Windows 11 验收环境。
- 当前执行进程没有启用管理员身份。
- Get-CimInstance Win32_OperatingSystem 返回“拒绝访问”。可能涉及本次执行环境或系统权限，原因尚未定位；不将其视为目标应用或所有普通账户都无法采集的证据。未尝试提权或更改策略。
- 未查询实际故障日志、硬盘健康、私人文档、API Key 或报告文件。

## 官方兼容要求复核

本轮实际打开官方页面，访问日期 2026-11-12：

- [Tauri 前置要求](https://v2.tauri.app/start/prerequisites/)：Windows 开发需要 Microsoft C++ 工具、WebView2 与 Rust；选 MSVC Rust host。x64 项目目标为 x86_64-pc-windows-msvc。
- [Vue Quick Start](https://vuejs.org/guide/quick-start.html)：当前 Node 条件为 ^22.18.0 或 >=24.12.0，本机 24.16.0 满足。
- [Vite Guide](https://vite.dev/guide/)：页面列出 Node 20.19+、22.12+，且提醒模板可要求更高版本。本项目仍需在 C01 检查实际所选依赖 engines/peerDependencies。

页面要求核对不等于安装包或兼容构建已经验证。

## 下一阶段缺口

1. 原生构建前核实并补齐 Rust MSVC 工具链；系统安装和配置变更另行明确处理，本轮未执行。
2. C01 确定精确包版本并提交 package-lock.json、Cargo.lock 和工具链记录，验证 C++ 编译链接与 Tauri 窗口。
3. 在适当的 Windows 运行环境验证 PowerShell 5.1 普通权限采集；权限不足必须有降级路径。
4. 获得合法脱敏真实报告与独立安装验收环境；离线合成数据开发不依赖这些条件。
