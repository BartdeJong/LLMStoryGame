import { FURNITURE_AND_CLUES_GLYPHS } from "./furnitureAndClues";
import { LEGACY_AND_CONTAINER_GLYPHS } from "./legacyAndContainers";
import { TOOLS_AND_PAPER_GLYPHS } from "./toolsAndPaper";
import { VALUABLES_AND_NATURE_GLYPHS } from "./valuablesAndNature";

export const GLYPH_CATEGORIES = [
  "container", "tool", "paper", "valuable", "clothing", "food", "nature", "furniture", "machine", "danger", "generic",
] as const;
export type GlyphCategory = (typeof GLYPH_CATEGORIES)[number];

export const GLYPH_MATERIALS = [
  "metal", "glass", "wood", "paper", "cloth", "stone", "organic", "liquid", "light", "misc",
] as const;
export type GlyphMaterial = (typeof GLYPH_MATERIALS)[number];

export const GLYPH_STATES = ["glow", "cracked", "stained", "rusty", "dusty"] as const;
export type GlyphState = (typeof GLYPH_STATES)[number];

export interface GlyphDefinition {
  readonly id: string;
  readonly name: string;
  readonly category: GlyphCategory;
  readonly material: GlyphMaterial;
  readonly tags: readonly string[];
  readonly rows: readonly string[];
  readonly size: "1x1";
}

export interface VisualSpec {
  readonly icon: string;
  readonly accent?: string;
  readonly states?: readonly GlyphState[];
}

export const GLYPH_CATALOG: readonly GlyphDefinition[] = [
  ...LEGACY_AND_CONTAINER_GLYPHS,
  ...TOOLS_AND_PAPER_GLYPHS,
  ...VALUABLES_AND_NATURE_GLYPHS,
  ...FURNITURE_AND_CLUES_GLYPHS,
  {
    id: "lighthouse",
    name: "Lighthouse",
    category: "machine",
    material: "stone",
    tags: ["lighthouse", "beacon", "tower", "light", "lamp", "sea", "thirteenth"],
    size: "1x1",
    rows: [
      "................",
      "......aaaa......",
      ".....adddda.....",
      ".....oggggo.....",
      "......oooo......",
      ".....obbbbo.....",
      ".....obbbbo.....",
      ".....oaaaao.....",
      ".....obbbbo.....",
      "....obbbbbbo....",
      "....obbbbbbo....",
      "...obbbbbbbbo...",
      "...osssssssso...",
      "................",
      "................",
      "................",
    ],
  },
  {
    id: "stone_lighthouse",
    name: "Lighthouse2",
    category: "machine",
    material: "stone",
    tags: ["lighthouse", "tower", "beacon", "light", "nautical", "coast"],
    size: "1x1",
    rows: [
      "................",
      "......oooo......",
      ".....oaaaaao....",
      "...aoaggggaoa...",
      ".....oaaaaao....",
      "..oooooooooooo..",
      "....obbbbbbo....",
      "....obbbbbbo....",
      "....obssssbo....",
      "...obbbbbbbbo...",
      "...obssssssbo...",
      "...obbbbbbbbo...",
      "..obbbbbbbbbbo..",
      "..obsssddsssbo..",
      ".obbbbbddbbbbbo.",
      ".oooooooooooooo.",
    ],
  }
];

export function getGlyph(id: string): GlyphDefinition | undefined {
  return GLYPH_CATALOG.find((glyph) => glyph.id === id);
}
