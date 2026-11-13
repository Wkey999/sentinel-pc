import type { Scenario } from "./contracts";

export type SymptomCategory =
  | "setup_audit"
  | "gaming_display"
  | "restart_bsod"
  | "storage_io"
  | "office_peripheral";

export interface CategoryPreset {
  id: SymptomCategory;
  label: string;
  subtitle: string;
  mappedScenarioId: Scenario["id"];
  examplePrompt: string;
}

export interface FollowupQuestion {
  id: string;
  prompt: string;
  hint: string;
  quickOptions: string[];
}

export interface InterviewAnswer {
  questionId: string;
  question: string;
  answer: string;
}

export const SETUP_AUDIT_PRESET: CategoryPreset = {
  id: "setup_audit",
  label: "⚡ 一键傻瓜体检（查装机乌龙与性能释放）",
  subtitle: "免打字免问诊：直接扫描显示器是否插错主板口、高刷是否锁 60Hz、内存 XMP/双通道及电源计划",
  mappedScenarioId: "application",
  examplePrompt:
    "帮我全机扫描一遍基础设置、装机乌龙与性能释放（显示器接核显还是独显、刷新率、内存频率、电源计划）",
};

export const CATEGORY_PRESETS: CategoryPreset[] = [
  {
    id: "gaming_display",
    label: "游戏黑屏 / 闪退 / 掉帧",
    subtitle: "玩到一半黑屏恢复、直接退出、或显卡驱动无响应",
    mappedScenarioId: "application",
    examplePrompt: "刚才打游戏时屏幕突然黑了一下又恢复，过一会游戏直接闪退了",
  },
  {
    id: "restart_bsod",
    label: "突然重启 / 死机 / 蓝屏",
    subtitle: "高负载或日常使用中无征兆黑屏重启、Kernel-Power 41",
    mappedScenarioId: "restart",
    examplePrompt: "玩游戏时电脑突然像断电一样自动重启，没有蓝屏提示",
  },
  {
    id: "storage_io",
    label: "硬盘掉盘 / 卡顿 / SMART 告警",
    subtitle: "读取加载极慢、盘符消失、或已有 CrystalDiskInfo / smartctl 报告",
    mappedScenarioId: "storage",
    examplePrompt: "最近游戏加载特别慢，偶尔整个磁盘消失一两分钟才恢复",
  },
  {
    id: "office_peripheral",
    label: "办公卡死 / 外设间歇断连",
    subtitle: "表格/软件无响应、鼠标键盘或 USB 设备频繁重连",
    mappedScenarioId: "empty",
    examplePrompt: "办公软件经常无响应转圈，鼠标偶尔还会断连几秒再响一声",
  },
];

export function detectCategoryFromText(text: string): SymptomCategory {
  const lower = text.toLowerCase();
  if (/硬盘|掉盘|ssd|hdd|nvme|smart|加载慢|crystal|磁盘|卡死.*读/.test(lower)) {
    return "storage_io";
  }
  if (/重启|断电|蓝屏|死机|bsod|41|whea/.test(lower)) {
    return "restart_bsod";
  }
  if (/鼠标|键盘|usb|外设|断连|耳机|办公|表格|word|excel|wps/.test(lower)) {
    return "office_peripheral";
  }
  return "gaming_display";
}

