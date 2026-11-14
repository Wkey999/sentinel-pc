import { describe, expect, it, vi } from "vitest";
import {
  buildHardwareAnswer,
  hardwareQuestionTopics,
  resolveHardwareAnswer,
} from "../src/domain/hardware-answer";
import { hardwareDemo } from "../src/services/hardware-demo";

function nativeInfo() {
  const info = { ...hardwareDemo(), origin: "windows_native" as const };
  info.groups.find((group) => group.id === "cpu")!.items = [
    {
      name: "Intel Core Ultra 7 255HX",
      details: ["20 核 / 20 线程"],
      problem: false,
    },
  ];
  return info;
}

describe("本机配置问答", () => {
  it("CPU 查询直接引用硬件页快照，不依赖本轮报告或 AI 摘要", () => {
    const reply = buildHardwareAnswer("我的cpu是什么?", nativeInfo())!;
    expect(reply).toContain("Intel Core Ultra 7 255HX");
    expect(reply).toContain("20 核 / 20 线程");
    expect(reply).toContain("采集时间");
    expect(reply).not.toContain("暂未读到");
    expect(reply).not.toContain("诊断解读");
  });
  it("有缓存不重采，没有缓存才读取；不调用模型", async () => {
    const info = nativeInfo();
    const load = vi.fn(async () => info);
    expect(
      await resolveHardwareAnswer("我的CPU是什么", {
        cached: () => info,
        load,
      }),
    ).toContain("255HX");
    expect(load).not.toHaveBeenCalled();
    expect(
      await resolveHardwareAnswer("我的CPU是什么", {
        cached: () => undefined,
        load,
      }),
    ).toContain("255HX");
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("多项问题保留两张显卡、两条内存，不把其中一个设备当成全部", () => {
    const reply = buildHardwareAnswer(
      "我的显卡和内存型号是什么？",
      nativeInfo(),
    )!;
    expect(reply).toContain("独立显卡");
    expect(reply).toContain("集成显卡");
    expect(reply).toContain("插槽 1");
    expect(reply).toContain("插槽 2");
  });
  it("支持型号、操作系统及完整配置，来源注明演示或缓存过期", () => {
    expect(
      buildHardwareAnswer("电脑型号和操作系统是什么？", nativeInfo()),
    ).toContain("Windows 11");
    const demo = hardwareDemo();
    demo.collectedAtUtc = "2020-01-01T00:00:00Z";
    const reply = buildHardwareAnswer("我的电脑配置", demo)!;
    expect(reply).toContain("浏览器演示配置，不是本机实测");
    expect(reply).toContain("超过 24 小时");
    expect(reply).toContain("NPU");
  });
  it("刷新率优先本轮原生证据，不从面板商品名猜测实时 Hz", () => {
    const reply = buildHardwareAnswer(
      "我的显示器刷新率是多少？",
      nativeInfo(),
      {
        native: true,
        rows: [{ label: "显示器", value: "独立显卡直连 · 2560×1440 @ 144Hz" }],
        modelInfo: "",
        osInfo: "",
      },
    )!;
    expect(reply).toContain("144Hz");
    expect(reply).toContain("本轮采集报告");
  });
  it("无法采集时不编造型号，不拿合成报告充当本机数据", async () => {
    const reply = await resolveHardwareAnswer("我的CPU是什么", {
      cached: () => undefined,
      load: async () => {
        throw new Error("unavailable");
      },
      fallback: {
        native: false,
        rows: [{ label: "处理器", value: "Synthetic CPU" }],
        modelInfo: "",
        osInfo: "",
      },
    });
    expect(reply).toContain("本次读取未完成");
    expect(reply).not.toContain("Synthetic CPU");
  });
  it("快照缺项时可使用明确标注的原生报告，不用不可读分组中的残余名称", () => {
    const info = nativeInfo();
    info.groups[0]!.status = "unavailable";
    const reply = buildHardwareAnswer("我的CPU是什么？", info, {
      native: true,
      rows: [{ label: "处理器", value: "Report CPU" }],
      modelInfo: "",
      osInfo: "",
    })!;
    expect(reply).toContain("Report CPU");
    expect(reply).not.toContain("255HX");
  });
  it("故障描述仍走问诊，普通回答不会因为包含硬件词被当成提问", () => {
    for (const q of [
      "我的CPU过热死机",
      "游戏显卡黑屏怎么办",
      "内存用了16GB",
      "CPU占用率100%为什么",
      "这个CPU性能怎么样",
    ]) {
      expect(hardwareQuestionTopics(q)).toEqual([]);
    }
    expect(hardwareQuestionTopics("我的CPU是什么？")).toEqual(["cpu"]);
    expect(hardwareQuestionTopics("GPU")).toEqual(["graphics"]);
  });
});
