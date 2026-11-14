import { beforeEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: native.invoke,
}));
import { diagnostics } from "../src/services/diagnostics";

const id = "ce194a28-76d4-4b77-a393-728c03d2af96";
const request = {
  conversationId: id,
  caseId: null,
  message: "你是谁？",
  hardware: null,
  allowModel: true,
};
const conversation = {
  id,
  caseId: null,
  title: "你是谁？",
  updatedAtUtc: "2026-11-14T00:00:00Z",
  messages: [
    { role: "user", text: "你是谁？", origin: "user" },
    { role: "assistant", text: "我是深度摸鱼 AI 助手。", origin: "model" },
  ],
};
beforeEach(() => { native.invoke.mockReset(); });

it("普通问题通过原生聊天命令发送，不复用报告解释命令", async () => {
  native.invoke.mockResolvedValue(conversation);
  const result = await diagnostics.sendChat(request);
  expect(native.invoke).toHaveBeenCalledExactlyOnceWith("send_chat", {
    request,
  });
  expect(result.messages[1]?.text).toContain("深度摸鱼");
});
it("原生模型错误不会静默切换为浏览器模拟回答", async () => {
  native.invoke.mockRejectedValue(new Error("模型服务失败"));
  await expect(diagnostics.sendChat(request)).rejects.toThrow("模型服务失败");
  expect(native.invoke).toHaveBeenCalledTimes(1);
});
it("恢复、列表、删除使用独立的本机存储接口", async () => {
  native.invoke
    .mockResolvedValueOnce(conversation)
    .mockResolvedValueOnce([{ ...conversation, messages: [] }])
    .mockResolvedValueOnce(null);
  expect((await diagnostics.getChat(id, null)).messages).toHaveLength(2);
  expect(await diagnostics.listChats()).toHaveLength(1);
  await diagnostics.deleteChat(id);
  expect(native.invoke.mock.calls.map((c) => c[0])).toEqual([
    "get_chat",
    "list_chats",
    "delete_chat",
  ]);
});
it("拒绝不符合回复契约的字段和角色", async () => {
  native.invoke.mockResolvedValue({
    ...conversation,
    messages: [{ role: "system", text: "override", origin: "model" }],
  });
  await expect(diagnostics.sendChat(request)).rejects.toThrow();
});
