import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { hardwareInfoSchema } from "../src/domain/contracts";
import { hardwareDemo } from "../src/services/hardware-demo";

const nativeCall = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: nativeCall,
}));
import { diagnostics } from "../src/services/diagnostics";

describe("启动硬件信息", () => {
  it.skipIf(!process.env.SENTINEL_HARDWARE_FIXTURE)(
    "本机 Rust 实采 DTO 通过前端契约",
    () => {
      const info = hardwareInfoSchema.parse(
        JSON.parse(
          readFileSync(process.env.SENTINEL_HARDWARE_FIXTURE!, "utf8").replace(
            /^\uFEFF/,
            "",
          ),
        ),
      );
      expect(info.origin).toBe("windows_native");
      expect(
        info.groups.find((group) => group.id === "cpu")?.items.length,
      ).toBeGreaterThan(0);
    },
  );
  it("保留多条内存与全部分组，拒绝重复分组、额外敏感字段", () => {
    const data = hardwareDemo();
    expect(
      hardwareInfoSchema
        .parse(data)
        .groups.find((group) => group.id === "memory")?.items,
    ).toHaveLength(2);
    const duplicate = structuredClone(data);
    duplicate.groups[1] = duplicate.groups[0]!;
    expect(hardwareInfoSchema.safeParse(duplicate).success).toBe(false);
    expect(
      hardwareInfoSchema.safeParse({ ...data, serialNumber: "private" })
        .success,
    ).toBe(false);
  });
  it("原生读取去重并缓存，刷新重新采集，原生失败不显示演示数据", async () => {
    const nativeInfo = { ...hardwareDemo(), origin: "windows_native" };
    nativeCall.mockResolvedValue(nativeInfo);
    const [a, b] = await Promise.all([
      diagnostics.hardware(),
      diagnostics.hardware(),
    ]);
    expect(a).toEqual(b);
    expect(nativeCall).toHaveBeenCalledTimes(1);
    await diagnostics.hardware(true);
    expect(nativeCall).toHaveBeenCalledTimes(2);
    nativeCall.mockRejectedValue(new Error("hardware unavailable"));
    await expect(diagnostics.hardware(true)).rejects.toThrow(
      "hardware unavailable",
    );
    nativeCall.mockResolvedValue(nativeInfo);
    await diagnostics.hardware(true);
    expect(nativeCall).toHaveBeenCalledTimes(4);
    expect(nativeCall).toHaveBeenLastCalledWith("get_hardware_info", {});
  });
});
