import { z } from "zod";

export const hardwareGroupIds = [
  "cpu",
  "baseboard",
  "memory",
  "graphics",
  "monitors",
  "storage",
  "npu",
  "audio",
  "network",
  "bios",
] as const;
export const hardwareInfoSchema = z.strictObject({
  origin: z.enum(["windows_native", "browser_demo"]),
  collectedAtUtc: z.string(),
  computerModel: z.string(),
  operatingSystem: z.string(),
  groups: z
    .array(
      z.strictObject({
        id: z.enum(hardwareGroupIds),
        label: z.string(),
        status: z.enum(["available", "empty", "unavailable"]),
        items: z
          .array(
            z.strictObject({
              name: z.string(),
              details: z.array(z.string()),
              problem: z.boolean(),
            }),
          )
          .max(64),
      }),
    )
    .length(hardwareGroupIds.length)
    .refine(
      (groups) =>
        groups.every((group, index) => group.id === hardwareGroupIds[index]),
      "硬件信息分组缺失或重复",
    ),
});
export type HardwareInfo = z.infer<typeof hardwareInfoSchema>;

export const scenarioId = z.enum([
  "restart",
  "application",
  "storage",
  "empty",
  "insufficient",
]);
export const categoryId = z.enum([
  "gaming_display",
  "restart_bsod",
  "storage_io",
  "office_peripheral",
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
    "failed",
    "timed_out",
    "cancelled",
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
export const auditCheckResultSchema = z.strictObject({
  checkId: z.string(),
  metric: z.string(),
  objectId: z.string().nullable(),
  assessment: z.string(),
  evidenceIds: z.array(z.string()),
  summary: z.string(),
  limitations: z.array(z.string()),
});
export const reportSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    provenance: z.enum([
      "synthetic",
      "native_collected",
      "imported_report_declared",
      "mixed",
    ]),
    ruleVersion: z.string(),
    generatedAtUtc: z.string(),
    findings: z.array(findingSchema),
    evidence: z.array(evidenceSchema),
    coverage: z.array(coverageSchema),
    unknowns: z.array(z.string()),
    auditChecks: z.array(auditCheckResultSchema).optional(),
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
    scenarioId: scenarioId.optional(),
    category: categoryId.optional(),
    symptom: z.string().trim().min(1).max(1000),
    incidentStartUtc: z.iso.datetime({ offset: true }),
    incidentEndUtc: z.iso.datetime({ offset: true }),
    displayTimezone: z.enum(["Asia/Hong_Kong", "Asia/Shanghai", "UTC"]),
    environment: z.enum(["personal", "workplace", "unknown"]),
    interview: z
      .strictObject({
        frequency: z.string(),
        recentChanges: z.string(),
        reproduction: z.string(),
        answers: z.array(
          z.strictObject({
            questionId: z.string(),
            answer: z.string(),
          }),
        ),
      })
      .optional(),
  })
  .refine((r) => {
    const span = Date.parse(r.incidentEndUtc) - Date.parse(r.incidentStartUtc);
    return span >= 0 && span <= 86400000;
  }, "时间范围需有序且不超过 24 小时");
