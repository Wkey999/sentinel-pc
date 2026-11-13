import { describe, expect, it, vi } from "vitest";
import { createHardwareCache } from "../src/services/hardware-cache";
import { hardwareDemo } from "../src/services/hardware-demo";

const now = Date.parse("2026-11-14T05:00:00Z");
function fixture() {
  return {
    ...hardwareDemo(),
    origin: "windows_native" as const,
    collectedAtUtc: new Date(now).toISOString(),
  };
}
function setup() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const load = vi.fn(async () => fixture());
  let time = now;
  const create = () =>
    createHardwareCache({
      origin: "windows_native",
      load,
      storage: () => storage,
      now: () => time,
    });
  return {
    create,
    load,
    values,
    storage,
    advance: (hours: number) => {
      time += hours * 3600000;
    },
  };
}

describe("持久硬件快照", () => {
  it("重建应用后立即读取缓存，24 小时内无需再次调用采集", async () => {
    const s = setup();
    const info = await s.create().get();
    s.advance(2);
    const restarted = s.create();
    expect(restarted.peek()).toEqual(info);
    expect(restarted.isFresh()).toBe(true);
    expect(await restarted.get()).toEqual(info);
    expect(s.load).toHaveBeenCalledTimes(1);
  });

  it("过期仍能先展示旧结果，刷新失败保留快照，成功后替换并持久保存", async () => {
    const s = setup();
    const old = await s.create().get();
    s.advance(25);
    const cache = s.create();
    expect(cache.isFresh()).toBe(false);
    expect(cache.peek()).toEqual(old);
    s.load.mockRejectedValueOnce(new Error("offline"));
    await expect(cache.get()).rejects.toThrow("offline");
    expect(cache.peek()).toEqual(old);
    const updated = {
      ...fixture(),
      collectedAtUtc: new Date(now + 25 * 3600000).toISOString(),
      computerModel: "Updated PC",
    };
    s.load.mockResolvedValueOnce(updated);
    expect(await cache.get()).toEqual(updated);
    expect(s.create().peek()).toEqual(updated);
  });

  it("手动刷新绕过缓存；并发刷新与读取共用一次采集", async () => {
    const s = setup();
    const cache = s.create();
    await cache.get();
    await Promise.all([cache.get(true), cache.get(true), cache.get()]);
    expect(s.load).toHaveBeenCalledTimes(2);
  });

  it("损坏、旧版本、未来时间、演示数据和敏感额外字段不会作为本机缓存展示", () => {
    const s = setup();
    for (const saved of [
      "broken",
      JSON.stringify({ version: 0, info: fixture() }),
      JSON.stringify({
        version: 1,
        info: { ...fixture(), origin: "browser_demo" },
      }),
      JSON.stringify({
        version: 1,
        info: { ...fixture(), collectedAtUtc: "invalid" },
      }),
      JSON.stringify({
        version: 1,
        info: { ...fixture(), collectedAtUtc: new Date(now + 1).toISOString() },
      }),
      JSON.stringify({
        version: 1,
        info: { ...fixture(), serialNumber: "private" },
      }),
    ]) {
      s.storage.setItem("sentinel.hardware.windows_native.v1", saved);
      expect(s.create().peek()).toBeUndefined();
    }
  });

  it("采集来源不符会报错，存储不可用时仍能读取并在内存中去重", async () => {
    const storage = () => {
      throw new Error("Storage disabled");
    };
    const load = vi.fn(async () => fixture());
    const cache = createHardwareCache({
      origin: "windows_native",
      load,
      storage,
      now: () => now,
    });
    expect(cache.peek()).toBeUndefined();
    await cache.get();
    await cache.get();
    expect(load).toHaveBeenCalledTimes(1);
    load.mockResolvedValueOnce({
      ...fixture(),
      origin: "browser_demo",
    } as never);
    await expect(cache.get(true)).rejects.toThrow("来源");
    expect(cache.peek()).toEqual(fixture());
  });

  it("不完整的采集最多缓存五分钟，避免缺失信息长期不更新", async () => {
    const s = setup();
    const info = fixture();
    info.groups[0]!.status = "unavailable";
    s.load.mockResolvedValueOnce(info);
    const cache = s.create();
    await cache.get();
    s.advance(0.1);
    expect(cache.peek()).toEqual(info);
    expect(cache.isFresh()).toBe(false);
  });
});
