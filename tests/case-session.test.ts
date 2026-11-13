import { describe, expect, it } from "vitest";
import {
  latestAudit,
  defaultCaseTitle,
  isSetupAudit,
} from "../src/domain/case-session";
import { renameCaseSchema } from "../src/domain/contracts";
import { MockService } from "../src/services/mock";

describe("案例像对话一样管理", () => {
  it("反复打开最近体检和重命名不会新增记录，改名后仍能找到体检", async () => {
    const service = new MockService();
    const first = await service.createSetupAudit({
      displayTimezone: "Asia/Shanghai",
      environment: "personal",
    });
    const named = await service.rename(first.id, "笔记本基础检查");
    expect(isSetupAudit(named)).toBe(true);
    for (let i = 0; i < 5; i++)
      expect(latestAudit(await service.list())?.id).toBe(first.id);
    expect(await service.list()).toHaveLength(1);
    await service.delete(first.id);
    expect(latestAudit(await service.list())).toBeUndefined();
    await expect(service.get(first.id)).rejects.toThrow();
  });
  it("只有明确新建才出现第二条记录，并按时间选择最近体检", async () => {
    const service = new MockService();
    const a = await service.createSetupAudit({
      displayTimezone: "Asia/Shanghai",
      environment: "personal",
    });
    const b = await service.createSetupAudit({
      displayTimezone: "Asia/Shanghai",
      environment: "personal",
    });
    a.createdAtUtc = "2026-11-14T01:00:00Z";
    b.createdAtUtc = "2026-11-14T02:00:00Z";
    expect(latestAudit([a, b])?.id).toBe(b.id);
    expect(await service.list()).toHaveLength(2);
  });
  it("自动标题可辨识，拒绝空白、控制字符和超长名称", () => {
    expect(
      defaultCaseTitle("setup_audit", "", new Date("2026-11-14T02:00:00Z")),
    ).toContain("一键体检 ·");
    expect(defaultCaseTitle("gaming_display", " 游戏黑屏\n经常发生 ")).toBe(
      "游戏黑屏 经常发生",
    );
    const caseId = "5e4de361-5367-4c91-a6bf-44fa7d0a164a";
    for (const title of [" ", "x\ny", "x\u0000y", "字".repeat(81)])
      expect(renameCaseSchema.safeParse({ caseId, title }).success).toBe(false);
    expect(
      renameCaseSchema.parse({ caseId, title: "  我的电脑  " }).title,
    ).toBe("我的电脑");
  });
});
