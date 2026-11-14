// Development-only transport fixture around the unchanged production DiagnosePage.
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { Theme } from "@astryxdesign/core/theme";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import { sentinelTheme } from "../../src/theme";
import { DiagnosePage } from "../../src/pages/DiagnosePage";
import { caseSchema, type CaseRecord } from "../../src/domain/contracts";
import { diagnostics } from "../../src/services/diagnostics";
import raw from "../fixtures/fault-contract.json";

const replays = raw.map((r) => ({
  ...r,
  draft: caseSchema.parse(r.draft),
  planned: caseSchema.parse(r.planned),
  collecting: caseSchema.parse(r.collecting),
  completed: caseSchema.parse(r.completed),
}));
let selected: (typeof replays)[number] | undefined;
let renamed = "";
let started = false;
let events: string[] = [];
let publish = (_value: string) => {};
const trace = (event: string) => {
  events.push(event);
  publish(events.join(" → "));
};
const stage = (record: CaseRecord) => ({
  ...record,
  title: renamed || record.title,
});
diagnostics.cachedHardware = () => undefined;
diagnostics.hardware = async () => {
  throw Error("离线回放禁止本机采集");
};
diagnostics.sendChat = async () => {
  throw Error("离线回放禁止模型请求");
};
diagnostics.getChat = async (id, caseId) => ({
  id,
  caseId,
  title: "",
  messages: [],
  updatedAtUtc: "",
});
diagnostics.create = async (request) => {
  selected = replays.find((r) => r.category === request.category);
  if (!selected || request.scenarioId) throw Error("未按真实分类创建案例");
  if (request.interview?.answers.length !== 3) throw Error("问诊答案不完整");
  started = false;
  renamed = "";
  trace(`create:${request.category}:3answers`);
  return stage(selected.draft);
};
diagnostics.rename = async (r) => {
  renamed = r.title;
  trace("rename");
  return stage(selected!.draft);
};
diagnostics.build = async () => {
  trace("build:Rust-plan");
  return stage(selected!.planned);
};
diagnostics.approve = async (r) => {
  const plan = selected!.planned.plan!;
  if (r.planId !== plan.id || r.planHash !== plan.hash)
    throw Error("计划不匹配");
  trace("approve:fixture");
  return { token: selected!.draft.id, expiresAtUtc: "2099-01-01T00:00:00Z" };
};
diagnostics.start = async (r) => {
  if (
    started ||
    r.consentToken !== selected!.draft.id ||
    r.planHash !== selected!.planned.plan!.hash
  )
    throw Error("重复启动或令牌不匹配");
  started = true;
  trace("start:once");
  return stage(selected!.collecting);
};
diagnostics.get = async () => {
  trace("poll:Rust-report");
  return stage(selected!.completed);
};

function Test() {
  const [active, setActive] = useState<CaseRecord | null>(null);
  const [capture, setCapture] = useState("尚未运行");
  const [key, setKey] = useState(0);
  publish = setCapture;
  return (
    <Theme theme={sentinelTheme} mode="light">
      <VStack
        height="100dvh"
        width="100%"
        style={{ backgroundColor: "var(--color-background-body)" }}
      >
        <Text weight="bold">
          合成故障回放 · Rust 规则结果 / 模拟界面传输 · 不采集本机、不联网
        </Text>
        <Text aria-label="回放流程" size="sm">
          {capture}
        </Text>
        <Button
          label="清空测试会话"
          size="sm"
          variant="secondary"
          onClick={() => {
            setActive(null);
            events = [];
            setCapture("尚未运行");
            setKey(key + 1);
          }}
        />
        <DiagnosePage
          key={key}
          capabilities={{
            apiVersion: 3,
            realCollectionEnabled: true,
            modelConfigured: false,
            modelTarget: null,
            modelProtocol: "chat_completions",
            supportedCategories: [
              "gaming_display",
              "restart_bsod",
              "storage_io",
              "office_peripheral",
            ],
            reportImportEnabled: true,
            asyncRuns: true,
            toolExecution: "synthetic_replay",
            setupAuditEnabled: false,
          }}
          activeCase={active}
          conversationId="00000000-0000-4000-8000-000000000001"
          onChatsChanged={async () => {}}
          onOpenTools={() => trace("tools:manual-only")}
          onCaseUpdated={async (record) => {
            setActive(record);
          }}
          onResetCase={() => setActive(null)}
          onExportCase={async () => {
            trace("export:covered-in-Rust");
          }}
        />
      </VStack>
    </Theme>
  );
}
createRoot(document.getElementById("app")!).render(<Test />);
