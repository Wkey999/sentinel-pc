import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ChatComposer, ChatComposerInput } from "@astryxdesign/core/Chat";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import {
  ArrowUpIcon,
  MicrophoneIcon,
  StopIcon,
  XMarkIcon,
} from "@heroicons/react/24/solid";
import { startDictation, type DictationSession } from "../services/dictation";

interface VoiceComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder: string;
  isDisabled?: boolean;
  style?: CSSProperties;
  inputStyle?: CSSProperties;
  density?: "compact" | "balanced" | "spacious";
  sessionFactory?: typeof startDictation;
}

export function VoiceComposer({
  value,
  onChange,
  onSubmit,
  placeholder,
  isDisabled = false,
  style,
  inputStyle,
  density,
  sessionFactory = startDictation,
}: VoiceComposerProps) {
  const [phase, setPhase] = useState<"idle" | "listening" | "stopping">("idle");
  const [levels, setLevels] = useState<number[]>(Array(80).fill(0));
  const [error, setError] = useState("");
  const session = useRef<DictationSession | null>(null);
  const prefix = useRef("");
  const transcriptRef = useRef<HTMLSpanElement>(null);
  const run = useRef(0);
  const callbacks = useRef({ onChange, onSubmit });
  callbacks.current = { onChange, onSubmit };
  const merge = (text: string) =>
    [prefix.current.trimEnd(), text.trim()].filter(Boolean).join(" ");

  function cancel() {
    run.current++;
    session.current?.cancel();
    session.current = null;
    callbacks.current.onChange(prefix.current);
    setPhase("idle");
  }
  useEffect(
    () => () => {
      run.current++;
      session.current?.cancel();
    },
    [],
  );
  useEffect(() => {
    if (isDisabled && session.current) cancel();
  }, [isDisabled]);
  useEffect(() => {
    const element = transcriptRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [value, phase]);

  function start() {
    if (session.current || isDisabled) return;
    const id = ++run.current;
    prefix.current = value;
    setError("");
    setLevels(Array(80).fill(0));
    setPhase("listening");
    try {
      const next = sessionFactory({
        onTranscript: (text) => {
          if (run.current === id) callbacks.current.onChange(merge(text));
        },
        onLevels: (nextLevels) => {
          if (run.current === id) setLevels(nextLevels);
        },
        onStopping: () => {
          if (run.current === id) setPhase("stopping");
        },
        onError: (message) => {
          if (run.current === id) setError(message);
        },
        onFinish: (text, send) => {
          if (run.current !== id) return;
          run.current++;
          session.current = null;
          const result = merge(text);
          callbacks.current.onChange(result);
          setPhase("idle");
          if (send && result.trim()) callbacks.current.onSubmit(result);
        },
      });
      if (run.current === id) session.current = next;
      else next.cancel();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "语音输入启动失败，请使用 Win + H。",
      );
      setPhase("idle");
    }
  }

  return (
    <VStack gap={2} style={style} width={style?.width ?? "100%"}>
      {phase === "idle" ? (
        <ChatComposer
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder={placeholder}
          isDisabled={isDisabled}
          density={density}
          input={<ChatComposerInput style={inputStyle} />}
          sendActions={
            <IconButton
              label="语音输入"
              tooltip="语音输入 · 使用浏览器识别服务，可能需要联网"
              variant="ghost"
              icon={<Icon icon={MicrophoneIcon} />}
              onClick={start}
            />
          }
        />
      ) : (
        <VStack
          gap={2}
          padding={3}
          width="100%"
          role="group"
          aria-label={
            phase === "stopping" ? "正在完成语音转写" : "正在语音输入"
          }
          style={{
            backgroundColor: "var(--color-background-popover)",
            borderRadius: "var(--radius-chat)",
            minWidth: 0,
          }}
        >
          <Text
            ref={transcriptRef}
            size="base"
            color={value ? "primary" : "placeholder"}
            display="block"
            role="status"
            aria-label="实时语音转写"
            aria-live="polite"
            tabIndex={0}
            style={{
              minHeight: "var(--spacing-10)",
              maxHeight: "calc(var(--spacing-10) * 3)",
              overflowY: "auto",
              whiteSpace: "pre-wrap",
              textAlign: "start",
              paddingInline: "var(--spacing-2)",
            }}
          >
            {value || "正在聆听，请说话…"}
          </Text>
          <HStack gap={3} vAlign="center" width="100%" style={{ minWidth: 0 }}>
            <IconButton
              label="取消语音输入"
              tooltip="取消并丢弃本次转写"
              variant="secondary"
              icon={<Icon icon={XMarkIcon} />}
              onClick={cancel}
              style={{ borderRadius: "50%", flexShrink: 0 }}
            />
            <svg
              viewBox="0 0 640 40"
              preserveAspectRatio="none"
              role="img"
              aria-label="麦克风音量波形"
              style={{
                flex: 1,
                minWidth: 0,
                height: "var(--spacing-10)",
                color: "var(--color-text-secondary)",
              }}
            >
              {levels.map((level, index) => {
                const height = 3 + Math.max(0, Math.min(1, level)) * 31;
                return (
                  <rect
                    key={index}
                    x={index * 8 + 2}
                    y={(40 - height) / 2}
                    width={3}
                    height={height}
                    rx={1.5}
                    fill="currentColor"
                    opacity={level > 0.03 ? 0.85 : 0.35}
                  />
                );
              })}
            </svg>
            <IconButton
              label="停止语音输入"
              tooltip="停止并编辑识别文字"
              variant="secondary"
              icon={<Icon icon={StopIcon} />}
              isDisabled={phase === "stopping"}
              onClick={() => session.current?.stop()}
              style={{ borderRadius: "50%", flexShrink: 0 }}
            />
            <IconButton
              label="发送语音转写"
              tooltip="完成转写并发送"
              variant="primary"
              icon={<Icon icon={ArrowUpIcon} />}
              isLoading={phase === "stopping"}
              onClick={() => session.current?.stop(true)}
              style={{ borderRadius: "50%", flexShrink: 0 }}
            />
          </HStack>
        </VStack>
      )}
      {error ? (
        <Text size="sm" role="status">
          {error}
        </Text>
      ) : null}
    </VStack>
  );
}
