import { defineTheme } from "@astryxdesign/core/theme";

// 哨兵自有主题：面向游戏玩家，亮蓝为主、无描边、仅保留很淡的光晕与渐变。
// 字体只使用系统自带字体（生产 CSP 禁止远程字体）。
const SANS_FALLBACKS =
  '"Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif';
const MONO_FALLBACKS =
  '"Cascadia Mono", "Cascadia Code", Consolas, "SFMono-Regular", Menlo, monospace';

const accentMix = (percent: number) =>
  `color-mix(in srgb, var(--color-accent) ${percent}%, transparent)`;

export const sentinelTheme = defineTheme({
  name: "sentinel",
  color: {
    accent: ["#2F7BFF", "#5CA8FF"],
    neutralStyle: "cool",
    contrast: "standard",
  },
  typography: {
    scale: { base: 14, ratio: 1.2 },
    body: { family: "Segoe UI", fallbacks: SANS_FALLBACKS },
    heading: { family: "Segoe UI", fallbacks: SANS_FALLBACKS, weight: "bold" },
    code: { family: "Cascadia Mono", fallbacks: MONO_FALLBACKS },
  },
  radius: { base: 4, multiplier: 1.25 },
  tokens: {
    // 底色整体偏亮蓝：浅色为淡蓝白，深色为明亮的海军蓝而不是灰黑
    "--color-background-body": ["#EAF2FF", "#0C2250"],
    "--color-background-surface": ["#F6F9FF", "#12306A"],
  },
  components: {
    // 页面顶部一抹淡蓝光晕（无描边）
    layout: {
      base: {
        backgroundImage: `radial-gradient(ellipse 70% 38% at 50% 0%, ${accentMix(18)}, transparent 70%)`,
        backgroundRepeat: "no-repeat",
      },
    },
    // 主按钮：微渐变 + 柔和外发光（无描边）
    button: {
      "variant:primary": {
        backgroundImage:
          "linear-gradient(180deg, color-mix(in srgb, var(--color-accent) 80%, white), var(--color-accent))",
        boxShadow: `0 4px 16px ${accentMix(34)}`,
      },
    },
    // 胶囊：去掉边框，改用淡蓝底
    token: {
      base: {
        border: "none",
        backgroundColor: accentMix(14),
      },
    },
  },
});