export function getFollowupQuestions(category: SymptomCategory): FollowupQuestion[] {
  const commonTime: FollowupQuestion = {
    id: "when_occurred",
    prompt: "这个问题大概发生在什么时候？是否能稳定复现？",
    hint: "时间越准，日志检索范围越精准；不记得也没关系。",
    quickOptions: [
      "刚刚发生（10 分钟内）",
      "今天之内发生过多次",
      "记不清具体时间了",
    ],
  };

  const commonChange: FollowupQuestion = {
    id: "recent_change",
    prompt: "出问题前的 48 小时内，电脑有没有过什么变化？",
    hint: "近期变更是最容易被忽略的线索。",
    quickOptions: [
      "刚更新过显卡驱动或系统补丁",
      "新装了软件/插件或插了新外设",
      "什么都没动过，突然就这样",
    ],
  };

  switch (category) {
    case "setup_audit":
      return [];
    case "gaming_display":
      return [
        {
          id: "display_behavior",
          prompt: "黑屏或闪退时，电脑的声音、风扇和主机灯是什么状态？",
          hint: "这能帮我们区分是“显卡驱动重置”还是“整机断电”。",
          quickOptions: [
            "黑一下马上恢复，游戏语音/背景音还在",
            "游戏直接闪退回桌面，弹出报错窗口",
            "黑屏后彻底没反应，只能长按电源重启",
          ],
        },
        commonTime,
        commonChange,
      ];
    case "restart_bsod":
      return [
        {
          id: "restart_trigger",
          prompt: "重启前电脑正在做什么？重启过程有没有蓝屏进度条？",
          hint: "区分高负载触发与待机触发非常关键。",
          quickOptions: [
            "打大型游戏高负载时直接黑屏重启，无蓝屏",
            "出现过蓝屏界面并收集错误百分比",
            "只开网页或挂机时也莫名其妙重启",
          ],
        },
        commonTime,
        commonChange,
      ];
    case "storage_io":
      return [
        {
          id: "storage_symptom",
          prompt: "硬盘异常具体表现在哪一块？手头有没有现成的检测报告？",
          hint: "如果已经有 CrystalDiskInfo 或 smartctl 导出文件，后续可直接导入。",
          quickOptions: [
            "系统盘或游戏盘加载卡顿、资源管理器未响应",
            "副盘偶尔消失，重启电脑又重新出现",
            "我已经有检测软件导出的文本/JSON 报告",
          ],
        },
        commonTime,
        commonChange,
      ];
    case "office_peripheral":
      return [
        {
          id: "peripheral_scope",
          prompt: "出问题时，是单个软件卡死，还是连带键盘鼠标一起断连？",
          hint: "有助于判断是软件自身无响应还是 USB 供电/接口链路异常。",
          quickOptions: [
            "仅某个办公软件无响应，鼠标还能正常移动",
            "听到 USB 拔出/插入提示音，外设一起失灵几秒",
            "接在扩展坞/前面板上的设备更容易断",
          ],
        },
        commonTime,
        commonChange,
      ];
  }
}

export function buildConsolidatedSymptom(
  initialSymptom: string,
  answers: InterviewAnswer[],
): string {
  if (answers.length === 0) return initialSymptom.trim();
  const details = answers
    .map((a) => `- ${a.question}：${a.answer}`)
    .join("\n");
  const merged = `${initialSymptom.trim()}\n\n[问诊补充上下文]\n${details}`;
  // 后端 CreateCase 限制 symptom 最多 1000 字符
  return merged.length > 980 ? `${merged.slice(0, 977)}...` : merged;
}

export interface GuidedStep {
  priority: number;
  title: string;
  purpose: string;
  action: string;
  expected: string;
}

