import { getGlyph } from "./catalog";
import { tokenizeVisualText } from "./matcher";

// How a glyph sits in a room: hung on the wall face, drawn larger as a piece of furniture, or as a plain 16px prop.
// Same wall-mounted idea as the story-forge bake tool.
const WALL_MOUNTED_WORDS = new Set([
  "window", "shelf", "poster", "banner", "plaque", "hook", "rail", "notice", "board",
  "painting", "picture", "mirror", "clock", "peg",
]);
// Glyphs that carry their own post or stand; they are never hung up.
const NEVER_WALL = new Set(["grandfather_clock", "signpost", "display_stand", "lamp_post", "lamp_stand"]);
// Free-standing signs hang on the wall as just their board.
const WALL_CROP_ROWS: Readonly<Record<string, number>> = { sign: 9 };

// Furniture drawn at 1.5 tiles, standing on the bottom of its own tile.
const BIG_FURNITURE = new Set([
  "bed", "bookshelf", "table", "council_table", "cooling_table", "grandfather_clock", "stove",
  "wardrobe", "desk", "cupboard", "sofa", "armchair", "piano", "counter", "cabinet",
]);

export const BIG_FURNITURE_SCALE = 1.5;

export function isWallMounted(iconId: string, name = ""): boolean {
  const base = iconId.replace(/_open$/, "");
  if (NEVER_WALL.has(base)) return false;
  const words = new Set([
    ...tokenizeVisualText(`${base.replace(/_/g, " ")} ${getGlyph(base)?.name ?? ""} ${name}`),
  ]);
  return [...WALL_MOUNTED_WORDS].some((word) => words.has(word));
}

export function wallCropRows(iconId: string): number {
  return WALL_CROP_ROWS[iconId.replace(/_open$/, "")] ?? 16;
}

export function isBigFurniture(iconId: string): boolean {
  return BIG_FURNITURE.has(iconId.replace(/_open$/, ""));
}

// Big furniture needs room above and to both sides; if any of those tiles holds something else it stays 16px.
export function canEnlarge(
  x: number,
  y: number,
  isBusy: (tileX: number, tileY: number) => boolean,
): boolean {
  return !isBusy(x, y - 1) && !isBusy(x - 1, y) && !isBusy(x + 1, y) && !isBusy(x - 1, y - 1) && !isBusy(x + 1, y - 1);
}

// The last non-empty glyph row, so large furniture can stand on the bottom of its tile.
export function glyphBottomRow(iconId: string): number {
  const glyph = getGlyph(iconId.replace(/_open$/, ""));
  if (!glyph) return 15;
  for (let row = glyph.rows.length - 1; row >= 0; row -= 1) if (/[^.]/.test(glyph.rows[row]!)) return row;
  return 15;
}
