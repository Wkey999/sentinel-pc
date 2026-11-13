import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@astryxdesign/core/AppShell";
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
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import {
  ClockIcon,
  Cog6ToothIcon,
  PlusIcon,
  ShieldCheckIcon,
  SparklesIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import type {
  AppStatus,
  BackendCapabilities,
  CaseRecord,
  ExportResult,
} from "./domain/contracts";
import { DiagnosePage } from "./pages/DiagnosePage";
import { HistoryPage } from "./pages/HistoryPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ToolsPage } from "./pages/ToolsPage";
import { diagnostics } from "./services/diagnostics";

type NavPage = "diagnose" | "history" | "tools" | "settings";
type ColorMode = "dark" | "light" | "system";

interface AppProps {
  colorMode: ColorMode;
  onColorModeChange: (mode: ColorMode) => void;
}

export function App({ colorMode, onColorModeChange }: AppProps) {
  const [page, setPage] = useState<NavPage>("diagnose");
  const [appStatus, setAppStatus] = useState<AppStatus>();
  const [capabilities, setCapabilities] = useState<BackendCapabilities>();
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [activeCase, setActiveCase] = useState<CaseRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportModal, setExportModal] = useState<ExportResult | null>(null);
  const [copied, setCopied] = useState(false);

  const refreshAll = useCallback(async () => {
    const [stRes, capsRes, listRes] = await Promise.allSettled([
      diagnostics.status(),
      diagnostics.capabilities(),
      diagnostics.list(),
    ]);
    if (stRes.status === "fulfilled") setAppStatus(stRes.value);
    if (capsRes.status === "fulfilled") setCapabilities(capsRes.value);
    if (listRes.status === "fulfilled") setCases(listRes.value);
  }, []);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  async function handleCaseUpdated(record: CaseRecord) {
    setActiveCase(record);
    await refreshAll();
  }

  async function handleExportCase(
    caseId: string,
    format: "markdown" | "json",
  ) {
    setBusy(true);
    try {
      const result = await diagnostics.export({ caseId, format });
      setExportModal(result);
      setCopied(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteCase(caseId: string) {
    setBusy(true);
    try {
      await diagnostics.delete(caseId);
      if (activeCase?.id === caseId) {
        setActiveCase(null);
      }
      await refreshAll();
    } finally {
      setBusy(false);
    }
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
      sideNav={
        <SideNav
          collapsible
          resizable={{ defaultWidth: 268, minWidth: 220, maxWidth: 360 }}
          header={
            <SideNavHeading
              heading="Sentinel PC · 哨兵"
              icon={<NavIcon icon={<Icon icon={ShieldCheckIcon} size="sm" />} />}
              headingHref="#"
            />
          }
          footer={
            <SideNavSection title="运行状态" isHeaderHidden>
              <SideNavItem
                label={
                  capabilities?.realCollectionEnabled
                    ? "桌面原生（本机只读实采）"
                    : appStatus?.mode === "native-synthetic"
                      ? "桌面原生（合成预览）"
                      : "浏览器 Mock 演示"
                }
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setPage("settings");
                }}
                endContent={
                  <StatusDot
                    variant={
                      capabilities?.realCollectionEnabled
                        ? "success"
                        : appStatus?.mode === "native-synthetic"
                          ? "accent"
                          : "warning"
                    }
                    label="运行模式"
                  />
                }
              />
            </SideNavSection>
          }>
          <SideNavSection title="主工作台" isHeaderHidden>
            <SideNavItem
              label="新开智能问诊"
              icon={PlusIcon}
              href="#"
              isSelected={page === "diagnose" && activeCase === null}
              onClick={(e) => {
                e.preventDefault();
                setActiveCase(null);
                setPage("diagnose");
              }}
            />
            <SideNavItem
              label="诊断对话台"
              icon={SparklesIcon}
              href="#"
              isSelected={page === "diagnose" && activeCase !== null}
              onClick={(e) => {
                e.preventDefault();
                setPage("diagnose");
              }}
            />
            <SideNavItem
              label={`案例历史 (${cases.length})`}
              icon={ClockIcon}
              href="#"
              isSelected={page === "history"}
              onClick={(e) => {
                e.preventDefault();
                setPage("history");
              }}
            />
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

          <Divider />

          <SideNavSection title="最近案例">
            <VStack gap={0.5}>
              {cases.slice(0, 8).map((c) => (
                <SideNavItem
                  key={c.id}
                  label={c.title}
                  href="#"
                  isSelected={page === "diagnose" && activeCase?.id === c.id}
                  onClick={(e) => {
                    e.preventDefault();
                    setActiveCase(c);
                    setPage("diagnose");
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
      }>
      {page === "diagnose" ? (
        <DiagnosePage
          status={appStatus}
          capabilities={capabilities}
          activeCase={activeCase}
          onCaseUpdated={handleCaseUpdated}
          onResetCase={() => setActiveCase(null)}
          onExportCase={handleExportCase}
        />
      ) : null}

      {page === "history" ? (
        <HistoryPage
          cases={cases}
          busy={busy}
          onRefresh={refreshAll}
          onOpenCase={(record) => {
            setActiveCase(record);
            setPage("diagnose");
          }}
          onExportCase={handleExportCase}
          onDeleteCase={handleDeleteCase}
        />
      ) : null}

      {page === "tools" ? <ToolsPage capabilities={capabilities} /> : null}

      {page === "settings" ? (
        <SettingsPage
          status={appStatus}
          capabilities={capabilities}
          onCapabilitiesChanged={refreshAll}
          colorMode={colorMode}
          onColorModeChange={onColorModeChange}
        />
      ) : null}

      <Dialog
        isOpen={Boolean(exportModal)}
        onOpenChange={(open) => {
          if (!open) setExportModal(null);
        }}
        width={680}
        purpose="info">
        <DialogHeader
          title={`脱敏报告导出预览 · ${exportModal?.filename ?? ""}`}
          subtitle="默认已移除用户自由描述、授权令牌及本机路径，可直接复制发往论坛或维修人员。"
        />
        <VStack gap={4}>
          {exportModal ? (
            <VStack
              width="100%"
              style={{ maxHeight: "52vh", overflowY: "auto" }}>
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
