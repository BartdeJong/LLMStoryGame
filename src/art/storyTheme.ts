import { hashSeed } from "./random";
import type { StoryLighting } from "./lighting";

export type StoryAtmosphere = "fireflies" | "tide-glow" | "falling-ash" | "motes";

export interface StoryVisualTheme {
  readonly canvasFilter: string;
  readonly frame: string;
  readonly panel: string;
  readonly accent: string;
  readonly text: string;
  readonly muted: string;
  readonly control: string;
  readonly activeControl: string;
  readonly atmosphere: StoryAtmosphere;
  readonly particle: string;
  readonly lighting: StoryLighting;
}

export const STORY_THEMES: Readonly<Record<string, StoryVisualTheme>> = {
  example: {
    canvasFilter: "sepia(0.14) saturate(1.12) hue-rotate(-8deg) brightness(1.06)",
    frame: "#bd9651",
    panel: "rgb(44 34 25 / 88%)",
    accent: "#f1c96a",
    text: "#fff4d1",
    muted: "#d3ddc2",
    control: "rgb(44 34 25 / 72%)",
    activeControl: "rgb(126 91 47 / 88%)",
    atmosphere: "fireflies",
    particle: "#f5d477",
    lighting: { outdoor: "#f2eee6", indoor: "#d9cdb8", underground: "#a9a6b8", edge: "#8f8a84" },
  },
  holmesashenvelope: {
    canvasFilter: "sepia(0.38) saturate(0.72) brightness(0.82) contrast(1.12)",
    frame: "#927450",
    panel: "rgb(24 28 34 / 93%)",
    accent: "#d8aa70",
    text: "#efe2cf",
    muted: "#c5b9aa",
    control: "rgb(24 28 34 / 82%)",
    activeControl: "rgb(91 73 57 / 92%)",
    atmosphere: "falling-ash",
    particle: "#b8b2a8",
    lighting: { outdoor: "#f6f2ea", indoor: "#e2d6c0", underground: "#b4b1c2", edge: "#9a948c" },
  },
  paddingtonhat: {
    canvasFilter: "sepia(0.48) saturate(1.28) hue-rotate(-8deg) brightness(1.04)",
    frame: "#dc8b35",
    panel: "rgb(53 34 19 / 90%)",
    accent: "#ffb347",
    text: "#fff2d6",
    muted: "#e6c49c",
    control: "rgb(53 34 19 / 76%)",
    activeControl: "rgb(131 75 28 / 90%)",
    atmosphere: "motes",
    particle: "#ffd27a",
    lighting: { outdoor: "#fbf6ee", indoor: "#f0e4cc", underground: "#b8b0b8", edge: "#a39a8e" },
  },
};

export function getStoryVisualTheme(storyId: string): StoryVisualTheme {
  const knownTheme = STORY_THEMES[storyId];
  if (knownTheme) return knownTheme;

  const hue = hashSeed(storyId) % 360;
  return {
    canvasFilter: `hue-rotate(${hue}deg) saturate(1.12)`,
    frame: `hsl(${hue} 36% 48%)`,
    panel: "rgb(25 34 37 / 90%)",
    accent: `hsl(${hue} 58% 72%)`,
    text: "#f5f0d7",
    muted: "#c7d0c3",
    control: "rgb(25 34 37 / 76%)",
    activeControl: `hsl(${hue} 38% 38% / 92%)`,
    atmosphere: "motes",
    particle: `hsl(${hue} 74% 82%)`,
    lighting: { outdoor: "#f0ede6", indoor: "#d9cdb8", underground: "#a9a6b8", edge: "#8e8a86" },
  };
}
