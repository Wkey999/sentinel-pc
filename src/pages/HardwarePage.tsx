// Adapted from Astryx settings template: fixed header + scrolling sectioned body.
import { useEffect, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Grid } from "@astryxdesign/core/Grid";
import { Icon } from "@astryxdesign/core/Icon";
import { Layout, LayoutContent, LayoutHeader } from "@astryxdesign/core/Layout";
import { Section } from "@astryxdesign/core/Section";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from "@astryxdesign/core/Table";
import { Heading, Text } from "@astryxdesign/core/Text";
import {
  ArrowPathIcon,
  BoltIcon,
  ComputerDesktopIcon,
  CpuChipIcon,
} from "@heroicons/react/24/outline";
import type { HardwareInfo } from "../domain/contracts";
import { diagnostics } from "../services/diagnostics";

const surfaceStyle = {
  backgroundColor:
    "color-mix(in srgb, var(--color-background-body) 85%, var(--color-background-card))",
  borderRadius: "var(--radius-container)",
  marginInline: 0,
  marginBlock: 0,
};

export function HardwarePage({ onAudit }: { onAudit: () => void }) {
  const [info, setInfo] = useState<HardwareInfo | undefined>(
    diagnostics.cachedHardware,
  );
  const [loading, setLoading] = useState(() => !diagnostics.hardwareIsFresh());
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    diagnostics
      .hardware()
      .then((value) => {
        if (active) setInfo(value);
      })
      .catch((reason) => {
        if (active) setError(String(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function refresh() {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      setInfo(await diagnostics.hardware(true));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setLoading(false);
    }
  }
  const problems =
    info?.groups.flatMap((group) =>
      group.items.filter((item) => item.problem),
    ) ?? [];
  const unavailable =
    info?.groups.filter((group) => group.status === "unavailable").length ?? 0;
  return (
    <Layout
      height="fill"
      header={
        <LayoutHeader>
          <HStack gap={3} wrap="wrap" vAlign="center">
            <StackItem size="fill">
              <VStack gap={1}>
                <Heading level={2}>硬件信息</Heading>
                <Text color="secondary" size="sm">
                  先认识你的电脑，再开始排查。
                </Text>
              </VStack>
            </StackItem>
            <Button
              label={loading ? "正在读取…" : "刷新信息"}
              icon={<Icon icon={ArrowPathIcon} size="sm" />}
              isDisabled={loading}
              onClick={() => void refresh()}
            />
            <Button
              label="一键体检"
              variant="primary"
              icon={<Icon icon={BoltIcon} size="sm" />}
              onClick={onAudit}
            />
          </HStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent padding={4}>
          <VStack gap={4}>
            {error ? (
              <Banner
                status="error"
                title="硬件信息读取未完成"
                description={`${error}${info ? " 当前仍显示上次读取结果，可点击刷新重试。" : " 请点击刷新信息重试。"}`}
              />
            ) : null}
            {loading && !info ? (
              <Section padding={6} style={surfaceStyle}>
                <VStack gap={3}>
                  <Icon icon={CpuChipIcon} size="lg" />
                  <Heading level={3}>正在识别这台电脑</Heading>
                  <Text color="secondary">
                    读取系统与设备信息，首次打开可能需要几秒钟。
                  </Text>
                </VStack>
              </Section>
            ) : null}
            {info ? (
              <>
                <VStack gap={1} padding={3} style={surfaceStyle}>
                  <Text size="sm" weight="semibold">
                    上次采集：
                    {new Date(info.collectedAtUtc).toLocaleString("zh-CN", {
                      hour12: false,
                    })}
                    {loading
                      ? " · 正在后台更新，当前显示上次结果"
                      : " · 本地硬件快照"}
                  </Text>
                  <Text size="sm" color="secondary">
                    24
                    小时内优先使用缓存；更换设备或查看最新磁盘余量、设备状态时，请点击「刷新信息」。一键体检会单独读取当前证据。
                  </Text>
                </VStack>
                {info.origin === "browser_demo" ? (
                  <Banner
                    status="info"
                    title="浏览器演示数据"
                    description="此页仅展示布局，桌面应用会自动读取你自己的硬件信息。"
                  />
                ) : null}
                <Grid columns={{ minWidth: 260, max: 2 }} gap={4}>
                  <Section padding={5} style={surfaceStyle}>
                    <VStack gap={2}>
                      <HStack gap={2} vAlign="center">
                        <Icon icon={ComputerDesktopIcon} size="md" />
                        <Text color="secondary">电脑型号</Text>
                      </HStack>
                      <Heading level={3}>
                        {info.computerModel || "型号未报告"}
                      </Heading>
                    </VStack>
                  </Section>
                  <Section padding={5} style={surfaceStyle}>
                    <VStack gap={2}>
                      <Text color="secondary">操作系统</Text>
                      <Heading level={3}>
                        {info.operatingSystem || "系统信息未报告"}
                      </Heading>
                    </VStack>
                  </Section>
                </Grid>
                <Section padding={0} style={surfaceStyle}>
                  <VStack padding={4} gap={2}>
                    <HStack gap={2} vAlign="center">
                      <Icon icon={CpuChipIcon} size="md" />
                      <Heading level={3}>硬件总览</Heading>
                    </HStack>
                    <Text type="supporting" color="secondary">
                      {info.origin === "windows_native"
                        ? "本机只读采集 · 信息仅在本地展示"
                        : "示例配置 · 非本机检测结果"}
                    </Text>
                  </VStack>
                  <Table
                    density="balanced"
                    textOverflow="wrap"
                    verticalAlign="top"
                    dividers="rows"
                  >
                    <TableHeader>
                      <TableRow>
                        <TableHeaderCell style={{ width: "20%" }}>
                          硬件
                        </TableHeaderCell>
                        <TableHeaderCell>型号与关键参数</TableHeaderCell>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {info.groups.map((group) => (
                        <TableRow key={group.id}>
                          <TableCell>
                            <Text weight="semibold">{group.label}</Text>
                          </TableCell>
                          <TableCell>
                            <VStack gap={3}>
                              {group.items.length ? (
                                group.items.map((item, index) => (
                                  <VStack key={index} gap={0.5}>
                                    <HStack gap={2} vAlign="center">
                                      <Text weight="medium">
                                        {item.name || "型号未报告"}
                                      </Text>
                                      {item.problem ? (
                                        <StatusDot
                                          variant="warning"
                                          label="需要留意"
                                        />
                                      ) : null}
                                    </HStack>
                                    {item.details.filter(Boolean).length ? (
                                      <Text size="sm" color="secondary">
                                        {item.details
                                          .filter(Boolean)
                                          .join(" · ")}
                                      </Text>
                                    ) : null}
                                  </VStack>
                                ))
                              ) : (
                                <Text color="secondary">
                                  {group.status === "unavailable"
                                    ? "系统接口暂不可读，可刷新重试；不代表硬件故障。"
                                    : group.id === "npu"
                                      ? "未发现可枚举的 NPU；也可能尚未安装对应驱动。"
                                      : "未发现可枚举的设备或系统未提供信息。"}
                                </Text>
                              )}
                            </VStack>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Section>
                <Section padding={4} style={surfaceStyle}>
                  <VStack gap={2}>
                    <Heading level={3}>基础排查提示</Heading>
                    <Text>
                      {problems.length
                        ? `发现 ${problems.length} 项需要留意：${problems.map((item) => item.name).join("、")}。请结合上方设备状态继续排查。`
                        : "当前概览没有报告设备状态码异常或分区空间不足；这不代表已完成全面体检。"}
                    </Text>
                    {unavailable ? (
                      <Text color="secondary">
                        有 {unavailable}{" "}
                        类信息暂未读到，请以实际设备和驱动状态为准。
                      </Text>
                    ) : null}
                    <Text size="sm" color="secondary">
                      需要检查刷新率、显示输出、内存配置与电源计划时，点击「一键体检」。
                    </Text>
                  </VStack>
                </Section>
              </>
            ) : null}
          </VStack>
        </LayoutContent>
      }
    />
  );
}
