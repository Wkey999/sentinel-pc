import { useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Divider } from "@astryxdesign/core/Divider";
import { Icon } from "@astryxdesign/core/Icon";
import { Layout, LayoutContent, LayoutHeader } from "@astryxdesign/core/Layout";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Stack";
import { StatusDot, type StatusDotVariant } from "@astryxdesign/core/StatusDot";
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
import { Token } from "@astryxdesign/core/Token";
import { ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";
import type {
  BackendCapabilities,
  CaseRecord,
  ReportFormat,
} from "../domain/contracts";
import { diagnostics } from "../services/diagnostics";

interface ToolEntry {
  id: string;
  name: string;
  category: "native" | "storage" | "telemetry" | "stress";
  tubaLocation: string;
  capabilityNote: string;
  statusDot: StatusDotVariant;
  statusLabel: string;
  importFormat?: ReportFormat;
  importButtonLabel?: string;
  actionBadgeLabel?: string;
}

const TOOL_CATALOG: ToolEntry[] = [
  {
    id: "win-events",
    name: "Windows 硬件快照与事件日志（系统内置）",
    category: "native",
    tubaLocation: "系统内置",
    capabilityNote:
      "自动读取本机配置、显示器连接通路、高刷档位，以及蓝屏/黑屏掉驱动/强行重启前后的 Windows 系统事件记录。",
    statusDot: "success",
    statusLabel: "桌面端已接入只读采集",
    actionBadgeLabel: "已集成至「一键体检」",
  },
  {
    id: "crystaldiskinfo",
    name: "CrystalDiskInfo / DiskInfo（硬盘健康检测）",
    category: "storage",
    tubaLocation: "磁盘工具",
    capabilityNote:
      "查看固态/机械硬盘健康度百分比、温度、通电时间，重点看「0E（媒体与数据完整性错误）」或「05/C5」是否为 0。",
    statusDot: "accent",
    statusLabel: "支持导出 .txt 一键导入分析",
    importFormat: "crystal_disk_info_text",
    importButtonLabel: "导入 .txt 报告",
  },
  {
    id: "hwinfo",
    name: "HWiNFO64（传感器温度与功耗监控）",
    category: "telemetry",
    tubaLocation: "综合 / 其他工具",
    capabilityNote:
      "实时查看 CPU 封装温度、显卡核心/热点温度、功耗以及是否触发过热降频（Thermal Throttling）。",
    statusDot: "accent",
    statusLabel: "支持导出英文 .csv 日志导入",
    importFormat: "hwinfo_csv",
    importButtonLabel: "导入 .csv 日志",
  },
  {
    id: "cpuz",
    name: "CPU-Z（处理器、主板与内存核对）",
    category: "telemetry",
    tubaLocation: "CPU工具",
    capabilityNote:
      "在「内存 (Memory)」页核对是否开启双通道、观察「DRAM 频率」（DDR4/DDR5 实际频率 = 显示值 × 2），在「SPD」页查看内存颗粒品牌。",
    statusDot: "neutral",
    statusLabel: "用于核对双通道与内存频率",
    actionBadgeLabel: "在图吧工具箱手动查看",
  },
  {
    id: "gpuz",
    name: "GPU-Z（显卡参数与通道核对）",
    category: "telemetry",
    tubaLocation: "显卡工具",
    capabilityNote:
      "核对显卡真实流处理器数量（防假卡）、显存颗粒品牌（三星/海力士/镁光），以及「总线接口 (Bus Interface)」是否运行在正常 PCIe 通道。",
    statusDot: "neutral",
    statusLabel: "用于核对显卡通道与真伪",
    actionBadgeLabel: "在图吧工具箱手动查看",
  },
  {
    id: "aida64",
    name: "AIDA64（内存跑分与单烤 FPU）",
    category: "telemetry",
    tubaLocation: "综合 / 内存工具",
    capabilityNote:
      "常用两项功能：①「工具 → 内存与缓存测试」看内存读写速度与延迟（Latency）；②「工具 → 系统稳定性测试」只勾选 Stress FPU 单烤测试 CPU 散热器压不压得住。",
    statusDot: "neutral",
    statusLabel: "适合查内存延迟与 CPU 散热",
    actionBadgeLabel: "在图吧工具箱手动查看",
  },
  {
    id: "furmark",
    name: "FurMark 甜甜圈（显卡满载烤机）",
    category: "stress",
    tubaLocation: "烤机 / 显卡工具",
    capabilityNote:
      "让显卡满载运行 5–10 分钟，观察显卡温度是否过高、风扇是否异响，以及高负载下是否直接黑屏、闪退或重启（排查显卡散热与电源供电）。",
    statusDot: "warning",
    statusLabel: "高负载测试，请留意温度",
    actionBadgeLabel: "按需短时手动测试",
  },
  {
    id: "tm5",
    name: "TestMem5 (TM5) / MemTest（内存稳定性测试）",
    category: "stress",
    tubaLocation: "内存 / 烤机工具",
    capabilityNote:
      "开启 XMP / EXPO 或手动超频内存后必测；若运行报错（Error > 0），说明内存频率或时序不稳，会导致游戏莫名闪退或蓝屏。",
    statusDot: "warning",
    statusLabel: "排查内存超频与游戏闪退",
    actionBadgeLabel: "按需短时手动测试",
  },
  {
    id: "asssd",
    name: "AS SSD / CrystalDiskMark（固态硬盘测速）",
    category: "storage",
    tubaLocation: "磁盘工具",
    capabilityNote:
      "测试固态硬盘连续读写与 4K 随机读写速度，排查硬盘满盘掉速或插错低速 M.2 插槽。",
    statusDot: "neutral",
    statusLabel: "排查掉速与低速接口",
    actionBadgeLabel: "在图吧工具箱手动查看",
  },
];

const REPORT_TITLES: Record<ReportFormat, string> = {
  crystal_disk_info_text: "CrystalDiskInfo 硬盘报告",
  hwinfo_csv: "HWiNFO64 传感器日志",
  smartctl_json: "smartctl SMART 报告",
};

interface ToolsPageProps {
  capabilities?: BackendCapabilities;
  onCaseImported: (record: CaseRecord) => void;
  onBusyChange: (busy: boolean) => void;
  onRecordsChanged: () => Promise<void>;
}

export function ToolsPage({
  capabilities,
  onCaseImported,
  onBusyChange,
  onRecordsChanged,
}: ToolsPageProps) {
  const [filter, setFilter] = useState<string>("all");
  const [importing, setImporting] = useState(false);
  const [activeFormat, setActiveFormat] = useState<ReportFormat | null>(null);
  const [importError, setImportError] = useState("");
  const [downloadNotice, setDownloadNotice] = useState("");
  const [downloadError, setDownloadError] = useState("");

  const canImport = Boolean(capabilities?.reportImportEnabled);

  async function handleOpenTubaWebsite() {
    setDownloadError("");
    setDownloadNotice("");
    try {
      const res = await diagnostics.openWindowsSettings("https://www.tbtool.cn/");
      setDownloadNotice(
        res.desktop
          ? "已在系统默认浏览器打开图吧工具箱官网 (tbtool.cn)，可在官网选择 2026 最新版网盘链接下载解压。"
          : "已为你打开图吧工具箱官网 (tbtool.cn)。",
      );
    } catch (error) {
      setDownloadError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async function importAndAnalyze(targetFormat: ReportFormat) {
    if (importing || !canImport) return;
    setImporting(true);
    setActiveFormat(targetFormat);
    setImportError("");
    onBusyChange(true);
    let created: CaseRecord | null = null;
    try {
      const now = Date.now();
      created = await diagnostics.create({
        category: targetFormat === "hwinfo_csv" ? "gaming_display" : "storage_io",
        symptom: "外部工具报告补证；只分析主动选择的报告。",
        incidentStartUtc: new Date(now - 60 * 60 * 1000).toISOString(),
        incidentEndUtc: new Date(now).toISOString(),
        displayTimezone: "Asia/Shanghai",
        environment: "personal",
      });
      const selected = await diagnostics.importReport({
        caseId: created.id,
        format: targetFormat,
      });
      if (!selected) {
        await diagnostics.delete(created.id);
        created = null;
        return;
      }
      await diagnostics.rename({
        caseId: selected.id,
        title: `外部报告 · ${REPORT_TITLES[targetFormat]}`,
      });
      const planned = await diagnostics.buildImportPlan(selected.id);
      const p = planned.plan;
      if (!p) {
        throw new Error("未能生成报告解析计划。");
      }
      const consent = await diagnostics.approve({
        caseId: planned.id,
        planId: p.id,
        planHash: p.hash,
      });
      let result = await diagnostics.start({
        caseId: planned.id,
        planId: p.id,
        planHash: p.hash,
        consentToken: consent.token,
      });
      for (
        let i = 0;
        i < 100 && ["collecting", "cancelling"].includes(result.status);
        i++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        result = await diagnostics.get(result.id);
      }
      if (["collecting", "cancelling"].includes(result.status)) {
        throw new Error("报告仍在分析，可从左侧最近案例查看进度。");
      }
      onBusyChange(false);
      onCaseImported(result);
    } catch (error) {
      setImportError(String(error));
      if (created) {
        try {
          await diagnostics.delete(created.id);
        } catch {
          setImportError(
            `${String(error)}；临时案例清理失败，可在最近案例删除。`,
          );
        }
      }
    } finally {
      setImporting(false);
      setActiveFormat(null);
      onBusyChange(false);
      void onRecordsChanged();
    }
  }

  const filtered =
    filter === "all"
      ? TOOL_CATALOG
      : TOOL_CATALOG.filter((t) => t.category === filter);

  return (
    <Layout
      height="fill"
      header={
        <LayoutHeader>
          <VStack gap={1}>
            <Heading level={2}>常用诊断工具与报告导入</Heading>
            <Text size="sm" color="secondary">
              结合图吧工具箱等装机圈常用工具定位硬件与稳定性问题；所有导出的日志均在本机离线解析，不会私自运行第三方工具。
            </Text>
          </VStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent padding={6}>
          <VStack gap={5}>
            <Card variant="default" padding={5}>
              <VStack gap={3}>
                <HStack gap={4} hAlign="between" vAlign="center" width="100%" wrap="wrap">
                  <StackItem size="fill">
                    <VStack gap={1}>
                      <HStack gap={2} vAlign="center" wrap="wrap">
                        <Heading level={3}>获取图吧工具箱 2026 最新版</Heading>
                        <Token size="sm" color="green" label="官网直达下载" />
                      </HStack>
                      <Text size="sm" color="secondary">
                        图吧工具箱整合了数十款硬件检测软件（整包约 2–3 GB），Sentinel PC 为保持轻量不捆绑分发；点击右侧按钮直接在浏览器打开官网网盘下载解压，之后即可把报告导入下方解析。
                      </Text>
                    </VStack>
                  </StackItem>
                  <StackItem size="static">
                    <Button
                      variant="secondary"
                      icon={<Icon icon={ArrowTopRightOnSquareIcon} size="sm" />}
                      label="前往官网下载最新版 (tbtool.cn)"
                      onClick={() => void handleOpenTubaWebsite()}
                    />
                  </StackItem>
                </HStack>
                {downloadNotice ? (
                  <Banner
                    status="success"
                    title="已跳转图吧工具箱官网"
                    description={downloadNotice}
                  />
                ) : null}
                {downloadError ? (
                  <Banner
                    status="error"
                    title="未能打开图吧工具箱官网"
                    description={downloadError}
                  />
                ) : null}
              </VStack>
            </Card>

            <Card variant="default" padding={5}>
              <VStack gap={3}>
                <HStack hAlign="between" vAlign="center" width="100%" wrap="wrap">
                  <Heading level={3}>
                    导入图吧工具箱 / 第三方检测报告（本机离线解析）
                  </Heading>
                  <Token size="sm" color="blue" label="本机离线解析" />
                </HStack>
                <VStack gap={1.5}>
                  <Text size="sm">
                    •{" "}
                    <Text weight="semibold" display="inline">
                      硬盘健康报告（CrystalDiskInfo / DiskInfo）：
                    </Text>
                    在「图吧工具箱 → 磁盘工具」打开 DiskInfo，点击顶部菜单「文件 → 保存(文本)」（或按 Ctrl + T）导出 .txt 后导入，自动检查健康度、温度与 0E/05 坏道告警。
                  </Text>
                  <Text size="sm">
                    •{" "}
                    <Text weight="semibold" display="inline">
                      温度与功耗曲线日志（HWiNFO64）：
                    </Text>
                    在「图吧工具箱 → 综合/其他工具」打开 HWiNFO64（勾选 Sensors-only 仅传感器），点击右下角「开始记录日志」保存 .csv，复现掉帧或高热后导入分析。
                  </Text>
                </VStack>
                <Divider />
                <HStack gap={3} wrap="wrap" vAlign="center">
                  <Button
                    variant="primary"
                    label={
                      importing && activeFormat === "crystal_disk_info_text"
                        ? "正在分析 DiskInfo 报告…"
                        : "导入 DiskInfo 硬盘报告 (.txt)"
                    }
                    isDisabled={importing || !canImport}
                    onClick={() => void importAndAnalyze("crystal_disk_info_text")}
                  />
                  <Button
                    variant="secondary"
                    label={
                      importing && activeFormat === "hwinfo_csv"
                        ? "正在分析 HWiNFO64 日志…"
                        : "导入 HWiNFO64 传感器日志 (.csv)"
                    }
                    isDisabled={importing || !canImport}
                    onClick={() => void importAndAnalyze("hwinfo_csv")}
                  />
                  <Button
                    variant="ghost"
                    label={
                      importing && activeFormat === "smartctl_json"
                        ? "正在分析 smartctl 报告…"
                        : "导入 smartctl 报告 (.json)"
                    }
                    isDisabled={importing || !canImport}
                    onClick={() => void importAndAnalyze("smartctl_json")}
                  />
                </HStack>
                {!canImport ? (
                  <Text size="sm" color="secondary">
                    当前处于浏览器预览模式，请在 Sentinel PC 桌面端选择本地报告文件进行分析。
                  </Text>
                ) : (
                  <Text size="sm" color="secondary">
                    选择文件后将直接在本机完成解析并生成独立分析报告；不会修改原文件，也不会自动上传 AI。
                  </Text>
                )}
                {importError ? (
                  <Banner
                    status="error"
                    title="报告导入未完成"
                    description={importError}
                  />
                ) : null}
              </VStack>
            </Card>

            <TabList value={filter} onChange={setFilter} hasDivider>
              <Tab value="all" label={`全部常用工具 (${TOOL_CATALOG.length})`} />
              <Tab value="native" label="系统内置与体检" />
              <Tab value="storage" label="磁盘工具（查硬盘）" />
              <Tab value="telemetry" label="CPU / 显卡 / 内存工具" />
              <Tab value="stress" label="烤机与稳定性测试" />
            </TabList>

            <Card variant="default" padding={0}>
              <Table
                aria-label="图吧工具箱常用工具与报告联动目录"
                density="balanced"
                textOverflow="wrap"
                verticalAlign="top"
                dividers="rows"
              >
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell>工具名称与核心用途</TableHeaderCell>
                    <TableHeaderCell>位置</TableHeaderCell>
                    <TableHeaderCell>当前支持状态</TableHeaderCell>
                    <TableHeaderCell>操作 / 联动方式</TableHeaderCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((tool) => (
                    <TableRow key={tool.id}>
                      <TableCell>
                        <VStack gap={0.5}>
                          <Text weight="semibold" size="sm">
                            {tool.name}
                          </Text>
                          <Text type="supporting" color="secondary">
                            {tool.capabilityNote}
                          </Text>
                        </VStack>
                      </TableCell>
                      <TableCell>
                        <Token size="sm" color="blue" label={tool.tubaLocation} />
                      </TableCell>
                      <TableCell>
                        <HStack gap={1.5} vAlign="center">
                          <StatusDot
                            variant={tool.statusDot}
                            label={tool.statusLabel}
                          />
                          <Text size="sm">{tool.statusLabel}</Text>
                        </HStack>
                      </TableCell>
                      <TableCell>
                        {tool.importFormat && tool.importButtonLabel ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            label={
                              importing && activeFormat === tool.importFormat
                                ? "分析中…"
                                : tool.importButtonLabel
                            }
                            isDisabled={importing || !canImport}
                            onClick={() =>
                              void importAndAnalyze(tool.importFormat!)
                            }
                          />
                        ) : (
                          <Token
                            size="sm"
                            label={tool.actionBadgeLabel ?? "在图吧工具箱手动查看"}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </VStack>
        </LayoutContent>
      }
    />
  );
}
