import { describe, expect, it } from "vitest";
import { MockService, samples, analyzeMock } from "../src/services/mock";
import {
  createCaseSchema,
  reportSchema,
  startSchema,
} from "../src/domain/contracts";

const start = "2026-11-12T01:53:00Z",
  end = "2026-11-12T02:13:00Z";
const input = (
  scenarioId:
    | "restart"
    | "application"
    | "storage"
    | "empty"
    | "insufficient" = "restart",
) => ({
  scenarioId,
  symptom: "合成输入 SECRET-DO-NOT-EXPORT",
  incidentStartUtc: start,
  incidentEndUtc: end,
  displayTimezone: "Asia/Hong_Kong" as const,
  environment: "personal" as const,
});
async function ready(s: MockService, id: "restart" | "storage" = "restart") {
  const c = await s.create(input(id));
  const planned = await s.build(c.id);
  const p = planned.plan!;
  const base = { caseId: c.id, planId: p.id, planHash: p.hash };
  const consent = await s.approve(base);
  return { ...base, consentToken: consent.token };
}
describe("合成规则的边界", () => {
  it.each(samples)("$id：证据引用完整且结果有来源", (s) => {
    const r = analyzeMock(s, start, end);
    expect(reportSchema.safeParse(r).success).toBe(true);
    expect(r.provenance).toBe("synthetic");
  });
  it("同编号不同 provider 或 schema 不命中", () => {
    const s = structuredClone(samples[0]!);
    s.evidence[0]!.provider = "fake";
    expect(analyzeMock(s, start, end).findings).toHaveLength(0);
    s.evidence[0]!.provider = "Microsoft-Windows-Kernel-Power";
    s.evidence[0]!.schemaVersion = 99;
    expect(analyzeMock(s, start, end).findings).toHaveLength(0);
  });
  it("不同实体、来源、启动会话或时间顺序不关联", () => {
    expect(analyzeMock(samples[1]!, start, end).findings).toHaveLength(2);
    for (const key of [
      "entity",
      "source",
      "bootSession",
      "observedAtUtc",
    ] as const) {
      const s = structuredClone(samples[1]!);
      s.evidence[1]![key] =
        key === "observedAtUtc" ? "2026-11-12T02:02:00Z" : "other";
      expect(analyzeMock(s, start, end).findings).toHaveLength(1);
    }
  });
  it("窗口外事件不用于结论，原证据保留", () => {
    const r = analyzeMock(
      samples[0]!,
      "2026-11-13T01:53:00Z",
      "2026-11-13T02:13:00Z",
    );
    expect(r.findings).toHaveLength(0);
    expect(r.evidence).toHaveLength(1);
  });
  it("未知证据引用被拒绝", () => {
    const r = analyzeMock(samples[0]!, start, end);
    r.findings[0]!.evidenceIds = ["fabricated"];
    expect(reportSchema.safeParse(r).success).toBe(false);
  });
  it("空结果、权限不足和截断保持不同状态", () => {
    expect(analyzeMock(samples[3]!, start, end).coverage[0]!.status).toBe(
      "empty",
    );
    expect(
      analyzeMock(samples[4]!, start, end).coverage.map((c) => c.status),
    ).toEqual(["permission_denied", "truncated", "missing"]);
  });
});
describe("语义契约与 Mock 流程", () => {
  it("额外字段、超长文字、无序时间被拒绝", () => {
    expect(
      createCaseSchema.safeParse({ ...input(), command: "cmd" }).success,
    ).toBe(false);
    expect(
      createCaseSchema.safeParse({ ...input(), symptom: "a".repeat(1001) })
        .success,
    ).toBe(false);
    expect(
      createCaseSchema.safeParse({
        ...input(),
        incidentEndUtc: "2026-11-10T00:00:00Z",
      }).success,
    ).toBe(false);
    expect(startSchema.safeParse({ caseId: "../private" }).success).toBe(false);
  });
  it("重复启动幂等", async () => {
    const s = new MockService();
    const r = await ready(s);
    const a = await s.start(r),
      b = await s.start(r);
    expect(a.report).toEqual(b.report);
    expect(await s.list()).toHaveLength(1);
  });
  it("改变计划后旧同意不可用", async () => {
    const s = new MockService();
    const r = await ready(s);
    await s.build(r.caseId);
    await expect(s.start(r)).rejects.toThrow("计划已变化");
  });
  it("伪造同意令牌拒绝", async () => {
    const s = new MockService();
    const r = await ready(s);
    await expect(
      s.start({ ...r, consentToken: crypto.randomUUID() }),
    ).rejects.toThrow("同意已失效");
  });
  it("导出排除问题描述、序列号和令牌", async () => {
    const s = new MockService();
    const r = await ready(s, "storage");
    await s.start(r);
    const json = await s.export({ caseId: r.caseId, format: "json" });
    expect(json.content).not.toContain("SN-DEMO-001");
    expect(json.content).not.toContain("SECRET-DO-NOT-EXPORT");
    expect(json.content).not.toContain(r.consentToken);
    expect(json.content).toContain("REDACTED_1");
    const md = await s.export({ caseId: r.caseId, format: "markdown" });
    expect(md.content).toContain("STORAGE");
  });
  it("删除后无法再打开或启动", async () => {
    const s = new MockService();
    const r = await ready(s);
    await s.delete(r.caseId);
    await expect(s.start(r)).rejects.toThrow("案例不存在");
    expect(await s.list()).toHaveLength(0);
  });
});
