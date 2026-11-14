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
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
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
  AuditCheckResult,
  BackendCapabilities,
  CaseRecord,
  Explanation,
  HardwareInfo,
} from "../domain/contracts";
import {
  buildConsolidatedSymptom,
  CATEGORY_PRESETS,
  detectCategoryFromText,
  getFollowupQuestions,
  SETUP_AUDIT_PRESET,
  type FollowupQuestion,
  type InterviewAnswer,
  type SymptomCategory,
} from "../domain/interview";
import { defaultCaseTitle, isSetupAudit } from "../domain/case-session";
import { diagnostics, modelReminder } from "../services/diagnostics";
import { VoiceComposer } from "../components/VoiceComposer";

interface DiagnosePageProps {
  status?: AppStatus;
  capabilities?: BackendCapabilities;
  activeCase: CaseRecord | null;
  autoStartAudit?: boolean;
  isVisible?: boolean;
  conversationId: string;
  onChatsChanged: () => Promise<void>;
  onOpenTools: () => void;
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
  origin?: string;
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
  const prevTextRef = useRef(text);
  const [visibleLen, setVisibleLen] = useState(stream ? 0 : text.length);

  useEffect(() => {
    const prev = prevTextRef.current;
    prevTextRef.current = text;
    if (!stream) {
      setVisibleLen(text.length);
      return;
    }
    const isPrefixExtension = prev.length > 0 && text.startsWith(prev);
    if (!isPrefixExtension) {
      setVisibleLen(0);
    } else {
      setVisibleLen((v) => (v > text.length ? text.length : v));
    }
    const timer = window.setInterval(() => {
      setVisibleLen((prevLen) => {
        if (prevLen >= text.length) {
          window.clearInterval(timer);
          return prevLen;
        }
        return Math.min(text.length, prevLen + 6);
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
  memory_channels: "内存通道数",
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
      "点击按钮打开电源设置，核对当前计划和使用场景；平衡计划并不等于异常。",
  },
  refresh_rate: {
    tier: "small_fix",
    badgeLabel: "小问题 · 一键直达系统设置",
    badgeColor: "green",
    actionLabel: "直达 Windows 高刷设置",
    commandToCopy: "ms-settings:display-advanced",
    guideText:
      "点击按钮打开高级显示，核对对应屏幕和当前连接可选的刷新率；不保证能使用面板最高档位。",
  },
  game_mode: {
    tier: "small_fix",
    badgeLabel: "小问题 · 一键直达系统设置",
    badgeColor: "green",
    actionLabel: "直达 Windows 游戏模式",
    commandToCopy: "ms-settings:gaming-gamemode",
    guideText:
      "点击按钮打开游戏模式设置，核对配置与支持状态；开关不保证带来性能收益。",
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
    badgeLabel: "显示输出 · 需核对接线",
    badgeColor: "orange",
    guideText:
      "若为台式机，可核对显示器是否连接独显接口；笔记本混合显卡、扩展坞和内置屏不能据此判断插错。",
  },
  memory_speed: {
    tier: "big_handoff",
    badgeLabel: "内存设置 · 手动核对",
    badgeColor: "orange",
    guideText:
      "先对照 CPU、主板与内存支持规格核对当前速率；速率差异不证明未开启 XMP/EXPO，不直接要求超频。",
  },
  xmp_expo_profile: {
    tier: "big_handoff",
    badgeLabel: "内存设置 · 手动核对",
    badgeColor: "orange",
    guideText:
      "在 BIOS 中手动核对档位与平台支持；无法读取开关状态时不建议直接开启超频。",
  },
  pcie_link: {
    tier: "big_handoff",
    badgeLabel: "链路状态 · 补充验证",
    badgeColor: "orange",
    guideText:
      "先核对当时负载、设备能力与插槽规格；空闲低速不证明插错或接触不良。",
  },
  thermal_power_limits: {
    tier: "big_handoff",
    badgeLabel: "传感器记录 · 核对限制标志",
    badgeColor: "orange",
    guideText:
      "日志中的限制标志只是一条线索。核对采样时段、负载和温度，不直接断言硅脂干涸、散热器故障或电源功率不足。",
  },
};

function formatFriendlyCheckSummary(chk: AuditCheckResult): string {
  switch (chk.metric) {
    case "output_adapter": {
      if (chk.assessment === "no_issue_observed") {
        return "显示器已直连独立显卡输出，画面通路正常。";
      }
      if (chk.assessment === "opportunity") {
        return "检测到独立显卡，但当前屏幕接在主板核显口；如果是台式机，建议把显示器线改插到下方独显接口。";
      }
      return "当前为笔记本内置屏幕或混合输出模式，连接正常。";
    }
    case "refresh_rate": {
      const hzMatch = chk.summary.match(/当前约\s*([\d.]+)\s*Hz/i);
      const hz = hzMatch
        ? Number(hzMatch[1]).toFixed(2).replace(/\.00$/, "")
        : "";
      if (chk.assessment === "no_issue_observed") {
        return hz
          ? `当前屏幕已运行在 ${hz}Hz 高刷新率模式，画面流畅。`
          : "当前屏幕已运行在高刷新率模式，画面流畅。";
      }
      if (chk.assessment === "opportunity") {
        return hz
          ? `当前屏幕刷新率（${hz}Hz）未开到最高档位，可点击下方按钮在系统设置中调高。`
          : "当前屏幕刷新率未开启到更高档位，可点击下方按钮在系统设置中调高。";
      }
      return hz
        ? `当前屏幕刷新率约 ${hz}Hz，可在系统显示设置中查看可选档位。`
        : "可在 Windows「高级显示」设置中查看当前屏幕刷新率。";
    }
    case "memory_speed": {
      const spdMatch = chk.summary.match(/配置(?:速率)?字段(?:为)?\s*(\d+)/);
      const speed = spdMatch ? spdMatch[1] : "";
      if (chk.assessment === "no_issue_observed") {
        return speed
          ? `当前内存运行在 ${speed} MT/s 高频档位，工作正常。`
          : "当前内存运行在标称高频档位，工作正常。";
      }
      if (chk.assessment === "opportunity") {
        return speed
          ? `当前内存运行在 ${speed} MT/s，低于内存条标称速率；可在主板 BIOS 中开启 XMP / EXPO 提升性能。`
          : "当前内存运行频率偏低，可在主板 BIOS 中开启 XMP / EXPO 提升性能。";
      }
      return speed
        ? `当前内存运行在默认稳定频率（${speed} MT/s）。`
        : "当前内存运行在默认稳定频率。";
    }
    case "memory_channels": {
      const countMatch = chk.summary.match(/读到\s*(\d+)\s*条/);
      return countMatch
        ? `已识别到 ${countMatch[1]} 根内存条，容量与插槽工作正常。`
        : "已识别本机内存条信息，工作正常。";
    }
    case "xmp_expo_profile":
      return "内存超频（XMP / EXPO）属于主板 BIOS 级设置，Windows 下仅作只读核对，日常使用无需改动。";
    case "power_scheme": {
      if (chk.summary.includes("高性能")) {
        return "当前正在使用「高性能」电源模式。";
      }
      if (chk.summary.includes("平衡")) {
        return "当前正在使用「平衡」电源模式，日常办公与游戏均可正常发挥性能。";
      }
      if (chk.summary.includes("节能") || chk.assessment === "opportunity") {
        return "当前处于「节能」模式，玩大型游戏时可能会限制性能，建议切换为平衡或高性能。";
      }
      return "当前正在使用电脑厂商自带的自定义电源模式，运行正常；如需切换可点击右侧电源设置。";
    }
    case "game_mode": {
      if (/\benabled\b|已开启/i.test(chk.summary)) {
        return "Windows 游戏模式已开启。";
      }
      if (/\bdisabled\b|已关闭/i.test(chk.summary)) {
        return "Windows 游戏模式当前为关闭状态，可按需开启。";
      }
      return "当前使用系统默认游戏模式设置，无需额外调整。";
    }
    case "hags": {
      if (/\benabled\b|已开启/i.test(chk.summary)) {
        return "硬件加速 GPU 调度已开启。";
      }
      if (/\bdisabled\b|已关闭/i.test(chk.summary)) {
        return "硬件加速 GPU 调度当前为关闭状态。";
      }
      return "当前使用系统默认图形加速设置，无需额外调整。";
    }
    case "system_disk_free": {
      const diskMatch = chk.summary.match(
        /可用\s*(\d+)\s*\/\s*(\d+)\s*字节[^\d]*([\d.]+)%/,
      );
      const freeGb = diskMatch
        ? (Number(diskMatch[1]) / 1024 ** 3).toFixed(0)
        : "";
      const totalGb = diskMatch
        ? (Number(diskMatch[2]) / 1024 ** 3).toFixed(0)
        : "";
      const pct = diskMatch ? Number(diskMatch[3]).toFixed(0) : "";
      if (chk.assessment === "opportunity") {
        return diskMatch
          ? `系统盘仅剩约 ${freeGb} GB（可用 ${pct}%），建议点击下方按钮清理系统盘临时文件。`
          : "系统盘剩余空间不足 10%，建议点击下方按钮清理系统盘临时文件。";
      }
      if (chk.assessment === "no_issue_observed") {
        return diskMatch
          ? `系统盘剩余约 ${freeGb} GB / 共 ${totalGb} GB（可用 ${pct}%），空间充足。`
          : "系统盘剩余空间充足。";
      }
      return "未能读取系统盘剩余空间，可在 Windows「存储」设置中查看。";
    }
    case "pcie_link":
      return "显卡与固态硬盘连接正常（日常待机无需满载测试）。";
    case "thermal_power_limits":
      return "当前无异常过热告警；如遇玩游戏自动关机或严重掉帧，可从「工具与来源」导入温度记录分析。";
    default:
      return chk.summary.replace(/GUID=[0-9a-f-]+/gi, "").trim();
  }
}

function dedupeAuditChecks(checks: AuditCheckResult[]): AuditCheckResult[] {
  const seen = new Set<string>();
  return checks.filter((chk) => {
    const key = `${chk.metric}::${chk.assessment}::${formatFriendlyCheckSummary(chk)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

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

const centeredInputStyle: CSSProperties = {
  textAlign: "center",
};

const detailLabelStyle: CSSProperties = {
  width: "4.5rem",
};

const minWidthZeroStyle: CSSProperties = {
  minWidth: 0,
};

export function DiagnosePage({
  status: _status,
  capabilities,
  activeCase,
  autoStartAudit = false,
  isVisible = true,
  conversationId,
  onChatsChanged,
  onOpenTools: _onOpenTools,
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
  const autoExplainedCaseRef = useRef<string | null>(null);
  const [liveCapabilities, setLiveCapabilities] = useState<
    BackendCapabilities | undefined
  >(capabilities);
  const [hardwareSnapshot, setHardwareSnapshot] = useState<
    HardwareInfo | undefined
  >(() => diagnostics.cachedHardware());
  useEffect(() => {
    setLiveCapabilities(capabilities);
  }, [capabilities]);
  useEffect(() => {
    if (!isVisible) return;
    void diagnostics
      .hardware()
      .then(setHardwareSnapshot)
      .catch(() => undefined);
    void diagnostics
      .capabilities()
      .then(setLiveCapabilities)
      .catch(() => undefined);
  }, [isVisible]);
  const effectiveCapabilities = liveCapabilities ?? capabilities;
  const [agentActionFeedback, setAgentActionFeedback] = useState("");
  const [chatFollowups, setChatFollowups] = useState<ChatTurn[]>([]);
  const [answerBusy, setAnswerBusy] = useState(false);
  const answerPending = useRef(false);
  const answerGeneration = useRef(0);
  const [chatLoading, setChatLoading] = useState(true);
  const [pendingConsent, setPendingConsent] = useState<string | null>(null);
  const chatId = activeCase?.id ?? conversationId;
  const streamedChatRef = useRef<string | null>(null);
  const mapChat = (
    messages: Array<{
      role: "user" | "assistant";
      text: string;
      origin: string;
    }>,
    streamLast = false,
  ): ChatTurn[] =>
    messages.map((m, index) => ({
      ...m,
      id: `chat-${index}`,
      stream:
        streamLast && index === messages.length - 1 && m.role === "assistant",
    }));
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (
        e as CustomEvent<{ conversationId?: string; text?: string }>
      ).detail;
      if (!detail || detail.conversationId !== chatId || !detail.text) return;
      streamedChatRef.current = chatId;
      setChatFollowups((prev) =>
        prev.map((turn) =>
          turn.id.startsWith("waiting-") && turn.role === "assistant"
            ? {
                ...turn,
                text: detail.text!,
                origin: "model",
                stream: true,
              }
            : turn,
        ),
      );
    };
    window.addEventListener("sentinel-chat-stream", handler);
    return () => window.removeEventListener("sentinel-chat-stream", handler);
  }, [chatId]);
  useEffect(() => {
    let current = true;
    setChatLoading(true);
    setChatFollowups([]);
    void diagnostics
      .getChat(chatId, activeCase?.id ?? null)
      .then((c) => {
        if (current) setChatFollowups(mapChat(c.messages));
      })
      .catch((e) => {
        if (current) setErrorMsg(String(e));
      })
      .finally(() => {
        if (current) setChatLoading(false);
      });
    return () => {
      current = false;
      answerGeneration.current++;
    };
  }, [chatId, activeCase?.id]);
  useEffect(
    () => () => {
      answerGeneration.current++;
    },
    [],
  );

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
    const snap = hardwareSnapshot;

    const cs = ev.find((e) => e.id.startsWith("Win32_ComputerSystem"));
    const csMfg = cs?.fields.Manufacturer?.trim() ?? "";
    const csModel = cs?.fields.Model?.trim() ?? "";
    const reportModelInfo = csModel
      ? csMfg &&
        !csModel.toLowerCase().startsWith(csMfg.toLowerCase().slice(0, 5))
        ? `${csMfg} ${csModel}`
        : csModel
      : csMfg;
    const modelInfo = reportModelInfo || snap?.computerModel || "";

    const os = ev.find((e) => e.id.startsWith("Win32_OperatingSystem"));
    const osCaption = os?.fields.Caption?.trim() ?? "";
    const osArch = os?.fields.OSArchitecture?.trim() ?? "";
    const reportOsInfo = osCaption
      ? `${osCaption.replace(/^Microsoft\s+/i, "")}${osArch ? ` ${osArch}` : ""}`
      : "";
    const osInfo = reportOsInfo || snap?.operatingSystem || "";

    const snapText = (id: HardwareInfo["groups"][number]["id"]) => {
      const group = snap?.groups.find((g) => g.id === id);
      if (!group || group.items.length === 0) return "";
      return group.items
        .map((item) => {
          const detail = item.details.filter(Boolean).slice(0, 2).join(" / ");
          return detail ? `${item.name}（${detail}）` : item.name;
        })
        .join("\n");
    };

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
    const cpuValue = cpus.length > 0 ? cpus.join(" / ") : snapText("cpu");
    if (cpuValue) {
      rows.push({ label: "处理器", value: cpuValue });
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
    const boardValue =
      boards.length > 0 ? boards.join(" / ") : snapText("baseboard");
    if (boardValue) {
      rows.push({ label: "主板", value: boardValue });
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
    } else {
      const memSnap = snapText("memory");
      if (memSnap) rows.push({ label: "内存", value: memSnap });
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
    const gpuValue = gpus.length > 0 ? gpus.join("\n") : snapText("graphics");
    if (gpuValue) {
      rows.push({ label: "显卡", value: gpuValue });
    }

    const disp = ev.find((e) => e.kind === "setup.display_path");
    const monSnap = snapText("monitors");
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
    } else if (monSnap) {
      rows.push({ label: "显示器", value: monSnap });
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
    const storageSnap = snapText("storage");
    if (diskDrives.length > 0) {
      rows.push({ label: "磁盘", value: diskDrives.join("\n") });
    } else if (storageSnap) {
      rows.push({ label: "磁盘", value: storageSnap });
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
    const soundValue = sounds.length > 0 ? sounds.join("\n") : snapText("audio");
    if (soundValue) {
      rows.push({ label: "声卡", value: soundValue });
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
    const nicValue = nics.length > 0 ? nics.join("\n") : snapText("network");
    if (nicValue) {
      rows.push({ label: "网卡", value: nicValue });
    }

    return { modelInfo, osInfo, rows };
  }, [activeCase?.report?.evidence, hardwareSnapshot]);

  const dedupedAuditChecks = useMemo(
    () => dedupeAuditChecks(activeCase?.report?.auditChecks ?? []),
    [activeCase?.report?.auditChecks],
  );

  function buildDirectAnswer(): string {
    if (displayedExplanation?.origin === "model") {
      return displayedExplanation.summary;
    }

    if (dedupedAuditChecks.length > 0) {
      const opportunities = dedupedAuditChecks.filter(
        (c) => c.assessment === "opportunity",
      );
      if (opportunities.length > 0) {
        const names = opportunities
          .map((c) => AUDIT_METRIC_LABELS[c.metric] ?? c.metric)
          .join("、");
        return `本机体检已完成：发现 ${opportunities.length} 项可优化设置（${names}），已在下方列出，可直接点击对应按钮打开 Windows 设置调整。`;
      }
      return "本机体检已完成：显卡输出、高刷新率、内存频率与系统盘空间等核心项目均状态正常，未发现明显异常。下方为各项体检详情，右侧提供常用系统设置快捷入口。";
    }

    if (activeCase?.report?.findings.length) {
      return activeCase.report.findings
        .slice(0, 3)
        .map((f) => `• ${f.title}：${f.observation}`)
        .join("\n");
    }

    if (explainBusy) {
      return "正在结合本轮检测结果生成诊断结论，请稍候…";
    }

    if (activeCase?.report) {
      return "本轮检测已完成，可在右侧查看本机配置概览与常用设置入口，也可继续向我提问。";
    }

    return "";
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
    if (!interviewStarted) return chatFollowups;

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
            ? "正在执行本机只读体检，请稍候…"
            : "关键上下文已收集，正在执行只读检查计划…",
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
    dedupedAuditChecks,
    displayedExplanation,
    explainBusy,
    initialSymptom,
    interviewCompleted,
    interviewStarted,
    questions,
  ]);

  function startNewDiagnosis(text: string, presetCategory?: SymptomCategory) {
    if (inFlight.current || answerPending.current) return;
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
    if (inFlight.current || answerPending.current) return;
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

  async function handleComposerSubmit(value: string) {
    const trimmed = value.trim();
    if (!trimmed || answerPending.current || chatLoading || inFlight.current)
      return;
    if (Array.from(trimmed).length > 4000) {
      setErrorMsg("消息最多 4000 字。");
      return;
    }
    if (currentQuestion) {
      submitFollowupAnswer(trimmed);
      return;
    }
    if (effectiveCapabilities?.modelConfigured && modelReminder.needsReminder()) {
      setPendingConsent(trimmed);
      setComposerText("");
      return;
    }
    await sendChatMessage(trimmed);
  }

  async function sendChatMessage(message: string) {
    if (answerPending.current) return;
    answerPending.current = true;
    setAnswerBusy(true);
    onBusyChange?.(true);
    setComposerText("");
    setErrorMsg("");
    const generation = ++answerGeneration.current;
    streamedChatRef.current = null;
    const waitingId = `waiting-${generation}`;
    setChatFollowups((previous) => [
      ...previous,
      { id: waitingId + "-user", role: "user", text: message },
      {
        id: waitingId,
        role: "assistant",
        text: "正在准备本机上下文并等待 AI 回复…",
        stream: true,
      },
    ]);
    try {
      const hardware =
        diagnostics.cachedHardware() ??
        (await diagnostics.hardware().catch(() => undefined));
      if (effectiveCapabilities?.modelConfigured) modelReminder.recordSend();
      const result = await diagnostics.sendChat({
        conversationId: chatId,
        caseId: activeCase?.id ?? null,
        message,
        hardware: hardware?.origin === "windows_native" ? hardware : null,
        allowModel: true,
      });
      if (generation === answerGeneration.current)
        setChatFollowups(
          mapChat(result.messages, streamedChatRef.current !== chatId),
        );
      await onChatsChanged();
    } catch (error) {
      if (generation === answerGeneration.current) {
        setChatFollowups((previous) =>
          previous.filter(
            (t) => t.id !== waitingId && t.id !== waitingId + "-user",
          ),
        );
        setComposerText(message);
        setErrorMsg(String(error));
      }
    } finally {
      if (generation === answerGeneration.current) {
        answerPending.current = false;
        setAnswerBusy(false);
      }
      onBusyChange?.(false);
    }
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
      const useNativeV2 = Boolean(effectiveCapabilities?.realCollectionEnabled);
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

  async function handleExplainWithAi(
    targetCase: CaseRecord | null = activeCase,
  ) {
    if (!targetCase || explainBusy) return;
    setExplainBusy(true);
    setErrorMsg("");
    try {
      const exp = await diagnostics.explainReport({
        caseId: targetCase.id,
        allowModel: true,
      });
      setAiExplanation(exp);
      const refreshed = await diagnostics.get(targetCase.id);
      await onCaseUpdated(refreshed);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "生成诊断解读失败，请重试。",
      );
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

  useEffect(() => {
    setAiExplanation(null);
    setAgentActionFeedback("");
  }, [activeCase?.id]);

  useEffect(() => {
    if (
      activeCase?.id &&
      activeCase.report &&
      activeCase.diagnostic &&
      activeCase.status !== "cancelled" &&
      activeCase.status !== "failed" &&
      !savedExplanation &&
      !aiExplanation &&
      !explainBusy &&
      autoExplainedCaseRef.current !== activeCase.id
    ) {
      autoExplainedCaseRef.current = activeCase.id;
      void handleExplainWithAi(activeCase);
    }
  }, [activeCase, savedExplanation, aiExplanation, explainBusy]);

  function handleResetAll() {
    if (inFlight.current || answerPending.current) return;
    answerGeneration.current++;
    answerPending.current = false;
    setAnswerBusy(false);
    pendingCase.current = null;
    autoExplainedCaseRef.current = null;
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
      effectiveCapabilities &&
      !activeCase &&
      !initialAuditStarted.current
    ) {
      initialAuditStarted.current = true;
      startQuickAudit();
    }
  }, [autoStartAudit, effectiveCapabilities, activeCase]);

  const showSplitWorkspace =
    interviewStarted || Boolean(activeCase) || chatFollowups.length > 0;
  const guidedSteps = useMemo(
    () =>
      activeCase?.report?.findings.length
        ? activeCase.report.findings.slice(0, 8).map((f, index) => ({
            priority: index + 1,
            title: f.title,
            purpose: f.observation,
            action: f.nextStep,
            expected:
              "记录是否复现、时间和新提示；一次只改变一个变量，不预先保证性能收益。",
          }))
        : [
            {
              priority: 1,
              title: "先补充缺少的证据",
              purpose: "没有发现不等于已排除全部问题。",
              action:
                "查看左侧待补证项目，按实际问题选择对应工具或记录复现时间；不要为了凑证据直接修改 BIOS 或进行烤机。",
              expected: "得到可追溯、可比较的记录，再决定下一步。",
            },
          ],
    [activeCase?.report],
  );

  const consentDialog = (
    <Dialog
      isOpen={pendingConsent !== null}
      onOpenChange={(open) => {
        if (!open) {
          if (pendingConsent) setComposerText(pendingConsent);
          setPendingConsent(null);
        }
      }}
      purpose="form"
    >
      <DialogHeader
        title="AI 使用提醒"
        subtitle="已累计发送 10 次 AI 提问。继续使用会联网，并由所配置的服务计费；之后每 10 次再提醒一次。"
      />
      <VStack gap={3}>
        <Text weight="semibold">
          {effectiveCapabilities?.modelName} ·{" "}
          {effectiveCapabilities?.modelTarget}
        </Text>
        <Text>
          发送范围：你主动输入的消息、最近最多 6
          轮成功对话、脱敏后的硬件缓存、最近一次本机体检事实，以及当前案例的问题描述及体检摘要。不会上传原始附件。对话原文保存在本机。
        </Text>
        <Text style={preLineTextStyle}>{pendingConsent}</Text>
        <HStack gap={2} hAlign="end">
          <Button
            label="暂不发送"
            variant="secondary"
            onClick={() => {
              if (pendingConsent) setComposerText(pendingConsent);
              setPendingConsent(null);
            }}
          />
          <Button
            label="继续发送"
            variant="primary"
            onClick={() => {
              const message = pendingConsent;
              modelReminder.acknowledge();
              setPendingConsent(null);
              if (message) void sendChatMessage(message);
            }}
          />
        </HStack>
      </VStack>
    </Dialog>
  );
  return !showSplitWorkspace ? (
    <Layout
      height="fill"
      contentWidth={960}
      content={
        <LayoutContent padding={6}>
          {consentDialog}
          <VStack gap={3} hAlign="center">
            <Icon icon={ShieldCheckIcon} size="lg" />
            <Heading level={1}>智能硬件与系统诊断</Heading>
            <Text color="secondary" justify="center">
              输入电脑故障现象、查询本机硬件配置，或选择下方高频诊断场景
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
              inputStyle={centeredInputStyle}
              isDisabled={busy || answerBusy || chatLoading || !isVisible}
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
              {consentDialog}
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
                        : !interviewStarted && chatFollowups.length > 0
                          ? "AI 问答"
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
                        : !interviewStarted && chatFollowups.length > 0
                          ? "自由对话"
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
                        : "继续提问，可结合本机配置和当前体检结果…"
                    }
                    value={composerText}
                    onChange={setComposerText}
                    onSubmit={handleComposerSubmit}
                    isDisabled={busy || answerBusy || chatLoading || !isVisible}
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
                        variant={
                          turn.role === "user" ||
                          turn.id.startsWith("hardware-answer-")
                            ? "filled"
                            : "ghost"
                        }
                        style={
                          turn.id.startsWith("hardware-answer-")
                            ? {
                                backgroundColor: "var(--color-background-body)",
                              }
                            : undefined
                        }
                      >
                        <VStack gap={3}>
                          {turn.origin && turn.role === "assistant" ? (
                            <Text
                              size="sm"
                              weight="semibold"
                              color={
                                turn.origin === "model"
                                  ? "primary"
                                  : "secondary"
                              }
                            >
                              {turn.origin === "model"
                                ? `AI · ${effectiveCapabilities?.modelName ?? "已配置模型"}`
                                : turn.origin === "browser_preview"
                                  ? "浏览器预览 · 未调用 AI"
                                  : "AI 未能回答"}
                            </Text>
                          ) : null}
                          <StreamingText
                            text={turn.text}
                            stream={turn.stream}
                          />
                          {(turn.id === "turn-executed" ||
                            turn.id === "loaded-case-assistant") &&
                          activeCase &&
                          dedupedAuditChecks.length > 0 ? (
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
                                {dedupedAuditChecks.length} 项）
                              </Heading>
                              {dedupedAuditChecks.map((chk) => {
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
                                            label: "系统默认",
                                          };
                                const actionMeta =
                                  chk.assessment === "opportunity"
                                    ? AUDIT_ACTION_META[chk.metric]
                                    : undefined;
                                return (
                                  <VStack
                                    key={`${activeCase.id}-${chk.checkId}-${chk.metric}-${chk.objectId ?? "global"}`}
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
                                          paddingInline={2}
                                          paddingBlock={1}
                                          style={{
                                            flexShrink: 0,
                                            backgroundColor:
                                              "var(--color-background-body)",
                                            borderRadius:
                                              "var(--radius-container)",
                                            border: "var(--border-width) solid",
                                            borderColor:
                                              badge.dot === "success"
                                                ? "var(--color-border-success)"
                                                : "var(--color-border)",
                                          }}
                                        >
                                          <StatusDot
                                            variant={badge.dot}
                                            label={badge.label}
                                            style={{
                                              width: "var(--spacing-3)",
                                              height: "var(--spacing-3)",
                                              ...(badge.dot === "success"
                                                ? {
                                                    backgroundColor:
                                                      "var(--color-icon-success)",
                                                  }
                                                : {}),
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
                                        text={formatFriendlyCheckSummary(chk)}
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
                          effectiveCapabilities?.setupAuditEnabled ? (
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
                          ) : effectiveCapabilities?.realCollectionEnabled ? (
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

            {activeCase || interviewStarted ? (
              <ResizeHandle
                resizable={resizable}
                isReversed
                hasDivider
                isAlwaysVisible
                label="调整对话与证据面板宽度"
              />
            ) : null}

            {/* 右栏：可调宽的常驻诊断与进度面板 */}
            <VStack
              width={resizable.size}
              height="100%"
              padding={4}
              gap={4}
              style={{
                ...panelScrollStyle,
                ...(!activeCase && !interviewStarted
                  ? { display: "none" }
                  : {}),
              }}
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
                      {!activeCase && chatFollowups.length > 0
                        ? "AI 问答"
                        : "等待完成左侧问诊与授权"}
                    </Text>
                    <Text size="sm" color="secondary">
                      {!activeCase && chatFollowups.length > 0
                        ? "回答引用本机硬件快照。完整设备列表可在「硬件信息」查看；需要检查设置或故障时，可使用「一键体检」。"
                        : "完成左侧简短追问并确认检查后，这里会呈现观察结论、下一步排查指南和原始证据。"}
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

                      {hardwareOverview.rows.length > 0 ? (
                        <Card variant="default" padding={4}>
                          <VStack gap={2}>
                            <HStack
                              hAlign="between"
                              vAlign="center"
                              width="100%"
                            >
                              <Heading level={5}>本机配置概览</Heading>
                              <Token
                                size="sm"
                                color="blue"
                                label="本机实测配置"
                              />
                            </HStack>
                            <Divider />
                            <VStack gap={2} width="100%">
                              {hardwareOverview.rows.map((row) => (
                                <HStack
                                  key={row.label}
                                  gap={3}
                                  vAlign="start"
                                  width="100%"
                                >
                                  <StackItem
                                    size="static"
                                    style={detailLabelStyle}
                                  >
                                    <Text
                                      size="sm"
                                      color="secondary"
                                      weight="medium"
                                    >
                                      {row.label}
                                    </Text>
                                  </StackItem>
                                  <StackItem
                                    size="fill"
                                    style={minWidthZeroStyle}
                                  >
                                    <Text size="sm" style={preLineTextStyle}>
                                      {row.value}
                                    </Text>
                                  </StackItem>
                                </HStack>
                              ))}
                            </VStack>
                          </VStack>
                        </Card>
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
                                        ? "AI 智能体已介入"
                                        : "智能体检总结"
                                    }
                                  />
                                ) : null}
                                <Button
                                  label={
                                    explainBusy
                                      ? "AI 解读中…"
                                      : displayedExplanation
                                        ? "重新生成解读"
                                        : effectiveCapabilities?.modelConfigured
                                          ? "让 AI 深度解读"
                                          : "生成体检总结"
                                  }
                                  size="sm"
                                  variant="secondary"
                                  isDisabled={explainBusy}
                                  onClick={() => void handleExplainWithAi()}
                                />
                              </HStack>
                            </HStack>
                            {displayedExplanation?.origin === "model" ? (
                              <VStack gap={2}>
                                <StreamingText
                                  text={displayedExplanation.summary}
                                  stream={Boolean(aiExplanation)}
                                />
                                {displayedExplanation.recommendations.length >
                                0 ? (
                                  <VStack gap={1}>
                                    <Text
                                      type="supporting"
                                      weight="semibold"
                                      color="secondary"
                                    >
                                      建议操作顺序：
                                    </Text>
                                    {displayedExplanation.recommendations
                                      .slice(0, 3)
                                      .map((rec) => (
                                        <Text
                                          key={rec.priority}
                                          size="sm"
                                          style={preLineTextStyle}
                                        >
                                          {rec.priority}. {rec.instruction}
                                        </Text>
                                      ))}
                                  </VStack>
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
                            ) : explainBusy ? (
                              <Text size="sm" color="secondary">
                                正在结合本轮检测结果生成解读，请稍候…
                              </Text>
                            ) : (
                              <Text size="sm">
                                {(() => {
                                  const opps = dedupedAuditChecks.filter(
                                    (c) => c.assessment === "opportunity",
                                  );
                                  if (opps.length > 0) {
                                    const names = opps
                                      .map(
                                        (c) =>
                                          AUDIT_METRIC_LABELS[c.metric] ??
                                          c.metric,
                                      )
                                      .join("、");
                                    return `本轮共发现 ${opps.length} 项可优化设置（${names}）。点击下方对应的「直达设置」按钮，即可直接跳转到 Windows 设置页面自行开关调整，安全无损。`;
                                  }
                                  return "核心硬件与基础设置检查未见明显异常。如果日常使用流畅，无需修改 BIOS 或系统底层设置；需要调节电源模式、分辨率或刷新率时，直接使用下方快捷入口即可。";
                                })()}
                              </Text>
                            )}
                          </VStack>
                        </Card>
                      ) : null}

                      <Card variant="default" padding={4}>
                        <VStack gap={3}>
                          <HStack hAlign="between" vAlign="center" width="100%">
                            <Heading level={5}>手动排查与系统设置入口</Heading>
                            <Token
                              size="sm"
                              color="blue"
                              label="由你确认操作"
                            />
                          </HStack>
                          <Text size="sm" color="secondary">
                            下方按钮只打开对应 Windows
                            设置页，不会替你修改配置。先核对本轮证据与当前用途，每次只改变一项；需要外部工具时，从“工具与来源”补充证据。
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
                              label="导出证据报告"
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

                      {activeCase.report.findings.length > 0 ? (
                        <>
                          <VStack gap={2}>
                            <Heading level={5}>
                              已观察到的事实（
                              {activeCase.report.findings.length}）
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
                              <Card
                                key={step.priority}
                                variant="muted"
                                padding={4}
                              >
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
                        </>
                      ) : null}
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
