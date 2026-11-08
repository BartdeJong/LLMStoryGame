import { describe, expect, it } from "vitest";
import { getStoryVisualTheme } from "./storyTheme";

describe("story visual themes", () => {
  it("gives every shipped story a distinct canvas look and atmosphere", () => {
    const themes = ["example", "lanterntide", "holmesashenvelope"].map(getStoryVisualTheme);

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
});
