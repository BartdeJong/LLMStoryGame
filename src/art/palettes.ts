export const PALETTE_NAMES = [
  "meadow",
  "forest",
  "cave",
  "ruins",
  "shore",
  "village",
  "dusk",
  "mist",
  // Added for pre-baked areas.
  "cottage",
  "kitchen",
  "parlour",
  "shop",
  "workshop",
  "office",
  "london",
  "park",
  "market",
  "lighthouse",
  "underwater",
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
  cottage: {
    ink: "#3d3530", shadow: "#6b5646", earth: "#c49a62", leaf: "#7f9a5e", leafLight: "#a9b977",
    cream: "#f3e6c4", highlight: "#fff4d6", water: "#6a9ab5", skin: "#e8b88f", accent: "#d9a441",
  },
  kitchen: {
    ink: "#3b322c", shadow: "#6e5243", earth: "#c27a45", leaf: "#7f9a5e", leafLight: "#a9b977",
    cream: "#f5ece0", highlight: "#fffaf0", water: "#6a9ab5", skin: "#e8b88f", accent: "#e08a3c",
  },
  parlour: {
    ink: "#2b2422", shadow: "#4f3a33", earth: "#7a4b36", leaf: "#5d6b4c", leafLight: "#8a9467",
    cream: "#d9c49a", highlight: "#f2dfae", water: "#4e7a83", skin: "#d9a582", accent: "#9e3b34",
  },
  shop: {
    ink: "#2e2620", shadow: "#4f3d2e", earth: "#7d5a3a", leaf: "#66704d", leafLight: "#959466",
    cream: "#e2cf9e", highlight: "#f7e3a8", water: "#5a8486", skin: "#dfac85", accent: "#c9973a",
  },
  workshop: {
    ink: "#35302b", shadow: "#5c4d3f", earth: "#a67c50", leaf: "#6d7d54", leafLight: "#9aa36d",
    cream: "#e6d6b0", highlight: "#f6e9c6", water: "#5f8d93", skin: "#e2b089", accent: "#c4553e",
  },
  office: {
    ink: "#2c3230", shadow: "#4b5552", earth: "#8a8470", leaf: "#5f7262", leafLight: "#8d9c86",
    cream: "#d8d3bd", highlight: "#eee8d2", water: "#5b7f8a", skin: "#d6aa8a", accent: "#8a5a3c",
  },
  london: {
    ink: "#2f3436", shadow: "#545c5e", earth: "#a39c8e", leaf: "#5f8a55", leafLight: "#8fb06e",
    cream: "#ece8de", highlight: "#fbf8f0", water: "#5f8fa6", skin: "#e6b48d", accent: "#c8443a",
  },
  park: {
    ink: "#26392e", shadow: "#3f5b45", earth: "#a58a62", leaf: "#5e9a4f", leafLight: "#93c06a",
    cream: "#f1e7c3", highlight: "#fff8dc", water: "#4fa0c4", skin: "#e8b88f", accent: "#d9534a",
  },
  market: {
    ink: "#33302c", shadow: "#5a5048", earth: "#a07d58", leaf: "#6f9a4e", leafLight: "#a3c26a",
    cream: "#f2e3c0", highlight: "#fff3d2", water: "#5a98b0", skin: "#e6b48d", accent: "#d8483c",
  },
  lighthouse: {
    ink: "#2a3540", shadow: "#4a5866", earth: "#9a8468", leaf: "#6b8a6e", leafLight: "#98ad8f",
    cream: "#eef0ea", highlight: "#fffdf2", water: "#4f8aa8", skin: "#e2b392", accent: "#c0453c",
  },
  underwater: {
    ink: "#13303a", shadow: "#21505c", earth: "#4c7a78", leaf: "#2f7a72", leafLight: "#58a596",
    cream: "#b9d8c8", highlight: "#f2c46d", water: "#2e7f95", skin: "#d9b08f", accent: "#e09a3a",
  },
  mist: {
    ink: "#34434a", shadow: "#59696c", earth: "#9a8a73", leaf: "#718982", leafLight: "#a4b09a",
    cream: "#d9dcc8", highlight: "#f0ead4", water: "#6e9da0", skin: "#dfb69a", accent: "#bf8173",
  },
};

export function getPaletteColor(palette: Palette, slot: PaletteColorSlot): string {
  return palette[slot];
}

