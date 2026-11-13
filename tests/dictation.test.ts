import { afterEach, describe, expect, it, vi } from "vitest";
import {
  startDictation,
  type DictationCallbacks,
} from "../src/services/dictation";
import {
  createChineseRecognizer,
  type SpeechRecognitionLike,
} from "../src/services/voice";

function setup() {
  const rec = {
    start: vi.fn(),
    stop: vi.fn(),
    abort: vi.fn(),
  } as unknown as SpeechRecognitionLike;
  let events!: Parameters<typeof createChineseRecognizer>[0];
  const callbacks: DictationCallbacks = {
    onTranscript: vi.fn(),
    onLevels: vi.fn(),
    onStopping: vi.fn(),
    onError: vi.fn(),
    onFinish: vi.fn(),
  };
  const cleanup = vi.fn();
  const meter = vi.fn(async () => cleanup);
  const dependencies = {
    recognizer: (value: typeof events) => {
      events = value;
      return rec;
    },
    meter,
  };
  const session = startDictation(callbacks, dependencies);
  return { rec, events, callbacks, cleanup, session };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("语音输入生命周期", () => {
  it("等待 stop 后的最终结果再发送，只提交一次", async () => {
    const s = setup();
    await Promise.resolve();
    s.events.onTranscript("中间结果", false);
    expect(s.callbacks.onTranscript).toHaveBeenLastCalledWith("中间结果");
    expect(s.callbacks.onFinish).not.toHaveBeenCalled();
    s.session.stop(true);
    expect(s.cleanup).toHaveBeenCalledTimes(1);
    expect(s.callbacks.onFinish).not.toHaveBeenCalled();
    s.events.onTranscript("最终识别文字", true);
    s.events.onEnd();
    s.events.onEnd();
    expect(s.callbacks.onFinish).toHaveBeenCalledExactlyOnceWith(
      "最终识别文字",
      true,
    );
  });
  it("停止只回填文字，不发送；自然结束也不自动发送", () => {
    for (const stop of [true, false]) {
      const s = setup();
      s.events.onTranscript("我的电脑", true);
      if (stop) s.session.stop();
      s.events.onEnd();
      expect(s.callbacks.onFinish).toHaveBeenCalledWith("我的电脑", false);
    }
  });
  it("取消后丢弃迟到结果，权限延迟返回的麦克风也立即释放", async () => {
    let events!: Parameters<typeof createChineseRecognizer>[0];
    let resolveMeter!: (cleanup: () => void) => void;
    const onFinish = vi.fn();
    const onTranscript = vi.fn();
    const cleanup = vi.fn();
    const abort = vi.fn();
    const session = startDictation(
      {
        onFinish,
        onTranscript,
        onLevels: vi.fn(),
        onStopping: vi.fn(),
        onError: vi.fn(),
      },
      {
        recognizer: (callbacks) => {
          events = callbacks;
          return {
            start: vi.fn(),
            stop: vi.fn(),
            abort,
          } as unknown as SpeechRecognitionLike;
        },
        meter: () =>
          new Promise((resolve) => {
            resolveMeter = resolve;
          }),
      },
    );
    session.cancel();
    events.onTranscript("迟到文字", true);
    events.onEnd();
    resolveMeter(cleanup);
    await Promise.resolve();
    expect(abort).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(onFinish).not.toHaveBeenCalled();
    expect(onTranscript).not.toHaveBeenCalled();
  });
  it("停止超时保留草稿，不把中间结果自动发送", () => {
    vi.useFakeTimers();
    const s = setup();
    s.events.onTranscript("临时结果", false);
    s.session.stop(true);
    vi.advanceTimersByTime(5000);
    expect(s.rec.abort).toHaveBeenCalledTimes(1);
    expect(s.callbacks.onFinish).toHaveBeenCalledWith("临时结果", false);
    expect(s.callbacks.onError).toHaveBeenCalled();
    s.events.onEnd();
    expect(s.callbacks.onFinish).toHaveBeenCalledTimes(1);
  });
  it("识别失败保留已有文字，不发送；重复操作不会重复 stop", () => {
    const s = setup();
    s.events.onTranscript("已有文字", false);
    s.session.stop(true);
    s.session.stop(true);
    expect(s.rec.stop).toHaveBeenCalledTimes(1);
    s.events.onError("麦克风不可用");
    expect(s.callbacks.onFinish).toHaveBeenCalledWith("已有文字", false);
  });
  it("浏览器不支持时明确返回 Windows 听写路径，不申请麦克风", () => {
    const meter = vi.fn();
    expect(() =>
      startDictation(
        {
          onFinish: vi.fn(),
          onTranscript: vi.fn(),
          onLevels: vi.fn(),
          onStopping: vi.fn(),
          onError: vi.fn(),
        },
        { recognizer: () => null, meter },
      ),
    ).toThrow("Win + H");
    expect(meter).not.toHaveBeenCalled();
  });
  it("中文识别合并所有分段且支持取消", () => {
    const rec = {
      start: vi.fn(),
      stop: vi.fn(),
      abort: vi.fn(),
    } as unknown as SpeechRecognitionLike;
    vi.stubGlobal("window", {
      SpeechRecognition: function () {
        return rec;
      },
    });
    const onTranscript = vi.fn();
    createChineseRecognizer({ onTranscript, onError: vi.fn(), onEnd: vi.fn() });
    expect(rec.lang).toBe("zh-CN");
    expect(rec.continuous).toBe(true);
    rec.onresult!({
      results: [
        { isFinal: true, 0: { transcript: "我的电脑" } },
        { isFinal: false, 0: { transcript: "卡顿了" } },
      ],
    });
    expect(onTranscript).toHaveBeenCalledWith("我的电脑卡顿了", true);
  });
});
