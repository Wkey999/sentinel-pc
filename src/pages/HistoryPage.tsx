import { useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Divider } from "@astryxdesign/core/Divider";
import { Layout, LayoutContent, LayoutHeader } from "@astryxdesign/core/Layout";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot, type StatusDotVariant } from "@astryxdesign/core/StatusDot";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from "@astryxdesign/core/Table";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Icon } from "@astryxdesign/core/Icon";
import { Token } from "@astryxdesign/core/Token";
import {
  ArrowPathIcon,
  DocumentArrowDownIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import type { CaseRecord } from "../domain/contracts";

interface HistoryPageProps {
  cases: CaseRecord[];
  busy: boolean;
  onRefresh: () => Promise<void>;
  onOpenCase: (record: CaseRecord) => void;
  onExportCase: (caseId: string, format: "markdown" | "json") => Promise<void>;
  onDeleteCase: (caseId: string) => Promise<void>;
}

const STATUS_MAP: Record<
  CaseRecord["status"],
  { label: string; dot: StatusDotVariant }
> = {
  draft: { label: "草稿（待生成计划）", dot: "neutral" },
  awaiting_consent: { label: "待授权确认", dot: "warning" },
  collecting: { label: "采集中", dot: "accent" },
  cancelling: { label: "取消中", dot: "warning" },
  cancelled: { label: "已取消", dot: "neutral" },
  failed: { label: "执行失败", dot: "error" },
  completed: { label: "已完成", dot: "success" },
  completed_partial: { label: "已完成（部分覆盖）", dot: "success" },
  interrupted: { label: "已中断（重启失效）", dot: "error" },
};

const SCENARIO_LABELS: Record<string, string> = {
  setup_audit: "一键傻瓜体检",
  restart: "突然重启 / 异常关机",
  application: "游戏 / 应用崩溃",
  storage: "存储健康告警",
  empty: "无相关事件记录",
  insufficient: "资料 / 权限不足",
};

function formatLocalTime(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: tz,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function HistoryPage({
  cases,
  busy,
  onRefresh,
  onOpenCase,
  onExportCase,
  onDeleteCase,
}: HistoryPageProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const selectedCase = cases.find((c) => c.id === selectedId) ?? cases[0] ?? null;

  return (
    <Layout
      height="fill"
      header={
        <LayoutHeader>
          <HStack hAlign="between" vAlign="center" width="100%">
            <VStack gap={1}>
              <Heading level={2}>案例历史与复测档案</Heading>
              <Text size="sm" color="secondary">
                所有案例按时间倒序保存在本机，未确认或重启中断的案例不会自动重跑。
              </Text>
            </VStack>
            <Button
              label="刷新列表"
              variant="secondary"
              size="sm"
              icon={<Icon icon={ArrowPathIcon} size="sm" />}
              isDisabled={busy}
              onClick={() => void onRefresh()}
            />
          </HStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent padding={6}>
          <VStack gap={5}>
            {cases.length === 0 ? (
              <Banner
                status="info"
                title="暂无诊断案例"
                description="请前往“智能问诊”描述你的电脑问题，完成一轮排查后将自动记录在此。"
              />
            ) : (
              <VStack gap={4}>
                <Table aria-label="历史诊断案例列表" density="compact">
                  <TableHeader>
                    <TableRow>
                      <TableHeaderCell>案例标题 / 场景</TableHeaderCell>
                      <TableHeaderCell>当前状态</TableHeaderCell>
                      <TableHeaderCell>创建时间</TableHeaderCell>
                      <TableHeaderCell>观察条数</TableHeaderCell>
                      <TableHeaderCell>操作</TableHeaderCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cases.map((item) => {
                      const st = STATUS_MAP[item.status];
                      const findingsCount = item.report?.findings.length ?? 0;
                      return (
                        <TableRow
                          key={item.id}
                          onClick={() => setSelectedId(item.id)}>
                          <TableCell>
                            <VStack gap={0.5}>
                              <Text weight="semibold" size="sm">
                                {item.title}
                              </Text>
                              <Text type="supporting" color="secondary">
                                {SCENARIO_LABELS[item.scenarioId] ?? item.scenarioId}
                              </Text>
                            </VStack>
                          </TableCell>
                          <TableCell>
                            <HStack gap={1.5} vAlign="center">
                              <StatusDot variant={st.dot} label={st.label} />
                              <Text size="sm">{st.label}</Text>
                            </HStack>
                          </TableCell>
                          <TableCell>
                            <Text size="sm" color="secondary">
                              {formatLocalTime(item.createdAtUtc, item.displayTimezone)}
                            </Text>
                          </TableCell>
                          <TableCell>
                            <Text size="sm">{findingsCount} 条发现</Text>
                          </TableCell>
                          <TableCell>
                            <HStack gap={1}>
                              <Button
                                label="打开 / 复测"
                                variant="secondary"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenCase(item);
                                }}
                              />
                              <Button
                                label="导出"
                                variant="ghost"
                                size="sm"
                                icon={<Icon icon={DocumentArrowDownIcon} size="sm" />}
                                isDisabled={!item.report || busy}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void onExportCase(item.id, "markdown");
                                }}
                              />
                              <Button
                                label="删除"
                                variant="ghost"
                                size="sm"
                                icon={<Icon icon={TrashIcon} size="sm" />}
                                isDisabled={busy}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setConfirmDeleteId(item.id);
                                }}
                              />
                            </HStack>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>

                {selectedCase ? (
                  <Card variant="default" padding={5}>
                    <VStack gap={3}>
                      <HStack hAlign="between" vAlign="center" width="100%">
                        <Heading level={4}>案例摘要：{selectedCase.title}</Heading>
                        <HStack gap={1.5}>
                          <Token
                            size="sm"
                            label={
                              selectedCase.environment === "personal"
                                ? "个人电脑"
                                : selectedCase.environment === "workplace"
                                  ? "办公设备"
                                  : "未知环境"
                            }
                          />
                          {selectedCase.report ? (
                            <Token
                              size="sm"
                              color="blue"
                              label={`来源：${selectedCase.report.provenance}`}
                            />
                          ) : null}
                        </HStack>
                      </HStack>
                      <Divider />
                      <VStack gap={1}>
                        <Text type="supporting" color="secondary">
                          用户症状与问诊上下文
                        </Text>
                        <Text size="sm">{selectedCase.symptom}</Text>
                      </VStack>
                      {selectedCase.report ? (
                        <VStack gap={1}>
                          <Text type="supporting" color="secondary">
                            核心观察（{selectedCase.report.findings.length} 项）
                          </Text>
                          {selectedCase.report.findings.map((f) => (
                            <Text key={f.id} size="sm">
                              • {f.title}：{f.observation}
                            </Text>
                          ))}
                        </VStack>
                      ) : (
                        <Text size="sm" color="secondary">
                          该案例尚未生成诊断报告，可点击“打开 / 复测”继续完成授权与检查。
                        </Text>
                      )}
                    </VStack>
                  </Card>
                ) : null}
              </VStack>
            )}
          </VStack>

          <Dialog
            isOpen={Boolean(confirmDeleteId)}
            onOpenChange={(open) => {
              if (!open) setConfirmDeleteId(null);
            }}
            purpose="required"
            width={420}>
            <DialogHeader
              title="确认删除该案例？"
              subtitle="删除后将永久移除案例记录、关联的授权令牌及检查结果。"
            />
            <VStack gap={4}>
              <Text size="sm">此操作不可撤销。确认继续吗？</Text>
              <HStack gap={2} hAlign="end" width="100%">
                <Button
                  label="取消"
                  variant="secondary"
                  onClick={() => setConfirmDeleteId(null)}
                />
                <Button
                  label="确认删除"
                  variant="destructive"
                  isDisabled={busy}
                  onClick={async () => {
                    if (confirmDeleteId) {
                      await onDeleteCase(confirmDeleteId);
                      setConfirmDeleteId(null);
                    }
                  }}
                />
              </HStack>
            </VStack>
          </Dialog>
        </LayoutContent>
      }
    />
  );
}