export function getPrioritizedNextSteps(
  category: SymptomCategory,
): GuidedStep[] {
  switch (category) {
    case "setup_audit":
      return [
        {
          priority: 1,
          title: "确认显示器视频线插在独立显卡接口，而非主板接口",
          purpose: "避免通过核显跨 PCIe 搬运画面导致 5%–15% 帧率损失、操作延迟以及 G-Sync/FreeSync 失效",
          action: "查看机箱背面：确认 DP / HDMI 线插在下方横置的独立显卡金属挡板接口上，而不是上方靠近 USB 的主板接口。",
          expected: "视频信号直出独立显卡，游戏帧数与响应延迟恢复满血状态。",
        },
        {
          priority: 2,
          title: "检查 Windows 高级显示器刷新率是否锁在 60Hz",
          purpose: "释放 144Hz / 165Hz / 240Hz 高刷屏的真实流畅度",
          action: "右键桌面 -> 显示设置 -> 高级显示器设置 -> 将“选择刷新率”改为显示器支持的最高档位。",
          expected: "桌面拖动窗口与游戏画面丝滑度明显提升。",
        },
        {
          priority: 3,
          title: "核对内存 XMP/EXPO 频率与双通道插槽（2、4 槽）",
          purpose: "防止 DDR4 长期跑在 2133MHz 或 DDR5 跑在 4800MHz 拖累游戏最低帧（1% Low）",
          action: "打开任务管理器 -> 性能 -> 内存，查看速度与已使用插槽；若未达标则进主板 BIOS 开启 XMP / EXPO。",
          expected: "游戏团战卡顿与 1% Low 帧明显改善。",
        },
      ];
    case "gaming_display":
      return [
        {
          priority: 1,
          title: "排查显示线材与接口松动（零成本单变量验证）",
          purpose: "排除 DP/HDMI 线材接触不良或高刷带宽不足导致的短暂黑屏",
          action: "保存工作后，重新插紧显卡与显示器两端视频线，或更换一根已知正常的线材后运行同一游戏 15 分钟。",
          expected: "若黑屏消失，则高度指向线材或接口；若仍复现，继续下一步。",
        },
        {
          priority: 2,
          title: "记录并对比显卡驱动版本",
          purpose: "排除近期驱动更新引起的渲染链路崩溃或 TDR 超时",
          action: "若近 48 小时刚更新过驱动，可暂回退至上一个稳定版本，并在“复测对比”中记录变量。",
          expected: "闪退频率下降或不再出现显示恢复提示。",
        },
      ];
    case "restart_bsod":
      return [
        {
          priority: 1,
          title: "核实电源插座、排插与供电线连接",
          purpose: "排除外部供电瞬断导致的 Kernel-Power 41 异常关机",
          action: "检查主机电源线与墙插/排插是否虚接，暂时避开老旧多口排插直连墙插复测。",
          expected: "排除外部市电波动因素，若仍重启再进一步排查硬件与散热。",
        },
        {
          priority: 2,
          title: "高负载下观察温度并检查是否有蓝屏转储",
          purpose: "区分过热保护关机与系统错误检查重启",
          action: "记录重启前机箱风扇是否突然狂转，检查系统目录是否生成新的 Minidump 文件。",
          expected: "为下一轮分析提供精确的温度或错误检查码依据。",
        },
      ];
    case "storage_io":
      return [
        {
          priority: 1,
          title: "优先备份重要个人文件",
          purpose: "在任何告警原因未明确前，防止突发掉盘造成数据损失",
          action: "将桌面、文档及存档中不可替代的文件复制到外部移动硬盘或云盘；避免此时运行高强度全盘压力测试。",
          expected: "确保数据安全底线，再进行后续接口与健康检查。",
        },
        {
          priority: 2,
          title: "补充导入 CrystalDiskInfo / smartctl 原始报告",
          purpose: "获取更完整的 SMART 属性、介质错误计数与温度记录",
          action: "使用官网获取的工具导出文本或 JSON 报告后导入本案例。",
          expected: "补齐存储健康覆盖度，确认是否存在坏块或接口 CRC 报错。",
        },
      ];
    case "office_peripheral":
      return [
        {
          priority: 1,
          title: "将易断连外设直接插到主板后置 USB 口",
          purpose: "排除前置机箱面板或无源扩展坞供电不足导致的 USB 间歇重连",
          action: "拔掉扩展坞，将键鼠直连机箱后部主板原生 USB 接口并观察半天。",
          expected: "若断连停止，说明问题出在扩展坞或机箱前置面板线。",
        },
        {
          priority: 2,
          title: "单变量隔离第三方软件插件",
          purpose: "确认是否由特定加载项引起办公软件无响应",
          action: "以安全模式启动对应办公软件，或暂时禁用近期新装插件后进行复测。",
          expected: "软件不再转圈卡死即可锁定插件冲突范围。",
        },
      ];
  }
}
