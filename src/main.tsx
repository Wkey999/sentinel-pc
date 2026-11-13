import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Theme } from "@astryxdesign/core/theme";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import { App } from "./App";
import { sentinelTheme } from "./theme";

type ColorMode = "dark" | "light" | "system";
const MODE_KEY = "sentinel.colorMode"; // 仅界面偏好，不含任何敏感信息

function readMode(): ColorMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (v === "dark" || v === "light" || v === "system") return v;
  } catch {
    // 存储不可用时使用默认值
  }
  return "light";
}

function Root() {
  const [mode, setModeState] = useState<ColorMode>(readMode);
  const setMode = (next: ColorMode) => {
    setModeState(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // 忽略存储失败
    }
  };
  return (
    <Theme theme={sentinelTheme} mode={mode}>
      <App colorMode={mode} onColorModeChange={setMode} />
    </Theme>
  );
}

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
