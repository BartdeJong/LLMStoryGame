// Room and place types for the bake step: how a pack location's free text becomes a layout recipe.
import type { PaletteName } from "../../../src/art/palettes";
import { PALETTE_NAMES } from "../../../src/art/palettes";
import type { Biome, FloorStyle, WallStyle } from "../../../src/world/types";

export type DecorAt = "wall" | "side" | "corner" | "free" | "edge";
export interface DecorRule {
  icons: readonly string[];
  n: readonly [number, number];
  at: DecorAt;
}

export type Shape = "rect" | "L" | "octagon" | "hull" | "cave";
export type CounterStyle = "shop" | "kitchen" | "desk" | "none";

export interface Kind {
  name: string;
  group: "room" | "outdoor";
  biome: Biome;
  palette: PaletteName | "pack";
  floor: FloorStyle;
  wall: WallStyle;
  size: readonly [minW: number, maxW: number, minH: number, maxH: number];
  shape?: Shape;
  counter?: CounterStyle;
  rug?: "centre" | "runner";
  partition?: boolean;
  decor: readonly DecorRule[];
}

const room = (
  name: string, palette: Kind["palette"], floor: FloorStyle, wall: WallStyle,
  size: Kind["size"], decor: readonly DecorRule[], extra: Partial<Kind> = {},
): Kind => ({ name, group: "room", biome: "building", palette, floor, wall, size, decor, ...extra });

const outdoor = (
  name: string, biome: Biome, palette: Kind["palette"], floor: FloorStyle, wall: WallStyle,
  size: Kind["size"], decor: readonly DecorRule[], extra: Partial<Kind> = {},
): Kind => ({ name, group: "outdoor", biome, palette, floor, wall, size, decor, ...extra });

const SMALL = [14, 18, 10, 12] as const;
const MEDIUM = [20, 26, 12, 15] as const;
const LARGE = [28, 36, 15, 20] as const;

