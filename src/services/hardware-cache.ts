import { z } from "zod";
import { hardwareInfoSchema, type HardwareInfo } from "../domain/contracts";

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PARTIAL_MAX_AGE_MS = 5 * 60 * 1000;
const snapshotSchema = z.strictObject({
  version: z.literal(1),
  info: hardwareInfoSchema,
});

// Native and browser previews must never reuse each other's inventory.
export function createHardwareCache(options: {
  origin: HardwareInfo["origin"];
  load: () => Promise<HardwareInfo>;
  storage: () => Pick<Storage, "getItem" | "setItem">;
  now?: () => number;
}) {
  const key = `sentinel.hardware.${options.origin}.v1`;
  const now = options.now ?? Date.now;
  let snapshot: HardwareInfo | null | undefined;
  let pending: Promise<HardwareInfo> | undefined;

  function valid(info: HardwareInfo) {
    const timestamp = Date.parse(info.collectedAtUtc);
    return (
      info.origin === options.origin &&
      Number.isFinite(timestamp) &&
      timestamp <= now()
    );
  }

  function peek(): HardwareInfo | undefined {
    if (snapshot === undefined) {
      snapshot = null;
      try {
        const saved = snapshotSchema.safeParse(
          JSON.parse(options.storage().getItem(key) ?? "null"),
        );
        if (saved.success && valid(saved.data.info)) snapshot = saved.data.info;
      } catch {
        // Unavailable storage or an old/corrupt cache is a cache miss.
      }
    }
    return snapshot ?? undefined;
  }

  function isFresh() {
    const info = peek();
    if (!info || !valid(info)) return false;
    const maxAge = info.groups.some((group) => group.status === "unavailable")
      ? PARTIAL_MAX_AGE_MS
      : MAX_AGE_MS;
    return now() - Date.parse(info.collectedAtUtc) < maxAge;
  }

  function get(force = false): Promise<HardwareInfo> {
    if (pending) return pending;
    if (!force && isFresh()) return Promise.resolve(peek()!);
    pending = Promise.resolve()
      .then(options.load)
      .then((value) => {
        const info = hardwareInfoSchema.parse(value);
        if (!valid(info)) throw new Error("硬件信息来源或采集时间无效。");
        snapshot = info;
        try {
          options.storage().setItem(key, JSON.stringify({ version: 1, info }));
        } catch {
          // A storage failure must not discard a successful local read.
        }
        return info;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  }

  return { peek, isFresh, get };
}