export const actionSpecSchema = z.strictObject({
  actionId: z.string(),
  description: z.string(),
  risk: z.string(),
  estimatedSeconds: z.number().int().nonnegative(),
  outputLimitBytes: z.number().int().nonnegative(),
  requiresExternalConfirmation: z.boolean(),
  toolToken: z.string().nullable().optional(),
  deviceToken: z.string().nullable().optional(),
});
export const toolCandidateSchema = z.strictObject({
  token: z.string(),
  toolId: z.string(),
  displayPath: z.string(),
  sha256: z.string(),
  version: z.string().nullable().optional(),
  status: z.string(),
  integration: z.string(),
  notice: z.string(),
});
export const planSchema = z.strictObject({
  id: z.string().uuid(),
  caseId: z.string().uuid(),
  revision: z.number().int().min(1),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  actionIds: z.array(z.string()).min(1),
  dataScopes: z.array(z.string()),
  policyVersion: z.string(),
  adapterVersion: z.string(),
  scenarioId: z.string(),
  incidentStartUtc: z.string(),
  incidentEndUtc: z.string(),
  actions: z.array(actionSpecSchema).optional(),
  runId: z.string().nullable().optional(),
  artifactHashes: z.array(z.string()).optional(),
  toolIdentity: toolCandidateSchema.nullable().optional(),
});
export const caseSchema = z.strictObject({
  id: z.string().uuid(),
  title: z.string(),
  symptom: z.string(),
  scenarioId: z.string(),
  incidentStartUtc: z.string(),
  incidentEndUtc: z.string(),
  displayTimezone: z.string(),
  environment: z.string(),
  createdAtUtc: z.string(),
  status: z.enum([
    "draft",
    "awaiting_consent",
    "collecting",
    "cancelling",
    "cancelled",
    "failed",
    "completed",
    "completed_partial",
    "interrupted",
  ]),
  plan: planSchema.nullable(),
  report: reportSchema.nullable(),
  diagnostic: z.unknown().nullable().optional(),
});
export const consentSchema = z.strictObject({
  token: z.string().uuid(),
  expiresAtUtc: z.string(),
});
export const caseRequestSchema = z.strictObject({ caseId: z.string().uuid() });
export const renameCaseSchema = z.strictObject({
  caseId: z.string().uuid(),
  title: z
    .string()
    .trim()
    .min(1)
    .refine(
      (value) =>
        Array.from(value).length <= 80 &&
        !/[\u0000-\u001f\u007f-\u009f]/u.test(value),
      "名称最多 80 个字符，不能包含换行或控制字符",
    ),
});
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
export const backendCapabilitiesSchema = z.strictObject({
  apiVersion: z.number().int(),
  realCollectionEnabled: z.boolean(),
  modelConfigured: z.boolean(),
  supportedCategories: z.array(categoryId),
  reportImportEnabled: z.boolean(),
  asyncRuns: z.boolean(),
  toolExecution: z.string(),
  modelTarget: z.string().nullable(),
  modelProtocol: z.string(),
  modelName: z.string().nullable().optional(),
  setupAuditEnabled: z.boolean().optional(),
});
export const setupAuditRequestSchema = z.strictObject({
  displayTimezone: z.enum(["Asia/Hong_Kong", "Asia/Shanghai", "UTC"]),
  environment: z.enum(["personal", "workplace", "unknown"]),
});
export const modelConfigSchema = z.strictObject({
  provider: z.enum(["chat_completions", "sentinel_json_v1"]).optional(),
  endpoint: z.string().trim().min(1).max(2048),
  model: z.string().trim().min(1).max(128).optional(),
  apiKey: z.string().trim().min(1).max(4096),
});
export const retestRequestSchema = z.strictObject({
  caseId: z.string().uuid(),
  changedVariable: z.string().trim().min(1).max(400),
  userFeedback: z.string().trim().min(1).max(400),
});
export const interviewRequestSchema = z.strictObject({
  symptom: z.string().trim().min(1).max(1000),
  category: categoryId,
  context: z
    .strictObject({
      frequency: z.string(),
      recentChanges: z.string(),
      reproduction: z.string(),
      answers: z.array(
        z.strictObject({
          questionId: z.string(),
          answer: z.string(),
        }),
      ),
    })
    .optional(),
  allowModel: z.boolean(),
});
export const interviewResultSchema = z.strictObject({
  origin: z.string(),
  questions: z.array(
    z.strictObject({
      id: z.string(),
      prompt: z.string(),
    }),
  ),
  fallbackReason: z.string().nullable(),
});
export const explainRequestSchema = z.strictObject({
  caseId: z.string().uuid(),
  allowModel: z.boolean(),
});
export const recommendationSchema = z.strictObject({
  priority: z.number().int().nonnegative(),
  instruction: z.string(),
  expectedResult: z.string(),
  stopCondition: z.string(),
  evidenceIds: z.array(z.string()),
});
export const explanationSchema = z.strictObject({
  origin: z.string(),
  summary: z.string(),
  exclusions: z.array(z.string()),
  recommendations: z.array(recommendationSchema),
  fallbackReason: z.string().nullable(),
  suggestedActionIds: z.array(z.string()).default([]),
});
export const reportFormatSchema = z.enum([
  "smartctl_json",
  "crystal_disk_info_text",
]);
export const importRequestSchema = z.strictObject({
  caseId: z.string().uuid(),
  format: reportFormatSchema,
});

export type Evidence = z.infer<typeof evidenceSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;
export type Finding = z.infer<typeof findingSchema>;
export type AuditCheckResult = z.infer<typeof auditCheckResultSchema>;
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
export type BackendCapabilities = z.infer<typeof backendCapabilitiesSchema>;
export type SetupAuditRequest = z.infer<typeof setupAuditRequestSchema>;
export type ToolCandidate = z.infer<typeof toolCandidateSchema>;
export type ModelConfig = z.infer<typeof modelConfigSchema>;
export type RetestRequest = z.infer<typeof retestRequestSchema>;
export type InterviewRequest = z.infer<typeof interviewRequestSchema>;
export type InterviewResult = z.infer<typeof interviewResultSchema>;
export type ExplainRequest = z.infer<typeof explainRequestSchema>;
export type Explanation = z.infer<typeof explanationSchema>;
export type ReportFormat = z.infer<typeof reportFormatSchema>;
export type ImportRequest = z.infer<typeof importRequestSchema>;