export const KINDS: Record<string, Kind> = {
  bedroom: room("bedroom", "cottage", "boards", "plaster", SMALL, [
    { at: "wall", icons: ["mirror", "painting"], n: [1, 2] },
    { at: "corner", icons: ["flower", "basket"], n: [1, 2] },
    { at: "side", icons: ["chair", "stool"], n: [1, 1] },
  ], { rug: "centre" }),
  kitchen: room("kitchen", "kitchen", "tiles", "plaster", MEDIUM, [
    { at: "wall", icons: ["stove", "painting"], n: [1, 2] },
    { at: "corner", icons: ["barrel", "basket", "sack"], n: [2, 3] },
    { at: "side", icons: ["stool"], n: [1, 2] },
  ], { counter: "kitchen" }),
  bakery: room("bakery", "kitchen", "tiles", "plaster", MEDIUM, [
    { at: "wall", icons: ["stove", "painting"], n: [1, 2] },
    { at: "corner", icons: ["sack", "basket", "barrel"], n: [2, 3] },
    { at: "side", icons: ["stool"], n: [1, 1] },
  ], { counter: "shop" }),
  shop: room("shop", "shop", "boards", "wood", MEDIUM, [
    { at: "wall", icons: ["grandfather_clock", "painting", "display_stand", "mirror"], n: [2, 3] },
    { at: "corner", icons: ["crate", "barrel", "urn"], n: [2, 3] },
  ], { counter: "shop", rug: "centre" }),
  workshop: room("workshop", "workshop", "boards", "wood", [16, 20, 10, 12], [
    { at: "corner", icons: ["barrel", "crate", "bucket"], n: [2, 3] },
    { at: "side", icons: ["stool", "table"], n: [1, 2] },
    { at: "wall", icons: ["candle"], n: [1, 1] },
  ], { counter: "desk" }),
  shed: room("shed", "workshop", "boards", "wood", [14, 16, 9, 10], [
    { at: "corner", icons: ["barrel", "crate", "bucket"], n: [2, 3] },
    { at: "side", icons: ["stool"], n: [1, 1] },
  ]),
  office: room("office", "office", "boards", "plaster", MEDIUM, [
    { at: "wall", icons: ["bookshelf", "painting", "grandfather_clock"], n: [2, 3] },
    { at: "side", icons: ["chair"], n: [1, 2] },
    { at: "corner", icons: ["flower", "lamp_stand"], n: [1, 2] },
  ], { counter: "desk", rug: "centre" }),
  archive: room("archive", "office", "boards", "wood", MEDIUM, [
    { at: "wall", icons: ["bookshelf"], n: [4, 5] },
    { at: "corner", icons: ["lamp_stand"], n: [1, 2] },
    { at: "side", icons: ["stool", "chair"], n: [1, 2] },
  ], { counter: "desk" }),
  library: room("library", "parlour", "carpet", "wood", [24, 30, 14, 17], [
    { at: "wall", icons: ["bookshelf"], n: [5, 6] },
    { at: "corner", icons: ["lamp_stand", "flower"], n: [2, 2] },
    { at: "free", icons: ["chair", "table"], n: [1, 2] },
  ], { rug: "centre" }),
  hall: room("hall", "office", "tiles", "plaster", LARGE, [
    { at: "wall", icons: ["painting", "statue", "lamp_stand", "mirror"], n: [3, 4] },
    { at: "side", icons: ["bench", "chair"], n: [2, 3] },
    { at: "corner", icons: ["flower", "urn"], n: [2, 2] },
  ], { rug: "runner" }),
  parlour: room("parlour", "parlour", "carpet", "plaster", [22, 26, 13, 15], [
    { at: "wall", icons: ["painting", "mirror", "stove"], n: [2, 3] },
    { at: "side", icons: ["chair"], n: [1, 2] },
    { at: "corner", icons: ["flower", "lamp_stand"], n: [2, 2] },
  ], { rug: "centre" }),
  tower: room("tower", "pack", "flagstone", "stone", [16, 18, 14, 16], [
    { at: "side", icons: ["stool", "crate"], n: [1, 2] },
    { at: "corner", icons: ["barrel", "lamp_stand"], n: [1, 2] },
  ], { shape: "octagon", rug: "centre" }),
  lamproom: room("lamproom", "lighthouse", "flagstone", "stone", [14, 16, 12, 14], [
    { at: "side", icons: ["lamp_stand", "stool"], n: [2, 3] },
  ], { shape: "octagon", rug: "centre" }),
  cellar: room("cellar", "cave", "flagstone", "stone", MEDIUM, [
    { at: "corner", icons: ["barrel", "crate", "sack", "urn"], n: [3, 4] },
    { at: "side", icons: ["barrel", "crate"], n: [1, 2] },
  ], { partition: true }),
  ward: room("ward", "office", "tiles", "plaster", [22, 28, 13, 16], [
    { at: "side", icons: ["bed"], n: [3, 4] },
    { at: "corner", icons: ["flower"], n: [1, 2] },
    { at: "wall", icons: ["painting"], n: [1, 1] },
  ], { rug: "runner" }),
  uwhall: room("uwhall", "underwater", "flagstone", "stone", LARGE, [
    { at: "wall", icons: ["statue", "painting"], n: [5, 7] },
    { at: "corner", icons: ["urn", "flower"], n: [2, 3] },
    { at: "side", icons: ["lamp_stand", "statue"], n: [5, 6] },
  ], { rug: "runner" }),
  uwroom: room("uwroom", "underwater", "flagstone", "stone", SMALL, [
    { at: "corner", icons: ["urn", "flower"], n: [1, 2] },
    { at: "side", icons: ["lamp_stand"], n: [1, 2] },
  ], { shape: "octagon", rug: "centre" }),
  uwcistern: room("uwcistern", "underwater", "flagstone", "stone", MEDIUM, [
    { at: "corner", icons: ["urn", "barrel"], n: [2, 3] },
    { at: "wall", icons: ["lamp_stand"], n: [1, 2] },
  ], { shape: "L" }),
  uwstair: room("uwstair", "underwater", "flagstone", "stone", [10, 12, 20, 22], [
    { at: "side", icons: ["lamp_stand"], n: [3, 4] },
  ], { rug: "runner", biome: "cave" }),
  hull: room("hull", "underwater", "boards", "wood", [30, 34, 12, 14], [
    { at: "side", icons: ["barrel", "crate", "sack"], n: [3, 4] },
    { at: "corner", icons: ["crate", "urn"], n: [1, 2] },
  ], { shape: "hull", biome: "cave" }),
  generic: room("generic", "pack", "boards", "plaster", MEDIUM, [
    { at: "wall", icons: ["painting", "mirror"], n: [1, 2] },
    { at: "corner", icons: ["flower", "barrel"], n: [1, 2] },
    { at: "side", icons: ["chair"], n: [1, 1] },
  ], { rug: "centre", partition: true }),
  ruins: room("ruins", "ruins", "flagstone", "stone", MEDIUM, [
    { at: "free", icons: ["stone", "mushroom"], n: [2, 3] },
  ], { biome: "ruins" }),
  cave: room("cave", "cave", "dirt", "rock", [30, 36, 16, 20], [
    { at: "free", icons: ["stone", "mushroom"], n: [2, 3] },
  ], { shape: "cave", biome: "cave" }),

  garden: outdoor("garden", "meadow", "park", "grass", "hedge", [24, 30, 14, 17], [
    { at: "edge", icons: ["bench", "flower"], n: [2, 3] },
  ]),
  park: outdoor("park", "meadow", "park", "grass", "fence", [32, 38, 17, 20], [
    { at: "edge", icons: ["bench", "lamp_post"], n: [4, 5] },
  ]),
  street: outdoor("street", "village", "pack", "cobble", "brick", [32, 38, 11, 12], [
    { at: "wall", icons: ["lamp_post", "barrel", "crate", "bench"], n: [3, 5] },
    { at: "edge", icons: ["lamp_post", "bench"], n: [1, 2] },
  ]),
  square: outdoor("square", "village", "village", "cobble", "brick", [30, 36, 17, 21], [
    { at: "wall", icons: ["lamp_post", "bench"], n: [3, 4] },
    { at: "edge", icons: ["bench"], n: [1, 2] },
  ]),
  market: outdoor("market", "village", "market", "cobble", "brick", [34, 40, 15, 18], [
    { at: "wall", icons: ["barrel", "crate", "basket", "sack"], n: [3, 4] },
    { at: "free", icons: ["barrel", "crate", "basket"], n: [2, 3] },
  ]),
  yard: outdoor("yard", "village", "pack", "dirt", "brick", [28, 34, 14, 17], [
    { at: "wall", icons: ["crate", "barrel", "cart_wheel"], n: [3, 4] },
    { at: "free", icons: ["crate", "barrel"], n: [2, 3] },
  ]),
  harbour: outdoor("harbour", "shore", "shore", "deck", "rock", [30, 36, 15, 18], [
    { at: "edge", icons: ["barrel", "crate", "sack", "lamp_post"], n: [3, 5] },
    { at: "free", icons: ["stone", "crate", "barrel"], n: [2, 3] },
  ]),
  shore: outdoor("shore", "shore", "shore", "sand", "rock", [28, 34, 14, 17], [
    { at: "free", icons: ["shell", "stone"], n: [6, 8] },
  ]),
  tidepool: outdoor("tidepool", "shore", "shore", "sand", "rock", [26, 32, 14, 16], [
    { at: "free", icons: ["shell", "stone"], n: [6, 8] },
  ]),
  islet: outdoor("islet", "shore", "pack", "sand", "rock", [22, 28, 13, 16], [
    { at: "free", icons: ["stone", "shell"], n: [8, 10] },
  ]),
  reeds: outdoor("reeds", "shore", "meadow", "grass", "rock", [28, 34, 15, 18], [
    { at: "free", icons: ["stone", "mushroom"], n: [1, 2] },
  ]),
  kelp: outdoor("kelp", "forest", "underwater", "sand", "rock", [28, 34, 15, 18], [
    { at: "free", icons: ["stone", "shell"], n: [2, 3] },
  ]),
  meadow: outdoor("meadow", "meadow", "meadow", "grass", "hedge", [28, 34, 15, 18], [
    { at: "free", icons: ["mushroom", "stone", "flower"], n: [2, 3] },
  ]),
  forest: outdoor("forest", "forest", "forest", "grass", "hedge", [28, 34, 15, 18], [
    { at: "free", icons: ["mushroom", "stone"], n: [2, 3] },
  ]),
  roof: outdoor("roof", "ruins", "dusk", "flagstone", "stone", [18, 22, 11, 13], [
    { at: "corner", icons: ["urn", "barrel"], n: [1, 2] },
  ], { shape: "L" }),
};

