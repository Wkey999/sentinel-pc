import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Divider } from "@astryxdesign/core/Divider";
import {
  ChatLayout,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatMessageMetadata,
} from "@astryxdesign/core/Chat";
import { Icon } from "@astryxdesign/core/Icon";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { ResizeHandle, useResizable } from "@astryxdesign/core/Resizable";
import { Selector } from "@astryxdesign/core/Selector";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Step, Stepper } from "@astryxdesign/core/Stepper";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Token } from "@astryxdesign/core/Token";
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ComputerDesktopIcon,
  DocumentArrowDownIcon,
  PlusIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";
import type {
  AppStatus,
  BackendCapabilities,
  CaseRecord,
  Explanation,
} from "../domain/contracts";
import {
  buildConsolidatedSymptom,
  CATEGORY_PRESETS,
  detectCategoryFromText,
  getFollowupQuestions,
  getPrioritizedNextSteps,
  SETUP_AUDIT_PRESET,
  type FollowupQuestion,
  type InterviewAnswer,
  type SymptomCategory,
} from "../domain/interview";
import { defaultCaseTitle, isSetupAudit } from "../domain/case-session";
import { diagnostics } from "../services/diagnostics";
import { VoiceComposer } from "../components/VoiceComposer";

interface DiagnosePageProps {
  status?: AppStatus;
  capabilities?: BackendCapabilities;
  activeCase: CaseRecord | null;
  autoStartAudit?: boolean;
  isVisible?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onNewSession?: () => void;
  onNewAudit?: () => void;
  onCaseUpdated: (record: CaseRecord) => Promise<void>;
  onResetCase: () => void;
  onExportCase: (caseId: string, format: "markdown" | "json") => Promise<void>;
}

interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  stream?: boolean;
}

const preLineTextStyle: CSSProperties = {
  whiteSpace: "pre-line",
};

const halfCardStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
};

function StreamingText({
  text,
  stream = false,
  emphasis = false,
}: {
  text: string;
  stream?: boolean;
  emphasis?: boolean;
}) {
  const [visibleLen, setVisibleLen] = useState(stream ? 0 : text.length);

  useEffect(() => {
    if (!stream) {
      setVisibleLen(text.length);
      return;
    }
    setVisibleLen((prev) => (prev > text.length ? text.length : prev));
    const timer = window.setInterval(() => {
      setVisibleLen((prev) => {
        if (prev >= text.length) {
          window.clearInterval(timer);
          return prev;
        }
        return Math.min(text.length, prev + 6);
      });
    }, 18);
    return () => window.clearInterval(timer);
  }, [text, stream]);

  const shown = stream ? text.slice(0, visibleLen) : text;
  const isTyping = stream && visibleLen < text.length;

  return (
    <Text
      size="sm"
      weight={emphasis ? "semibold" : undefined}
      style={preLineTextStyle}
    >
      {isTyping ? `${shown} ▌` : shown}
    </Text>
  );
}

interface RetestEntry {
  id: string;
  changedVariable: string;
  outcome: string;
  recordedAt: string;
}

const AUDIT_METRIC_LABELS: Record<string, string> = {
  output_adapter: "显卡输出通路",
  refresh_rate: "显示器刷新率",
  memory_speed: "内存运行频率",
  xmp_expo_profile: "内存 XMP / EXPO 配置",
  power_scheme: "电源计划",
  game_mode: "Windows 游戏模式",
  hags: "硬件加速 GPU 计划",
  system_disk_free: "系统盘剩余空间",
  pcie_link: "PCIe 链路速率",
  thermal_power_limits: "温度与功耗限制",
  collection: "本机信息采集",
};

const AUDIT_ACTION_META: Record<
  string,
  {
    tier: "small_fix" | "big_handoff";
    badgeLabel: string;
    badgeColor: "green" | "orange";
    actionLabel?: string;
    commandToCopy?: string;
    guideText: string;
  }
> = {
  power_scheme: {
    tier: "small_fix",
    badgeLabel: "小问题 · 一键直达系统设置",
    badgeColor: "green",
    actionLabel: "直达 Windows 电源设置",
    commandToCopy: "ms-settings:powersleep",
    guideText:
      "已为你打开 Windows「电源和电池」设置页，直接在「电源模式」下拉框选择「最佳性能」即可。",
  },
  refresh_rate: {
    tier: "small_fix",
    badgeLabel: "小问题 · 一键直达系统设置",
    badgeColor: "green",
    actionLabel: "直达 Windows 高刷设置",
    commandToCopy: "ms-settings:display-advanced",
    guideText:
      "已为你打开 Windows「高级显示」设置页，直接在「选择刷新率」下拉框调至最高 Hz 即可。",
  },
  game_mode: {
    tier: "small_fix",
    badgeLabel: "小问题 · 一键直达系统设置",
    badgeColor: "green",
    actionLabel: "直达 Windows 游戏模式",
    commandToCopy: "ms-settings:gaming-gamemode",
    guideText:
      "已为你打开 Windows「游戏模式」设置页，直接点击页面内的开关即可开启或关闭。",
  },
  hags: {
    tier: "small_fix",
    badgeLabel: "小问题 · 一键直达系统设置",
    badgeColor: "green",
    actionLabel: "直达 Windows 图形加速设置",
    commandToCopy: "ms-settings:display-advancedgraphics",
    guideText:
      "已为你打开 Windows「默认图形设置」页，直接点击开关即可切换硬件加速 GPU 计划。",
  },
  system_disk_free: {
    tier: "small_fix",
    badgeLabel: "小问题 · 一键直达系统设置",
    badgeColor: "green",
    actionLabel: "直达 Windows 存储清理",
    commandToCopy: "ms-settings:storagesense",
    guideText:
      "已为你打开 Windows「存储」设置页，可直接进入「临时文件」清理系统盘缓存。",
  },
  output_adapter: {
    tier: "big_handoff",
    badgeLabel: "物理接线边界 · 需手动换口",
    badgeColor: "orange",
    guideText:
      "【物理接线问题 · 软件无法代劳】如果显示器线插在主板竖口（核显），请直接拔下机箱背后的显示器线，改插到下方横置的独立显卡接口上！",
  },
  memory_speed: {
    tier: "big_handoff",
    badgeLabel: "BIOS 硬件边界 · 不背锅",
    badgeColor: "orange",
    guideText:
      "【主板 BIOS 级设置 · 免费软件不强改防不开机】内存频率偏低需重启电脑狂按 Del / F2 进入主板 BIOS 开启 XMP / EXPO。",
  },
  xmp_expo_profile: {
    tier: "big_handoff",
    badgeLabel: "BIOS 硬件边界 · 不背锅",
    badgeColor: "orange",
    guideText:
      "【主板 BIOS 级设置 · 免费软件不强改防不开机】Windows 下无法直接改写 BIOS 超频配置，请重启进主板 BIOS 开启 XMP / EXPO。",
  },
  pcie_link: {
    tier: "big_handoff",
    badgeLabel: "硬件插槽边界 · 甩锅售后",
    badgeColor: "orange",
    guideText:
      "【主板/显卡物理通道问题】若显卡未跑满 PCIe 通道，多为插在了第二根慢速槽或金手指接触不良，请重插显卡第一槽或找整机售后处理。",
  },
  thermal_power_limits: {
    tier: "big_handoff",
    badgeLabel: "散热/供电硬伤 · 甩锅售后",
    badgeColor: "orange",
    guideText:
      "【硬件散热/电源负载问题 · 软件不背锅】若出现温度撞墙或供电不足降频，属于硅脂干涸、风道积灰或电源功率不够，建议清灰换硅脂或导出报告找硬件售后！",
  },
};

const rootStyle: CSSProperties = {
  height: "100%",
  width: "100%",
};

const chatColumnStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: "100%",
};

const chatLayoutStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
};

