import { expect, it } from "vitest";
import { createModelReminder } from "../src/services/model-reminder";

function fixture() {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
  return {
    data,
    storage,
    reminder: createModelReminder(() => storage, "test"),
  };
}
it("首次及前十次直接发送，第十一次才提醒", () => {
  const { reminder } = fixture();
  for (let i = 0; i < 10; i++) {
    expect(reminder.needsReminder()).toBe(false);
    reminder.recordSend();
  }
  expect(reminder.needsReminder()).toBe(true);
});
it("切换对话或重新创建计数器不会丢失次数", () => {
  const { reminder, storage } = fixture();
  for (let i = 0; i < 7; i++) reminder.recordSend();
  const reopened = createModelReminder(() => storage, "test");
  for (let i = 0; i < 3; i++) {
    expect(reopened.needsReminder()).toBe(false);
    reopened.recordSend();
  }
  expect(reopened.needsReminder()).toBe(true);
});
it("暂不发送不会重置计数，继续后每十次再次提醒", () => {
  const { reminder } = fixture();
  for (let i = 0; i < 10; i++) reminder.recordSend();
  expect(reminder.needsReminder()).toBe(true);
  expect(reminder.needsReminder()).toBe(true);
  reminder.acknowledge();
  for (let i = 0; i < 10; i++) {
    expect(reminder.needsReminder()).toBe(false);
    reminder.recordSend();
  }
  expect(reminder.needsReminder()).toBe(true);
});
it("损坏数据安全忽略，存储不可用时仍保留当前进程次数", () => {
  const { data, reminder } = fixture();
  data.set("test", '{"version":1,"count":-1}');
  expect(reminder.needsReminder()).toBe(false);
  const unavailable = createModelReminder(() => {
    throw Error("denied");
  }, "test");
  for (let i = 0; i < 10; i++) unavailable.recordSend();
  expect(unavailable.needsReminder()).toBe(true);
});
