# Sentinel PC · 深度摸鱼

[简体中文](README.md) | **English**

A **read-only Windows desktop hardware checkup and fault diagnosis agent** built for gamers and everyday PC users.
Runs with standard user privileges, bundles zero bloated third-party binaries, and never modifies your system behind your back—helping you inspect hardware configurations, spot common setup bottlenecks, and analyze reports from established utilities like **Tuba Toolbox (图吧工具箱)**, **CrystalDiskInfo**, and **HWiNFO64**.

---

## Key Features

### 1. One-Click Read-Only Hardware Checkup & Setup Audit
- **Read-Only System Snapshot**: Automatically inspects motherboard/model, OS build, CPU, GPU display routing (integrated vs. discrete GPU and active outputs), current monitor refresh rate vs. highest EDID-reported refresh rate, memory speed and populated slot count, active power plan, Windows Game Mode, Hardware-Accelerated GPU Scheduling (HAGS), and system drive free space.
- **Direct Jump to Native Windows Settings**: For quick fixes like refresh rate, power plan, Game Mode, HAGS, or Storage Sense, Sentinel PC provides allowlisted `ms-settings:*` shortcuts so you can review and toggle settings directly in Windows Settings without copy-pasting shell commands.
- **Honest Diagnostic Boundaries**: When user-mode APIs cannot reliably read low-level states (such as XMP/EXPO profile status, physical dual-channel slot pairing, real-time PCIe link width/speed, or thermal throttling under load), Sentinel PC explicitly marks them as *Unknown / Needs Verification* and guides you to check BIOS, verify physical DP/HDMI cabling, or export a redacted report for support.

### 2. Guided Fault Triage, Multi-Turn AI Q&A & Single-Variable Retesting
- **Four Guided Triage Flows**: Covers *Gaming Stutter & Display Issues*, *BSOD / Black Screen & Unexpected Reboots*, *Drive Disconnection & Read/Write Errors*, and *Office Lag & Peripheral Glitches*.
- **Single-Variable Retesting & Case History**: Save diagnostic cases locally and log before/after retest results changing one variable at a time.
- **Redacted Report Export**: Export diagnostic cases as Markdown (`.md`) or JSON (`.json`) with a full pre-export preview. Personal file paths, API keys, and sensitive credentials are automatically stripped.
- **Optional LLM Gateway with Deterministic Offline Fallback**:
  - Connect to **DeepSeek** or any OpenAI Chat Completions-compatible HTTPS endpoint, with a built-in **"Test Model Connectivity"** check and real-time **SSE streaming** responses.
  - API keys are encrypted locally using Windows **DPAPI** (`CryptProtectData`) under the current user account and are never echoed back to the UI in plaintext.
  - Works 100% offline: if no API key is configured, the network is unreachable, or the remote endpoint fails, Sentinel PC seamlessly falls back to its built-in deterministic rule engine.

### 3. Toolbox Companion & Offline Report Parser
- **Lightweight Single Binary (~16 MB)**: Instead of bundling 2–3 GB of third-party hardware utilities, the **Tools & Sources** page provides a curated quick-reference guide for **Tuba Toolbox (图吧工具箱)** along with an official download shortcut (`https://www.tbtool.cn/`).
- **Offline Structured Report Parsing**: Paste or import hardware reports locally without uploading them to the cloud (unless you explicitly ask the AI assistant during a triage session):
  - **CrystalDiskInfo / DiskInfo** text reports (`.txt`)
  - **HWiNFO64** sensor CSV logs (`.csv`)
  - **smartctl** SMART JSON outputs (`.json`)

### 4. Clean, Adaptive Desktop UI
- Switch between **Light**, **Deep Blue**, and **System** color themes with multiple backdrop styles.
- Runs as a standalone Windows desktop executable (powered by Windows WebView2) or in browser mock preview mode (`127.0.0.1:1420`).

---

## Scope & Safety Principles

