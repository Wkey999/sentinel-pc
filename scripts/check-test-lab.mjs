// Node 24 executes the repository's TypeScript contract directly; no extra package is installed.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { caseSchema, reportSchema } from "../src/domain/contracts.ts";

const directory = resolve(process.argv[2] ?? "private-reports/test-lab/latest");
const scenarios = JSON.parse(readFileSync(join(directory, "scenarios.json"), "utf8"));
const checks = scenarios.map((s) => {
  const parsed = caseSchema.safeParse(s.record);
  return {
    id: s.id, title: s.title, rulesPassed: s.rulesPassed, contractPassed: parsed.success,
    errors: parsed.success ? [] : parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  };
});
const livePath = join(directory, "live-report.json");
let live = null;
if (existsSync(livePath)) {
  const report = JSON.parse(readFileSync(livePath, "utf8"));
  // Export includes explanation/comparison/retests beyond the IPC Report DTO.
  const { explanation, comparison, retests, ...ipcReport } = report;
  const parsed = reportSchema.safeParse(ipcReport);
  live = { contractPassed: parsed.success, errors: parsed.success ? [] : parsed.error.issues, coverage: report.coverage,
    checks: report.auditChecks ?? [], findingCount: report.findings.length };
}
const result = {
  generatedAt: new Date().toISOString(), source: "current repository source; not an injected production environment",
  scenarios: checks, live, rulesPassed: checks.filter((s) => s.rulesPassed).length,
  contractsPassed: checks.filter((s) => s.contractPassed).length,
};
writeFileSync(join(directory, "contract-results.json"), JSON.stringify(result, null, 2));
let metadata = {};
if (existsSync(join(directory, "run-metadata.json"))) {
  metadata = JSON.parse(readFileSync(join(directory, "run-metadata.json"), "utf8").replace(/^\uFEFF/, ""));
}
const oneLine = (v) => String(v ?? "未记录").replace(/[|\r\n]/g, " ");
const status = (v) => v ? "通过" : "失败";
const lines = [
  "# 哨兵：单台笔记本测试实验室", "", `生成时间：${result.generatedAt}（UTC）`, "",
  "本目录的模拟场景仅回放输入到当前 Rust 规则，再用当前前端 Zod 校验实际序列化结果。它们不是这台电脑的故障，也不是对封包 EXE 注入硬件环境。", "",
  "## 本轮结果", "", `- 合成规则：${result.rulesPassed}/${checks.length} 通过。`,
  `- 前后端契约：${result.contractsPassed}/${checks.length} 通过。`,
  `- 本机只读采集：${live ? `已执行；导出报告契约${status(live.contractPassed)}` : "本轮未执行；使用 -Live 单独开启"}。`,
  `- 自动化回归：${oneLine(metadata.regression)}`, "",
  "## 24 个独立模拟环境", "", "| 场景 | 规则 | 前端接收 | 查看报告 |", "| --- | --- | --- | --- |",
  ...checks.map((s) => `| ${oneLine(s.title)} | ${status(s.rulesPassed)} | ${status(s.contractPassed)} | [${s.id}](${s.id}.md) |`),
  "", "## 本轮发现的问题", "",
];
const failed = checks.filter((s) => !s.contractPassed || !s.rulesPassed);
if (!failed.length) lines.push("本轮合成输入和契约检查没有发现失败；这不替代其他硬件实测。");
for (const s of failed) {
  const details=[...new Set(s.errors.map((e) => `${e.path.replace(/\.\d+\./g,".*.")}: ${e.message}`))];
  lines.push(`- ${s.id}：${details.join("；") || "规则不符合预期，见 scenarios.json"}`);
}
if (live) {
  lines.push("", "## 当前笔记本：真实只读采集", "", "| 来源 | 状态 |", "| --- | --- |",
    ...live.coverage.map((c) => `| ${oneLine(c.source)} | ${oneLine(c.status)} |`),
    "", `报告中有 ${live.checks.length} 个子结果、${live.findingCount} 条提醒；未知项不计作通过。`, "",
    "查看 [脱敏真实报告](live-report.md)。未导出原始 EDID、原始附件、个人文件或模型 Key。"
  );
}
lines.push("", "## 封包与源码的区别", "",
  `- 本次记录的桌面初版 SHA256：${oneLine(metadata.releaseSha256)}`, `- 当前 Windows：${oneLine(metadata.windowsBuild)}`,
  `- 当前进程管理员角色：${oneLine(metadata.isAdmin)}`,
  "- 场景规则和契约检查运行的是当前源码和隔离的内存数据库；没有将模拟案例注入桌面数据库。封包 UI 测试另见 QA_SESSION.md，真实体检会正常新增案例；本轮不重打包或替换 EXE。",
  "", "## 一台电脑怎样继续测", "",
  "1. 双击项目根目录的「运行测试实验室.cmd」，重放全部场景并收集一次本机只读结果。",
  "2. 普通回归：powershell -NoProfile -File scripts/test-lab.ps1 -Full。加 -Live 才会采集本机数据。",
  "3. 在桌面哨兵中点击一键体检 → 授权 → 查看结果 → 覆盖与未知 → 导出 → 关闭重开验证历史。",
  "4. 不插外设也能做全部合成回放。以后若已有外接屏/扩展坞，可手动接入后再体检；一次只改变一个连接，记录前后结果。",
  "5. 不需要改 BIOS、切显卡模式、填满磁盘、降内存速率、制造蓝屏、关闭防护或启用付费模型来凑场景。",
  "", "## 尚未验证的范围", "",
  "- 其他真实机器、不同 Windows/驱动、真实主板误插、各类 USB 扩展坞、混合显卡 MUX 的硬件行为。",
  "- PCIe 与热传感器当前未实现可靠采集；显示 unknown/unsupported 是覆盖缺口，不是验收通过。",
  "- DeepSeek 实际 HTTPS/账号计费未测试；回归只使用传输 Mock。没有关闭网络或改代理来模拟离线。",
  "- 模拟报告不能作为真实硬件验收、性能提升或故障确诊的证据。", ""
);
writeFileSync(join(directory, "TEST_REPORT.md"), lines.join("\n"));
console.log(`Rules ${result.rulesPassed}/${checks.length}; contracts ${result.contractsPassed}/${checks.length}; report: ${join(directory, "TEST_REPORT.md")}`);
if (failed.length || live?.contractPassed === false) process.exitCode = 1;
