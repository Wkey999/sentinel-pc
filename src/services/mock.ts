// Browser-only interaction double. Native diagnosis is authoritative in sentinel-core.
import rawCatalog from "../../resources/samples.json";
import {
  catalogSchema,
  createCaseSchema,
  type Scenario,
  type Evidence,
  type Finding,
  type Report,
  type CaseRecord,
  type Plan,
  type CreateCase,
  type Consent,
  type ApproveRequest,
  type StartRequest,
  type ExportRequest,
  type ExportResult,
} from "../domain/contracts";

export const samples = catalogSchema.parse(rawCatalog).scenarios;
const clone = <T>(value: T): T => structuredClone(value);
const event = (e: Evidence, provider: string, channel: string, id: number) =>
  e.kind === "windows.event" &&
  e.provider === provider &&
  e.channel === channel &&
  e.eventId === id &&
  e.schemaVersion === 0;

export function analyzeMock(
  scenario: Scenario,
  start: string,
  end: string,
): Report {
  const findings: Finding[] = [];
  const unknowns = ["这些是合成样本，不能用于判断当前电脑的健康或故障根因。"];
  const applicable = scenario.evidence.filter(
    (e) =>
      e.observedAtUtc === null ||
      (Date.parse(e.observedAtUtc) >= Date.parse(start) &&
        Date.parse(e.observedAtUtc) <= Date.parse(end)),
  );
  if (applicable.length !== scenario.evidence.length)
    unknowns.push("部分证据不在所选时间窗口，未用于事件结论。");
  const add = (
    ruleId: string,
    title: string,
    observation: string,
    evidenceIds: string[],
    limitations: string[],
    nextStep: string,
  ) =>
    findings.push({
      id: `finding-${ruleId}-${evidenceIds.join("-")}`,
      ruleId,
      title,
      observation,
      evidenceIds,
      strength: "对记录内容较强；对根因不足",
      limitations,
      nextStep,
    });
  for (const e of applicable) {
    if (event(e, "Microsoft-Windows-Kernel-Power", "System", 41))
      add(
        "WIN-RESTART-001",
        "记录到未正常关机后的启动事件",
        "样本中存在 Kernel-Power 41。它描述未正常关机后的启动情况，不能单独定位原因。",
        [e.id],
        [
          "不能仅凭这条事件判断电源、主板或 CPU 损坏。",
          "BugcheckCode 为 0 也不能排除所有故障。",
        ],
        "先确认当时是否长按电源、断电或蓝屏，再补充同一时间段的记录。",
      );
    if (event(e, "Application Error", "Application", 1000)) {
      add(
        "WIN-APP-001",
        "应用存在异常记录",
        "样本记录了应用异常；故障模块是记录中的线索，不能直接当作根因。",
        [e.id],
        [
          "ntdll.dll 等系统模块可能只是故障表现。",
          "本轮没有排除驱动、插件、应用代码或硬件因素。",
        ],
        "记录程序版本和近期变更；先按一个变量复测，不随意替换系统 DLL。",
      );
      const wer = applicable.find(
        (w) =>
          event(w, "Windows Error Reporting", "Application", 1001) &&
          e.entity !== null &&
          w.entity === e.entity &&
          e.bootSession !== null &&
          w.bootSession === e.bootSession &&
          w.source === e.source &&
          e.observedAtUtc &&
          w.observedAtUtc &&
          Date.parse(w.observedAtUtc) - Date.parse(e.observedAtUtc) >= 0 &&
          Date.parse(w.observedAtUtc) - Date.parse(e.observedAtUtc) <= 120000,
      );
      if (wer)
        add(
          "TIMELINE-APP-001",
          "两条记录符合受限关联条件",
          "同一来源中，同一应用和启动会话的 WER 记录在异常事件后 120 秒内出现，可并列查看。",
          [e.id, wer.id],
          [
            "样本中声明的实体身份与时间关联不证明故障因果。",
            "当前只支持合成样本 schema 0，不代表实际 Windows 版本的格式已验收。",
          ],
          "结合两条记录查看程序身份、异常代码和复现场景。",
        );
    }
    if (e.kind === "storage.health" && e.fields.declaredHealth === "failed")
      add(
        "STORAGE-001",
        "样本声明了存储健康告警",
        "合成报告证据中 declaredHealth 为 failed；这是报告声明，不是本产品实测。",
        [e.id],
        [
          "尚未完成真实 smartctl 或 CrystalDiskInfo 格式验收。",
          "没有测试时间，不能把它关联到本次闪退，也不能预测损坏时间。",
        ],
        "若真实报告出现类似告警，先备份重要资料，再用受支持来源核实，避免自动运行长测。",
      );
  }
  if (!findings.length)
    unknowns.push("本轮没有足够的匹配证据；没有记录不代表没有故障。");
  scenario.coverage
    .filter((c) => c.status !== "available" && c.status !== "empty")
    .forEach((c) => unknowns.push(`${c.source}：${c.detail}`));
  return {
    schemaVersion: 1,
    provenance: "synthetic",
    ruleVersion: "preview-0.1.0",
    generatedAtUtc: new Date().toISOString(),
    findings,
    evidence: clone(scenario.evidence),
    coverage: clone(scenario.coverage),
    unknowns,
  };
}

