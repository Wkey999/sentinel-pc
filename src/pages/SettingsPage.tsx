import { useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Divider } from "@astryxdesign/core/Divider";
import { Layout, LayoutContent, LayoutHeader } from "@astryxdesign/core/Layout";
import { Selector } from "@astryxdesign/core/Selector";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Token } from "@astryxdesign/core/Token";
import { Thumbnail } from "@astryxdesign/core/Thumbnail";
import { backgrounds, type BackgroundId } from "../domain/appearance";
import type { AppStatus, BackendCapabilities } from "../domain/contracts";
import { diagnostics } from "../services/diagnostics";

interface SettingsPageProps {
  status?: AppStatus;
  capabilities?: BackendCapabilities;
  onCapabilitiesChanged: () => Promise<void>;
  colorMode: "dark" | "light" | "system";
  onColorModeChange: (mode: "dark" | "light" | "system") => void;
  backgroundId: BackgroundId;
  onBackgroundChange: (id: BackgroundId) => void;
}

export function SettingsPage({
  status,
  capabilities,
  onCapabilitiesChanged,
  colorMode,
  onColorModeChange,
  backgroundId,
  onBackgroundChange,
}: SettingsPageProps) {
  const [section, setSection] = useState<string>("runtime");
  const [endpoint, setEndpoint] = useState(
    capabilities?.modelTarget ?? "https://api.deepseek.com/chat/completions",
  );
  const [modelName, setModelName] = useState(
    capabilities?.modelName ?? "deepseek-chat",
  );
  const [apiKey, setApiKey] = useState("");
  const [modelBusy, setModelBusy] = useState(false);
  const [modelFeedback, setModelFeedback] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  const isMock = status?.mode !== "native-synthetic";
  const realEnabled = Boolean(capabilities?.realCollectionEnabled);

  async function handleSaveModel() {
    if (modelBusy) return;
    setModelBusy(true);
    setModelFeedback(null);
    try {
      await diagnostics.configureModel({
        provider: "chat_completions",
        endpoint: endpoint.trim(),
        model: modelName.trim() || "deepseek-chat",
        apiKey: apiKey.trim(),
      });
      setApiKey("");
      await onCapabilitiesChanged();
      setModelFeedback({
        kind: "success",
        text: "模型凭据已通过 Windows DPAPI 加密保存至本机。",
      });
    } catch (e) {
      setModelFeedback({
        kind: "error",
        text: e instanceof Error ? e.message : "保存模型配置失败。",
      });
    } finally {
      setModelBusy(false);
    }
  }

  async function handleClearModel() {
    if (modelBusy) return;
    setModelBusy(true);
    setModelFeedback(null);
    try {
      await diagnostics.clearModel();
      await onCapabilitiesChanged();
      setModelFeedback({
        kind: "success",
        text: "已清除本机保存的模型凭据，现已切回离线确定性规则模式。",
      });
    } catch (e) {
      setModelFeedback({
        kind: "error",
        text: e instanceof Error ? e.message : "清除模型凭据失败。",
      });
    } finally {
      setModelBusy(false);
    }
  }

  return (
    <Layout
      height="fill"
      header={
        <LayoutHeader>
          <VStack gap={1}>
            <Heading level={2}>设置、隐私边界与关于</Heading>
            <Text size="sm" color="secondary">
              查看当前运行模式、AI 模型安全边界、数据脱敏策略与项目原则。
            </Text>
          </VStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent padding={6}>
          <VStack gap={5}>
            <TabList value={section} onChange={setSection} hasDivider>
              <Tab value="runtime" label="运行环境与后端状态" />
              <Tab value="ai" label="AI 模型与网络边界" />
              <Tab value="privacy" label="隐私脱敏与数据保留" />
              <Tab value="about" label="关于 Sentinel PC" />
            </TabList>

            {section === "runtime" ? (
              <Card variant="default" padding={5}>
                <VStack gap={4}>
                  <Heading level={4}>界面外观</Heading>
                  <Divider />
                  <HStack hAlign="between" vAlign="center" width="100%">
                    <Text size="sm" weight="medium">
                      配色模式
                    </Text>
                    <Selector
                      label="配色模式"
                      isLabelHidden
                      size="sm"
                      value={colorMode}
                      onChange={(v) =>
                        onColorModeChange(v as "dark" | "light" | "system")
                      }
                      options={[
                        { value: "light", label: "浅色（默认）" },
                        { value: "dark", label: "深蓝" },
                        { value: "system", label: "跟随系统" },
                      ]}
                    />
                  </HStack>
                  <VStack gap={3}>
                    <Text size="sm" weight="bold">
                      背景图片
                    </Text>
                    <Text size="sm" color="secondary">
                      点击下方预览即可切换，自动记住选择；配色模式保持独立。
                    </Text>
                    <HStack gap={4} wrap="wrap" width="100%">
                      {backgrounds.map((item) => (
                        <VStack
                          key={item.id}
                          gap={2}
                          style={{
                            flex: "1 1 14rem",
                            minWidth: 0,
                            maxWidth: "18rem",
                          }}
                        >
                          <Thumbnail
                            src={item.url}
                            alt={item.label}
                            label={`切换背景：${item.label}`}
                            onClick={() => onBackgroundChange(item.id)}
                            style={{
                              width: "100%",
                              height: "auto",
                              aspectRatio: "16 / 9",
                              borderRadius: "var(--radius-container)",
                            }}
                          />
                          <Button
                            label={`${backgroundId === item.id ? "已选用 · " : "使用 · "}${item.label}`}
                            variant={
                              backgroundId === item.id ? "primary" : "secondary"
                            }
                            aria-pressed={backgroundId === item.id}
                            width="100%"
                            onClick={() => onBackgroundChange(item.id)}
                          />
                        </VStack>
                      ))}
                    </HStack>
                  </VStack>
                  <Divider />
                  <Heading level={4}>当前运行环境</Heading>
                  <HStack hAlign="between" vAlign="center" width="100%">
                    <Text size="sm" weight="medium">
                      前端架构与版本
                    </Text>
                    <Token
                      size="sm"
                      color="blue"
                      label={`React + Astryx · v${status?.version ?? "0.1.0"}`}
                    />
                  </HStack>
                  <HStack hAlign="between" vAlign="center" width="100%">
                    <Text size="sm" weight="medium">
                      后端连接模式
                    </Text>
                    <HStack gap={1.5} vAlign="center">
                      <StatusDot
                        variant={isMock ? "warning" : "accent"}
                        label={isMock ? "浏览器内存 Mock" : "桌面原生 SQLite"}
                      />
                      <Text size="sm">
                        {isMock
                          ? "浏览器预览模式（刷新后数据清空，不代表本机实采）"
                          : "Tauri 原生桌面模式（合成样本验证中）"}
                      </Text>
                    </HStack>
                  </HStack>
                  <HStack hAlign="between" vAlign="center" width="100%">
                    <Text size="sm" weight="medium">
                      本机真实系统采集
                    </Text>
                    <HStack gap={1.5} vAlign="center">
                      <StatusDot
                        variant={realEnabled ? "success" : "warning"}
                        label={realEnabled ? "v2 真实采集就绪" : "未启用"}
                      />
                      <Text size="sm" color="secondary">
                        {realEnabled
                          ? `已启用（API v${capabilities?.apiVersion ?? 2}）`
                          : "浏览器预览模式（请在 Tauri 桌面端实采）"}
                      </Text>
                    </HStack>
                  </HStack>
                </VStack>
              </Card>
            ) : null}

            {section === "ai" ? (
              <VStack gap={4}>
                <Banner
                  status={capabilities?.modelConfigured ? "success" : "info"}
                  title={
                    capabilities?.modelConfigured
                      ? `已配置远程大模型端点：${capabilities.modelTarget ?? "已加密保存"}`
                      : "AI 模型当前处于离线规则兜底模式"
                  }
                  description="AI 负责问诊追问与通俗翻译报告，绝不持有系统命令执行权。支持填写 DeepSeek 或兼容 HTTPS 网关地址；配置仅用 Windows DPAPI 加密存放在本机。"
                />
                <Card variant="default" padding={5}>
                  <VStack gap={4}>
                    <Heading level={4}>
                      模型端点与凭据配置（DeepSeek / HTTPS 网关）
                    </Heading>
                    <Divider />
                    <TextInput
                      label="HTTPS 模型接口地址"
                      value={endpoint}
                      onChange={setEndpoint}
                      placeholder="https://api.deepseek.com/chat/completions"
                    />
                    <TextInput
                      label="模型名称（如 deepseek-chat / deepseek-reasoner）"
                      value={modelName}
                      onChange={setModelName}
                      placeholder="deepseek-chat"
                    />
                    <TextInput
                      label="API Key（仅本机 DPAPI 加密存储）"
                      type="password"
                      value={apiKey}
                      onChange={setApiKey}
                      placeholder="sk-..."
                    />
                    {modelFeedback ? (
                      <Banner
                        status={
                          modelFeedback.kind === "success" ? "success" : "error"
                        }
                        title={modelFeedback.text}
                      />
                    ) : null}
                    <HStack gap={2} hAlign="end" width="100%">
                      <Button
                        label="清除本地凭据"
                        variant="secondary"
                        isDisabled={modelBusy || !capabilities?.modelConfigured}
                        onClick={() => void handleClearModel()}
                      />
                      <Button
                        label={modelBusy ? "保存中…" : "安全保存配置"}
                        variant="primary"
                        isDisabled={
                          modelBusy || !endpoint.trim() || !apiKey.trim()
                        }
                        onClick={() => void handleSaveModel()}
                      />
                    </HStack>
                  </VStack>
                </Card>
                <Card variant="default" padding={5}>
                  <VStack gap={3}>
                    <Heading level={4}>模型安全护栏（不可绕过）</Heading>
                    <Divider />
                    <Text size="sm">
                      • 绝不在浏览器 localStorage 或导出报告中保存任何 API Key。
                    </Text>
                    <Text size="sm">
                      •
                      发送给模型的摘要默认先经过本机脱敏，并限定在受控字节预算内。
                    </Text>
                    <Text size="sm">
                      •
                      模型只能从内置动作白名单中建议检查项，不能自由拼接命令行参数。
                    </Text>
                    <Text size="sm">
                      • 断网、未配置 Key
                      或响应校验失败时，自动无缝回退本地确定性规则。
                    </Text>
                  </VStack>
                </Card>
              </VStack>
            ) : null}

            {section === "privacy" ? (
              <Card variant="default" padding={5}>
                <VStack gap={3}>
                  <Heading level={4}>脱敏与数据保留原则</Heading>
                  <Divider />
                  <Text size="sm">
                    •
                    默认导出仅包含结构化观察、覆盖度与脱敏摘要，不包含原始用户自由文本、同意令牌或完整本机路径。
                  </Text>
                  <Text size="sm">
                    •
                    导出前始终提供完整文本预览，方便你发往贴吧、论坛或发给维修人员前再次人工核对。
                  </Text>
                  <Text size="sm">
                    • 桌面端案例保存在本机应用数据目录的 SQLite
                    中，支持随时单个删除；计划中的 30 天自动清理策略将随后端
                    Schema v2 一并落地。
                  </Text>
                </VStack>
              </Card>
            ) : null}

            {section === "about" ? (
              <Card variant="default" padding={5}>
                <VStack gap={3}>
                  <Heading level={4}>Sentinel PC · 哨兵</Heading>
                  <Divider />
                  <Text size="sm" color="secondary">
                    面向普通游戏玩家与日常办公用户的 Windows 桌面智能故障诊断
                    Agent。
                  </Text>
                  <Text size="sm">
                    核心准则：复用成熟合规检测工具、保留原始证据出处、坦诚标注“尚不能判断的边界”，不拿单一日志编号直接诱导盲目更换硬件。
                  </Text>
                </VStack>
              </Card>
            ) : null}
          </VStack>
        </LayoutContent>
      }
    />
  );
}
