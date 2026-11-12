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
