import { createPixelCanvas } from "./canvas";
import { PALETTES, type PaletteName } from "./palettes";
import { createSeededRandom, type Seed } from "./random";

export const TILE_TYPES = [
  "grass",
  "path",
  "water",
  "tree",
  "rock",
  "wall",
  "floor",
  "door",
  "trail-exit",
  "cave-mouth",
  "gate",
  "hatch",
  "flowers",
  "bridge",
] as const;

export type TileType = (typeof TILE_TYPES)[number];

const tileCache = new Map<string, HTMLCanvasElement>();

export function paintTile(
  paletteName: PaletteName,
  tile: TileType,
  seed: Seed = 0,
  frame = 0,
): HTMLCanvasElement {
  const { canvas, context } = createPixelCanvas();
  const palette = PALETTES[paletteName];
  const random = createSeededRandom(`${seed}:${paletteName}:${tile}`);
  const pixel = (color: string, x: number, y: number, width = 1, height = 1) => {
    context.fillStyle = color;
    context.fillRect(x, y, width, height);
  };

  const ground = (color: string) => {
    context.fillStyle = color;
    context.fillRect(0, 0, 16, 16);
  };

  switch (tile) {
    case "grass":
      ground(palette.leaf);
      for (let index = 0; index < 12; index += 1) {
        const color = random() > 0.53 ? palette.leafLight : palette.shadow;
        pixel(color, 1 + Math.floor(random() * 14), 1 + Math.floor(random() * 14), 1 + Math.floor(random() * 2), 1);
      }
      break;
    case "path":
      ground(palette.earth);
      for (let index = 0; index < 8; index += 1) {
        const color = random() > 0.5 ? palette.cream : palette.shadow;
        pixel(color, 1 + Math.floor(random() * 14), 1 + Math.floor(random() * 14), 1 + Math.floor(random() * 2), 1);
      }
      break;
    case "water":
      ground(palette.water);
      pixel(palette.shadow, 0, 0, 16, 1);
      pixel(palette.shadow, 0, 15, 16, 1);
      pixel(palette.highlight, 2 + ((frame & 1) * 5), 4, 4, 1);
      pixel(palette.leafLight, 8 - ((frame & 1) * 3), 10, 5, 1);
      pixel(palette.highlight, 3, 13 - ((frame & 1) * 2), 2, 1);
      break;
    case "tree":
      ground(palette.leaf);
      pixel(palette.shadow, 2, 11, 12, 4);
      pixel(palette.earth, 7, 9, 3, 6);
      pixel(palette.shadow, 4, 5, 8, 7);
      pixel(palette.leafLight, 3, 3, 10, 7);
      pixel(palette.leafLight, 5, 1, 6, 3);
      pixel(palette.leaf, 2, 6, 12, 4);
      pixel(palette.highlight, 5, 4);
      pixel(palette.leaf, 9, 3, 2, 2);
      break;
    case "rock":
      ground(palette.leaf);
      pixel(palette.shadow, 3, 9, 10, 5);
      pixel(palette.ink, 4, 7, 8, 5);
      pixel(palette.cream, 5, 6, 6, 4);
      pixel(palette.highlight, 7, 5, 4, 2);
      pixel(palette.shadow, 10, 8, 2, 3);
      break;
    case "wall":
      ground(palette.earth);
      pixel(palette.shadow, 0, 0, 16, 2);
      pixel(palette.cream, 1, 3, 6, 4);
      pixel(palette.shadow, 7, 3, 1, 4);
      pixel(palette.cream, 9, 3, 6, 4);
      pixel(palette.shadow, 0, 8, 4, 1);
      pixel(palette.cream, 4, 9, 7, 5);
      pixel(palette.shadow, 11, 9, 1, 5);
      pixel(palette.cream, 12, 9, 4, 5);
      break;
    case "floor":
      ground(palette.earth);
      for (const y of [3, 8, 13]) pixel(palette.shadow, 0, y, 16, 1);
      for (const x of [5, 12]) pixel(palette.shadow, x, 0, 1, 3);
      for (const x of [2, 9]) pixel(palette.cream, x, 4, 1, 3);
      for (const x of [7, 14]) pixel(palette.cream, x, 9, 1, 3);
      break;
    case "door":
    case "hatch":
      ground(palette.earth);
      pixel(palette.shadow, 2, 0, 12, 16);
      pixel(palette.cream, 4, 2, 8, 14);
      pixel(palette.accent, 5, 3, 6, 11);
      pixel(palette.shadow, 6, 5, 4, 1);
      pixel(palette.highlight, 9, 9);
      pixel(palette.ink, 10, 9);
      break;
    case "trail-exit":
      ground(palette.leaf);
      pixel(palette.earth, 2, 0, 12, 16);
      pixel(palette.cream, 4, 1, 8, 14);
      pixel(palette.shadow, 6, 3, 4, 11);
      pixel(palette.leafLight, 3, 6, 2, 2);
      pixel(palette.leafLight, 11, 10, 2, 2);
      break;
    case "cave-mouth":
      ground(palette.earth);
      pixel(palette.shadow, 2, 4, 12, 12);
      pixel(palette.ink, 4, 3, 8, 12);
      pixel(palette.ink, 6, 1, 4, 3);
      pixel(palette.highlight, 5, 6, 2, 1);
      pixel(palette.shadow, 4, 14, 8, 2);
      break;
    case "gate":
      ground(palette.leaf);
      pixel(palette.earth, 2, 2, 3, 14);
      pixel(palette.earth, 11, 2, 3, 14);
      pixel(palette.cream, 3, 1, 10, 3);
      pixel(palette.shadow, 5, 5, 2, 11);
      pixel(palette.shadow, 9, 5, 2, 11);
      pixel(palette.accent, 3, 8, 10, 2);
      break;
    case "flowers":
      ground(palette.leaf);
      for (const [x, y] of [[4, 4], [11, 7], [7, 12], [13, 13]] as const) {
        pixel(palette.leafLight, x, y + 1, 1, 3);
        pixel(palette.highlight, x - 1, y, 3, 1);
        pixel(palette.accent, x, y - 1, 1, 3);
      }
      pixel(palette.cream, 4, 4);
      pixel(palette.cream, 11, 7);
      pixel(palette.highlight, 7, 12);
      pixel(palette.cream, 13, 13);
      break;
    case "bridge":
      ground(palette.water);
      pixel(palette.shadow, 0, 0, 16, 2);
      pixel(palette.shadow, 0, 14, 16, 2);
      for (const y of [3, 7, 11]) {
        pixel(palette.earth, 1, y, 14, 3);
        pixel(palette.cream, 2, y, 12, 1);
      }
      pixel(palette.shadow, 4, 2, 2, 12);
      pixel(palette.shadow, 10, 2, 2, 12);
      break;
  }

  return canvas;
}

export function getTileCanvas(
  paletteName: PaletteName,
  tile: TileType,
  seed: Seed = 0,
  frame = 0,
): HTMLCanvasElement {
  const shimmerFrame = tile === "water" ? frame & 1 : 0;
  const key = `${paletteName}:${tile}:${seed}:${shimmerFrame}`;
  let canvas = tileCache.get(key);
  if (!canvas) {
    canvas = paintTile(paletteName, tile, seed, shimmerFrame);
    tileCache.set(key, canvas);
  }
  return canvas;
}
