import { afterEach, describe, expect, it, vi } from "vitest";
import {
  backgrounds,
  processBackgroundImage,
  resolveBackgroundStyle,
  type CustomBackground,
} from "../src/domain/appearance";

describe("appearance background helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves preset and custom adaptive fit styles", () => {
    expect(resolveBackgroundStyle("original", null)).toEqual({
      url: backgrounds[0].url,
      size: "cover",
      position: "center 20%",
    });

    const baseCustom: CustomBackground = {
      dataUrl: "data:image/webp;base64,AAAA",
      name: "wall",
      width: 1920,
      height: 1080,
      fit: "cover",
    };
    expect(resolveBackgroundStyle("custom", baseCustom)).toEqual({
      url: baseCustom.dataUrl,
      size: "cover",
      position: "center center",
    });

    expect(
      resolveBackgroundStyle("custom", {
        ...baseCustom,
        width: 1080,
        height: 1920,
        fit: "cover",
      }),
    ).toEqual({
      url: baseCustom.dataUrl,
      size: "cover",
      position: "center 25%",
    });

    expect(
      resolveBackgroundStyle("custom", { ...baseCustom, fit: "top" }),
    ).toEqual({
      url: baseCustom.dataUrl,
      size: "cover",
      position: "center top",
    });

    expect(
      resolveBackgroundStyle("custom", { ...baseCustom, fit: "contain" }),
    ).toEqual({
      url: baseCustom.dataUrl,
      size: "contain",
      position: "center center",
    });
  });

  it("scales 4K jpg via createImageBitmap without calling URL.createObjectURL", async () => {
    const close = vi.fn();
    const drawImage = vi.fn();
    const createObjectURL = vi.fn(() => {
      throw new Error("blob URL must not be created");
    });

    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({
      width: 3840,
      height: 2160,
      close,
    })));
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL,
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal("document", {
      createElement: (tag: string) => {
        expect(tag).toBe("canvas");
        const canvas = {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage }),
          toDataURL: (mime: string) => `data:${mime};base64,ZmFrZQ==`,
        };
        return canvas;
      },
    });

    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "wallpaper.jpg", {
      type: "image/jpeg",
    });
    const result = await processBackgroundImage(file);

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1920, 1080);
    expect(result).toEqual({
      dataUrl: "data:image/webp;base64,ZmFrZQ==",
      name: "wallpaper",
      width: 1920,
      height: 1080,
    });
  });
});
