import { expect, it } from "vitest";
import generated from "./fixtures/rust-contract.json";
import { caseSchema } from "../src/domain/contracts";
import { samples, analyzeMock } from "../src/services/mock";

it.each(generated)(
  "Rust 实际序列化的 $scenarioId 符合前端契约且 Mock 结果一致",
  (raw) => {
    const record = caseSchema.parse(raw);
    const scenario = samples.find((s) => s.id === record.scenarioId)!;
    const expected = analyzeMock(
      scenario,
      record.incidentStartUtc,
      record.incidentEndUtc,
    );
    expect(record.report).toEqual({
      ...expected,
      generatedAtUtc: record.report!.generatedAtUtc,
    });
  },
);
