import { useMemo, useState, type CSSProperties } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Divider } from "@astryxdesign/core/Divider";
import {
  ChatComposer,
  ChatLayout,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatMessageMetadata,
  ChatSystemMessage,
  ChatToolCalls,
} from "@astryxdesign/core/Chat";
import { Icon } from "@astryxdesign/core/Icon";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { ResizeHandle, useResizable } from "@astryxdesign/core/Resizable";
import { Selector } from "@astryxdesign/core/Selector";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot, type StatusDotVariant } from "@astryxdesign/core/StatusDot";
import { Step, Stepper } from "@astryxdesign/core/Stepper";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from "@astryxdesign/core/Table";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Token } from "@astryxdesign/core/Token";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import {
  ArrowPathIcon,
  BoltIcon,
  CheckCircleIcon,
  ComputerDesktopIcon,
  DocumentArrowDownIcon,
  PlusIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import type {
  AppStatus,
  BackendCapabilities,
  CaseRecord,
} from "../domain/contracts";
import {
  buildConsolidatedSymptom,
  CATEGORY_PRESETS,
  detectCategoryFromText,
  getFollowupQuestions,
  getPrioritizedNextSteps,
  SETUP_AUDIT_PRESET,
  type InterviewAnswer,
  type SymptomCategory,
} from "../domain/interview";
import { diagnostics } from "../services/diagnostics";

interface DiagnosePageProps {
  status?: AppStatus;
  capabilities?: BackendCapabilities;
  activeCase: CaseRecord | null;
  onCaseUpdated: (record: CaseRecord) => Promise<void>;
  onResetCase: () => void;
  onExportCase: (caseId: string, format: "markdown" | "json") => Promise<void>;
}

interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  toolCalls?: Array<{
    key: string;
    name: string;
    target: string;
    status: "complete" | "running" | "error";
    duration?: string;
    resultDetail?: string;
  }>;
}

interface RetestEntry {
  id: string;
  changedVariable: string;
  outcome: string;
  recordedAt: string;
}

const COVERAGE_STATUS_META: Record<
  string,
  { label: string; dot: StatusDotVariant }
> = {
  available: { label: "已采集（可用）", dot: "success" },
  empty: { label: "结果为空", dot: "neutral" },
  missing: { label: "未提供", dot: "warning" },
  unsupported: { label: "尚未支持", dot: "warning" },
  permission_denied: { label: "权限不足", dot: "error" },
  truncated: { label: "输出截断", dot: "warning" },
  failed: { label: "采集失败", dot: "error" },
  timed_out: { label: "采集超时", dot: "warning" },
  cancelled: { label: "已取消", dot: "neutral" },
};

const rootStyle: CSSProperties = {
  height: "100%",
  width: "100%",
};

const chatColumnStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: "100%",
};

const chatLayoutStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
};

const panelScrollStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
};

