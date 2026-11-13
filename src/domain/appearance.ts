import originalBackground from "../assets/anime-bg.jpg";
import snowBackground from "../assets/snow-bg.jpg";

export const backgrounds = [
  { id: "original", label: "晴空 · 默认插画", url: originalBackground },
  { id: "snow", label: "雪境 · 紫色插画", url: snowBackground },
] as const;

export type BackgroundId = (typeof backgrounds)[number]["id"];
const BACKGROUND_KEY = "sentinel.background";

export function readBackground(): BackgroundId {
  try {
    const saved = localStorage.getItem(BACKGROUND_KEY);
    return backgrounds.find((item) => item.id === saved)?.id ?? "original";
  } catch {
    return "original";
  }
}

export function saveBackground(id: BackgroundId) {
  try {
    localStorage.setItem(BACKGROUND_KEY, id);
  } catch {
    // The current selection still works when local storage is unavailable.
  }
}
