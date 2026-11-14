# Sentinel PC · 深度摸鱼

**简体中文** | [English](README.en.md)

面向游戏玩家与日常办公用户的 **Windows 桌面智能硬件体检与故障诊断 Agent**。
以普通用户权限运行，不捆绑数 GB 第三方工具包，不做后台驻留与流氓自动改写，帮助你快速看清本机配置、定位常见性能/故障盲区，并在需要时与图吧工具箱等成熟检测报告联动。

---

## 核心功能

### 1. 一键只读硬件体检与配置核查
- **只读硬件与系统快照**：自动采集本机主板/型号、操作系统版本、CPU、显卡输出通路（核显/独显及活动输出数）、显示器当前刷新率与可识别 EDID 最高档位、内存运行速率与物理插槽条数、当前电源计划、Windows 游戏模式、硬件加速 GPU 计划（HAGS）以及系统盘剩余空间。
- **小问题一键直达系统设置**：针对刷新率未跑满、电源计划保守、游戏模式或 HAGS 调整、系统盘空间清理等设置项，无需复制粘贴复杂命令，直接通过 `ms-settings:*` 白名单跳转至 Windows 原生设置页手动确认修改。
- **大问题诚实边界（不瞎猜）**：遇到用户态 API 无法可靠读取的指标（如 XMP/EXPO 开关状态、内存物理双通道归属、PCIe 实时协商速率或高负载温度节流），明确标注「待核对/未知」，引导进入 BIOS 核对、检查物理 DP/HDMI 接线，或导出脱敏报告交由售后排查。

### 2. 故障问诊、多轮 AI 问答与复测对比
- **四大故障分诊流**：覆盖「游戏掉帧与显示异常」「蓝屏、黑屏与自动重启」「磁盘掉盘与读写异常」「办公卡顿与外设异常」4 类高频场景。
- **单变量复测与案例归档**：支持保存诊断案例、记录「每次只改一个变量」的前后复测对比，避免盲目折腾。
- **脱敏报告导出**：支持一键导出 Markdown（`.md`）或 JSON（`.json`）诊断报告，导出前提供完整内容预览，自动剔除本机隐私路径、API Key 与敏感凭据，方便发帖求助或提交售后。
- **可选大模型接入与本地确定性回退**：
  - 支持接入 DeepSeek 或兼容 OpenAI Chat Completions 协议的 HTTPS 模型网关，内置「测试模型连通性」一键探测与真实 SSE 流式打字机回答。
  - API Key 仅通过 Windows **DPAPI**（`CryptProtectData`）加密保存在本机当前用户下，前端永不回显明文。
  - 断网、未配置 API Key 或远端服务异常时，自动无缝回退至本地确定性规则引擎，离线依然可用。

### 3. 图吧工具箱联动与离线报告解析
- **轻量绿色，按需获取工具箱**：程序本体单文件约 **16 MB**，不捆绑 2–3 GB 的第三方软件合集；在「工具与来源」页面提供图吧工具箱常用工具速查表与官网直达入口（`https://www.tbtool.cn/`）。
- **本地离线解析专业报告**：支持粘贴或导入以下常见报告，在本地完成结构化解析（除非用户主动在问诊中发起 AI 对话，否则绝不上传外网）：
  - **CrystalDiskInfo / DiskInfo** 硬盘健康报告（`.txt`）
  - **HWiNFO64** 传感器监测日志（`.csv`）
  - **smartctl** 磁盘 SMART 报告（`.json`）

### 4. 界面与交互体验
- 支持 **浅色 / 深蓝 / 跟随系统** 主题配色与多套背景风格切换。
- 支持桌面端独立单文件运行（基于 Windows WebView2），同时支持浏览器 Mock 预览调试（`127.0.0.1:1420`）。

---

## 适用边界与安全原则

| 原则 | 说明 |
| :--- | :--- |
| **普通用户权限运行** | 默认不申请管理员（UAC）提权，不安装内核驱动。 |
| **零自动修改** | 不自动改写注册表、BIOS、电源计划或系统策略，所有系统设置变更均由用户在 Windows 原生设置页手动确认。 |
| **不代跑高危操作** | 不内置、不自动拉起烤机压力测试或固件刷写程序。 |
| **最小权限与隐私保护** | Tauri `capabilities` 最小权限配置 + 生产环境严格 CSP（禁止远程脚本）；仅在用户显式触发模型测试或问答时向白名单 HTTPS 网关发起请求。 |

