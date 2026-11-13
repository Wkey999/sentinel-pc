import { invoke, isTauri } from "@tauri-apps/api/core";
import { z } from "zod";
import * as c from "../domain/contracts";
import { MockService } from "./mock";
import { hardwareDemo } from "./hardware-demo";
import { createHardwareCache } from "./hardware-cache";

const native = isTauri();
const mock = new MockService();
const hardwareCache = createHardwareCache({
  origin: native ? "windows_native" : "browser_demo",
  storage: () => localStorage,
  load: () =>
    call("get_hardware_info", undefined, c.hardwareInfoSchema, async () =>
      hardwareDemo(),
    ),
});
// Native failures never silently switch to Mock data.
async function call<T>(
  command: string,
  request: unknown,
  schema: z.ZodType<T>,
  fallback: () => Promise<unknown>,
): Promise<T> {
  const result = native
    ? await invoke(command, request === undefined ? {} : { request })
    : await fallback();
  return schema.parse(result);
}
export const diagnostics = {
  hardware: hardwareCache.get,
  cachedHardware: hardwareCache.peek,
  hardwareIsFresh: hardwareCache.isFresh,
  status: () =>
    call("get_app_status", undefined, c.appStatusSchema, async () => ({
      version: "0.1.0",
      mode: "browser-mock",
      modelEnabled: false,
      realCollectionEnabled: false,
    })),
  capabilities: () =>
    call(
      "get_backend_capabilities",
      undefined,
      c.backendCapabilitiesSchema,
      async () => ({
        apiVersion: 1,
        realCollectionEnabled: false,
        modelConfigured: false,
        supportedCategories: [
          "gaming_display",
          "restart_bsod",
          "storage_io",
          "office_peripheral",
        ],
        reportImportEnabled: false,
        asyncRuns: false,
        toolExecution: "browser_mock",
        modelTarget: null,
        modelProtocol: "chat_completions",
        modelName: null,
        setupAuditEnabled: false,
      }),
    ),
  createSetupAudit: (r: c.SetupAuditRequest) =>
    call(
      "create_setup_audit",
      c.setupAuditRequestSchema.parse(r),
      c.caseSchema,
      () => mock.createSetupAudit(r),
    ),
  configureModel: (r: c.ModelConfig) =>
    call(
      "configure_model",
      c.modelConfigSchema.parse(r),
      z.null(),
      async () => {
        throw new Error("浏览器预览模式无法保存加密凭据，请在桌面端使用。");
      },
    ),
  clearModel: () => call("clear_model", undefined, z.null(), async () => null),
  probeTools: (toolboxDirectory?: string) =>
    call(
      "probe_tools",
      { toolboxDirectory: toolboxDirectory ?? null },
      z.array(c.toolCandidateSchema),
      async () => [],
    ),
  createRetestRun: (r: c.RetestRequest) =>
    call(
      "create_retest_run",
      c.retestRequestSchema.parse(r),
      c.caseSchema,
      () => mock.get(r.caseId),
    ),
  cancelRun: (r: { caseId: string; runId: string }) =>
    call("cancel_run", r, c.caseSchema, () => mock.get(r.caseId)),
  assistInterview: (r: c.InterviewRequest) =>
    call(
      "assist_interview",
      c.interviewRequestSchema.parse(r),
      c.interviewResultSchema,
      async () => ({
        origin: "local_rule",
        questions: [],
        fallbackReason: "browser_mock",
      }),
    ),
  explainReport: (r: c.ExplainRequest) =>
    call(
      "explain_report",
      c.explainRequestSchema.parse(r),
      c.explanationSchema,
      async () => ({
        origin: "local_rule",
        summary: "浏览器预览模式：当前仅展示本地确定性规则与优先级指南。",
        exclusions: [],
        recommendations: [],
        fallbackReason: "browser_mock",
        suggestedActionIds: [],
      }),
    ),
  importReport: (r: c.ImportRequest) =>
    call(
      "import_report",
      c.importRequestSchema.parse(r),
      c.caseSchema.nullable(),
      async () => {
        throw new Error("请在桌面端应用中使用本地检测报告导入功能。");
      },
    ),
  buildImportPlan: (id: string) =>
    call(
      "build_import_plan",
      c.caseRequestSchema.parse({ caseId: id }),
      c.caseSchema,
      () => mock.build(id),
    ),
  create: (r: c.CreateCase) =>
    call("create_case", c.createCaseSchema.parse(r), c.caseSchema, () =>
      mock.create(r),
    ),
  list: () =>
    call("list_cases", undefined, z.array(c.caseSchema), () => mock.list()),
  get: (id: string) =>
    call(
      "get_case",
      c.caseRequestSchema.parse({ caseId: id }),
      c.caseSchema,
      () => mock.get(id),
    ),
  build: (id: string) =>
    call(
      "build_plan",
      c.caseRequestSchema.parse({ caseId: id }),
      c.caseSchema,
      () => mock.build(id),
    ),
  approve: (r: c.ApproveRequest) =>
    call("approve_plan", c.approveSchema.parse(r), c.consentSchema, () =>
      mock.approve(r),
    ),
  start: (r: c.StartRequest) =>
    call("start_plan", c.startSchema.parse(r), c.caseSchema, () =>
      mock.start(r),
    ),
  rename: (request: { caseId: string; title: string }) => {
    const r = c.renameCaseSchema.parse(request);
    return call("rename_case", r, c.caseSchema, () =>
      mock.rename(r.caseId, r.title),
    );
  },
  delete: (id: string) =>
    call(
      "delete_case",
      c.caseRequestSchema.parse({ caseId: id }),
      z.null(),
      async () => {
        await mock.delete(id);
        return null;
      },
    ),
  export: (r: c.ExportRequest) =>
    call(
      "export_case",
      c.exportRequestSchema.parse(r),
      c.exportResultSchema,
      () => mock.export(r),
    ),
  openWindowsSettings: (uri: string) =>
    call("open_windows_settings", { uri }, z.null(), async () => {
      throw new Error(
        "浏览器预览模式无法跳转本机 Windows 设置，请在桌面端使用。",
      );
    }),
};
