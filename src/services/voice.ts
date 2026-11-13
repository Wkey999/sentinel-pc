// 语音输入服务：优先使用浏览器 / WebView2 原生 SpeechRecognition（STT）。
// 若当前 WebView2 内核不支持在线 STT，则给出清晰的降级提示（Win + H）。

export interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface SpeechRecognitionResultEventLike {
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSttSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

export function createChineseRecognizer(callbacks: {
  onTranscript: (text: string, isFinal: boolean) => void;
  onError: (message: string) => void;
  onEnd: () => void;
}): SpeechRecognitionLike | null {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) return null;

  const rec = new Ctor();
  rec.lang = "zh-CN";
  rec.interimResults = true;
  rec.continuous = true;

  rec.onresult = (event) => {
    let combined = "";
    let hasFinal = false;
    for (let i = 0; i < event.results.length; i += 1) {
      const item = event.results[i];
      if (!item) continue;
      combined += item[0]?.transcript ?? "";
      if (item.isFinal) hasFinal = true;
    }
    callbacks.onTranscript(combined.trim(), hasFinal);
  };

  rec.onerror = (event) => {
    const code = event.error ?? "unknown";
    if (code === "not-allowed" || code === "service-not-allowed") {
      callbacks.onError(
        "麦克风权限未开启。你也可以直接点击输入框后按 Win + H 使用 Windows 11 原生语音听写。",
      );
    } else if (code === "network") {
      callbacks.onError(
        "当前内核在线语音识别服务不可达。你可以点击输入框后按 Win + H 使用 Windows 11 自带中文语音听写。",
      );
    } else if (code === "no-speech") {
      callbacks.onError("没有检测到说话声音，请靠近麦克风再试一次。");
    } else {
      callbacks.onError(
        `语音识别暂不可用（${code}）。可直接按 Win + H 启用系统语音输入。`,
      );
    }
  };

  rec.onend = () => {
    callbacks.onEnd();
  };

  return rec;
}
