import originalBackground from "../assets/anime-bg.jpg";
import snowBackground from "../assets/snow-bg.jpg";

export const backgrounds = [
  { id: "original", label: "晴空 · 默认插画", url: originalBackground },
  { id: "snow", label: "雪境 · 紫色插画", url: snowBackground },
] as const;

export type BackgroundFit = "cover" | "top" | "contain";
export type BackgroundId = (typeof backgrounds)[number]["id"] | "custom";

export interface CustomBackground {
  dataUrl: string;
  name: string;
  width: number;
  height: number;
  fit: BackgroundFit;
}

const BACKGROUND_KEY = "sentinel.background";
const CUSTOM_BACKGROUND_KEY = "sentinel.custom-background";
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_DIMENSION = 1920;
const MAX_DATA_URL_LENGTH = 2_200_000;

export function readCustomBackground(): CustomBackground | null {
  try {
    const raw = localStorage.getItem(CUSTOM_BACKGROUND_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CustomBackground>;
    if (
      typeof parsed.dataUrl !== "string" ||
      !parsed.dataUrl.startsWith("data:image/") ||
      typeof parsed.width !== "number" ||
      typeof parsed.height !== "number"
    ) {
      return null;
    }
    const fit: BackgroundFit =
      parsed.fit === "top" || parsed.fit === "contain" ? parsed.fit : "cover";
    return {
      dataUrl: parsed.dataUrl,
      name: typeof parsed.name === "string" && parsed.name ? parsed.name : "自定义背景",
      width: parsed.width,
      height: parsed.height,
      fit,
    };
  } catch {
    return null;
  }
}

export function saveCustomBackground(bg: CustomBackground | null): boolean {
  try {
    if (!bg) {
      localStorage.removeItem(CUSTOM_BACKGROUND_KEY);
      return true;
    }
    localStorage.setItem(CUSTOM_BACKGROUND_KEY, JSON.stringify(bg));
    return true;
  } catch {
    return false;
  }
}

export function readBackground(): BackgroundId {
  try {
    const saved = localStorage.getItem(BACKGROUND_KEY);
    if (saved === "custom" && readCustomBackground()) return "custom";
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

export function resolveBackgroundStyle(
  backgroundId: BackgroundId,
  customBg: CustomBackground | null,
): { url: string; size: "cover" | "contain"; position: string } {
  if (backgroundId === "custom" && customBg) {
    if (customBg.fit === "contain") {
      return { url: customBg.dataUrl, size: "contain", position: "center center" };
    }
    if (customBg.fit === "top") {
      return { url: customBg.dataUrl, size: "cover", position: "center top" };
    }
    // Portrait images default slightly higher so character faces stay framed.
    const position = customBg.height > customBg.width ? "center 25%" : "center center";
    return { url: customBg.dataUrl, size: "cover", position };
  }
  const preset = backgrounds.find((item) => item.id === backgroundId) ?? backgrounds[0];
  return { url: preset.url, size: "cover", position: "center 20%" };
}

export async function processBackgroundImage(
  file: File,
): Promise<Omit<CustomBackground, "fit">> {
  if (
    !file.type.startsWith("image/") &&
    !/\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name)
  ) {
    throw new Error("请选择 PNG、JPG、WebP 等常见图片文件。");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("图片文件超过 20 MB，请先压缩或换一张较小的图片。");
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("无法解码该图片文件，请尝试 PNG 或 JPG 格式。"));
      el.src = objectUrl;
    });

    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;
    if (!srcW || !srcH) {
      throw new Error("图片尺寸无效。");
    }

    const scale = Math.min(1, MAX_DIMENSION / Math.max(srcW, srcH));
    const width = Math.max(1, Math.round(srcW * scale));
    const height = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("当前环境不支持画布压缩，无法导入图片。");
    }
    ctx.drawImage(img, 0, 0, width, height);

    let dataUrl = canvas.toDataURL("image/webp", 0.86);
    if (!dataUrl.startsWith("data:image/webp") || dataUrl.length > MAX_DATA_URL_LENGTH) {
      dataUrl = canvas.toDataURL("image/jpeg", 0.86);
    }
    if (dataUrl.length > MAX_DATA_URL_LENGTH) {
      dataUrl = canvas.toDataURL("image/jpeg", 0.72);
    }
    if (dataUrl.length > MAX_DATA_URL_LENGTH) {
      throw new Error("压缩后图片体积仍然过大，请换一张分辨率更低或细节更简洁的图片。");
    }

    return {
      dataUrl,
      name: file.name.replace(/\.[^.]+$/, "") || "自定义背景",
      width,
      height,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
