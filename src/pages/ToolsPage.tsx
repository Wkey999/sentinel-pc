import { useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Layout, LayoutContent, LayoutHeader } from "@astryxdesign/core/Layout";
import { HStack, VStack } from "@astryxdesign/core/Stack";
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
import { TextInput } from "@astryxdesign/core/TextInput";
import { Icon } from "@astryxdesign/core/Icon";
import { Token } from "@astryxdesign/core/Token";
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
} from "@heroicons/react/24/outline";
import type { BackendCapabilities, ToolCandidate } from "../domain/contracts";
import { diagnostics } from "../services/diagnostics";

interface ToolEntry {
  id: string;
  name: string;
  category: "native" | "storage" | "telemetry";
  integrationMode: string;
  statusDot: StatusDotVariant;
  statusLabel: string;
  license: string;
  capabilityNote: string;
  officialUrl: string;
}

const TOOL_CATALOG: ToolEntry[] = [
  {
    id: "win-events",
    name: "Windows 事件日志与系统概况",
    category: "native",
    integrationMode: "系统内置只读采集 (R0)",
    statusDot: "warning",
    statusLabel: "待接入原生采集器（当前为合成样本演示）",
    license: "Windows 系统内置组件",
    capabilityNote:
      "读取 System / Application / WHEA / Display / USB 事件窗口与硬件驱动概况，不读取 Security 日志。",
    officialUrl:
      "https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.diagnostics/get-winevent",
  },
  {
    id: "smartctl",
    name: "smartmontools (smartctl)",
    category: "storage",
    integrationMode: "自动发现受控运行 + JSON 导入",
    statusDot: "accent",
    statusLabel: "后端纯解析器已就绪 (v7.2–7.5 JSON)，待串联导入/CLI",
    license: "GPL-2.0-or-later（不随安装包分发）",
    capabilityNote:
      "识别 ATA / NVMe / SCSI 设备 SMART 属性与位掩码退出码；若本机已安装，经确认后只读调用。",
    officialUrl: "https://www.smartmontools.org/",
  },
  {
    id: "crystaldiskinfo",
    name: "CrystalDiskInfo",
    category: "storage",
    integrationMode: "文本报告导入 + 目录发现",
    statusDot: "accent",
    statusLabel: "后端纯解析器已就绪 (9.0–9.6 英文/简中文本)，待串联导入",
    license: "MIT（不随安装包打包，保留版权声明）",
    capabilityNote:
      "支持多盘健康声明、温度、通电次数与通电时间解析，导入时保留原始校验哈希。",
    officialUrl: "https://crystalmark.info/en/software/crystaldiskinfo/",
  },
  {
    id: "hwinfo",
    name: "HWiNFO64",
    category: "telemetry",
    integrationMode: "手动外部运行 + 报告导入（规划中）",
    statusDot: "neutral",
    statusLabel: "第二批次候选（遵循官方免费/Pro 授权边界）",
    license: "专有软件（自动 CLI 属 Pro 授权，不绕过限制）",
    capabilityNote:
      "用于传感器温度、电压与功耗异常排查，不在免费版上使用自动点击或旁路破解。",
    officialUrl: "https://www.hwinfo.com/",
  },
  {
    id: "presentmon",
    name: "Intel PresentMon",
    category: "telemetry",
    integrationMode: "CSV 导入 / 受限帧时间采集（规划中）",
    statusDot: "neutral",
    statusLabel: "第二批次候选",
    license: "MIT（需分别核对 Console/Service 依赖）",
    capabilityNote: "用于游戏卡顿、掉帧与渲染管线延迟分析。",
    officialUrl: "https://github.com/GameTechDev/PresentMon",
  },
];

interface ToolsPageProps {
  capabilities?: BackendCapabilities;
}

