import { invoke, isTauri } from "@tauri-apps/api/core";
import { z } from "zod";
import * as c from "../domain/contracts";
import { MockService } from "./mock";

const native = isTauri();
const mock = new MockService();
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
      () =>
        mock.create({
          category: "gaming_display",
          symptom:
            "帮我全机扫描一遍基础设置、装机乌龙与性能释放（显示器接核显还是独显、刷新率、内存频率、电源计划）",
          incidentStartUtc: new Date(Date.now() - 3600_000).toISOString(),
          incidentEndUtc: new Date().toISOString(),
          displayTimezone: r.displayTimezone,
          environment: r.environment,
        }),
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
  clearModel: () =>
    call("clear_model", undefined, z.null(), async () => null),
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
};
