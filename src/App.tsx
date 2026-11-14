import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@astryxdesign/core/AppShell";
import { Banner } from "@astryxdesign/core/Banner";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Button } from "@astryxdesign/core/Button";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Divider } from "@astryxdesign/core/Divider";
import { Icon } from "@astryxdesign/core/Icon";
import { NavIcon } from "@astryxdesign/core/NavIcon";
import {
  SideNav,
  SideNavHeading,
  SideNavItem,
  SideNavSection,
} from "@astryxdesign/core/SideNav";
import { VStack, HStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import {
  BoltIcon,
  Cog6ToothIcon,
  ComputerDesktopIcon,
  EllipsisHorizontalIcon,
  PlusIcon,
  ShieldCheckIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import type {
  AppStatus,
  BackendCapabilities,
  CaseRecord,
  ExportResult,
  Conversation,
} from "./domain/contracts";
import { DiagnosePage } from "./pages/DiagnosePage";
import { HardwarePage } from "./pages/HardwarePage";
import { SettingsPage } from "./pages/SettingsPage";
import { ToolsPage } from "./pages/ToolsPage";
import { diagnostics } from "./services/diagnostics";
import { latestAudit } from "./domain/case-session";
import {
  backgrounds,
  readBackground,
  saveBackground,
  type BackgroundId,
} from "./domain/appearance";

type NavPage = "hardware" | "diagnose" | "tools" | "settings";
type ColorMode = "dark" | "light" | "system";

interface AppProps {
  colorMode: ColorMode;
  onColorModeChange: (mode: ColorMode) => void;
}

export function App({ colorMode, onColorModeChange }: AppProps) {
  const [backgroundId, setBackgroundId] =
    useState<BackgroundId>(readBackground);
  const background =
    backgrounds.find((item) => item.id === backgroundId) ?? backgrounds[0];
  const changeBackground = (id: BackgroundId) => {
    setBackgroundId(id);
    saveBackground(id);
  };
  const [page, setPage] = useState<NavPage>("hardware");
  const [appStatus, setAppStatus] = useState<AppStatus>();
  const [capabilities, setCapabilities] = useState<BackendCapabilities>();
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [chats, setChats] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string>(() =>
    crypto.randomUUID(),
  );
  const [chatToDelete, setChatToDelete] = useState<Conversation | null>(null);
  const [activeCase, setActiveCase] = useState<CaseRecord | null>(null);
  const [sessionKey, setSessionKey] = useState(0);
  const sessionRef = useRef(0);
  const [autoStartAudit, setAutoStartAudit] = useState(false);
  const [runBusy, setRunBusy] = useState(false);
  const runBusyRef = useRef(false);
  const [caseAction, setCaseAction] = useState<{
    kind: "rename" | "delete";
    record: CaseRecord;
  } | null>(null);
  const [caseTitle, setCaseTitle] = useState("");
  const [caseError, setCaseError] = useState("");
  const [caseActionBusy, setCaseActionBusy] = useState(false);
  const caseActionPending = useRef(false);
  const [exportModal, setExportModal] = useState<ExportResult | null>(null);
  const [copied, setCopied] = useState(false);
  const refreshGeneration = useRef(0);

  const refreshAll = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    const [stRes, capsRes, listRes, chatsRes] = await Promise.allSettled([
      diagnostics.status(),
      diagnostics.capabilities(),
      diagnostics.list(),
      diagnostics.listChats(),
    ]);
    if (stRes.status === "fulfilled") setAppStatus(stRes.value);
    if (capsRes.status === "fulfilled") setCapabilities(capsRes.value);
    if (
      listRes.status === "fulfilled" &&
      generation === refreshGeneration.current
    )
      setCases(listRes.value);
    if (
      chatsRes.status === "fulfilled" &&
      generation === refreshGeneration.current
    )
      setChats(chatsRes.value);
  }, []);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const handleCaseUpdated = useCallback(
    async (record: CaseRecord) => {
      if (sessionRef.current === sessionKey) setActiveCase(record);
      await refreshAll();
    },
    [sessionKey, refreshAll],
  );

  const handleRunBusy = useCallback((value: boolean) => {
    runBusyRef.current = value;
    setRunBusy(value);
  }, []);

  function openSession(
    record: CaseRecord | null,
    startAudit = false,
    chatId?: string,
  ) {
    if (runBusyRef.current) {
      setPage("diagnose");
      return;
    }
    if (record && record.id === activeCase?.id) {
      setPage("diagnose");
      return;
    }
    sessionRef.current += 1;
    setSessionKey(sessionRef.current);
    setAutoStartAudit(startAudit);
    setConversationId(chatId ?? crypto.randomUUID());
    setActiveCase(record);
    setPage("diagnose");
    if (startAudit) handleRunBusy(true);
  }

  function openAudit() {
    if (runBusyRef.current) {
      setPage("diagnose");
      return;
    }
    const recent = latestAudit(cases);
    openSession(recent ?? null, !recent);
  }

  function showCaseAction(kind: "rename" | "delete", record: CaseRecord) {
    setCaseError("");
    setCaseTitle(record.title);
    setCaseAction({ kind, record });
  }

  async function saveCaseAction() {
    if (!caseAction || caseActionPending.current) return;
    caseActionPending.current = true;
    setCaseActionBusy(true);
    setCaseError("");
    try {
      if (caseAction.kind === "rename") {
        const updated = await diagnostics.rename({
          caseId: caseAction.record.id,
          title: caseTitle,
        });
        refreshGeneration.current += 1;
        setCases((current) =>
          current.map((item) => (item.id === updated.id ? updated : item)),
        );
        setActiveCase((current) =>
          current?.id === updated.id ? updated : current,
        );
      } else {
        await diagnostics.delete(caseAction.record.id);
        refreshGeneration.current += 1;
        setCases((current) =>
          current.filter((item) => item.id !== caseAction.record.id),
        );
        if (activeCase?.id === caseAction.record.id) {
          sessionRef.current += 1;
          setSessionKey(sessionRef.current);
          setAutoStartAudit(false);
          setActiveCase(null);
        }
      }
      setCaseAction(null);
    } catch (error) {
      setCaseError(error instanceof Error ? error.message : String(error));
    } finally {
      caseActionPending.current = false;
      setCaseActionBusy(false);
    }
  }

  async function handleExportCase(caseId: string, format: "markdown" | "json") {
    const result = await diagnostics.export({ caseId, format });
    setExportModal(result);
    setCopied(false);
  }

  function handleDownloadExport() {
    if (!exportModal) return;
    const blob = new Blob([exportModal.content], {
      type: exportModal.mediaType,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportModal.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleCopyExport() {
    if (!exportModal) return;
    await navigator.clipboard.writeText(exportModal.content);
    setCopied(true);
  }

  return (
    <AppShell
      contentPadding={0}
      style={{
        backgroundImage: `linear-gradient(180deg, color-mix(in srgb, var(--color-background-body) 14%, transparent), color-mix(in srgb, var(--color-background-body) 22%, transparent)), url(${background.url})`,
        backgroundSize: "cover",
        backgroundPosition: "center 20%",
        backgroundRepeat: "no-repeat",
        backgroundAttachment: "fixed",
      }}
      sideNav={
        <SideNav
          collapsible
          resizable={{ defaultWidth: 268, minWidth: 220, maxWidth: 360 }}
          header={
            <SideNavHeading
              heading="Sentinel PC · 哨兵"
              icon={
                <NavIcon icon={<Icon icon={ShieldCheckIcon} size="sm" />} />
              }
              headingHref="#"
            />
          }
          footer={
            <SideNavSection title="系统" isHeaderHidden>
              <SideNavItem
                label="工具与来源"
                icon={WrenchScrewdriverIcon}
                href="#"
                isSelected={page === "tools"}
                onClick={(e) => {
                  e.preventDefault();
                  setPage("tools");
                }}
              />
              <SideNavItem
                label="设置与关于"
                icon={Cog6ToothIcon}
                href="#"
                isSelected={page === "settings"}
                onClick={(e) => {
                  e.preventDefault();
                  setPage("settings");
                }}
              />
            </SideNavSection>
          }
        >
          <SideNavSection title="主工作台" isHeaderHidden>
            <SideNavItem
              label="新对话"
              isDisabled={runBusy}
              icon={PlusIcon}
              href="#"
              isSelected={
                page === "diagnose" &&
                activeCase === null &&
                !chats.some((c) => c.id === conversationId)
              }
              onClick={(e) => {
                e.preventDefault();
                openSession(null);
              }}
            />
            <SideNavItem
              label="一键体检"
              isDisabled={!capabilities}
              icon={BoltIcon}
              href="#"
              onClick={(e) => {
                e.preventDefault();
                openAudit();
              }}
            />
            <SideNavItem
              label="硬件信息"
              icon={ComputerDesktopIcon}
              href="#"
              isSelected={page === "hardware"}
              onClick={(e) => {
                e.preventDefault();
                setPage("hardware");
              }}
            />
          </SideNavSection>

          <Divider />

          {chats.length ? (
            <SideNavSection title={`最近对话 (${chats.length})`}>
              {chats.map((chat) => (
                <SideNavItem
                  key={chat.id}
                  label={chat.title}
                  href="#"
                  isDisabled={runBusy}
                  isSelected={
                    page === "diagnose" &&
                    !activeCase &&
                    conversationId === chat.id
                  }
                  onClick={(e) => {
                    e.preventDefault();
                    openSession(null, false, chat.id);
                  }}
                  actions={
                    <DropdownMenu
                      presentation="popover"
                      button={{
                        label: `对话操作：${chat.title}`,
                        icon: <Icon icon={EllipsisHorizontalIcon} size="sm" />,
                        isIconOnly: true,
                        variant: "ghost",
                        isDisabled: runBusy,
                      }}
                      items={[
                        {
                          id: "delete",
                          label: "删除对话",
                          variant: "destructive",
                          onClick: () => setChatToDelete(chat),
                        },
                      ]}
                    />
                  }
                />
              ))}
            </SideNavSection>
          ) : null}

          <SideNavSection title={`最近案例 (${cases.length})`}>
            <VStack gap={0.5}>
              {runBusy ? (
                <Text type="supporting" color="secondary">
                  检查进行中，完成后可切换或管理记录。
                </Text>
              ) : null}
              {cases.map((c) => (
                <SideNavItem
                  key={c.id}
                  label={c.title}
                  isDisabled={runBusy}
                  href="#"
                  actions={
                    <DropdownMenu
                      presentation="popover"
                      button={{
                        label: `案例操作：${c.title}`,
                        icon: <Icon icon={EllipsisHorizontalIcon} size="sm" />,
                        isIconOnly: true,
                        variant: "ghost",
                        isDisabled: runBusy,
                      }}
                      items={[
                        {
                          id: "rename",
                          label: "重命名",
                          onClick: () => showCaseAction("rename", c),
                        },
                        {
                          id: "delete",
                          label: "删除",
                          variant: "destructive",
                          onClick: () => showCaseAction("delete", c),
                        },
                      ]}
                    />
                  }
                  isSelected={page === "diagnose" && activeCase?.id === c.id}
                  onClick={(e) => {
                    e.preventDefault();
                    openSession(c);
                  }}
                  endContent={
                    <StatusDot
                      variant={
                        c.status === "completed" ||
                        c.status === "completed_partial"
                          ? "success"
                          : c.status === "interrupted" || c.status === "failed"
                            ? "error"
                            : "neutral"
                      }
                      label={c.status}
                    />
                  }
                />
              ))}
              {cases.length === 0 ? (
                <Text type="supporting" color="secondary">
                  暂无历史案例
                </Text>
              ) : null}
            </VStack>
          </SideNavSection>
        </SideNav>
      }
    >
      <VStack
        height="100%"
        width="100%"
        style={{ display: page === "diagnose" ? "flex" : "none" }}
      >
        <DiagnosePage
          key={sessionKey}
          status={appStatus}
          capabilities={capabilities}
          activeCase={activeCase}
          conversationId={conversationId}
          onChatsChanged={refreshAll}
          onOpenTools={() => setPage("tools")}
          autoStartAudit={autoStartAudit}
          isVisible={page === "diagnose"}
          onBusyChange={handleRunBusy}
          onNewSession={() => openSession(null)}
          onNewAudit={() => openSession(null, true)}
          onCaseUpdated={handleCaseUpdated}
          onResetCase={() => setActiveCase(null)}
          onExportCase={handleExportCase}
        />
      </VStack>
      {page === "hardware" ? <HardwarePage onAudit={openAudit} /> : null}

      {page === "tools" ? (
        <ToolsPage
          capabilities={capabilities}
          onRecordsChanged={refreshAll}
          onBusyChange={handleRunBusy}
          onCaseImported={(record) => {
            openSession(record);
            void refreshAll();
          }}
        />
      ) : null}

      {page === "settings" ? (
        <SettingsPage
          status={appStatus}
          capabilities={capabilities}
          onCapabilitiesChanged={refreshAll}
          colorMode={colorMode}
          onColorModeChange={onColorModeChange}
          backgroundId={backgroundId}
          onBackgroundChange={changeBackground}
        />
      ) : null}

      <Dialog
        isOpen={chatToDelete !== null}
        purpose="required"
        onOpenChange={(open) => {
          if (!open && !caseActionBusy) setChatToDelete(null);
        }}
      >
        <DialogHeader
          title="删除这段对话？"
          subtitle={`将删除「${chatToDelete?.title ?? ""}」的本机消息记录，无法恢复。`}
        />
        <VStack gap={3}>
          {caseError ? <Banner status="error" title={caseError} /> : null}
          <HStack gap={2} hAlign="end">
            <Button
              label="取消"
              variant="secondary"
              isDisabled={caseActionBusy}
              onClick={() => {
                setChatToDelete(null);
                setCaseError("");
              }}
            />
            <Button
              label="删除对话"
              isDisabled={caseActionBusy}
              onClick={() =>
                void (async () => {
                  if (!chatToDelete || caseActionPending.current) return;
                  caseActionPending.current = true;
                  setCaseActionBusy(true);
                  setCaseError("");
                  try {
                    await diagnostics.deleteChat(chatToDelete.id);
                    if (conversationId === chatToDelete.id) openSession(null);
                    setChatToDelete(null);
                    await refreshAll();
                  } catch (error) {
                    setCaseError(String(error));
                  } finally {
                    caseActionPending.current = false;
                    setCaseActionBusy(false);
                  }
                })()
              }
            />
          </HStack>
        </VStack>
      </Dialog>
      <Dialog
        isOpen={Boolean(caseAction)}
        purpose={caseAction?.kind === "delete" ? "required" : "form"}
        onOpenChange={(open) => {
          if (!open && !caseActionBusy) setCaseAction(null);
        }}
        width={420}
      >
        <DialogHeader
          title={caseAction?.kind === "delete" ? "删除这条记录？" : "重命名"}
          subtitle={
            caseAction?.kind === "delete"
              ? `将删除「${caseAction.record.title}」及其检查结果，无法恢复。`
              : "名称仅保存在这台电脑。"
          }
        />
        <VStack gap={4}>
          {caseError ? (
            <Banner status="error" title="操作未完成" description={caseError} />
          ) : null}
          {caseAction?.kind === "rename" ? (
            <TextInput
              label="名称"
              value={caseTitle}
              onChange={setCaseTitle}
              hasAutoFocus
              isDisabled={caseActionBusy}
              onEnter={() => void saveCaseAction()}
            />
          ) : null}
          <HStack gap={2} hAlign="end">
            <Button
              label="取消"
              isDisabled={caseActionBusy}
              onClick={() => setCaseAction(null)}
            />
            <Button
              label={
                caseActionBusy
                  ? "处理中…"
                  : caseAction?.kind === "delete"
                    ? "删除记录"
                    : "保存名称"
              }
              variant={
                caseAction?.kind === "delete" ? "destructive" : "primary"
              }
              isDisabled={
                caseActionBusy ||
                (caseAction?.kind === "rename" && !caseTitle.trim())
              }
              onClick={() => void saveCaseAction()}
            />
          </HStack>
        </VStack>
      </Dialog>

      <Dialog
        isOpen={Boolean(exportModal)}
        onOpenChange={(open) => {
          if (!open) setExportModal(null);
        }}
        width={680}
        purpose="info"
      >
        <DialogHeader
          title={`脱敏报告导出预览 · ${exportModal?.filename ?? ""}`}
          subtitle="默认已移除用户自由描述、授权令牌及本机路径，可直接复制发往论坛或维修人员。"
        />
        <VStack gap={4}>
          {exportModal ? (
            <VStack
              width="100%"
              style={{ maxHeight: "52vh", overflowY: "auto" }}
            >
              <CodeBlock
                code={exportModal.content}
                language={
                  exportModal.filename.endsWith(".json") ? "json" : "markdown"
                }
              />
            </VStack>
          ) : null}
          <HStack gap={2} hAlign="end" width="100%">
            <Button
              label={copied ? "已复制到剪贴板" : "复制文本"}
              variant="secondary"
              onClick={() => void handleCopyExport()}
            />
            <Button
              label="下载文件"
              variant="primary"
              onClick={handleDownloadExport}
            />
          </HStack>
        </VStack>
      </Dialog>
    </AppShell>
  );
}