export function ToolsPage({ capabilities }: ToolsPageProps) {
  const [filter, setFilter] = useState<string>("all");
  const [toolboxDir, setToolboxDir] = useState("");
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState("");
  const [discovered, setDiscovered] = useState<ToolCandidate[] | null>(null);

  async function handleProbeTools() {
    if (probing) return;
    setProbing(true);
    setProbeError("");
    try {
      const list = await diagnostics.probeTools(
        toolboxDir.trim() ? toolboxDir.trim() : undefined,
      );
      setDiscovered(list);
    } catch (e) {
      setProbeError(e instanceof Error ? e.message : "扫描本机工具失败。");
    } finally {
      setProbing(false);
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
            <Heading level={2}>工具目录与来源边界</Heading>
            <Text size="sm" color="secondary">
              Sentinel PC 复用成熟工具而非自造底层驱动；不随安装包捆绑未授权二进制，所有受控运行均需你授权确认。
            </Text>
          </VStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent padding={6}>
          <VStack gap={5}>
            <Banner
              status={capabilities?.realCollectionEnabled ? "success" : "info"}
              title={
                capabilities?.realCollectionEnabled
                  ? "本机工具自动发现已就绪（仅扫描存在性与哈希，不自动运行）"
                  : "关于自动发现与手动导入的说明"
              }
              description={
                capabilities?.realCollectionEnabled
                  ? "支持自动扫描 Program Files 及自定义工具箱目录中的 smartctl.exe 与 CrystalDiskInfo；发现后需经你确认才会受控执行或导入。"
                  : "当前处于浏览器预览模式；在 Tauri 桌面端可点击下方按钮真实扫描本机合规工具。"
              }
            />

            <Card variant="default" padding={4}>
              <VStack gap={3}>
                <HStack gap={3} vAlign="end" wrap="wrap" width="100%">
                  <TextInput
                    label="可选：额外工具箱目录（留空则扫描默认安装路径）"
                    value={toolboxDir}
                    onChange={setToolboxDir}
                    placeholder="例如：D:\Tools\Hardware"
                  />
                  <Button
                    label={probing ? "扫描中…" : "扫描本机合规工具"}
                    variant="primary"
                    icon={<Icon icon={ArrowPathIcon} size="sm" />}
                    isDisabled={probing}
                    onClick={() => void handleProbeTools()}
                  />
                </HStack>
                {probeError ? (
                  <Banner status="error" title={probeError} />
                ) : null}
                {discovered !== null ? (
                  discovered.length === 0 ? (
                    <Text size="sm" color="secondary">
                      未在默认路径或指定目录中发现受支持的 smartctl / CrystalDiskInfo 可执行文件。
                    </Text>
                  ) : (
                    <VStack gap={2}>
                      {discovered.map((tool) => (
                        <HStack
                          key={tool.token}
                          gap={2}
                          hAlign="between"
                          vAlign="center"
                          width="100%">
                          <VStack gap={0.5}>
                            <Text size="sm" weight="medium">
                              {tool.toolId} · {tool.displayPath}
                            </Text>
                            <Text type="supporting" color="secondary">
                              {tool.notice}
                            </Text>
                          </VStack>
                          <Token
                            size="sm"
                            color="blue"
                            label={`${tool.integration} · ${tool.version ?? tool.sha256.slice(0, 8)}`}
                          />
                        </HStack>
                      ))}
                    </VStack>
                  )
                ) : null}
              </VStack>
            </Card>

            <TabList value={filter} onChange={setFilter} hasDivider>
              <Tab value="all" label={`全部工具 (${TOOL_CATALOG.length})`} />
              <Tab value="native" label="系统内置采集" />
              <Tab value="storage" label="硬盘与存储" />
              <Tab value="telemetry" label="温度 / 帧时间" />
            </TabList>

            <Card variant="default" padding={0}>
              <Table aria-label="支持与候选工具目录" density="balanced">
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell>工具 / 来源</TableHeaderCell>
                    <TableHeaderCell>集成方式</TableHeaderCell>
                    <TableHeaderCell>当前状态</TableHeaderCell>
                    <TableHeaderCell>授权与边界</TableHeaderCell>
                    <TableHeaderCell>官方来源</TableHeaderCell>
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
                        <Token size="sm" label={tool.integrationMode} />
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
                        <Text type="supporting" color="secondary">
                          {tool.license}
                        </Text>
                      </TableCell>
                      <TableCell>
                        <Button
                          label="官网"
                          variant="ghost"
                          size="sm"
                          icon={<Icon icon={ArrowTopRightOnSquareIcon} size="sm" />}
                          href={tool.officialUrl}
                          target="_blank"
                          rel="noreferrer"
                        />
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
