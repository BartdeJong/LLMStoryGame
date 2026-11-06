export const PALETTE_NAMES = [
  "meadow",
  "forest",
  "cave",
  "ruins",
  "shore",
  "village",
  "dusk",
  "mist",
] as const;

export type PaletteName = (typeof PALETTE_NAMES)[number];

export const PALETTE_COLOR_SLOTS = [
  "ink",
  "shadow",
  "earth",
  "leaf",
  "leafLight",
  "cream",
  "highlight",
  "water",
  "skin",
  "accent",
] as const;

export type PaletteColorSlot = (typeof PALETTE_COLOR_SLOTS)[number];
export type Palette = Readonly<Record<PaletteColorSlot, string>>;

export const PALETTES: Readonly<Record<PaletteName, Palette>> = {
  meadow: {
    ink: "#283b35", shadow: "#405647", earth: "#9b7756", leaf: "#668653", leafLight: "#91a86a",
    cream: "#eadcb0", highlight: "#f6e8c2", water: "#57999a", skin: "#e9b888", accent: "#ca7958",
  },
  forest: {
    ink: "#20352f", shadow: "#355347", earth: "#766247", leaf: "#496f4a", leafLight: "#77945a",
    cream: "#d8d5a5", highlight: "#ede7bd", water: "#4b8881", skin: "#d7a47d", accent: "#bd7655",
  },
  cave: {
    ink: "#29313d", shadow: "#414b59", earth: "#776957", leaf: "#586c68", leafLight: "#849087",
    cream: "#cbc8b5", highlight: "#e8dfc7", water: "#527c89", skin: "#d3a88f", accent: "#b78369",
  },
  ruins: {
    ink: "#3d3836", shadow: "#62564b", earth: "#927555", leaf: "#687650", leafLight: "#a19a68",
    cream: "#ddd0a7", highlight: "#f0e2ba", water: "#6d9690", skin: "#dfa983", accent: "#bf7157",
  },
  shore: {
    ink: "#2c4144", shadow: "#4c6460", earth: "#c29b6b", leaf: "#76936c", leafLight: "#a9ae78",
    cream: "#f0d9a8", highlight: "#fff0c8", water: "#4f9baa", skin: "#e6b38d", accent: "#d47e64",
  },
  village: {
    ink: "#3d3935", shadow: "#665348", earth: "#a47c56", leaf: "#66805a", leafLight: "#92a36a",
    cream: "#e4d5ad", highlight: "#f5e8c3", water: "#628f91", skin: "#e5b48d", accent: "#c87853",
  },
  dusk: {
    ink: "#34344a", shadow: "#514b62", earth: "#92715e", leaf: "#6b785e", leafLight: "#a19a73",
    cream: "#e5cba7", highlight: "#f4dfbb", water: "#637f9a", skin: "#dfa78b", accent: "#c77772",
  },
  mist: {
    ink: "#34434a", shadow: "#59696c", earth: "#9a8a73", leaf: "#718982", leafLight: "#a4b09a",
    cream: "#d9dcc8", highlight: "#f0ead4", water: "#6e9da0", skin: "#dfb69a", accent: "#bf8173",
  },
};

export function getPaletteColor(palette: Palette, slot: PaletteColorSlot): string {
  return palette[slot];
}
