import { createRoot } from "react-dom/client";
import { useState } from "react";
import { Theme } from "@astryxdesign/core/theme";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import { sentinelTheme } from "../../src/theme";
import { DiagnosePage } from "../../src/pages/DiagnosePage";
import { caseSchema, type Conversation } from "../../src/domain/contracts";
import { diagnostics } from "../../src/services/diagnostics";
import fixtures from "../fixtures/rust-contract.json";
const metrics = [
  "output_adapter",
  "refresh_rate",
  "memory_speed",
  "xmp_expo_profile",
  "power_scheme",
  "game_mode",
  "hags",
  "system_disk_free",
  "pcie_link",
  "thermal_power_limits",
  "memory_channels",
];
const checks = metrics.map((metric, i) => ({
  checkId: "preview-" + i,
  metric,
  objectId: null,
  assessment:
    i === 1
      ? "opportunity"
      : i === 2 || i === 4 || i === 7
        ? "no_issue_observed"
        : "unknown",
  evidenceIds: [],
  summary:
    i === 1
      ? "合成演示：当前 60 Hz，有更高同分辨率模式，需手动核对。"
      : i === 2
        ? "合成演示：配置速率 5600；未低于模块所报值，不表示 XMP 已开启。"
        : i === 4
          ? "合成演示：平衡电源计划，不代表性能异常。"
          : i === 7
            ? "合成演示：系统卷可用 25%，未触发低于 10% 的提醒。"
            : "合成演示：当前来源不足以确认此项。",
  limitations: ["仅用于界面验证，非本机检测。"],
}));
const record = caseSchema.parse({
  ...fixtures[0],
  title: "一键体检（合成界面验收）",
  report: { ...fixtures[0].report, auditChecks: checks },
});
let conversation: Conversation = {
  id: record.id,
  caseId: record.id,
  title: "合成测试",
  messages: [],
  updatedAtUtc: "",
};
diagnostics.getChat = async () => conversation;
diagnostics.cachedHardware = () => undefined;
diagnostics.hardware = async () => {
  throw Error("合成测试不采集本机硬件");
};
function Test() {
  const [capture, setCapture] = useState("尚未发送（无联网）");
  diagnostics.sendChat = async (r) => {
    setCapture(
      JSON.stringify({
        message: r.message,
        caseId: r.caseId,
        allowModel: r.allowModel,
        hardware: r.hardware,
      }),
    );
    const text = r.message.includes("你是谁")
      ? "【合成模型回调】我是哨兵 AI 助手。"
      : r.message.includes("系统")
        ? "【合成模型回调】当前测试没有系统快照，不能猜测系统版本。"
        : "【合成模型回调】这是多轮上下文接口验收，不是真实 API 回答。";
    conversation = {
      ...conversation,
      messages: [
        ...conversation.messages,
        { role: "user", text: r.message, origin: "user" },
        { role: "assistant", text, origin: "model" },
      ],
    };
    return conversation;
  };
  return (
    <Theme theme={sentinelTheme} mode="light">
      <VStack
        height="100dvh"
        width="100%"
        style={{ backgroundColor: "var(--color-background-body)" }}
      >
        <Text weight="bold">合成界面验收 · 不联网 / 不烤机 / 非本机检测</Text>
        <Text aria-label="验收请求" size="sm">
          {capture}
        </Text>
        <DiagnosePage
          capabilities={{
            apiVersion: 3,
            realCollectionEnabled: true,
            modelConfigured: true,
            supportedCategories: [],
            reportImportEnabled: true,
            asyncRuns: true,
            toolExecution: "test_only",
            modelTarget: "https://api.deepseek.com/chat/completions",
            modelProtocol: "chat_completions",
            modelName: "Mock 仅测试",
            setupAuditEnabled: true,
          }}
          activeCase={record}
          conversationId={record.id}
          onChatsChanged={async () => {}}
          onOpenTools={() => setCapture("工具入口已触发")}
          onCaseUpdated={async () => {}}
          onResetCase={() => {}}
          onExportCase={async () => {}}
        />
      </VStack>
    </Theme>
  );
}
createRoot(document.getElementById("app")!).render(<Test />);
