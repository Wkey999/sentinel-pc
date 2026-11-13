import type { CaseRecord } from "./contracts";

export function isSetupAudit(record: CaseRecord): boolean {
  return (
    (record.diagnostic as { mode?: string } | null)?.mode === "setup_audit" ||
    (!record.diagnostic && /体检/.test(record.title))
  );
}
export function latestAudit(cases: CaseRecord[]): CaseRecord | undefined {
  return [...cases]
    .filter(isSetupAudit)
    .sort((a, b) => Date.parse(b.createdAtUtc) - Date.parse(a.createdAtUtc))[0];
}
export function defaultCaseTitle(
  category: string,
  symptom: string,
  date = new Date(),
): string {
  if (category === "setup_audit") {
    return `一键体检 · ${new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date)}`;
  }
  return (
    Array.from(symptom.trim().replace(/\s+/g, " ")).slice(0, 32).join("") ||
    "新的诊断"
  );
}