---

## 快速上手

### 普通用户运行
1. 确保系统为 Windows 10 / 11（已内置 Microsoft Edge WebView2 Runtime）。
2. 下载或构建单文件可执行程序 `sentinel-pc.exe`（桌面快捷版名如 `哨兵 Sentinel PC.exe`），双击即可直接运行，无需安装。
3. **推荐排查流程**：
   - 先在 **「装机体检」** 查看本机核心硬件摘要与可优化设置项；
   - 若遇具体故障，前往 **「故障问诊」** 选择对应症状或导入 **「工具与来源」** 中解析出的 DiskInfo / HWiNFO64 报告；
   - 如需 AI 深度追问，可在 **「设置」** 中填入 DeepSeek API Key 并点击「测试模型连通性」。

---

## 技术栈与仓库结构

- **桌面宿主与后端**：Tauri 2 + Rust（核心库 `crates/sentinel-core`，宿主 `src-tauri`）
- **前端界面**：React 19 + TypeScript + Vite + Astryx UI（`@astryxdesign/core`）
- **本地存储与系统能力**：SQLite（`rusqlite` 本地案例存储）+ Windows WinHTTP（原生 HTTPS / SSE 流式请求）+ Windows DPAPI（凭据加密）

### 目录速览
- `crates/sentinel-core/`：Rust 核心诊断引擎、硬件探测、报告解析器（DiskInfo / HWiNFO / smartctl）、本地规则与模型网关。
- `src-tauri/`：Tauri 2 桌面端宿主、IPC 命令绑定与安全权限配置。
- `src/`：React 19 前端页面（装机体检 `HardwarePage`、故障问诊 `DiagnosePage`、工具与来源 `ToolsPage`、设置 `SettingsPage`）。
- `docs/`：项目架构与工程规范文档：
  - [PROJECT_SPEC.md](docs/PROJECT_SPEC.md) — 产品范围、功能矩阵与安全基线
  - [BACKEND_HANDOFF.md](docs/BACKEND_HANDOFF.md) — 后端架构、模块职责与接口契约
  - [ADR/0001-scope.md](docs/ADR/0001-scope.md) — 架构决策记录（只读边界与工具联动）
  - [ACCEPTANCE.md](docs/ACCEPTANCE.md) — 验收标准与测试矩阵
  - [ENVIRONMENT.md](docs/ENVIRONMENT.md) — 开发环境要求
  - [UPSTREAM_REUSE.md](docs/UPSTREAM_REUSE.md) — 开源参考与归属说明

---

## 本地开发与构建

### 环境要求
- **操作系统**：Windows 10 / 11 (x64)
- **Node.js**：`>= 24.12.0`
- **Rust**：MSVC 工具链（`stable-x86_64-pc-windows-msvc`）+ Windows 10/11 SDK + WebView2

### 常用命令

```powershell
# 1. 安装前端依赖
npm ci --ignore-scripts

# 2. 启动浏览器预览模式 (http://127.0.0.1:1420/)
npm run dev

# 3. 前端类型检查与单元测试 (Vitest)
npm run check

# 4. 运行 Rust 核心库单元与集成测试
npm run test:core
# 或直接执行：
cargo test --manifest-path crates/sentinel-core/Cargo.toml

# 5. 构建 Windows Release 独立单文件可执行程序
npm run tauri build -- --no-bundle
```

构建完成后，单文件程序输出于 `target/release/sentinel-pc.exe`（约 16 MB）。

---

## 许可证与致谢

- 第三方开源参考与归属清单请参见 [docs/UPSTREAM_REUSE.md](docs/UPSTREAM_REUSE.md) 与 [docs/reference/IMPORT_MANIFEST.json](docs/reference/IMPORT_MANIFEST.json)。
- 本仓库自有代码采用 [MIT License](LICENSE) 开源。