// Surfaces for rooms and walls, kept apart from the 10 character colour slots.
export interface Surface {
  readonly floor: string; // main floor colour (light, warm)
  readonly floorAlt: string; // second floor colour: checks, plank variation, carpet speckle
  readonly seam: string; // lines between boards, tiles and stones
  readonly wallFace: string; // the lit front of a wall
  readonly wallTop: string; // the dark top of a wall seen from above
  readonly trim: string; // skirting board, panel rails, door frames
  readonly rug: string; // rug and counter accent
}

export const SURFACES: Readonly<Record<PaletteName, Surface>> = {
  meadow: { floor: "#dcc190", floorAlt: "#cfb280", seam: "#a98a5e", wallFace: "#dccfa6", wallTop: "#4d4338", trim: "#8a6b4a", rug: "#b5544a" },
  forest: { floor: "#c9ad7c", floorAlt: "#bc9f6e", seam: "#8f7650", wallFace: "#b9ae88", wallTop: "#33403a", trim: "#6e5a40", rug: "#8d4a3c" },
  cave: { floor: "#a6967c", floorAlt: "#988870", seam: "#6f6250", wallFace: "#7b7a78", wallTop: "#2b313b", trim: "#555a63", rug: "#8a5a50" },
  ruins: { floor: "#cbb68a", floorAlt: "#bda87c", seam: "#8d7a58", wallFace: "#b2a487", wallTop: "#3f3a38", trim: "#7a6a50", rug: "#a2584a" },
  shore: { floor: "#ead2a0", floorAlt: "#dcc28e", seam: "#b39868", wallFace: "#e4dcc2", wallTop: "#3f5558", trim: "#a98258", rug: "#d0705c" },
  village: { floor: "#d6b685", floorAlt: "#c8a875", seam: "#9c7c54", wallFace: "#dccfa8", wallTop: "#4a4039", trim: "#835f43", rug: "#b2523f" },
  dusk: { floor: "#cfae8a", floorAlt: "#c0a07c", seam: "#8f7258", wallFace: "#cdb9a6", wallTop: "#3a3850", trim: "#7a5f56", rug: "#a8605f" },
  mist: { floor: "#cdbc9c", floorAlt: "#bfae8e", seam: "#8f8068", wallFace: "#c8c9b6", wallTop: "#3b4a50", trim: "#6f7a74", rug: "#946a64" },
  cottage: { floor: "#e6c68e", floorAlt: "#d9b87c", seam: "#b08e58", wallFace: "#f2e1b0", wallTop: "#5c4636", trim: "#a97b4d", rug: "#c8643f" },
  kitchen: { floor: "#f3ebdc", floorAlt: "#dc8a45", seam: "#bfae98", wallFace: "#f0d9a6", wallTop: "#5a4234", trim: "#fffaf0", rug: "#4f8f8a" },
  parlour: { floor: "#a9683f", floorAlt: "#9a5c38", seam: "#6a3d28", wallFace: "#8f3a36", wallTop: "#2a1d1c", trim: "#4d2e24", rug: "#c2563f" },
  shop: { floor: "#b98a5a", floorAlt: "#aa7c4e", seam: "#7a5636", wallFace: "#9a7048", wallTop: "#2c2119", trim: "#d2a640", rug: "#8f3a34" },
  workshop: { floor: "#c9a272", floorAlt: "#ba9364", seam: "#8a6a46", wallFace: "#b4875a", wallTop: "#38302a", trim: "#5c8a96", rug: "#c4553e" },
  office: { floor: "#c8b08a", floorAlt: "#baa27c", seam: "#8d7856", wallFace: "#a9bfae", wallTop: "#2e3836", trim: "#5d4a3a", rug: "#5e7f6e" },
  london: { floor: "#c9c5bb", floorAlt: "#b9b5ab", seam: "#85827a", wallFace: "#a7a9a6", wallTop: "#3b4244", trim: "#6a6f6c", rug: "#a14a45" },
  park: { floor: "#d9c496", floorAlt: "#cbb688", seam: "#a28a60", wallFace: "#5e9a4f", wallTop: "#2c5238", trim: "#8a6a48", rug: "#d9534a" },
  market: { floor: "#dcc08a", floorAlt: "#cdb27c", seam: "#a08658", wallFace: "#e9cfa0", wallTop: "#5a4a3c", trim: "#d8483c", rug: "#d8483c" },
  lighthouse: { floor: "#d6bf94", floorAlt: "#c8b186", seam: "#9a8462", wallFace: "#f0f0ea", wallTop: "#46525c", trim: "#c0453c", rug: "#4f7fa0" },
  underwater: { floor: "#7fb3a5", floorAlt: "#6fa396", seam: "#3f7a78", wallFace: "#4f9a98", wallTop: "#143440", trim: "#e09a3a", rug: "#e09a3a" },
};