const panelScrollStyle: CSSProperties = {
  flex: "0 0 auto",
  minWidth: 0,
  minHeight: 0,
  overflowY: "auto",
};

const fullWidthStyle: CSSProperties = {
  width: "100%",
};

const homeComposerStyle: CSSProperties = {
  width: "75%",
  marginInline: "auto",
  textAlign: "center",
};

export function DiagnosePage({
  status: _status,
  capabilities,
  activeCase,
  autoStartAudit = false,
  isVisible = true,
  onBusyChange,
  onNewSession,
  onNewAudit,
  onCaseUpdated,
  onResetCase,
  onExportCase,
}: DiagnosePageProps) {
  const [category, setCategory] = useState<SymptomCategory>(() => {
    if (activeCase && isSetupAudit(activeCase)) return "setup_audit";
    const savedCategory = (
      activeCase?.diagnostic as { category?: SymptomCategory } | null
    )?.category;
    return savedCategory ?? "gaming_display";
  });
  const environment = "personal" as const;
  const timeRangeChoice = "recent_1h";
  const [composerText, setComposerText] = useState("");
  const [initialSymptom, setInitialSymptom] = useState("");
  const [answers, setAnswers] = useState<InterviewAnswer[]>([]);
  const [interviewStarted, setInterviewStarted] = useState(false);
  const [planBuiltReady, setPlanBuiltReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const pendingCase = useRef<CaseRecord | null>(null);
  const [activeRun, setActiveRun] = useState<{
    caseId: string;
    runId: string;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [panelTab, setPanelTab] = useState<string>("summary");
  const [retestVariable, setRetestVariable] = useState("");
  const [retestOutcome, setRetestOutcome] = useState("问题不再复现（已改善）");
  const [retestHistory, setRetestHistory] = useState<RetestEntry[]>([]);
  const [aiQuestions, setAiQuestions] = useState<FollowupQuestion[] | null>(
    null,
  );
  const [aiExplanation, setAiExplanation] = useState<Explanation | null>(null);
  const [explainBusy, setExplainBusy] = useState(false);
  const [agentActionFeedback, setAgentActionFeedback] = useState("");
  const [chatFollowups, setChatFollowups] = useState<ChatTurn[]>([]);

  const workspaceRef = useRef<HTMLDivElement>(null);
  const resizable = useResizable({
    direction: "horizontal",
    containerRef: workspaceRef,
    defaultSize: "45%",
    minSize: "25%",
    maxSize: "70%",
    autoSaveId: "sentinel.case-panel-width.v1",
  });

  const questions = useMemo(
    () => aiQuestions ?? getFollowupQuestions(category),
    [aiQuestions, category],
  );
  const savedExplanation = useMemo(() => {
    const runs = (
      activeCase?.diagnostic as
        | { runs?: Array<{ explanation?: Explanation | null }> }
        | null
        | undefined
    )?.runs;
    return runs?.[runs.length - 1]?.explanation ?? null;
  }, [activeCase]);
  const displayedExplanation = aiExplanation ?? savedExplanation;
  const currentQuestionIndex = answers.length;
  const currentQuestion =
    interviewStarted && currentQuestionIndex < questions.length
      ? questions[currentQuestionIndex]
      : null;
  const interviewCompleted =
    interviewStarted && currentQuestionIndex >= questions.length;

  const currentStepIndex = useMemo(() => {
    if (retestHistory.length > 0) return 3;
    if (activeCase?.report) return 2;
    if (interviewCompleted || planBuiltReady) return 1;
    return 0;
  }, [activeCase, interviewCompleted, planBuiltReady, retestHistory.length]);

  const hardwareOverview = useMemo(() => {
    const ev = activeCase?.report?.evidence ?? [];
    if (ev.length === 0) {
      return {
        modelInfo: "",
        osInfo: "",
        rows: [] as Array<{ label: string; value: string }>,
      };
    }

    const cs = ev.find((e) => e.id.startsWith("Win32_ComputerSystem"));
    const csMfg = cs?.fields.Manufacturer?.trim() ?? "";
    const csModel = cs?.fields.Model?.trim() ?? "";
    const modelInfo = csModel
      ? csMfg &&
        !csModel.toLowerCase().startsWith(csMfg.toLowerCase().slice(0, 5))
        ? `${csMfg} ${csModel}`
        : csModel
      : csMfg;

    const os = ev.find((e) => e.id.startsWith("Win32_OperatingSystem"));
    const osCaption = os?.fields.Caption?.trim() ?? "";
    const osArch = os?.fields.OSArchitecture?.trim() ?? "";
    const osInfo = osCaption
      ? `${osCaption.replace(/^Microsoft\s+/i, "")}${osArch ? ` ${osArch}` : ""}`
      : "";

    const rows: Array<{ label: string; value: string }> = [];

    const cpus = ev
      .filter((e) => e.id.startsWith("Win32_Processor"))
      .map((e) => {
        const name = e.fields.Name?.trim();
        const cores = e.fields.NumberOfCores;
        const threads = e.fields.NumberOfLogicalProcessors;
        if (!name) return "";
        return cores && threads
          ? `${name}（${cores} 核 ${threads} 线程）`
          : name;
      })
      .filter(Boolean);
    if (cpus.length > 0) {
      rows.push({ label: "处理器", value: cpus.join(" / ") });
    }

    const boards = ev
      .filter((e) => e.id.startsWith("Win32_BaseBoard"))
      .map((e) => {
        const mfg = e.fields.Manufacturer?.trim() ?? "";
        const prod = e.fields.Product?.trim() ?? "";
        if (!mfg && !prod) return "";
        return mfg && prod ? `${mfg} ${prod}` : mfg || prod;
      })
      .filter(Boolean);
    if (boards.length > 0) {
      rows.push({ label: "主板", value: boards.join(" / ") });
    }

    const mems = ev.filter((e) => e.kind === "setup.memory");
    if (mems.length > 0) {
      let totalBytes = 0;
      const speeds = new Set<string>();
      const mfgs = new Set<string>();
      const types = new Set<string>();
      const perStick: string[] = [];
      for (const m of mems) {
        const cap = Number(m.fields.capacityBytes ?? "0");
        if (Number.isFinite(cap) && cap > 0) {
          totalBytes += cap;
          perStick.push(`${Math.round(cap / 1024 ** 3)}GB`);
        }
        const spd = m.fields.configuredClockSpeed || m.fields.reportedSpeed;
        if (spd) speeds.add(`${spd}MHz`);
        const mfg = m.fields.manufacturer?.trim();
        if (mfg && mfg !== "Unknown") mfgs.add(mfg);
        const memType = m.fields.memoryType;
        if (memType === "34") types.add("DDR5");
        else if (memType === "26") types.add("DDR4");
        else if (memType === "24") types.add("DDR3");
      }
      const totalGb =
        totalBytes > 0 ? `${Math.round(totalBytes / 1024 ** 3)}GB` : "";
      const mfgStr = Array.from(mfgs).join("/");
      const typeStr = Array.from(types).join("/");
      const spdStr = Array.from(speeds).join("/");
      const sticksStr = perStick.length > 0 ? ` (${perStick.join(" + ")})` : "";
      rows.push({
        label: "内存",
        value: `${[mfgStr, totalGb, typeStr, spdStr].filter(Boolean).join(" ")}${sticksStr}`,
      });
    }

    const gpus = ev
      .filter((e) => e.id.startsWith("Win32_VideoController"))
      .map((e) => {
        const name = e.fields.Name?.trim();
        const drv = e.fields.DriverVersion?.trim();
        const ramBytes = Number(e.fields.AdapterRAM ?? "0");
        const vram =
          Number.isFinite(ramBytes) && ramBytes >= 1024 ** 3
            ? `${Math.round(ramBytes / 1024 ** 3)}GB`
            : "";
        if (!name) return "";
        const extra = [vram, drv ? `驱动 ${drv}` : ""]
          .filter(Boolean)
          .join(" / ");
        return extra ? `${name}（${extra}）` : name;
      })
      .filter(Boolean);
    if (gpus.length > 0) {
      rows.push({ label: "显卡", value: gpus.join("\n") });
    }

    const disp = ev.find((e) => e.kind === "setup.display_path");
    if (disp) {
      const role =
        disp.fields.adapterRole === "discrete"
          ? "独立显卡直连"
          : disp.fields.adapterRole === "integrated"
            ? "主板核显输出"
            : "已连接显示输出";
      const w = disp.fields.width;
      const h = disp.fields.height;
      const hz = disp.fields.currentRefreshHz;
      rows.push({
        label: "显示器",
        value: `${role}${w && h ? ` · ${w}×${h}` : ""}${hz ? ` @ ${hz}Hz` : ""}`,
      });
    }

    const diskDrives = ev
      .filter((e) => e.id.startsWith("Win32_DiskDrive"))
      .map((e) => {
        const model = e.fields.Model?.trim();
        const sizeBytes = Number(e.fields.Size ?? "0");
        const gb =
          Number.isFinite(sizeBytes) && sizeBytes > 0
            ? `${Math.round(sizeBytes / 1000 ** 3)}GB`
            : "";
        if (!model) return "";
        return gb ? `${model} (${gb})` : model;
      })
      .filter(Boolean);
    if (diskDrives.length > 0) {
      rows.push({ label: "磁盘", value: diskDrives.join("\n") });
    } else {
      const disk = ev.find((e) => e.kind === "setup.disk_capacity");
      if (disk) {
        const total = Number(disk.fields.totalBytes ?? "0");
        const free = Number(disk.fields.freeBytes ?? "0");
        if (total > 0) {
          const totalGb = (total / 1024 ** 3).toFixed(0);
          const freeGb = (free / 1024 ** 3).toFixed(1);
          rows.push({
            label: "磁盘",
            value: `系统盘剩余 ${freeGb} GB / 总计 ${totalGb} GB`,
          });
        }
      }
    }

    const sounds = Array.from(
      new Set(
        ev
          .filter((e) => e.id.startsWith("Win32_SoundDevice"))
          .map((e) => e.fields.Name?.trim() ?? "")
          .filter(Boolean),
      ),
    );
    if (sounds.length > 0) {
      rows.push({ label: "声卡", value: sounds.join("\n") });
    }

    const nics = Array.from(
      new Set(
        ev
          .filter(
            (e) =>
              e.id.startsWith("Win32_NetworkAdapter") &&
              e.fields.PhysicalAdapter?.toLowerCase() === "true",
          )
          .map((e) => e.fields.Name?.trim() ?? "")
          .filter(Boolean),
      ),
    );
    if (nics.length > 0) {
      rows.push({ label: "网卡", value: nics.join("\n") });
    }

    return { modelInfo, osInfo, rows };
  }, [activeCase?.report?.evidence]);

  function buildDirectAnswer(questionText = ""): string {
    const q = questionText.toLowerCase();
    const parts: string[] = [];
    const findRow = (label: string) =>
      hardwareOverview.rows.find((r) => r.label === label)?.value;

    const cpuVal = findRow("处理器");
    const gpuVal = findRow("显卡");
    const memVal = findRow("内存");
    const boardVal = findRow("主板");
    const dispVal = findRow("显示器");
    const diskVal = findRow("磁盘");

    if (q.includes("cpu") || q.includes("处理器")) {
      parts.push(
        cpuVal
          ? `你的处理器（CPU）实测为：${cpuVal}。`
          : "本轮暂未读取到处理器型号，可在左侧「硬件信息」查看，或运行「一键体检」。",
      );
    } else if (
      q.includes("gpu") ||
      q.includes("显卡") ||
      q.includes("独显") ||
      q.includes("核显")
    ) {
      parts.push(
        gpuVal ? `你的显卡设备实测为：\n${gpuVal}` : "本轮暂未读取到显卡型号。",
      );
    } else if (
      q.includes("内存") ||
      q.includes("ram") ||
      q.includes("xmp") ||
      q.includes("频率")
    ) {
      parts.push(
        memVal ? `你的内存配置实测为：${memVal}。` : "本轮暂未读取到内存信息。",
      );
    } else if (q.includes("主板")) {
      parts.push(
        boardVal ? `你的主板型号为：${boardVal}。` : "本轮暂未读取到主板信息。",
      );
    } else if (
      q.includes("显示器") ||
      q.includes("刷新率") ||
      q.includes("hz") ||
      q.includes("分辨率")
    ) {
      parts.push(
        dispVal
          ? `当前显示器与输出通路：${dispVal}。`
          : "本轮暂未读取到显示器信息。",
      );
    } else if (
      q.includes("硬盘") ||
      q.includes("磁盘") ||
      q.includes("固态") ||
      q.includes("ssd")
    ) {
      parts.push(
        diskVal
          ? `你的磁盘设备实测为：\n${diskVal}`
          : "本轮暂未读取到磁盘信息。",
      );
    }

    if (displayedExplanation) {
      const originTag =
        displayedExplanation.origin === "model"
          ? "【DeepSeek 智能体解读】"
          : "【智能诊断解读】";
      parts.push(`${originTag}\n${displayedExplanation.summary}`);
      if (displayedExplanation.exclusions.length > 0) {
        parts.push(`可暂排除项：${displayedExplanation.exclusions.join("；")}`);
      }
    } else if (explainBusy) {
      parts.push(
        "DeepSeek 智能体正在结合以上实测证据流式生成深度解读，请稍候…",
      );
    } else if (parts.length === 0 && activeCase?.report) {
      const obs = activeCase.report.findings
        .slice(0, 3)
        .map((f) => `• ${f.title}：${f.observation}`);
      if (obs.length > 0) {
        parts.push(`本轮诊断关键观察：\n${obs.join("\n")}`);
      } else {
        parts.push(
          "本轮检测已完成。可在本对话继续提问；完整配置请查看「硬件信息」，设置入口在右侧。",
        );
      }
    }

    return parts.join("\n\n");
  }

  const turns = useMemo<ChatTurn[]>(() => {
    if (activeCase && !interviewStarted) {
      const base: ChatTurn[] = [
        {
          id: "loaded-case-user",
          role: "user",
          text: activeCase.symptom,
        },
        {
          id: "loaded-case-assistant",
          role: "assistant",
          text: activeCase.report
            ? buildDirectAnswer() || `已载入历史案例「${activeCase.title}」。`
            : `已载入未完成案例「${activeCase.title}」，你可以继续完成问诊或重新开始。`,
        },
      ];
      return [...base, ...chatFollowups];
    }

    const list: ChatTurn[] = [];
    if (!interviewStarted) return list;

    list.push({
      id: "turn-init-user",
      role: "user",
      text: initialSymptom,
    });

    questions.forEach((q, idx) => {
      if (idx <= answers.length) {
        list.push({
          id: `turn-q-${q.id}`,
          role: "assistant",
          text: `${q.prompt}（提示：${q.hint}）`,
        });
      }
      const ans = answers[idx];
      if (ans) {
        list.push({
          id: `turn-a-${q.id}`,
          role: "user",
          text: ans.answer,
        });
      }
    });

    if (interviewCompleted && !activeCase?.report) {
      list.push({
        id: "turn-plan-ready",
        role: "assistant",
        text:
          category === "setup_audit"
            ? "正在为你执行本机只读硬件扫描与 DeepSeek 智能体分析，请稍候…"
            : "关键上下文已收集，正在执行只读检查计划并调用智能体分析…",
        stream: true,
      });
    }

    if (activeCase?.report) {
      const isCancelled = activeCase.status === "cancelled";
      const isFailed = activeCase.status === "failed";

      const summaryLead = isCancelled
        ? "本轮检查已取消。"
        : isFailed
          ? "本轮检查未能顺利采集到数据，请重试。"
          : buildDirectAnswer() ||
            "本机检测已完成，体检结果已写入本对话，右侧保留操作指南。";

      list.push({
        id: "turn-executed",
        role: "assistant",
        text: summaryLead,
        stream: true,
      });
    }

    return [...list, ...chatFollowups];
  }, [
    activeCase,
    answers,
    category,
    chatFollowups,
    displayedExplanation,
    explainBusy,
    hardwareOverview,
    initialSymptom,
    interviewCompleted,
    interviewStarted,
    questions,
  ]);

  function startNewDiagnosis(text: string, presetCategory?: SymptomCategory) {
    if (inFlight.current) return;
    pendingCase.current = null;
    const trimmed = text.trim();
    if (!trimmed) return;
    onResetCase();
    const detected = presetCategory ?? detectCategoryFromText(trimmed);
    setCategory(detected);
    setInitialSymptom(trimmed);
    setAnswers([]);
    setAiQuestions(null);
    setAiExplanation(null);
    setInterviewStarted(true);
    setPlanBuiltReady(detected === "setup_audit");
    setErrorMsg("");
    setComposerText("");
    setChatFollowups([]);
    setRetestHistory([]);

    if (detected === "setup_audit") {
      void handleApproveAndRunPackage("setup_audit", trimmed, []);
    }
  }

  function startQuickAudit() {
    if (inFlight.current) return;
    pendingCase.current = null;
    onResetCase();
    setCategory("setup_audit");
    setInitialSymptom(SETUP_AUDIT_PRESET.examplePrompt);
    setAnswers([]);
    setAiQuestions(null);
    setAiExplanation(null);
    setInterviewStarted(true);
    setPlanBuiltReady(true);
    setErrorMsg("");
    setComposerText("");
    setChatFollowups([]);
    setRetestHistory([]);
    void handleApproveAndRunPackage(
      "setup_audit",
      SETUP_AUDIT_PRESET.examplePrompt,
      [],
    );
  }

  function submitFollowupAnswer(answerText: string) {
    if (!currentQuestion) return;
    const trimmed = answerText.trim();
    if (!trimmed) return;
    const nextAnswers: InterviewAnswer[] = [
      ...answers,
      {
        questionId: currentQuestion.id,
        question: currentQuestion.prompt,
        answer: trimmed,
      },
    ];
    setAnswers(nextAnswers);
    setComposerText("");
    if (nextAnswers.length >= questions.length) {
      setPlanBuiltReady(true);
      void handleApproveAndRunPackage(category, initialSymptom, nextAnswers);
    }
  }

  function handleComposerSubmit(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (!interviewStarted && !activeCase) {
      startNewDiagnosis(trimmed);
      return;
    }
    if (currentQuestion) {
      submitFollowupAnswer(trimmed);
      return;
    }
    if (activeCase?.report) {
      setComposerText("");
      const reply =
        buildDirectAnswer(trimmed) ||
        "已根据本轮证据整理结果，可在左侧「硬件信息」查看完整配置。";
      setChatFollowups((prev) => [
        ...prev,
        {
          id: `fu-u-${Date.now()}`,
          role: "user",
          text: trimmed,
        },
        {
          id: `fu-a-${Date.now()}`,
          role: "assistant",
          text: reply,
          stream: true,
        },
      ]);
      return;
    }
    startNewDiagnosis(trimmed);
  }

  async function handleApproveAndRunPackage(
    overrideCategory?: SymptomCategory,
    overrideSymptom?: string,
    overrideAnswers?: InterviewAnswer[],
  ) {
    if (inFlight.current || activeCase?.report) return;
    inFlight.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setErrorMsg("");
    try {
      const effectiveCategory = overrideCategory ?? category;
      const effectiveSymptom = overrideSymptom ?? initialSymptom;
      const effectiveAnswers = overrideAnswers ?? answers;
      const preset =
        effectiveCategory === "setup_audit"
          ? SETUP_AUDIT_PRESET
          : (CATEGORY_PRESETS.find((p) => p.id === effectiveCategory) ??
            CATEGORY_PRESETS[0]!);
      const now = new Date();
      const startMs =
        timeRangeChoice === "recent_1h"
          ? now.getTime() - 3600_000
          : timeRangeChoice === "today"
            ? now.getTime() - 12 * 3600_000
            : now.getTime() - 24 * 3600_000;
      const consolidated = buildConsolidatedSymptom(
        effectiveSymptom,
        effectiveAnswers,
      );
      const useSetupAudit = effectiveCategory === "setup_audit";
      const useNativeV2 = Boolean(capabilities?.realCollectionEnabled);
      const nativeCategory =
        effectiveCategory === "setup_audit"
          ? "gaming_display"
          : effectiveCategory;

      const existing = pendingCase.current ?? activeCase;
      let created =
        existing ??
        (useSetupAudit
          ? await diagnostics.createSetupAudit({
              displayTimezone: "Asia/Shanghai",
              environment,
            })
          : await diagnostics.create(
              useNativeV2
                ? {
                    category: nativeCategory,
                    symptom: consolidated,
                    incidentStartUtc: new Date(startMs).toISOString(),
                    incidentEndUtc: now.toISOString(),
                    displayTimezone: "Asia/Shanghai",
                    environment,
                    interview: {
                      frequency: timeRangeChoice,
                      recentChanges: effectiveAnswers[2]?.answer ?? "",
                      reproduction: effectiveAnswers[0]?.answer ?? "",
                      answers: effectiveAnswers.map((a) => ({
                        questionId: a.questionId,
                        answer: a.answer,
                      })),
                    },
                  }
                : {
                    scenarioId: preset.mappedScenarioId,
                    symptom: consolidated,
                    incidentStartUtc: new Date(startMs).toISOString(),
                    incidentEndUtc: now.toISOString(),
                    displayTimezone: "Asia/Shanghai",
                    environment,
                  },
            ));
      pendingCase.current = created;
      if (!existing) {
        created = await diagnostics.rename({
          caseId: created.id,
          title: defaultCaseTitle(effectiveCategory, effectiveSymptom),
        });
        pendingCase.current = created;
      }
      await onCaseUpdated(created);

      const withPlan = await diagnostics.build(created.id);
      if (!withPlan.plan) {
        throw new Error("未能生成检查计划。");
      }
      const consent = await diagnostics.approve({
        caseId: withPlan.id,
        planId: withPlan.plan.id,
        planHash: withPlan.plan.hash,
      });
      let result = await diagnostics.start({
        caseId: withPlan.id,
        planId: withPlan.plan.id,
        planHash: withPlan.plan.hash,
        consentToken: consent.token,
      });
      await onCaseUpdated(result);
      if (withPlan.plan.runId) {
        setActiveRun({ caseId: withPlan.id, runId: withPlan.plan.runId });
      }
      for (
        let i = 0;
        i < 100 &&
        (result.status === "collecting" || result.status === "cancelling");
        i += 1
      ) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        result = await diagnostics.get(result.id);
      }
      await onCaseUpdated(result);
      setPanelTab("summary");
      const latestRuns = (
        result.diagnostic as
          | { runs?: Array<{ explanation?: Explanation | null }> }
          | null
          | undefined
      )?.runs;
      const latestExp = latestRuns?.[latestRuns.length - 1]?.explanation;
      if (
        result.report &&
        result.diagnostic &&
        capabilities?.modelConfigured &&
        (!latestExp || latestExp.origin !== "model")
      ) {
        setExplainBusy(true);
        void diagnostics
          .explainReport({ caseId: result.id, allowModel: true })
          .then(async (exp) => {
            setAiExplanation(exp);
            const refreshed = await diagnostics.get(result.id);
            await onCaseUpdated(refreshed);
          })
          .catch(() => {
            // 若远程模型调用失败，保留本地规则结论
          })
          .finally(() => setExplainBusy(false));
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "执行检查计划时发生错误。");
    } finally {
      setActiveRun(null);
      inFlight.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  async function handleCancelActiveRun() {
    if (!activeRun) return;
    try {
      await diagnostics.cancelRun(activeRun);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "取消检查失败。");
    }
  }

  async function handleRecordRetest() {
    const trimmedVar = retestVariable.trim();
    if (!trimmedVar) return;
    if (activeCase?.diagnostic) {
      try {
        const updated = await diagnostics.createRetestRun({
          caseId: activeCase.id,
          changedVariable: trimmedVar,
          userFeedback: retestOutcome,
        });
        await onCaseUpdated(updated);
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : "创建复测记录失败。");
        return;
      }
    }
    setRetestHistory((prev) => [
      {
        id: `retest-${Date.now()}`,
        changedVariable: trimmedVar,
        outcome: retestOutcome,
        recordedAt: new Date().toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      },
      ...prev,
    ]);
    setRetestVariable("");
  }

  async function handleExplainWithAi() {
    if (!activeCase?.report || explainBusy) return;
    setExplainBusy(true);
    setErrorMsg("");
    try {
      const exp = await diagnostics.explainReport({
        caseId: activeCase.id,
        allowModel: Boolean(capabilities?.modelConfigured),
      });
      setAiExplanation(exp);
      const refreshed = await diagnostics.get(activeCase.id);
      await onCaseUpdated(refreshed);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "AI 报告解读失败。");
    } finally {
      setExplainBusy(false);
    }
  }

  async function handleCopyQuickFix(uri: string, guide: string) {
    setErrorMsg("");
    try {
      await diagnostics.openWindowsSettings(uri);
      setAgentActionFeedback(guide);
    } catch (e) {
      setErrorMsg(
        e instanceof Error ? e.message : "未能打开 Windows 系统设置页面。",
      );
    }
  }

  const autoExplainedCaseIdRef = useRef<string | null>(null);
  useEffect(() => {
    setAiExplanation(null);
    setAgentActionFeedback("");
    if (
      activeCase?.id &&
      activeCase.report &&
      activeCase.diagnostic &&
      capabilities?.modelConfigured &&
      (!savedExplanation || savedExplanation.origin !== "model") &&
      autoExplainedCaseIdRef.current !== activeCase.id
    ) {
      autoExplainedCaseIdRef.current = activeCase.id;
      setExplainBusy(true);
      void diagnostics
        .explainReport({ caseId: activeCase.id, allowModel: true })
        .then(async (exp) => {
          setAiExplanation(exp);
          const refreshed = await diagnostics.get(activeCase.id);
          await onCaseUpdated(refreshed);
        })
        .catch(() => {
          // 保持原有本地结论
        })
        .finally(() => setExplainBusy(false));
    }
  }, [
    activeCase?.id,
    activeCase?.report,
    activeCase?.diagnostic,
    capabilities?.modelConfigured,
    savedExplanation,
    onCaseUpdated,
  ]);

  function handleResetAll() {
    if (inFlight.current) return;
    pendingCase.current = null;
    onNewSession?.();
    setInterviewStarted(false);
    setInitialSymptom("");
    setAnswers([]);
    setAiQuestions(null);
    setAiExplanation(null);
    setPlanBuiltReady(false);
    setErrorMsg("");
    setComposerText("");
    setChatFollowups([]);
    setRetestHistory([]);
    onResetCase();
  }

  const initialAuditStarted = useRef(false);
  useEffect(() => {
    if (
      autoStartAudit &&
      capabilities &&
      !activeCase &&
      !initialAuditStarted.current
    ) {
      initialAuditStarted.current = true;
      startQuickAudit();
    }
  }, [autoStartAudit, capabilities, activeCase]);

  const showSplitWorkspace = interviewStarted || Boolean(activeCase);
  const guidedSteps = useMemo(
    () => getPrioritizedNextSteps(category),
    [category],
  );

  return !showSplitWorkspace ? (
    <Layout
      height="fill"
      contentWidth={960}
      content={
        <LayoutContent padding={6}>
          <VStack gap={3} hAlign="center">
            <Icon icon={ShieldCheckIcon} size="lg" />
            <Heading level={1}>电脑出了什么问题？</Heading>
            <Text color="secondary" justify="center">
              请在下方描述具体异常现象，或直接选择预设诊断场景。
            </Text>
          </VStack>
        </LayoutContent>
      }
      footer={
        <LayoutFooter padding={3}>
          <VStack
            gap={3}
            paddingBlockEnd={4}
            width="100%"
            style={fullWidthStyle}
          >
            <VoiceComposer
              density="compact"
              style={homeComposerStyle}
              isDisabled={busy || !isVisible}
              placeholder="描述你的电脑现象，例如显示输出异常、系统崩溃重启、磁盘告警或硬件核查"
              value={composerText}
              onChange={setComposerText}
              onSubmit={handleComposerSubmit}
            />
            <HStack gap={2} wrap="wrap" hAlign="center" width="100%">
              <StackItem size="static">
                <Token
                  size="md"
                  color="blue"
                  label="查本机配置 / 一键体检"
                  onClick={startQuickAudit}
                />
              </StackItem>
              {CATEGORY_PRESETS.map((preset) => (
                <StackItem key={preset.id} size="static">
                  <Token
                    size="md"
                    label={preset.label}
                    onClick={() =>
                      startNewDiagnosis(preset.examplePrompt, preset.id)
                    }
                  />
                </StackItem>
              ))}
            </HStack>
          </VStack>
        </LayoutFooter>
      }
    />
  ) : (
    <Layout
      height="fill"
      content={
        <LayoutContent padding={0}>
          <HStack
            ref={workspaceRef}
            height="100%"
            width="100%"
            style={rootStyle}
          >
            {/* 左栏：持续追问对话流 + 套餐授权 */}
            <VStack style={chatColumnStyle}>
              <VStack
                role="region"
                aria-label="诊断会话"
                width="100%"
                gap={3}
                padding={4}
                style={{
                  flexShrink: 0,
                  backgroundColor:
                    "color-mix(in srgb, var(--color-background-body) 92%, transparent)",
                }}
              >
                <HStack gap={2} vAlign="start" width="100%">
                  <StackItem size="static">
                    <Icon icon={ComputerDesktopIcon} size="sm" />
                  </StackItem>
                  <StackItem size="fill" style={{ minWidth: 0 }}>
                    <Heading level={4}>
                      {activeCase
                        ? activeCase.title
                        : category === "setup_audit"
                          ? SETUP_AUDIT_PRESET.label
                          : (CATEGORY_PRESETS.find((c) => c.id === category)
                              ?.label ?? "智能问诊")}
                    </Heading>
                  </StackItem>
                </HStack>
                <HStack
                  gap={3}
                  wrap="wrap"
                  hAlign="between"
                  vAlign="center"
                  width="100%"
                >
                  <HStack gap={2} vAlign="center" style={{ flexShrink: 0 }}>
                    <StatusDot
                      variant={activeCase?.report ? "success" : "accent"}
                      label="诊断进度"
                    />
                    <Text size="sm" weight="semibold">
                      {activeCase?.report
                        ? "已完成分析"
                        : interviewCompleted
                          ? "待单次授权"
                          : `追问 ${Math.min(answers.length + 1, questions.length)}/${questions.length}`}
                    </Text>
                  </HStack>
                  <HStack gap={2} wrap="wrap" vAlign="center">
                    {activeCase && !activeCase.report ? (
                      <Button
                        label="继续检查"
                        variant="secondary"
                        size="sm"
                        isDisabled={busy}
                        onClick={() =>
                          void handleApproveAndRunPackage(
                            category,
                            activeCase.symptom ||
                              SETUP_AUDIT_PRESET.examplePrompt,
                            [],
                          )
                        }
                      />
                    ) : null}
                    {activeCase && isSetupAudit(activeCase) ? (
                      <Button
                        label="重新体检"
                        variant="secondary"
                        size="sm"
                        isDisabled={busy}
                        onClick={onNewAudit}
                      />
                    ) : null}
                    <Button
                      label="新对话"
                      variant="ghost"
                      size="sm"
                      icon={<Icon icon={PlusIcon} size="sm" />}
                      isDisabled={busy}
                      onClick={handleResetAll}
                    />
                  </HStack>
                </HStack>
              </VStack>
              <Divider />

              {errorMsg ? (
                <Banner
                  status="error"
                  title="操作未能完成"
                  description={errorMsg}
                  isDismissable
                  onDismiss={() => setErrorMsg("")}
                />
              ) : null}

              <ChatLayout
                density="balanced"
                style={chatLayoutStyle}
                composer={
                  <VoiceComposer
                    placeholder={
                      currentQuestion
                        ? "在此回答当前问题，或补充说明…"
                        : "输入新问题即可随时开启新一轮问答…"
                    }
                    value={composerText}
                    onChange={setComposerText}
                    onSubmit={handleComposerSubmit}
                    isDisabled={busy || !isVisible}
                  />
                }
              >
                <ChatMessageList>
                  {turns.map((turn) => (
                    <ChatMessage
                      key={turn.id}
                      sender={turn.role === "user" ? "user" : "assistant"}
                    >
                      <ChatMessageBubble
                        width={
                          (turn.id === "turn-executed" ||
                            turn.id === "loaded-case-assistant") &&
                          activeCase?.report?.auditChecks?.length
                            ? "100%"
                            : undefined
                        }
                        variant={turn.role === "user" ? "filled" : "ghost"}
                      >
                        <VStack gap={4}>
                          <StreamingText
                            text={turn.text}
                            stream={turn.stream}
                          />
                          {(turn.id === "turn-executed" ||
                            turn.id === "loaded-case-assistant") &&
                          activeCase?.report?.auditChecks?.length ? (
                            <VStack
                              gap={2}
                              padding={4}
                              style={{
                                backgroundColor: "var(--color-background-body)",
                                borderRadius: "var(--radius-container)",
                              }}
                            >
                              <Heading level={5}>
                                基础设置与性能释放体检（
                                {activeCase.report.auditChecks.length} 项）
                              </Heading>
                              {activeCase.report.auditChecks.map((chk) => {
                                const badge =
                                  chk.assessment === "opportunity"
                                    ? {
                                        dot: "warning" as const,
                                        label: "发现优化点",
                                      }
                                    : chk.assessment === "no_issue_observed"
                                      ? {
                                          dot: "success" as const,
                                          label: "未见异常",
                                        }
                                      : chk.assessment === "not_applicable"
                                        ? {
                                            dot: "neutral" as const,
                                            label: "不适用",
                                          }
                                        : {
                                            dot: "neutral" as const,
                                            label: "无法确认",
                                          };
                                const actionMeta =
                                  AUDIT_ACTION_META[chk.metric];
                                return (
                                  <VStack
                                    key={`${activeCase.id}-${chk.checkId}-${chk.objectId ?? "global"}`}
                                    paddingBlock={3}
                                    gap={2}
                                  >
                                    <VStack gap={1.5}>
                                      <HStack
                                        hAlign="between"
                                        vAlign="center"
                                        wrap="wrap"
                                        width="100%"
                                      >
                                        <HStack
                                          gap={2}
                                          vAlign="center"
                                          wrap="wrap"
                                        >
                                          <Text weight="bold">
                                            {AUDIT_METRIC_LABELS[chk.metric] ??
                                              chk.metric}
                                          </Text>
                                          {actionMeta ? (
                                            <Token
                                              size="sm"
                                              color={actionMeta.badgeColor}
                                              label={actionMeta.badgeLabel}
                                            />
                                          ) : null}
                                        </HStack>
                                        <HStack
                                          gap={2}
                                          vAlign="center"
                                          style={{ flexShrink: 0 }}
                                        >
                                          <StatusDot
                                            variant={badge.dot}
                                            label={badge.label}
                                            style={{
                                              width: "var(--spacing-3)",
                                              height: "var(--spacing-3)",
                                            }}
                                          />
                                          <Text
                                            size="sm"
                                            weight="bold"
                                            style={{
                                              color:
                                                badge.dot === "success"
                                                  ? "var(--color-text-success)"
                                                  : badge.dot === "warning"
                                                    ? "var(--color-text-warning)"
                                                    : "var(--color-text-primary)",
                                            }}
                                          >
                                            {badge.label}
                                          </Text>
                                        </HStack>
                                      </HStack>
                                      <StreamingText
                                        text={chk.summary}
                                        stream={turn.stream}
                                        emphasis
                                      />
                                      {actionMeta ? (
                                        <HStack
                                          hAlign="between"
                                          vAlign="center"
                                          wrap="wrap"
                                          gap={2}
                                          width="100%"
                                        >
                                          <Text size="sm" weight="medium">
                                            {actionMeta.guideText}
                                          </Text>
                                          {actionMeta.commandToCopy &&
                                          actionMeta.actionLabel ? (
                                            <Button
                                              size="sm"
                                              variant="secondary"
                                              label={actionMeta.actionLabel}
                                              onClick={() =>
                                                void handleCopyQuickFix(
                                                  actionMeta.commandToCopy!,
                                                  actionMeta.guideText,
                                                )
                                              }
                                            />
                                          ) : null}
                                        </HStack>
                                      ) : null}
                                    </VStack>
                                    <Divider />
                                  </VStack>
                                );
                              })}
                            </VStack>
                          ) : null}
                        </VStack>
                      </ChatMessageBubble>
                      <ChatMessageMetadata>
                        <Text type="supporting" color="secondary">
                          {turn.role === "user"
                            ? "你的回答"
                            : "Sentinel 诊断 Agent"}
                        </Text>
                      </ChatMessageMetadata>
                    </ChatMessage>
                  ))}

                  {currentQuestion &&
                  currentQuestion.quickOptions.length > 0 ? (
                    <Card variant="default" padding={4}>
                      <VStack gap={2}>
                        <HStack hAlign="between" vAlign="center" width="100%">
                          <Text weight="semibold" size="sm">
                            请直接点选最符合你电脑情况的一项（无需打字）：
                          </Text>
                          <Token
                            size="sm"
                            color="blue"
                            label={`第 ${answers.length + 1} / ${questions.length} 步`}
                          />
                        </HStack>
                        <VStack gap={1.5} width="100%">
                          {currentQuestion.quickOptions.map((opt) => (
                            <Button
                              key={opt}
                              variant="secondary"
                              size="md"
                              label={opt}
                              onClick={() => submitFollowupAnswer(opt)}
                            />
                          ))}
                          <Button
                            variant="ghost"
                            size="sm"
                            label="不清楚 / 跳过问诊，直接扫描本机硬件与日志"
                            onClick={() => {
                              setPlanBuiltReady(true);
                              void handleApproveAndRunPackage(
                                category,
                                initialSymptom,
                                answers,
                              );
                            }}
                          />
                        </VStack>
                      </VStack>
                    </Card>
                  ) : null}

                  {interviewCompleted && !activeCase?.report ? (
                    <Card variant="default" padding={4}>
                      <VStack gap={3}>
                        <HStack hAlign="between" vAlign="center" width="100%">
                          <HStack gap={2} vAlign="center">
                            <Icon icon={ShieldCheckIcon} size="md" />
                            <Heading level={4}>
                              本轮套餐式检查计划（R0 只读）
                            </Heading>
                          </HStack>
                          <Token size="sm" color="blue" label="单次授权即可" />
                        </HStack>
                        <Divider />
                        <VStack gap={1.5}>
                          {category === "setup_audit" &&
                          capabilities?.setupAuditEnabled ? (
                            <>
                              <Text size="sm">
                                • 检查
                                1：显示器输出适配器归属（核对是否挂载在独立显卡或核显输出）
                              </Text>
                              <Text size="sm">
                                • 检查 2：当前刷新率 vs 显示器 EDID
                                上限（排查高刷是否锁在 60Hz）
                              </Text>
                              <Text size="sm">
                                • 检查 3：内存速率与插槽基础字段（无法直接测得
                                BIOS XMP/EXPO 开关状态，未知项将如实标明）
                              </Text>
                              <Text size="sm">
                                • 检查 4：Windows 电源计划（节能 / 平衡 /
                                高性能）
                              </Text>
                              <Text size="sm">
                                • 检查 5：系统盘剩余空间比例（核对是否低于 10%）
                              </Text>
                              <Text size="sm">
                                • 检查 6：PCIe
                                链路与热/功耗传感器（当前只读套餐暂不支持直接读取，将如实标为尚未支持）
                              </Text>
                            </>
                          ) : capabilities?.realCollectionEnabled ? (
                            <>
                              <Text size="sm">
                                • 动作
                                1：本机只读系统概况与已确认时间窗口事件日志采集（windows.system_snapshot
                                + windows.event_window）
                              </Text>
                              <Text size="sm">
                                • 动作 2：运行确定性诊断规则，保留原始证据 ID
                                与缺失覆盖项
                              </Text>
                            </>
                          ) : (
                            <>
                              <Text size="sm">
                                • 动作
                                1：采集时间窗口与场景匹配证据（浏览器预览映射到合成样本）
                              </Text>
                              <Text size="sm">
                                • 动作 2：运行确定性诊断规则，保留原始证据 ID
                                与缺失覆盖项
                              </Text>
                            </>
                          )}
                          <Text type="supporting" color="secondary">
                            权限边界：不修改系统设置、不安装第三方程序、不自动重启电脑。
                          </Text>
                        </VStack>
                        <HStack gap={2} hAlign="end" width="100%">
                          {busy && activeRun ? (
                            <Button
                              label="取消本轮检查"
                              variant="secondary"
                              onClick={() => void handleCancelActiveRun()}
                            />
                          ) : null}
                          <Button
                            label={
                              busy
                                ? "正在执行检查..."
                                : "同意套餐计划并开始检查"
                            }
                            variant="primary"
                            icon={<Icon icon={CheckCircleIcon} size="sm" />}
                            isDisabled={busy}
                            onClick={() => void handleApproveAndRunPackage()}
                          />
                        </HStack>
                      </VStack>
                    </Card>
                  ) : null}
                </ChatMessageList>
              </ChatLayout>
            </VStack>

            <ResizeHandle
              resizable={resizable}
              isReversed
              hasDivider
              isAlwaysVisible
              label="调整对话与证据面板宽度"
            />

            {/* 右栏：可调宽的常驻诊断与进度面板 */}
            <VStack
              width={resizable.size}
              height="100%"
              padding={4}
              gap={4}
              style={panelScrollStyle}
            >
              <HStack hAlign="between" vAlign="center" width="100%">
                <Heading level={4}>诊断进度与证据面板</Heading>
                {activeCase?.report ? (
                  <Button
                    label="脱敏导出"
                    variant="secondary"
                    size="sm"
                    icon={<Icon icon={DocumentArrowDownIcon} size="sm" />}
                    onClick={() => void onExportCase(activeCase.id, "markdown")}
                  />
                ) : null}
              </HStack>

              <Stepper
                activeStep={currentStepIndex}
                orientation="horizontal"
                density="compact"
              >
                <Step step={0} label="持续追问" />
                <Step step={1} label="套餐授权" />
                <Step step={2} label="证据指南" />
                <Step step={3} label="复测对比" />
              </Stepper>

              <TabList value={panelTab} onChange={setPanelTab} hasDivider>
                <Tab value="summary" label="结论与指南" />
                <Tab value="retest" label="复测对比" />
              </TabList>

              {!activeCase?.report ? (
                <Card variant="muted" padding={5}>
                  <VStack gap={2}>
                    <Text weight="semibold" size="sm">
                      等待完成左侧问诊与授权
                    </Text>
                    <Text size="sm" color="secondary">
                      完成左侧 3
                      个简短追问并点击“同意套餐计划”后，这里会立刻呈现：
                      观察结论、排好优先级的下一步操作指南、覆盖度明细以及可展开的原始证据。
                    </Text>
                  </VStack>
                </Card>
              ) : (
                <VStack gap={4}>
                  {panelTab === "summary" ? (
                    <VStack gap={4}>
                      <Banner
                        status="info"
                        title={`数据来源：${activeCase.report.provenance === "synthetic" ? "离线合成演示数据" : activeCase.report.provenance === "native_collected" ? "本机真实只读采集" : activeCase.report.provenance}`}
                        description="以下结论严格基于本轮已获取的证据，不凭单条事件编号直接断定硬件损坏。"
                      />

                      {hardwareOverview.modelInfo || hardwareOverview.osInfo ? (
                        <HStack gap={3} width="100%" vAlign="stretch">
                          {hardwareOverview.modelInfo ? (
                            <Card
                              variant="default"
                              padding={4}
                              style={halfCardStyle}
                            >
                              <VStack gap={1}>
                                <Text size="sm" color="secondary">
                                  型号信息
                                </Text>
                                <Text size="sm" weight="semibold">
                                  {hardwareOverview.modelInfo}
                                </Text>
                              </VStack>
                            </Card>
                          ) : null}
                          {hardwareOverview.osInfo ? (
                            <Card
                              variant="default"
                              padding={4}
                              style={halfCardStyle}
                            >
                              <VStack gap={1}>
                                <Text size="sm" color="secondary">
                                  系统信息
                                </Text>
                                <Text size="sm" weight="semibold">
                                  {hardwareOverview.osInfo}
                                </Text>
                              </VStack>
                            </Card>
                          ) : null}
                        </HStack>
                      ) : null}

                      {activeCase.diagnostic ? (
                        <Card variant="default" padding={4}>
                          <VStack gap={3}>
                            <HStack
                              hAlign="between"
                              vAlign="center"
                              width="100%"
                            >
                              <HStack gap={2} vAlign="center">
                                <Icon icon={SparklesIcon} size="md" />
                                <Heading level={5}>AI 智能体综合解读</Heading>
                              </HStack>
                              <HStack gap={2} vAlign="center">
                                {displayedExplanation ? (
                                  <Token
                                    size="sm"
                                    color={
                                      displayedExplanation.origin === "model"
                                        ? "green"
                                        : "blue"
                                    }
                                    label={
                                      displayedExplanation.origin === "model"
                                        ? "DeepSeek 智能体已介入"
                                        : "本地规则模板"
                                    }
                                  />
                                ) : null}
                                <Button
                                  label={
                                    explainBusy
                                      ? "AI 解读中…"
                                      : displayedExplanation
                                        ? "重新生成解读"
                                        : capabilities?.modelConfigured
                                          ? "让 AI 深度解读"
                                          : "生成规则解读"
                                  }
                                  size="sm"
                                  variant="secondary"
                                  isDisabled={explainBusy}
                                  onClick={() => void handleExplainWithAi()}
                                />
                              </HStack>
                            </HStack>
                            {displayedExplanation ? (
                              <VStack gap={2}>
                                <Text size="sm">
                                  {displayedExplanation.summary}
                                </Text>
                                {displayedExplanation.fallbackReason ? (
                                  <Text type="supporting" color="secondary">
                                    回退原因：
                                    {displayedExplanation.fallbackReason}
                                  </Text>
                                ) : null}
                                {displayedExplanation.exclusions.length > 0 ? (
                                  <VStack gap={1}>
                                    <Text
                                      type="supporting"
                                      weight="semibold"
                                      color="secondary"
                                    >
                                      可暂排除项（防盲目换件）：
                                    </Text>
                                    {displayedExplanation.exclusions.map(
                                      (ex, idx) => (
                                        <Text key={idx} size="sm">
                                          • {ex}
                                        </Text>
                                      ),
                                    )}
                                  </VStack>
                                ) : null}
                              </VStack>
                            ) : (
                              <Text size="sm" color="secondary">
                                {capabilities?.modelConfigured
                                  ? "点击右上角按钮，让配置好的大模型结合本轮证据用通俗人话总结问题与操作顺序。"
                                  : "当前未配置远程模型 Key，可在「设置与关于」填入 DeepSeek API Key 开启 AI 深度解读。"}
                              </Text>
                            )}
                          </VStack>
                        </Card>
                      ) : null}

                      <Card variant="default" padding={4}>
                        <VStack gap={3}>
                          <HStack hAlign="between" vAlign="center" width="100%">
                            <Heading level={5}>
                              Agent 行动台：小问题一键改良 · 大问题果断甩锅
                            </Heading>
                            <Token
                              size="sm"
                              color="blue"
                              label="安全无损分流"
                            />
                          </HStack>
                          <Text size="sm" color="secondary">
                            软件设置小毛病直接点下方按钮，一键直达对应 Windows
                            设置界面自己开关或调整（无需复制粘贴）；遇到插错主板口、进
                            BIOS 开 XMP
                            或硬件损坏等大问题，免费工具绝不强改底层，直接一键导出报告找售后保修！
                          </Text>
                          {agentActionFeedback ? (
                            <Banner
                              status="success"
                              title={agentActionFeedback}
                              isDismissable
                              onDismiss={() => setAgentActionFeedback("")}
                            />
                          ) : null}
                          <HStack gap={2} wrap="wrap">
                            <Button
                              size="sm"
                              variant="secondary"
                              label="直达：高性能电源设置"
                              onClick={() =>
                                void handleCopyQuickFix(
                                  AUDIT_ACTION_META.power_scheme!
                                    .commandToCopy!,
                                  AUDIT_ACTION_META.power_scheme!.guideText,
                                )
                              }
                            />
                            <Button
                              size="sm"
                              variant="secondary"
                              label="直达：屏幕分辨率调节"
                              onClick={() =>
                                void handleCopyQuickFix(
                                  "ms-settings:display",
                                  "已为你打开 Windows「显示」设置页，可直接调整显示器分辨率与缩放比例。",
                                )
                              }
                            />
                            <Button
                              size="sm"
                              variant="secondary"
                              label="直达：显示器高刷设置"
                              onClick={() =>
                                void handleCopyQuickFix(
                                  AUDIT_ACTION_META.refresh_rate!
                                    .commandToCopy!,
                                  AUDIT_ACTION_META.refresh_rate!.guideText,
                                )
                              }
                            />
                            <Button
                              size="sm"
                              variant="secondary"
                              label="直达：游戏模式开关"
                              onClick={() =>
                                void handleCopyQuickFix(
                                  AUDIT_ACTION_META.game_mode!.commandToCopy!,
                                  AUDIT_ACTION_META.game_mode!.guideText,
                                )
                              }
                            />
                            <Button
                              size="sm"
                              variant="secondary"
                              label="直达：清理系统盘空间"
                              onClick={() =>
                                void handleCopyQuickFix(
                                  AUDIT_ACTION_META.system_disk_free!
                                    .commandToCopy!,
                                  AUDIT_ACTION_META.system_disk_free!.guideText,
                                )
                              }
                            />
                            <Button
                              size="sm"
                              variant="primary"
                              label="大问题甩锅：导出报告找售后"
                              icon={
                                <Icon icon={DocumentArrowDownIcon} size="sm" />
                              }
                              onClick={() =>
                                void onExportCase(activeCase.id, "markdown")
                              }
                            />
                          </HStack>
                        </VStack>
                      </Card>

                      <VStack gap={2}>
                        <Heading level={5}>
                          已观察到的事实（{activeCase.report.findings.length}）
                        </Heading>
                        {activeCase.report.findings.map((f) => (
                          <Card key={f.id} variant="default" padding={3}>
                            <VStack gap={1.5}>
                              <HStack
                                hAlign="between"
                                vAlign="center"
                                width="100%"
                              >
                                <Text weight="semibold" size="sm">
                                  {f.title}
                                </Text>
                                <Token size="sm" label={f.strength} />
                              </HStack>
                              <Text size="sm">{f.observation}</Text>
                              {f.limitations.length > 0 ? (
                                <Text type="supporting" color="secondary">
                                  边界限制：{f.limitations.join("；")}
                                </Text>
                              ) : null}
                              <Text type="supporting" weight="medium">
                                规则建议：{f.nextStep}
                              </Text>
                            </VStack>
                          </Card>
                        ))}
                      </VStack>

                      <VStack gap={2}>
                        <Heading level={5}>
                          下一步低成本排查指南（按优先级排序）
                        </Heading>
                        {guidedSteps.map((step) => (
                          <Card key={step.priority} variant="muted" padding={4}>
                            <HStack gap={3} vAlign="start">
                              <Heading level={3}>{step.priority}</Heading>
                              <VStack gap={1}>
                                <Text weight="semibold">{step.title}</Text>
                                <Text type="supporting" color="secondary">
                                  目的：{step.purpose}
                                </Text>
                                <Text size="sm">操作：{step.action}</Text>
                                <Text type="supporting" color="secondary">
                                  预期反馈：{step.expected}
                                </Text>
                              </VStack>
                            </HStack>
                          </Card>
                        ))}
                      </VStack>
                    </VStack>
                  ) : null}

                  {panelTab === "retest" ? (
                    <VStack gap={4}>
                      <Banner
                        status="info"
                        title="单变量复测对比记录"
                        description="建议每次只调整一个变量（如换一条 DP 线或拔掉扩展坞），记录结果后再判断是否需要进一步排查。"
                      />
                      <Card variant="default" padding={4}>
                        <VStack gap={3}>
                          <TextInput
                            label="本次修改了什么条件？"
                            placeholder="例如：更换了一条已知正常的 DP 1.4 线材"
                            value={retestVariable}
                            onChange={setRetestVariable}
                          />
                          <Selector
                            label="复测观察结果"
                            value={retestOutcome}
                            onChange={setRetestOutcome}
                            options={[
                              {
                                value: "问题不再复现（已改善）",
                                label: "问题不再复现（已改善）",
                              },
                              {
                                value: "依然出现相同故障",
                                label: "依然出现相同故障",
                              },
                              {
                                value: "出现新现象（需补充检查）",
                                label: "出现新现象（需补充检查）",
                              },
                            ]}
                          />
                          <HStack gap={2} hAlign="end" width="100%">
                            <Button
                              label="记录本次复测变量"
                              variant="primary"
                              size="sm"
                              icon={<Icon icon={ArrowPathIcon} size="sm" />}
                              isDisabled={!retestVariable.trim()}
                              onClick={handleRecordRetest}
                            />
                          </HStack>
                        </VStack>
                      </Card>

                      {retestHistory.length > 0 ? (
                        <VStack gap={2}>
                          <Heading level={5}>
                            已记录的复测轮次（{retestHistory.length}）
                          </Heading>
                          {retestHistory.map((item) => (
                            <Card key={item.id} variant="muted" padding={3}>
                              <VStack gap={1}>
                                <HStack
                                  hAlign="between"
                                  vAlign="center"
                                  width="100%"
                                >
                                  <Text weight="semibold" size="sm">
                                    变更：{item.changedVariable}
                                  </Text>
                                  <Text type="supporting" color="secondary">
                                    {item.recordedAt}
                                  </Text>
                                </HStack>
                                <Text size="sm">结果：{item.outcome}</Text>
                              </VStack>
                            </Card>
                          ))}
                        </VStack>
                      ) : null}
                    </VStack>
                  ) : null}
                </VStack>
              )}
            </VStack>
          </HStack>
        </LayoutContent>
      }
    />
  );
}
