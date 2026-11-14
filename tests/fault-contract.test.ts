import { expect, it } from "vitest";
import fixtures from "./fixtures/fault-contract.json";
import { caseSchema } from "../src/domain/contracts";
import {
  CATEGORY_PRESETS,
  getFollowupQuestions,
} from "../src/domain/interview";

it.each(fixtures)("$category 的真实 Rust 回放契约可用于前端", (fixture) => {
  for (const stage of ["draft", "planned", "collecting", "completed"] as const)
    expect(caseSchema.safeParse(fixture[stage]).success).toBe(true);
  const completed = caseSchema.parse(fixture.completed);
  expect(completed.report!.provenance).toBe("synthetic");
  expect(completed.report!.findings.map((f) => f.ruleId).sort()).toEqual(
    [...fixture.expectedRuleIds].sort(),
  );
  expect(fixture.planned.plan!.actionIds).not.toContain("demo.analyze_fixture");
  expect(fixture.completed.diagnostic.category).toBe(fixture.category);
  const preset = CATEGORY_PRESETS.find((p) => p.id === fixture.category)!;
  expect(preset).toBeDefined();
  const questions = getFollowupQuestions(preset.id);
  expect(questions).toHaveLength(3);
  expect(questions.every((q) => q.quickOptions.length > 0)).toBe(true);
});
