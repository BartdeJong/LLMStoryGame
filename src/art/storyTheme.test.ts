import { describe, expect, it } from "vitest";
import { getStoryVisualTheme } from "./storyTheme";

describe("story visual themes", () => {
  it("gives every shipped story a distinct canvas look and atmosphere", () => {
    const themes = ["example", "holmesashenvelope"].map(getStoryVisualTheme);

    expect(new Set(themes.map((theme) => theme.canvasFilter)).size).toBe(themes.length);
    expect(new Set(themes.map((theme) => theme.atmosphere)).size).toBe(themes.length);
    expect(new Set(themes.map((theme) => theme.accent)).size).toBe(themes.length);
  });

  it("derives a stable distinct look for other story IDs", () => {
    expect(getStoryVisualTheme("new-story")).toEqual(getStoryVisualTheme("new-story"));
    expect(getStoryVisualTheme("new-story").canvasFilter).not.toBe(
      getStoryVisualTheme("another-story").canvasFilter,
    );
  });

  it("gives Paddington a warm orange theme instead of the generated hue", () => {
    const theme = getStoryVisualTheme("paddingtonhat");

    expect(theme.canvasFilter).toContain("sepia(0.48)");
    expect(theme.canvasFilter).not.toContain("hue-rotate(144deg)");
    expect(theme.frame).toBe("#dc8b35");
    expect(theme.accent).toBe("#ffb347");
  });

  it("gives every theme moderate ambient lighting", () => {
    for (const id of ["example", "holmesashenvelope", "paddingtonhat", "generated-story"]) {
      const { lighting } = getStoryVisualTheme(id);
      for (const key of ["outdoor", "indoor", "underground", "edge"] as const) {
        expect(lighting[key], `${id} ${key}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
      for (const key of ["outdoor", "indoor", "underground"] as const) {
        const value = parseInt(lighting[key].slice(1), 16);
        for (const channel of [value >> 16, (value >> 8) & 255, value & 255]) expect(channel).toBeGreaterThanOrEqual(0x90);
      }
    }
  });
});
