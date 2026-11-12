import { z } from "zod";

export const scenarioId = z.enum([
  "restart",
  "application",
  "storage",
  "empty",
  "insufficient",
]);
export const evidenceSchema = z.strictObject({
  id: z.string(),
  kind: z.string(),
  source: z.string(),
  observedAtUtc: z.string().nullable(),
  provider: z.string().nullable(),
  channel: z.string().nullable(),
  eventId: z.number().int().nonnegative().nullable(),
  schemaVersion: z.number().int().nonnegative().nullable(),
  recordId: z.number().int().nonnegative().nullable(),
  entity: z.string().nullable(),
  bootSession: z.string().nullable(),
  fields: z.record(z.string(), z.string()),
});
export const coverageSchema = z.strictObject({
  source: z.string(),
  status: z.enum([
    "available",
    "empty",
    "missing",
    "unsupported",
    "permission_denied",
    "truncated",
  ]),
  detail: z.string(),
});
export const findingSchema = z.strictObject({
  id: z.string(),
  ruleId: z.string(),
  title: z.string(),
  observation: z.string(),
  evidenceIds: z.array(z.string()),
  strength: z.string(),
  limitations: z.array(z.string()),
  nextStep: z.string(),
});
export const reportSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    provenance: z.literal("synthetic"),
    ruleVersion: z.string(),
    generatedAtUtc: z.string(),
    findings: z.array(findingSchema),
    evidence: z.array(evidenceSchema),
    coverage: z.array(coverageSchema),
    unknowns: z.array(z.string()),
  })
  .refine(
    (r) =>
      r.findings.every((f) =>
        f.evidenceIds.every((id) => r.evidence.some((e) => e.id === id)),
      ),
    "存在无效证据引用",
  );
export const scenarioSchema = z.strictObject({
  id: scenarioId,
  title: z.string(),
  description: z.string(),
  coverage: z.array(coverageSchema),
  evidence: z.array(evidenceSchema),
});
export const catalogSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provenance: z.literal("synthetic"),
  scenarios: z.array(scenarioSchema),
});
export const createCaseSchema = z
  .strictObject({
    scenarioId,
    symptom: z.string().trim().min(1).max(1000),
    incidentStartUtc: z.iso.datetime({ offset: true }),
    incidentEndUtc: z.iso.datetime({ offset: true }),
    displayTimezone: z.enum(["Asia/Hong_Kong", "Asia/Shanghai", "UTC"]),
    environment: z.enum(["personal", "workplace", "unknown"]),
  })
  .refine((r) => {
    const span = Date.parse(r.incidentEndUtc) - Date.parse(r.incidentStartUtc);
    return span >= 0 && span <= 86400000;
  }, "时间范围需有序且不超过 24 小时");
export const planSchema = z.strictObject({
  id: z.string().uuid(),
  caseId: z.string().uuid(),
  revision: z.number().int().min(1),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  actionIds: z.array(z.literal("demo.analyze_fixture")).length(1),
  dataScopes: z.array(z.string()),
  policyVersion: z.string(),
  adapterVersion: z.string(),
  scenarioId,
  incidentStartUtc: z.string(),
  incidentEndUtc: z.string(),
});
export const caseSchema = z.strictObject({
  id: z.string().uuid(),
  title: z.string(),
  symptom: z.string(),
  scenarioId,
  incidentStartUtc: z.string(),
  incidentEndUtc: z.string(),
  displayTimezone: z.string(),
  environment: z.string(),
  createdAtUtc: z.string(),
  status: z.enum([
    "draft",
    "awaiting_consent",
    "collecting",
    "completed_partial",
    "interrupted",
  ]),
  plan: planSchema.nullable(),
  report: reportSchema.nullable(),
});
export const consentSchema = z.strictObject({
  token: z.string().uuid(),
  expiresAtUtc: z.string(),
});
export const caseRequestSchema = z.strictObject({ caseId: z.string().uuid() });
export const approveSchema = z.strictObject({
  caseId: z.string().uuid(),
  planId: z.string().uuid(),
  planHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const startSchema = approveSchema.extend({
  consentToken: z.string().uuid(),
});
export const exportRequestSchema = caseRequestSchema.extend({
  format: z.enum(["markdown", "json"]),
});
export const exportResultSchema = z.strictObject({
  filename: z.string(),
  mediaType: z.string(),
  content: z.string(),
});
export const appStatusSchema = z.strictObject({
  version: z.string(),
  mode: z.enum(["native-synthetic", "browser-mock"]),
  modelEnabled: z.literal(false),
  realCollectionEnabled: z.literal(false),
});

export type Evidence = z.infer<typeof evidenceSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;
export type Finding = z.infer<typeof findingSchema>;
export type Report = z.infer<typeof reportSchema>;
export type CaseRecord = z.infer<typeof caseSchema>;
export type Plan = z.infer<typeof planSchema>;
export type CreateCase = z.infer<typeof createCaseSchema>;
export type Consent = z.infer<typeof consentSchema>;
export type ApproveRequest = z.infer<typeof approveSchema>;
export type StartRequest = z.infer<typeof startSchema>;
export type ExportRequest = z.infer<typeof exportRequestSchema>;
export type ExportResult = z.infer<typeof exportResultSchema>;
export type AppStatus = z.infer<typeof appStatusSchema>;
