// A shared counter, independent of conversation/component lifetime. Never stores messages or keys.
export function createModelReminder(
  storage: () => Pick<Storage, "getItem" | "setItem">,
  key: string,
) {
  let count = 0;
  const read = () => {
    try {
      const saved: unknown = JSON.parse(storage().getItem(key) ?? "null");
      if (
        saved &&
        typeof saved === "object" &&
        "version" in saved &&
        saved.version === 1 &&
        "count" in saved &&
        Number.isInteger(saved.count) &&
        typeof saved.count === "number" &&
        saved.count >= 0 &&
        saved.count <= 10
      )
        count = saved.count;
    } catch {
      /* Retain the process-local count if storage is unavailable. */
    }
    return count;
  };
  const write = (value: number) => {
    count = value;
    try {
      storage().setItem(key, JSON.stringify({ version: 1, count }));
    } catch {
      /* Conversation changes still retain the in-memory count. */
    }
  };
  return {
    needsReminder: () => read() >= 10,
    recordSend: () => write(Math.min(10, read() + 1)),
    acknowledge: () => write(0),
  };
}
