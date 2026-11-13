import { createChineseRecognizer, type SpeechRecognitionLike } from "./voice";

export interface DictationCallbacks {
  onTranscript: (text: string) => void;
  onLevels: (levels: number[]) => void;
  onStopping: () => void;
  onError: (message: string) => void;
  onFinish: (text: string, send: boolean) => void;
}
export interface DictationSession {
  stop: (send?: boolean) => void;
  cancel: () => void;
}

// Only visualises audio locally; it neither stores nor uploads a recording.
export async function startVoiceMeter(onLevels: (levels: number[]) => void) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  let context: AudioContext | undefined;
  try {
    context = new AudioContext();
    await context.resume();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const history = Array<number>(80).fill(0);
    const timer = window.setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      const rms = Math.sqrt(
        samples.reduce((sum, n) => sum + ((n - 128) / 128) ** 2, 0) /
          samples.length,
      );
      history.shift();
      history.push(Math.min(1, rms * 7));
      onLevels([...history]);
    }, 50);
    return () => {
      window.clearInterval(timer);
      source.disconnect();
      analyser.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      void context?.close().catch(() => {});
    };
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    void context?.close().catch(() => {});
    throw error;
  }
}

export function startDictation(
  callbacks: DictationCallbacks,
  dependencies = {
    recognizer: createChineseRecognizer,
    meter: startVoiceMeter,
  },
): DictationSession {
  let closed = false;
  let stopping = false;
  let shouldSend = false;
  let transcript = "";
  let stopMeter: (() => void) | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let recognizer: SpeechRecognitionLike | null = null;
  const abort = () => {
    try {
      recognizer?.abort();
    } catch {
      /* Already ended. */
    }
  };
  const clean = () => {
    clearTimeout(timeout);
    stopMeter?.();
    stopMeter = undefined;
  };
  const finish = (send: boolean) => {
    if (closed) return;
    closed = true;
    clean();
    callbacks.onFinish(transcript, send && Boolean(transcript.trim()));
  };
  recognizer = dependencies.recognizer({
    onTranscript: (text) => {
      if (closed) return;
      transcript = text;
      callbacks.onTranscript(text);
    },
    onError: (message) => {
      if (closed) return;
      callbacks.onError(message);
      finish(false);
      abort();
    },
    onEnd: () => finish(shouldSend),
  });
  if (!recognizer)
    throw new Error(
      "当前应用内核不支持语音识别。请点击输入框，按 Win + H 使用 Windows 语音听写。",
    );
  try {
    recognizer.start();
  } catch {
    closed = true;
    clean();
    abort();
    throw new Error(
      "语音输入未能启动。请检查麦克风权限，或点击输入框后按 Win + H。",
    );
  }
  if (!closed) {
    void dependencies
      .meter((levels) => {
        if (!closed && !stopping) callbacks.onLevels(levels);
      })
      .then((stop) => {
        if (closed || stopping) stop();
        else stopMeter = stop;
      })
      .catch(() => {
        // Speech recognition can work even when a separate meter is unavailable.
      });
  }
  return {
    stop(send = false) {
      if (closed || stopping) return;
      stopping = true;
      shouldSend = send;
      clean();
      callbacks.onStopping();
      timeout = setTimeout(() => {
        if (closed) return;
        callbacks.onError("未收到最终转写，已保留识别文字。请检查后手动发送。");
        finish(false);
        abort();
      }, 5000);
      try {
        recognizer?.stop();
      } catch {
        finish(false);
        abort();
      }
    },
    cancel() {
      if (closed) return;
      closed = true;
      clean();
      abort();
    },
  };
}