export class MockService {
  private cases = new Map<string, CaseRecord>();
  private consents = new Map<
    string,
    { caseId: string; hash: string; expires: number; used: boolean }
  >();
  async list(): Promise<CaseRecord[]> {
    return clone([...this.cases.values()].reverse());
  }
  async get(id: string): Promise<CaseRecord> {
    const c = this.cases.get(id);
    if (!c) throw Error("案例不存在或已删除。");
    return clone(c);
  }
  async create(input: CreateCase): Promise<CaseRecord> {
    const r = createCaseSchema.parse(input);
    const sample = samples.find((s) => s.id === r.scenarioId)!;
    const c: CaseRecord = {
      ...r,
      id: crypto.randomUUID(),
      title: sample.title,
      createdAtUtc: new Date().toISOString(),
      status: "draft",
      plan: null,
      report: null,
    };
    this.cases.set(c.id, c);
    return clone(c);
  }
  private async hash(p: Plan): Promise<string> {
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify({ ...p, hash: "" })),
    );
    return [...new Uint8Array(bytes)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  async build(id: string): Promise<CaseRecord> {
    const c = await this.get(id);
    if (c.report) throw Error("已完成案例不能覆盖；请新建一轮。");
    const p: Plan = {
      id: crypto.randomUUID(),
      caseId: c.id,
      revision: (c.plan?.revision ?? 0) + 1,
      hash: "",
      actionIds: ["demo.analyze_fixture"],
      dataScopes: ["仅内置合成样本；不采集本机数据；不联网"],
      policyVersion: "preview-0.1.0",
      adapterVersion: "synthetic-0.1.0",
      scenarioId: c.scenarioId,
      incidentStartUtc: c.incidentStartUtc,
      incidentEndUtc: c.incidentEndUtc,
    };
    p.hash = await this.hash(p);
    c.plan = p;
    c.status = "awaiting_consent";
    this.cases.set(id, c);
    return clone(c);
  }
  private async validate(r: ApproveRequest): Promise<CaseRecord> {
    const c = await this.get(r.caseId);
    if (
      !c.plan ||
      c.plan.id !== r.planId ||
      c.plan.hash !== r.planHash ||
      (await this.hash(c.plan)) !== r.planHash
    )
      throw Error("计划已变化，请重新预览。");
    return c;
  }
  async approve(r: ApproveRequest): Promise<Consent> {
    const c = await this.validate(r);
    if (c.status !== "awaiting_consent") throw Error("当前状态不能批准。");
    const token = crypto.randomUUID();
    const expires = Date.now() + 600000;
    this.consents.set(token, {
      caseId: c.id,
      hash: r.planHash,
      expires,
      used: false,
    });
    return { token, expiresAtUtc: new Date(expires).toISOString() };
  }
  async start(r: StartRequest): Promise<CaseRecord> {
    const c = await this.validate(r);
    const consent = this.consents.get(r.consentToken);
    if (
      !consent ||
      consent.caseId !== c.id ||
      consent.hash !== r.planHash ||
      consent.expires < Date.now()
    )
      throw Error("同意已失效或范围不符。");
    if (consent.used) {
      if (c.report) return c;
      throw Error("同意已使用。");
    }
    if (c.status !== "awaiting_consent") throw Error("当前状态不能启动。");
    consent.used = true;
    c.report = analyzeMock(
      samples.find((s) => s.id === c.scenarioId)!,
      c.incidentStartUtc,
      c.incidentEndUtc,
    );
    c.status = "completed_partial";
    this.cases.set(c.id, c);
    return clone(c);
  }
  async delete(id: string): Promise<void> {
    this.cases.delete(id);
    for (const [key, c] of this.consents)
      if (c.caseId === id) this.consents.delete(key);
  }
  async export(r: ExportRequest): Promise<ExportResult> {
    const c = await this.get(r.caseId);
    if (!c.report) throw Error("请先完成样本分析。");
    const report = clone(c.report);
    const replacements = new Map<string, string>();
    for (const e of report.evidence)
      for (const k of Object.keys(e.fields))
        if (/serial|token|password|username|computername/i.test(k)) {
          const v = e.fields[k]!;
          if (!replacements.has(v))
            replacements.set(v, `REDACTED_${replacements.size + 1}`);
          e.fields[k] = replacements.get(v)!;
        }
    if (r.format === "json")
      return {
        filename: "sentinel-synthetic-report.json",
        mediaType: "application/json",
        content: JSON.stringify(report, null, 2),
      };
    const safe = (s: string) =>
      s
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("[", "\\[")
        .replaceAll("]", "\\]");
    const content = [
      "# Sentinel PC · 合成样本报告",
      "本报告不是本机检测结果。模型关闭。",
      `生成时间：${report.generatedAtUtc}\n规则版本：${report.ruleVersion}`,
      "## 本轮覆盖",
      ...report.coverage.map(
        (v) => `- ${safe(v.source)}：${v.status}；${safe(v.detail)}`,
      ),
      "## 发现与依据",
      ...report.findings.flatMap((f) => [
        `### ${safe(f.title)}`,
        `规则：${f.ruleId}`,
        safe(f.observation),
        `依据：${f.evidenceIds.join(", ")}`,
        `证据强度：${f.strength}`,
        ...f.limitations.map((l) => `- 限制：${safe(l)}`),
        `下一步：${safe(f.nextStep)}`,
      ]),
      "## 不能判断什么",
      ...report.unknowns.map((u) => `- ${safe(u)}`),
      "## 证据出处",
      ...report.evidence.map(
        (e) =>
          `- ${e.id}：${safe(e.source)}；RecordID=${e.recordId ?? "未知"}；时间=${e.observedAtUtc ?? "未知"}`,
      ),
      "默认未附原始文件，也未包含问题描述。预览版脱敏仍需人工检查。",
    ].join("\n\n");
    return {
      filename: "sentinel-synthetic-report.md",
      mediaType: "text/markdown",
      content,
    };
  }
}
