import { hardwareGroupIds, type HardwareInfo } from "../domain/contracts";

// Browser-only illustration; native collection failures never fall back to it.
export function hardwareDemo(): HardwareInfo {
  const examples: Record<
    (typeof hardwareGroupIds)[number],
    [string, string[][]]
  > = {
    cpu: ["处理器", [["AMD Ryzen 7 处理器（演示）", "8 核 / 16 线程"]]],
    baseboard: [
      "主板",
      [["Sentinel Demo Board", "主板型号与版本会在桌面版读取"]],
    ],
    memory: [
      "内存",
      [
        ["16 GB DDR5", "配置速率 5600 MT/s · 插槽 1"],
        ["16 GB DDR5", "配置速率 5600 MT/s · 插槽 2"],
      ],
    ],
    graphics: [
      "显卡",
      [
        ["独立显卡（演示）", "专用显存 12 GB"],
        ["集成显卡（演示）", "使用共享系统内存"],
      ],
    ],
    monitors: [
      "显示器",
      [["27 英寸显示器（演示）", "显示器型号与尺寸由 EDID 提供"]],
    ],
    storage: [
      "磁盘",
      [
        ["NVMe SSD（演示）", "总容量 1024 GB"],
        ["系统分区 C:", "可用 256 GB / 总计 950 GB"],
      ],
    ],
    npu: ["NPU / AI 加速器", []],
    audio: [
      "声卡与音频设备",
      [["High Definition Audio（演示）"], ["USB 耳机（演示）"]],
    ],
    network: ["网卡", [["2.5GbE Ethernet（演示）"], ["Wi-Fi 6E（演示）"]]],
    bios: ["BIOS / 固件", [["UEFI 固件（演示）", "版本与日期将在桌面版读取"]]],
  };
  return {
    origin: "browser_demo",
    collectedAtUtc: new Date().toISOString(),
    computerModel: "Sentinel 演示电脑",
    operatingSystem: "Windows 11 · 64 位（演示）",
    groups: hardwareGroupIds.map((id) => ({
      id,
      label: examples[id][0],
      status: examples[id][1].length ? "available" : "empty",
      items: examples[id][1].map(([name, ...details]) => ({
        name: name!,
        details,
        problem: false,
      })),
    })),
  };
}