// Ordered rules: the first pattern that matches "name | biome" picks the kind.
const RULES: readonly [RegExp, string][] = [
  [/underwater stair|deep stair/, "uwstair"],
  [/underwater hall|drowned gallery/, "uwhall"],
  [/cistern/, "uwcistern"],
  [/underwater|drowned/, "uwroom"],
  [/wreck/, "hull"],
  [/kelp/, "kelp"],
  [/reed/, "reeds"],
  [/lamp room|lighthouse top/, "lamproom"],
  [/mothlight base|lighthouse base|tower/, "tower"],
  [/rooftop|\broof\b/, "roof"],
  [/cellar/, "cellar"],
  [/counting ?house|countinghouse/, "office"],
  [/bakery/, "bakery"],
  [/kitchen/, "kitchen"],
  [/\bshed\b|\bhut\b/, "shed"],
  [/pawnshop|\bshop\b|clockmaker/, "shop"],
  [/back room|workshop|oil press|loft/, "workshop"],
  [/library|reading room/, "library"],
  [/committee|council|booking/, "hall"],
  [/attic|bedroom|'s room|\broom$/, "bedroom"],
  [/baker street|sitting|parlou?r|\bhouse\b/, "parlour"],
  [/archive/, "archive"],
  [/mortuary|ward\b/, "ward"],
  [/hall|committee|council|booking|gallery/, "hall"],
  [/scotland yard|office|chambers|telegraph|pressroom|press room|vault|record/, "office"],
  [/square/, "square"],
  [/market/, "market"],
  [/street|\brow\b|cab stand|bus stop|lane|windsor/, "street"],
  [/warehouse yard|\byard\b/, "yard"],
  [/bandstand|park/, "park"],
  [/garden/, "garden"],
  [/tidepool/, "tidepool"],
  [/rock|islet/, "islet"],
  [/harbou?r|quay|berth|landing|mooring|steps|stairs|pier|dock/, "harbour"],
  [/fog|shore|beach|coast/, "shore"],
  [/meadow|field/, "meadow"],
  [/forest|wood|grove/, "forest"],
  [/ruin/, "ruins"],
  [/cave/, "cave"],
];

export interface Classified {
  kind: Kind;
  biome: Biome;
  palette: PaletteName;
  floor: FloorStyle;
  wall: WallStyle;
}

const isPalette = (text: string): text is PaletteName => (PALETTE_NAMES as readonly string[]).includes(text);

export function classifyLocation(location: { name: string; biome: string; palette: string; role: string }): Classified {
  const name = location.name.toLowerCase();
  const biome = location.biome.toLowerCase();
  const text = `${name} | ${biome}`;
  let kindName = RULES.find(([pattern]) => pattern.test(name))?.[1]
    ?? RULES.find(([pattern]) => pattern.test(text))?.[1];
  if (!kindName) kindName = /interior|building|indoor/.test(biome) ? "generic" : "meadow";
  const kind = KINDS[kindName]!;
  let palette: PaletteName;
  if (kind.palette !== "pack") palette = kind.palette;
  else if (/lighthouse|mothlight/.test(text)) palette = "lighthouse";
  else if (/london/.test(text)) palette = "london";
  else palette = isPalette(location.palette) ? location.palette : "village";
  if (kind.name === "street" && /london/.test(text)) palette = "london";
  if (kind.name === "street" && /cab stand|row|lane/.test(name) && palette === "village") palette = "village";
  if (kind.name === "tower" && /mothlight|lighthouse/.test(text)) palette = "lighthouse";
  if (kind.name === "tower" && /clock/.test(name)) palette = "workshop";
  // The same free text decides the surface materials of a few places.
  let { floor, wall } = kind;
  if (kind.name === "harbour" && /stairs|steps/.test(name)) floor = "flagstone";
  if (kind.name === "street" && /london/.test(text)) wall = "brick";
  if (kind.name === "tower" && /clock/.test(name)) { floor = "boards"; wall = "wood"; }
  if (kind.name === "generic" || kind.name === "hall") {
    if (/church/.test(name)) { floor = "flagstone"; wall = "stone"; palette = "village"; }
    if (/council/.test(name)) { floor = "boards"; wall = "wood"; palette = "ruins"; }
  }
  if (kind.name === "hall" && /committee|booking|gallery/.test(name) && !/underwater/.test(text)) {
    floor = /booking/.test(name) ? "tiles" : "carpet";
  }
  if (kind.name === "workshop" && /oil press|sailmaker/.test(name)) { wall = "wood"; }
  if (kind.name === "office" && /yard|police/.test(text)) { floor = "tiles"; }
  if (kind.name === "office" && /vault|record/.test(name)) { floor = "flagstone"; wall = "stone"; }
  return { kind, biome: kind.biome, palette, floor, wall };
}
