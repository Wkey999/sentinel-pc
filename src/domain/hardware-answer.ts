import type { HardwareInfo } from "./contracts";

type Topic = (typeof topics)[number];
const topics = [
  "cpu",
  "graphics",
  "memory",
  "baseboard",
  "monitors",
  "storage",
  "network",
  "audio",
  "npu",
  "bios",
  "system",
  "model",
] as const;
const names: Record<Topic, string> = {
  cpu: "处理器（CPU）",
  graphics: "显卡（GPU）",
  memory: "内存",
  baseboard: "主板",
  monitors: "显示器",
  storage: "磁盘",
  network: "网卡",
  audio: "音频设备",
  npu: "NPU / AI 加速器",
  bios: "BIOS / 固件",
  system: "操作系统",
  model: "电脑型号",
};
const patterns: Record<Topic, RegExp> = {
  cpu: /\bcpu\b|处理器|中央处理器/i,
  graphics: /\bgpu\b|显卡|独显|核显/i,
  memory: /内存|\bram\b/i,
  baseboard: /主板/i,
  monitors: /显示器|屏幕|分辨率|刷新率/i,
  storage: /硬盘|磁盘|固态|\b(?:ssd|nvme)\b/i,
  network: /网卡|无线网卡|\bwi-?fi\b/i,
  audio: /声卡|音频设备|耳机/i,
  npu: /\bnpu\b|ai\s*加速器/i,
  bios: /\bbios\b|固件/i,
  system: /操作系统|系统版本|windows\s*版本/i,
  model: /电脑型号|整机型号|笔记本型号/i,
};

export function hardwareQuestionTopics(question: string): Topic[] {
  const q = question.trim();
  // Symptoms still enter diagnostics; a hardware keyword alone is not an inventory question.
  if (
    /蓝屏|黑屏|闪退|死机|崩溃|重启|卡顿|故障|报错|过热|掉帧|无法|不能|占用|温度|性能怎么样|性能如何/i.test(
      q,
    )
  )
    return [];
  if (/本机配置|电脑配置|硬件配置|整机配置/.test(q)) return [...topics];
  const matched = topics.filter((topic) => patterns[topic].test(q));
  if (!matched.length) return [];
  const asks =
    /什么|型号|哪[个款种些]|多少|几核|几条|几[个块张]|多大|配置|查看|看一下|查一下|列出|告诉我|\?|？|\b(?:what|which|show|list)\b/i.test(
      q,
    );
  const bare =
    /^(?:我的?|本机的?|这台电脑的?|电脑的?)?(?:cpu|gpu|内存|主板|显卡|硬盘|显示器|网卡|声卡|npu|bios)[呢吗]?$/i.test(
      q,
    );
  return asks || bare ? matched : [];
}

export interface ReportHardwareFallback {
  rows: Array<{ label: string; value: string }>;
  modelInfo: string;
  osInfo: string;
  native: boolean;
}
const reportLabels: Partial<Record<Topic, string>> = {
  cpu: "处理器",
  graphics: "显卡",
  memory: "内存",
  baseboard: "主板",
  monitors: "显示器",
  storage: "磁盘",
  network: "网卡",
  audio: "声卡",
};

export function buildHardwareAnswer(
  question: string,
  info?: HardwareInfo,
  fallback?: ReportHardwareFallback,
): string | undefined {
  const requested = hardwareQuestionTopics(question);
  if (!requested.length) return undefined;
  const used = new Set<string>();
  const answers = requested.map((topic) => {
    if (
      topic === "monitors" &&
      /刷新率|分辨率/.test(question) &&
      fallback?.native
    ) {
      const mode = fallback.rows.find((row) => row.label === "显示器")?.value;
      if (mode?.trim()) {
        used.add("report");
        return `${names[topic]}（本轮采集报告）：\n${mode.trim()}`;
      }
    }
    let value =
      topic === "model"
        ? info?.computerModel
        : topic === "system"
          ? info?.operatingSystem
          : undefined;
    const group = info?.groups.find((item) => item.id === topic);
    if (group?.status === "available") {
      value = group.items
        .filter((item) => item.name.trim())
        .map((item) => [item.name, ...item.details.filter(Boolean)].join(" · "))
        .join("\n");
    }
    if (value?.trim()) {
      used.add("snapshot");
      return `${names[topic]}：\n${value.trim()}`;
    }
    if (fallback?.native) {
      value =
        topic === "model"
          ? fallback.modelInfo
          : topic === "system"
            ? fallback.osInfo
            : fallback.rows.find((row) => row.label === reportLabels[topic])
                ?.value;
      if (value?.trim()) {
        used.add("report");
        return `${names[topic]}（本轮采集报告）：\n${value.trim()}`;
      }
    }
    return `${names[topic]}：本机数据中暂未读到此项，请在「硬件信息」刷新后重试；这不代表设备不存在或损坏。`;
  });
  if (used.has("snapshot") && info) {
    const time = Date.parse(info.collectedAtUtc);
    const collected = Number.isFinite(time)
      ? new Date(time).toLocaleString("zh-CN", { hour12: false })
      : "时间未报告";
    answers.push(
      `${info.origin === "browser_demo" ? "来源：浏览器演示配置，不是本机实测" : "来源：本机硬件快照"}；采集时间：${collected}。`,
    );
    if (Number.isFinite(time) && Date.now() - time >= 24 * 3600000)
      answers.push(
        "这份快照已超过 24 小时；若更换过硬件或需要最新状态，请在「硬件信息」刷新。",
      );
    if (/刷新率|分辨率/.test(question))
      answers.push(
        "硬件概览不代表实时显示模式；刷新率、分辨率和输出通路请以本轮体检的对应证据为准。",
      );
  }
  if (used.has("report") && !used.has("snapshot"))
    answers.push("来源：本轮本机只读采集报告。");
  return answers.join("\n\n");
}

export async function resolveHardwareAnswer(
  question: string,
  source: {
    cached: () => HardwareInfo | undefined;
    load: () => Promise<HardwareInfo>;
    fallback?: ReportHardwareFallback;
  },
): Promise<string> {
  let info = source.cached();
  let failed = false;
  if (!info) {
    try {
      info = await source.load();
    } catch {
      failed = true;
    }
  }
  const answer =
    buildHardwareAnswer(question, info, source.fallback) ??
    "请说明要查询哪项本机配置。";
  return failed
    ? `${answer}\n\n本次读取未完成，没有使用演示数据代替本机配置。`
    : answer;
}