| Principle | Details |
| :--- | :--- |
| **Standard User Privileges** | Runs without UAC administrator elevation and installs zero kernel drivers. |
| **Zero Silent Modifications** | Never edits the registry, BIOS, power plans, or system policies automatically. Every system setting change happens manually in native Windows Settings. |
| **No Automated Stress Testing** | Does not bundle or auto-launch heavy burn-in stress tests or firmware flashers. |
| **Least Privilege & Privacy** | Strict Tauri `capabilities` permissions + production CSP disallowing remote scripts. Network requests are only sent to allowlisted HTTPS model gateways when explicitly triggered by the user. |

---

## Quick Start

### For End Users
1. Ensure you are running Windows 10 or Windows 11 (with Microsoft Edge WebView2 Runtime installed).
2. Download or build the standalone executable `sentinel-pc.exe` and double-click to launch—no installer required.
3. **Recommended Workflow**:
   - Start in **Hardware Checkup (装机体检)** to inspect your hardware summary and one-click Windows Settings optimizations.
   - Open **Fault Triage (故障问诊)** to troubleshoot specific symptoms or import parsed DiskInfo / HWiNFO64 reports from **Tools & Sources (工具与来源)**.
   - Optionally configure a DeepSeek API key in **Settings (设置)** and click **Test Model Connectivity (测试模型连通性)** to enable streaming AI follow-up Q&A.

---

## Tech Stack & Repository Structure

- **Desktop Host & Core Engine**: Tauri 2 + Rust (`crates/sentinel-core` core library, `src-tauri` desktop host)
- **Frontend**: React 19 + TypeScript + Vite + Astryx UI (`@astryxdesign/core`)
- **Local Storage & Native APIs**: SQLite (`rusqlite` for local case persistence) + Windows WinHTTP (native HTTPS & SSE streaming) + Windows DPAPI (credential encryption)

### Directory Layout
- `crates/sentinel-core/`: Rust diagnostic engine, hardware collectors, offline parsers (DiskInfo / HWiNFO / smartctl), deterministic rules, and LLM gateway client.
- `src-tauri/`: Tauri 2 desktop host, IPC command handlers, and capability definitions.
- `src/`: React 19 frontend (`HardwarePage`, `DiagnosePage`, `ToolsPage`, `SettingsPage`).
- `docs/`: Architecture and engineering documentation:
  - [PROJECT_SPEC.md](docs/PROJECT_SPEC.md) — Product scope, feature matrix, and safety baseline
  - [BACKEND_HANDOFF.md](docs/BACKEND_HANDOFF.md) — Backend architecture and IPC contracts
  - [ADR/0001-scope.md](docs/ADR/0001-scope.md) — Architecture Decision Record (read-only boundary)
  - [ACCEPTANCE.md](docs/ACCEPTANCE.md) — Acceptance criteria and test matrix
  - [ENVIRONMENT.md](docs/ENVIRONMENT.md) — Development environment prerequisites
  - [UPSTREAM_REUSE.md](docs/UPSTREAM_REUSE.md) — Upstream open-source references and attribution

---

## Local Development & Build

### Prerequisites
- **OS**: Windows 10 / 11 (x64)
- **Node.js**: `>= 24.12.0`
- **Rust**: MSVC toolchain (`stable-x86_64-pc-windows-msvc`) + Windows 10/11 SDK + WebView2

### Common Commands

```powershell
# 1. Install frontend dependencies
npm ci --ignore-scripts

# 2. Start browser preview mode (http://127.0.0.1:1420/)
npm run dev

# 3. Run TypeScript typecheck & frontend unit tests (Vitest)
npm run check

# 4. Run Rust core unit & integration tests
npm run test:core
# Or directly via Cargo:
cargo test --manifest-path crates/sentinel-core/Cargo.toml

# 5. Build standalone Windows Release executable
npm run tauri build -- --no-bundle
```

The compiled standalone binary will be output to `target/release/sentinel-pc.exe` (~16 MB).

---

## License & Acknowledgments

- See [docs/UPSTREAM_REUSE.md](docs/UPSTREAM_REUSE.md) and [docs/reference/IMPORT_MANIFEST.json](docs/reference/IMPORT_MANIFEST.json) for upstream open-source references and attribution details.
- This repository's original source code is licensed under the [MIT License](LICENSE).