export function DiagnosePage({
  status,
  capabilities,
  activeCase,
  onCaseUpdated,
  onResetCase,
  onExportCase,
}: DiagnosePageProps) {
  const [category, setCategory] = useState<SymptomCategory>("gaming_display");
  const [environment, setEnvironment] = useState<
    "personal" | "workplace" | "unknown"
  >("personal");
  const [timeRangeChoice, setTimeRangeChoice] = useState<string>("recent_1h");
  const [composerText, setComposerText] = useState("");
  const [initialSymptom, setInitialSymptom] = useState("");
  const [answers, setAnswers] = useState<InterviewAnswer[]>([]);
  const [interviewStarted, setInterviewStarted] = useState(false);
  const [planBuiltReady, setPlanBuiltReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activeRun, setActiveRun] = useState<{
    caseId: string;
    runId: string;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [panelTab, setPanelTab] = useState<string>("summary");
  const [expandedEvidenceId, setExpandedEvidenceId] = useState<string | null>(
    null,
  );
  const [retestVariable, setRetestVariable] = useState("");
  const [retestOutcome, setRetestOutcome] = useState("问题不再复现（已改善）");
  const [retestHistory, setRetestHistory] = useState<RetestEntry[]>([]);

  const resizable = useResizable({
    axis: "horizontal",
    edge: "start",
    defaultSize: 440,
    minSize: 340,
    maxSize: 640,
  });

  const questions = useMemo(() => getFollowupQuestions(category), [category]);
  const currentQuestionIndex = answers.length;
  const currentQuestion =
    interviewStarted && currentQuestionIndex < questions.length
      ? questions[currentQuestionIndex]
      : null;
  const interviewCompleted =
    interviewStarted && currentQuestionIndex >= questions.length;

  const currentStepIndex = useMemo(() => {
    if (retestHistory.length > 0) return 3;
    if (activeCase?.report) return 2;
    if (interviewCompleted || planBuiltReady) return 1;
    return 0;
  }, [activeCase, interviewCompleted, planBuiltReady, retestHistory.length]);

  const turns = useMemo<ChatTurn[]>(() => {
    if (activeCase && !interviewStarted) {
      return [
        {
          id: "loaded-case-user",
          role: "user",
          text: activeCase.symptom,
        },
        {
          id: "loaded-case-assistant",
          role: "assistant",
          text: activeCase.report
            ? `已载入历史案例「${activeCase.title}」。右侧面板展示了已保存的观察结论、证据边界与下一步排查指南；你可以在右侧“复测对比”中记录单变量调整后的变化。`
            : `已载入未完成案例「${activeCase.title}」，你可以继续完成授权检查或重新开启问诊。`,
          toolCalls: activeCase.report
            ? [
                {
                  key: "load-fixture",
                  name: "demo.analyze_fixture",
                  target: `scenario=${activeCase.scenarioId}`,
                  status: "complete",
                  duration: "0.2s",
                  resultDetail: `共关联 ${activeCase.report.evidence.length} 条证据，产出 ${activeCase.report.findings.length} 条观察结论`,
                },
              ]
            : undefined,
        },
      ];
    }

    const list: ChatTurn[] = [];
    if (!interviewStarted) return list;

    list.push({
      id: "turn-init-user",
      role: "user",
      text: initialSymptom,
    });

    questions.forEach((q, idx) => {
      if (idx <= answers.length) {
        list.push({
          id: `turn-q-${q.id}`,
          role: "assistant",
          text: `${q.prompt}（提示：${q.hint}）`,
        });
      }
      const ans = answers[idx];
      if (ans) {
        list.push({
          id: `turn-a-${q.id}`,
          role: "user",
          text: ans.answer,
        });
      }
    });

    if (interviewCompleted && !activeCase?.report) {
      list.push({
        id: "turn-plan-ready",
        role: "assistant",
        text:
          category === "setup_audit"
            ? "已进入【傻瓜体检模式】，跳过繁琐追问！我为你准备好了“全机基础设置与性能释放只读检查计划”（重点查显示器是否插错主板口、高刷是否锁 60Hz、内存 XMP 与电源计划，不修改任何系统设置）。请确认下方的计划卡片。"
            : "关键上下文已经问清楚了！我已经为你准备好了本轮“套餐式只读检查计划”（一次性授权执行，不修改系统设置）。请确认下方的计划卡片。",
      });
    }

    if (activeCase?.report) {
      const isSynthetic = activeCase.report.provenance === "synthetic";
      const isPartial = activeCase.status === "completed_partial";
      const isCancelled = activeCase.status === "cancelled";
      const isFailed = activeCase.status === "failed";
      const auditCount = activeCase.report.auditChecks?.length ?? 0;
      const diagRuns = (
        activeCase.diagnostic as
          | {
              runs?: Array<{
                tasks?: Array<{
                  actionId: string;
                  status: string;
                  detail: string;
                }>;
              }>;
            }
          | null
          | undefined
      )?.runs;
      const latestTasks = diagRuns?.[diagRuns.length - 1]?.tasks ?? [];
      const realCalls =
        latestTasks.length > 0
          ? latestTasks.map((t, idx) => ({
              key: `${t.actionId}-${idx}`,
              name: t.actionId,
              target: t.detail || t.actionId,
              status:
                t.status === "completed" || t.status === "available"
                  ? ("complete" as const)
                  : ("error" as const),
              duration: t.status,
              resultDetail: `状态=${t.status} | 证据=${activeCase.report!.evidence.length}`,
            }))
          : activeCase.plan?.actions && activeCase.plan.actions.length > 0
            ? activeCase.plan.actions.map((act, idx) => ({
                key: `${act.actionId}-${idx}`,
                name: act.actionId,
                target: act.description,
                status: "complete" as const,
                duration: `~${act.estimatedSeconds}s`,
                resultDetail: `风险=${act.risk} | 证据=${activeCase.report!.evidence.length}`,
              }))
            : [
                {
                  key: "native-collect",
                  name: "windows.system_snapshot",
                  target: `mode=${activeCase.report.provenance}`,
                  status: "complete" as const,
                  duration: "已执行",
                  resultDetail: `证据=${activeCase.report.evidence.length} | 体检项=${auditCount} | 未知项=${activeCase.report.unknowns.length}`,
                },
              ];

      const summaryLead = isSynthetic
        ? `检查已完成（当前为离线合成演示模式）。我已将技术日志与边界限制整理到右侧诊断面板：共发现 ${activeCase.report.findings.length} 条关键观察，并为你排好了低成本排查优先级。`
        : isCancelled
          ? "本轮检查已取消，右侧仅展示取消前已保存的证据与未知项说明。"
          : isFailed
            ? "本轮检查未能顺利采集到可用数据，请查看右侧“覆盖与未知”中的失败原因。"
            : isPartial
              ? `本轮套餐执行结束（部分项目暂不支持或受限，未覆盖项不视为“已通过”）。右侧已整理 ${auditCount > 0 ? `${auditCount} 项体检子结果、` : ""}${activeCase.report.findings.length} 条关键观察与边界说明。`
              : `本机真实扫描已完成！右侧诊断面板已列出 ${auditCount > 0 ? `${auditCount} 项设置与性能释放体检结果、` : ""}${activeCase.report.findings.length} 条关键观察及优先级指南。`;

      list.push({
        id: "turn-executed",
        role: "assistant",
        text: summaryLead,
        toolCalls: isSynthetic
          ? [
              {
                key: "sys-snap",
                name: "demo.analyze_fixture",
                target: `scenario=${activeCase.scenarioId} · 窗口=${timeRangeChoice}`,
                status: "complete",
                duration: "0.3s",
                resultDetail: `provenance=${activeCase.report.provenance} | 证据=${activeCase.report.evidence.length} | 未知项=${activeCase.report.unknowns.length}`,
              },
            ]
          : realCalls,
      });
    }

    return list;
  }, [
    activeCase,
    answers,
    initialSymptom,
    interviewCompleted,
    interviewStarted,
    questions,
    timeRangeChoice,
  ]);

  function startNewDiagnosis(text: string, presetCategory?: SymptomCategory) {
    const trimmed = text.trim();
    if (!trimmed) return;
    onResetCase();
    const detected = presetCategory ?? detectCategoryFromText(trimmed);
    setCategory(detected);
    setInitialSymptom(trimmed);
    setAnswers([]);
    setInterviewStarted(true);
    setPlanBuiltReady(detected === "setup_audit");
    setErrorMsg("");
    setComposerText("");
    setRetestHistory([]);
  }

  function startQuickAudit() {
    startNewDiagnosis(SETUP_AUDIT_PRESET.examplePrompt, "setup_audit");
  }

  function submitFollowupAnswer(answerText: string) {
    if (!currentQuestion) return;
    const trimmed = answerText.trim();
    if (!trimmed) return;
    setAnswers((prev) => [
      ...prev,
      {
        questionId: currentQuestion.id,
        question: currentQuestion.prompt,
        answer: trimmed,
      },
    ]);
    setComposerText("");
    if (answers.length + 1 >= questions.length) {
      setPlanBuiltReady(true);
    }
  }

  function handleComposerSubmit(value: string) {
    if (!value.trim()) return;
    if (!interviewStarted && !activeCase) {
      startNewDiagnosis(value);
      return;
    }
    if (currentQuestion) {
      submitFollowupAnswer(value);
    }
  }

  async function handleApproveAndRunPackage() {
    if (busy) return;
    setBusy(true);
    setErrorMsg("");
    try {
      const preset =
        category === "setup_audit"
          ? SETUP_AUDIT_PRESET
          : CATEGORY_PRESETS.find((p) => p.id === category) ??
            CATEGORY_PRESETS[0]!;
      const now = new Date();
      const startMs =
        timeRangeChoice === "recent_1h"
          ? now.getTime() - 3600_000
          : timeRangeChoice === "today"
            ? now.getTime() - 12 * 3600_000
            : now.getTime() - 24 * 3600_000;
      const consolidated = buildConsolidatedSymptom(initialSymptom, answers);
      const useSetupAudit =
        category === "setup_audit" && Boolean(capabilities?.setupAuditEnabled);
      const useNativeV2 = Boolean(capabilities?.realCollectionEnabled);
      const nativeCategory =
        category === "setup_audit" ? "gaming_display" : category;

      const created = useSetupAudit
        ? await diagnostics.createSetupAudit({
            displayTimezone: "Asia/Shanghai",
            environment,
          })
        : await diagnostics.create(
            useNativeV2
              ? {
                  category: nativeCategory,
                  symptom: consolidated,
                  incidentStartUtc: new Date(startMs).toISOString(),
                  incidentEndUtc: now.toISOString(),
                  displayTimezone: "Asia/Shanghai",
                  environment,
                  interview: {
                    frequency: timeRangeChoice,
                    recentChanges: answers[2]?.answer ?? "",
                    reproduction: answers[0]?.answer ?? "",
                    answers: answers.map((a) => ({
                      questionId: a.questionId,
                      answer: a.answer,
                    })),
                  },
                }
              : {
                  scenarioId: preset.mappedScenarioId,
                  symptom: consolidated,
                  incidentStartUtc: new Date(startMs).toISOString(),
                  incidentEndUtc: now.toISOString(),
                  displayTimezone: "Asia/Shanghai",
                  environment,
                },
          );

      const withPlan = await diagnostics.build(created.id);
      if (!withPlan.plan) {
        throw new Error("未能生成检查计划。");
      }
      const consent = await diagnostics.approve({
        caseId: withPlan.id,
        planId: withPlan.plan.id,
        planHash: withPlan.plan.hash,
      });
      let result = await diagnostics.start({
        caseId: withPlan.id,
        planId: withPlan.plan.id,
        planHash: withPlan.plan.hash,
        consentToken: consent.token,
      });
      if (withPlan.plan.runId) {
        setActiveRun({ caseId: withPlan.id, runId: withPlan.plan.runId });
      }
      for (
        let i = 0;
        i < 100 &&
        (result.status === "collecting" || result.status === "cancelling");
        i += 1
      ) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        result = await diagnostics.get(result.id);
      }
      await onCaseUpdated(result);
      setPanelTab("summary");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "执行检查计划时发生错误。");
    } finally {
      setActiveRun(null);
      setBusy(false);
    }
  }

  async function handleCancelActiveRun() {
    if (!activeRun) return;
    try {
      await diagnostics.cancelRun(activeRun);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "取消检查失败。");
    }
  }

  async function handleRecordRetest() {
    const trimmedVar = retestVariable.trim();
    if (!trimmedVar) return;
    if (activeCase?.diagnostic) {
      try {
        const updated = await diagnostics.createRetestRun({
          caseId: activeCase.id,
          changedVariable: trimmedVar,
          userFeedback: retestOutcome,
        });
        await onCaseUpdated(updated);
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : "创建复测记录失败。");
        return;
      }
    }
    setRetestHistory((prev) => [
      {
        id: `retest-${Date.now()}`,
        changedVariable: trimmedVar,
        outcome: retestOutcome,
        recordedAt: new Date().toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      },
      ...prev,
    ]);
    setRetestVariable("");
  }

  function handleResetAll() {
    setInterviewStarted(false);
    setInitialSymptom("");
    setAnswers([]);
    setPlanBuiltReady(false);
    setErrorMsg("");
    setRetestHistory([]);
    onResetCase();
  }

  const showSplitWorkspace = interviewStarted || Boolean(activeCase);
  const guidedSteps = useMemo(() => getPrioritizedNextSteps(category), [category]);

  return (
    <Layout
      height="fill"
      content={
        <LayoutContent padding={0}>
          {!showSplitWorkspace ? (
            <Layout
              height="fill"
              contentWidth={820}
              content={
                <LayoutContent padding={6}>
                  <VStack gap={8} hAlign="center">
                    <VStack gap={3} hAlign="center">
                      <Icon icon={ShieldCheckIcon} size="lg" />
                      <Heading level={1}>电脑出了什么问题？</Heading>
                      <Text color="secondary" justify="center">
                        先说一句你看到的现象就行，不用懂术语。我会一步步问清楚，再给你一份有依据、讲边界的排查方案。
                      </Text>
                    </VStack>

                    <VStack gap={3} hAlign="center">
                      <Button
                        variant="primary"
                        size="lg"
                        label="一键傻瓜体检（查插错口 / 锁 60Hz / 性能释放）"
                        icon={<Icon icon={BoltIcon} size="sm" />}
                        onClick={startQuickAudit}
                      />
                      <Text type="supporting" color="secondary" justify="center">
                        免打字免问诊：直接扫描显示器是否接错主板口、高刷是否锁 60Hz、内存 XMP 与电源计划
                      </Text>
                    </VStack>

                    <VStack gap={4} width="100%">
                      <ChatComposer
                        value={composerText}
                        onChange={setComposerText}
                        placeholder="或者直接描述具体症状：例如玩游戏时屏幕突然黑一下，过会儿游戏就闪退了…"
                        onSubmit={handleComposerSubmit}
                      />
                      <HStack gap={2} wrap="wrap" hAlign="center">
                        {CATEGORY_PRESETS.map((preset) => (
                          <Token
                            key={preset.id}
                            size="lg"
                            label={preset.label}
                            onClick={() =>
                              startNewDiagnosis(preset.examplePrompt, preset.id)
                            }
                          />
                        ))}
                      </HStack>
                    </VStack>

                    <HStack gap={3} wrap="wrap" hAlign="center" vAlign="end">
                      <Selector
                        label="电脑类型"
                        size="sm"
                        value={environment}
                        onChange={(v) =>
                          setEnvironment(
                            v as "personal" | "workplace" | "unknown",
                          )
                        }
                        options={[
                          { value: "personal", label: "个人家用 / 游戏电脑" },
                          { value: "workplace", label: "办公 / 公司设备" },
                          { value: "unknown", label: "不确定" },
                        ]}
                      />
                      <Selector
                        label="大致什么时候发生"
                        size="sm"
                        value={timeRangeChoice}
                        onChange={setTimeRangeChoice}
                        options={[
                          { value: "recent_1h", label: "刚刚（最近 1 小时）" },
                          { value: "today", label: "今天之内" },
                          { value: "unknown", label: "记不清（扩大到 24 小时）" },
                        ]}
                      />
                    </HStack>

                    <Text type="supporting" color="secondary" justify="center">
                      {status?.mode === "native-synthetic"
                        ? "当前为桌面预览：使用内置合成样本演示流程，尚未读取本机真实日志。"
                        : "当前为浏览器演示：使用内置合成样本，刷新后数据清空，尚未读取真实日志。"}
                    </Text>
                  </VStack>
                </LayoutContent>
              }
            />
          ) : (
            <HStack height="100%" width="100%" style={rootStyle}>
              {/* 左栏：持续追问对话流 + 套餐授权 */}
              <VStack style={chatColumnStyle}>
                <Toolbar
                  label="问诊工具栏"
                  startContent={
                    <HStack gap={2} vAlign="center">
                      <Icon icon={ComputerDesktopIcon} size="sm" />
                      <Heading level={4}>
                        {activeCase
                          ? activeCase.title
                          : category === "setup_audit"
                            ? SETUP_AUDIT_PRESET.label
                            : CATEGORY_PRESETS.find((c) => c.id === category)
                                ?.label ?? "智能问诊"}
                      </Heading>
                      <Token
                        size="sm"
                        color={activeCase?.report ? "green" : "blue"}
                        label={
                          activeCase?.report
                            ? "已完成分析"
                            : interviewCompleted
                              ? "待单次授权"
                              : `追问 ${Math.min(answers.length + 1, questions.length)}/${questions.length}`
                        }
                      />
                    </HStack>
                  }
                  endContent={
                    <Button
                      label="新开一轮"
                      variant="ghost"
                      size="sm"
                      icon={<Icon icon={PlusIcon} size="sm" />}
                      onClick={handleResetAll}
                    />
                  }
                />
                <Divider />

                {errorMsg ? (
                  <Banner
                    status="error"
                    title="操作未能完成"
                    description={errorMsg}
                    isDismissable
                    onDismiss={() => setErrorMsg("")}
                  />
                ) : null}

                <ChatLayout
                  density="balanced"
                  style={chatLayoutStyle}
                  composer={
                    <ChatComposer
                      value={composerText}
                      onChange={setComposerText}
                      isDisabled={!currentQuestion}
                      placeholder={
                        currentQuestion
                          ? "也可以自己输入更具体的现象，按回车发送…"
                          : "问诊上下文已收集完毕，请在上方确认检查计划或查看右侧报告"
                      }
                      onSubmit={handleComposerSubmit}
                    />
                  }>
                  <ChatMessageList>
                    <ChatSystemMessage variant="divider">
                      问诊开始 · 只需回答几个简单问题，所有检查均由你确认后才执行
                    </ChatSystemMessage>

                    {turns.map((turn) => (
                      <ChatMessage
                        key={turn.id}
                        sender={turn.role === "user" ? "user" : "assistant"}>
                        <ChatMessageBubble
                          variant={turn.role === "user" ? "filled" : "ghost"}>
                          <VStack gap={2}>
                            <Text size="sm">{turn.text}</Text>
                            {turn.toolCalls ? (
                              <ChatToolCalls
                                calls={turn.toolCalls}
                                defaultIsExpanded
                              />
                            ) : null}
                          </VStack>
                        </ChatMessageBubble>
                        <ChatMessageMetadata>
                          <Text type="supporting" color="secondary">
                            {turn.role === "user" ? "你" : "Sentinel 问诊助手"}
                          </Text>
                        </ChatMessageMetadata>
                      </ChatMessage>
                    ))}

                    {currentQuestion ? (
                      <Card variant="default" padding={4}>
                        <VStack gap={2}>
                          <Text
                            type="supporting"
                            weight="semibold"
                            color="secondary">
                            点选最接近的情况（或直接在下方输入补充）：
                          </Text>
                          <HStack gap={2} wrap="wrap">
                            {currentQuestion.quickOptions.map((opt) => (
                              <Token
                                key={opt}
                                size="lg"
                                label={opt}
                                onClick={() => submitFollowupAnswer(opt)}
                              />
                            ))}
                          </HStack>
                        </VStack>
                      </Card>
                    ) : null}

                    {interviewCompleted && !activeCase?.report ? (
                      <Card variant="default" padding={4}>
                        <VStack gap={3}>
                          <HStack hAlign="between" vAlign="center" width="100%">
                            <HStack gap={2} vAlign="center">
                              <Icon icon={ShieldCheckIcon} size="md" />
                              <Heading level={4}>本轮套餐式检查计划（R0 只读）</Heading>
                            </HStack>
                            <Token size="sm" color="blue" label="单次授权即可" />
                          </HStack>
                          <Divider />
                          <VStack gap={1.5}>
                            {category === "setup_audit" &&
                            capabilities?.setupAuditEnabled ? (
                              <>
                                <Text size="sm">
                                  • 检查 1：显示器输出适配器归属（核对是否挂载在独立显卡或核显输出）
                                </Text>
                                <Text size="sm">
                                  • 检查 2：当前刷新率 vs 显示器 EDID 上限（排查高刷是否锁在 60Hz）
                                </Text>
                                <Text size="sm">
                                  • 检查 3：内存速率与插槽基础字段（无法直接测得 BIOS XMP/EXPO 开关状态，未知项将如实标明）
                                </Text>
                                <Text size="sm">
                                  • 检查 4：Windows 电源计划（节能 / 平衡 / 高性能）
                                </Text>
                                <Text size="sm">
                                  • 检查 5：系统盘剩余空间比例（核对是否低于 10%）
                                </Text>
                                <Text size="sm">
                                  • 检查 6：PCIe 链路与热/功耗传感器（当前只读套餐暂不支持直接读取，将如实标为尚未支持）
                                </Text>
                              </>
                            ) : capabilities?.realCollectionEnabled ? (
                              <>
                                <Text size="sm">
                                  • 动作 1：本机只读系统概况与已确认时间窗口事件日志采集（windows.system_snapshot + windows.event_window）
                                </Text>
                                <Text size="sm">
                                  • 动作 2：运行确定性诊断规则，保留原始证据 ID 与缺失覆盖项
                                </Text>
                              </>
                            ) : (
                              <>
                                <Text size="sm">
                                  • 动作 1：采集时间窗口与场景匹配证据（浏览器预览映射到合成样本）
                                </Text>
                                <Text size="sm">
                                  • 动作 2：运行确定性诊断规则，保留原始证据 ID 与缺失覆盖项
                                </Text>
                              </>
                            )}
                            <Text type="supporting" color="secondary">
                              权限边界：不修改系统设置、不安装第三方程序、不自动重启电脑。
                            </Text>
                          </VStack>
                          <HStack gap={2} hAlign="end" width="100%">
                            {busy && activeRun ? (
                              <Button
                                label="取消本轮检查"
                                variant="secondary"
                                onClick={() => void handleCancelActiveRun()}
                              />
                            ) : null}
                            <Button
                              label={
                                busy
                                  ? "正在执行检查..."
                                  : "同意套餐计划并开始检查"
                              }
                              variant="primary"
                              icon={<Icon icon={CheckCircleIcon} size="sm" />}
                              isDisabled={busy}
                              onClick={() => void handleApproveAndRunPackage()}
                            />
                          </HStack>
                        </VStack>
                      </Card>
                    ) : null}
                  </ChatMessageList>
                </ChatLayout>
              </VStack>

              <ResizeHandle {...resizable.props} />

              {/* 右栏：可调宽的常驻诊断与进度面板 */}
              <VStack
                width={resizable.size}
                height="100%"
                padding={4}
                gap={4}
                style={panelScrollStyle}>
                <HStack hAlign="between" vAlign="center" width="100%">
                  <Heading level={4}>诊断进度与证据面板</Heading>
                  {activeCase?.report ? (
                    <Button
                      label="脱敏导出"
                      variant="secondary"
                      size="sm"
                      icon={<Icon icon={DocumentArrowDownIcon} size="sm" />}
                      onClick={() =>
                        void onExportCase(activeCase.id, "markdown")
                      }
                    />
                  ) : null}
                </HStack>

                <Stepper
                  activeStep={currentStepIndex}
                  orientation="horizontal"
                  density="compact">
                  <Step step={0} label="持续追问" />
                  <Step step={1} label="套餐授权" />
                  <Step step={2} label="证据指南" />
                  <Step step={3} label="复测对比" />
                </Stepper>

                <TabList value={panelTab} onChange={setPanelTab} hasDivider>
                  <Tab value="summary" label="结论与指南" />
                  <Tab value="coverage" label="覆盖与未知" />
                  <Tab value="evidence" label="证据时间线" />
                  <Tab value="retest" label="复测对比" />
                </TabList>

                {!activeCase?.report ? (
                  <Card variant="muted" padding={5}>
                    <VStack gap={2}>
                      <Text weight="semibold" size="sm">
                        等待完成左侧问诊与授权
                      </Text>
                      <Text size="sm" color="secondary">
                        完成左侧 3 个简短追问并点击“同意套餐计划”后，这里会立刻呈现：
                        观察结论、排好优先级的下一步操作指南、覆盖度明细以及可展开的原始证据。
                      </Text>
                    </VStack>
                  </Card>
                ) : (
                  <VStack gap={4}>
                    {panelTab === "summary" ? (
                      <VStack gap={4}>
                        <Banner
                          status="info"
                          title={`数据来源：${activeCase.report.provenance === "synthetic" ? "离线合成演示数据" : activeCase.report.provenance === "native_collected" ? "本机真实只读采集" : activeCase.report.provenance}`}
                          description="以下结论严格基于本轮已获取的证据，不凭单条事件编号直接断定硬件损坏。"
                        />

                        {activeCase.report.auditChecks &&
                        activeCase.report.auditChecks.length > 0 ? (
                          <VStack gap={2}>
                            <Heading level={5}>
                              基础设置与性能释放体检（{activeCase.report.auditChecks.length} 项）
                            </Heading>
                            {activeCase.report.auditChecks.map((chk) => {
                              const badge =
                                chk.assessment === "opportunity"
                                  ? { dot: "warning" as const, label: "发现优化点" }
                                  : chk.assessment === "no_issue_observed"
                                    ? { dot: "success" as const, label: "未见异常" }
                                    : chk.assessment === "not_applicable"
                                      ? { dot: "neutral" as const, label: "不适用" }
                                      : { dot: "neutral" as const, label: "无法确认" };
                              return (
                                <Card
                                  key={`${chk.checkId}-${chk.objectId ?? "global"}`}
                                  variant="default"
                                  padding={3}>
                                  <VStack gap={1.5}>
                                    <HStack
                                      hAlign="between"
                                      vAlign="center"
                                      width="100%">
                                      <Text weight="semibold" size="sm">
                                        {chk.metric}
                                        {chk.objectId ? ` (${chk.objectId})` : ""}
                                      </Text>
                                      <StatusDot
                                        variant={badge.dot}
                                        label={badge.label}
                                      />
                                    </HStack>
                                    <Text size="sm">{chk.summary}</Text>
                                    {chk.limitations.length > 0 ? (
                                      <Text type="supporting" color="secondary">
                                        边界说明：{chk.limitations.join("；")}
                                      </Text>
                                    ) : null}
                                  </VStack>
                                </Card>
                              );
                            })}
                          </VStack>
                        ) : null}

                        <VStack gap={2}>
                          <Heading level={5}>
                            已观察到的事实（{activeCase.report.findings.length}）
                          </Heading>
                          {activeCase.report.findings.map((f) => (
                            <Card key={f.id} variant="default" padding={3}>
                              <VStack gap={1.5}>
                                <HStack
                                  hAlign="between"
                                  vAlign="center"
                                  width="100%">
                                  <Text weight="semibold" size="sm">
                                    {f.title}
                                  </Text>
                                  <Token size="sm" label={f.strength} />
                                </HStack>
                                <Text size="sm">{f.observation}</Text>
                                {f.limitations.length > 0 ? (
                                  <Text type="supporting" color="secondary">
                                    边界限制：{f.limitations.join("；")}
                                  </Text>
                                ) : null}
                                <Text type="supporting" weight="medium">
                                  规则建议：{f.nextStep}
                                </Text>
                              </VStack>
                            </Card>
                          ))}
                        </VStack>

                        <VStack gap={2}>
                          <Heading level={5}>
                            下一步低成本排查指南（按优先级排序）
                          </Heading>
                          {guidedSteps.map((step) => (
                            <Card key={step.priority} variant="muted" padding={4}>
                              <HStack gap={3} vAlign="start">
                                <Heading level={3}>{step.priority}</Heading>
                                <VStack gap={1}>
                                  <Text weight="semibold">{step.title}</Text>
                                  <Text type="supporting" color="secondary">
                                    目的：{step.purpose}
                                  </Text>
                                  <Text size="sm">操作：{step.action}</Text>
                                  <Text type="supporting" color="secondary">
                                    预期反馈：{step.expected}
                                  </Text>
                                </VStack>
                              </HStack>
                            </Card>
                          ))}
                        </VStack>
                      </VStack>
                    ) : null}

                    {panelTab === "coverage" ? (
                      <VStack gap={4}>
                        <Table aria-label="本轮数据覆盖状态" density="compact">
                          <TableHeader>
                            <TableRow>
                              <TableHeaderCell>检测来源</TableHeaderCell>
                              <TableHeaderCell>状态</TableHeaderCell>
                              <TableHeaderCell>说明</TableHeaderCell>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {activeCase.report.coverage.map((c) => {
                              const meta = COVERAGE_STATUS_META[c.status] ?? {
                                label: c.status,
                                dot: "neutral" as StatusDotVariant,
                              };
                              return (
                                <TableRow key={c.source}>
                                  <TableCell>
                                    <Text size="sm" weight="medium">
                                      {c.source}
                                    </Text>
                                  </TableCell>
                                  <TableCell>
                                    <HStack gap={1.5} vAlign="center">
                                      <StatusDot
                                        variant={meta.dot}
                                        label={meta.label}
                                      />
                                      <Text size="sm">{meta.label}</Text>
                                    </HStack>
                                  </TableCell>
                                  <TableCell>
                                    <Text type="supporting" color="secondary">
                                      {c.detail}
                                    </Text>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>

                        <Banner
                          status="warning"
                          title={`目前还不能判断的事（${activeCase.report.unknowns.length}）`}
                          description="这些不是“没问题”，只是本轮证据覆盖不到，请不要据此直接换硬件。"
                          collapsible={false}>
                          <VStack gap={1.5}>
                            {activeCase.report.unknowns.map((u, i) => (
                              <Text key={i} size="sm">
                                • {u}
                              </Text>
                            ))}
                          </VStack>
                        </Banner>
                      </VStack>
                    ) : null}

                    {panelTab === "evidence" ? (
                      <VStack gap={2}>
                        {activeCase.report.evidence.length === 0 ? (
                          <Banner
                            status="warning"
                            title="本轮未收集到事件记录"
                            description="无记录不等于硬件绝对正常，请参考“覆盖与未知”补充日志或导入工具报告。"
                          />
                        ) : (
                          activeCase.report.evidence.map((ev) => {
                            const isOpen = expandedEvidenceId === ev.id;
                            return (
                              <Card key={ev.id} variant="default" padding={3}>
                                <VStack gap={1.5}>
                                  <HStack
                                    hAlign="between"
                                    vAlign="center"
                                    width="100%">
                                    <Text weight="semibold" size="sm">
                                      {ev.kind} · {ev.provider ?? ev.source}
                                    </Text>
                                    <Button
                                      label={isOpen ? "收起字段" : "展开字段"}
                                      variant="ghost"
                                      size="sm"
                                      onClick={() =>
                                        setExpandedEvidenceId(
                                          isOpen ? null : ev.id,
                                        )
                                      }
                                    />
                                  </HStack>
                                  <Text type="supporting" color="secondary">
                                    ID: {ev.id} | EventID:{" "}
                                    {ev.eventId ?? "无"} | 实体:{" "}
                                    {ev.entity ?? "未指定"}
                                  </Text>
                                  {isOpen ? (
                                    <VStack gap={1}>
                                      <Divider />
                                      {Object.entries(ev.fields).map(
                                        ([k, v]) => (
                                          <Text key={k} type="code">
                                            {k}: {v}
                                          </Text>
                                        ),
                                      )}
                                    </VStack>
                                  ) : null}
                                </VStack>
                              </Card>
                            );
                          })
                        )}
                      </VStack>
                    ) : null}

                    {panelTab === "retest" ? (
                      <VStack gap={4}>
                        <Banner
                          status="info"
                          title="单变量复测对比记录"
                          description="建议每次只调整一个变量（如换一条 DP 线或拔掉扩展坞），记录结果后再判断是否需要进一步排查。"
                        />
                        <Card variant="default" padding={4}>
                          <VStack gap={3}>
                            <TextInput
                              label="本次修改了什么条件？"
                              placeholder="例如：更换了一条已知正常的 DP 1.4 线材"
                              value={retestVariable}
                              onChange={setRetestVariable}
                            />
                            <Selector
                              label="复测观察结果"
                              value={retestOutcome}
                              onChange={setRetestOutcome}
                              options={[
                                {
                                  value: "问题不再复现（已改善）",
                                  label: "问题不再复现（已改善）",
                                },
                                {
                                  value: "依然出现相同故障",
                                  label: "依然出现相同故障",
                                },
                                {
                                  value: "出现新现象（需补充检查）",
                                  label: "出现新现象（需补充检查）",
                                },
                              ]}
                            />
                            <HStack gap={2} hAlign="end" width="100%">
                              <Button
                                label="记录本次复测变量"
                                variant="primary"
                                size="sm"
                                icon={<Icon icon={ArrowPathIcon} size="sm" />}
                                isDisabled={!retestVariable.trim()}
                                onClick={handleRecordRetest}
                              />
                            </HStack>
                          </VStack>
                        </Card>

                        {retestHistory.length > 0 ? (
                          <VStack gap={2}>
                            <Heading level={5}>
                              已记录的复测轮次（{retestHistory.length}）
                            </Heading>
                            {retestHistory.map((item) => (
                              <Card key={item.id} variant="muted" padding={3}>
                                <VStack gap={1}>
                                  <HStack
                                    hAlign="between"
                                    vAlign="center"
                                    width="100%">
                                    <Text weight="semibold" size="sm">
                                      变更：{item.changedVariable}
                                    </Text>
                                    <Text type="supporting" color="secondary">
                                      {item.recordedAt}
                                    </Text>
                                  </HStack>
                                  <Text size="sm">结果：{item.outcome}</Text>
                                </VStack>
                              </Card>
                            ))}
                          </VStack>
                        ) : null}
                      </VStack>
                    ) : null}
                  </VStack>
                )}
              </VStack>
            </HStack>
          )}
        </LayoutContent>
      }
    />
  );
}
