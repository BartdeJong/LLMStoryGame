import { createPixelCanvas } from "./canvas";
import { PALETTES, type PaletteColorSlot, type PaletteName } from "./palettes";

export const BODY_SHAPES = ["round", "tall", "small", "quadruped", "floaty"] as const;
export const CHARACTER_FEATURES = [
  "none",
  "horns",
  "hat",
  "wings",
  "tail",
  "glasses",
  "antenna",
  "deerstalker",
  "moustache",
  "bonnet",
  "bowler",
  "top-hat",
  "flat-cap",
  "headscarf",
  "monocle",
  "cravat",
  "veil",
] as const;
export const DIRECTIONS = ["down", "up", "left", "right"] as const;
export const WALK_FRAME_COUNTS = [2, 3, 4] as const;

export type BodyShape = (typeof BODY_SHAPES)[number];
export type CharacterFeature = (typeof CHARACTER_FEATURES)[number];
export type Direction = (typeof DIRECTIONS)[number];
export type WalkFrameCount = (typeof WALK_FRAME_COUNTS)[number];

export interface CharacterRecipe {
  readonly body: BodyShape;
  readonly bodyColor: PaletteColorSlot;
  readonly accentColor: PaletteColorSlot;
  readonly skinColor: PaletteColorSlot;
  readonly feature: CharacterFeature;
  readonly walkFrames: WalkFrameCount;
}

export const DEFAULT_CHARACTER_RECIPE: CharacterRecipe = {
  body: "round",
  bodyColor: "water",
  accentColor: "earth",
  skinColor: "skin",
  feature: "hat",
  walkFrames: 2,
};

const spriteCache = new Map<string, HTMLCanvasElement>();

export function paintCharacterSprite(
  recipe: CharacterRecipe,
  paletteName: PaletteName,
  direction: Direction = "down",
  frame = 0,
): HTMLCanvasElement {
  const { canvas, context } = createPixelCanvas();
  const palette = PALETTES[paletteName];
  const body = palette[recipe.bodyColor];
  const accent = palette[recipe.accentColor];
  const skin = palette[recipe.skinColor];
  const pose = Math.floor(frame) % recipe.walkFrames;
  const step = pose === 0 ? 0 : pose % 2 === 1 ? 1 : -1;
  const pixel = (color: string, x: number, y: number, width = 1, height = 1) => {
    context.fillStyle = color;
    context.fillRect(x, y, width, height);
  };

  pixel(palette.shadow, 4, 14, 8, 1);
  if (recipe.body === "quadruped") {
    pixel(body, 3, 7, 10, 5);
    pixel(skin, direction === "left" ? 1 : 10, 6, 4, 4);
    pixel(accent, 4, 5, 7, 3);
    pixel(palette.ink, 4, 12 + step, 2, 2);
    pixel(palette.ink, 10, 12 - step, 2, 2);
  } else {
    if (recipe.body === "tall") {
      pixel(body, 5, 5, 6, 8);
      pixel(accent, 6, 8, 4, 4);
    } else if (recipe.body === "small") {
      pixel(body, 5, 8, 6, 5);
      pixel(accent, 6, 9, 4, 3);
    } else if (recipe.body === "floaty") {
      pixel(body, 4, 7, 8, 6);
      pixel(accent, 5, 12, 2, 2);
      pixel(accent, 9, 12, 2, 2);
    } else {
      pixel(body, 4, 7, 8, 6);
      pixel(accent, 5, 9, 6, 3);
    }

    pixel(palette.ink, 5, 12 + step, 2, 2);
    pixel(palette.ink, 9, 12 - step, 2, 2);
    pixel(skin, 5, 3, 6, 5);
    pixel(palette.highlight, 6, 4, 1, 1);
    pixel(palette.highlight, 9, 4, 1, 1);

    if (direction === "up") {
      pixel(accent, 5, 3, 6, 3);
    } else if (direction === "left") {
      pixel(palette.ink, 5, 5);
      pixel(palette.ink, 8, 5);
      pixel(skin, 5, 4, 1, 2);
    } else if (direction === "right") {
      pixel(palette.ink, 7, 5);
      pixel(palette.ink, 10, 5);
      pixel(skin, 10, 4, 1, 2);
    } else {
      pixel(palette.ink, 6, 5);
      pixel(palette.ink, 9, 5);
    }
  }

  switch (recipe.feature) {
    case "horns":
      pixel(accent, 4, 3, 2, 2);
      pixel(accent, 10, 3, 2, 2);
      break;
    case "hat":
      pixel(accent, 4, 3, 8, 2);
      pixel(palette.highlight, 6, 1, 5, 2);
      break;
    case "wings":
      pixel(palette.highlight, 1, 7, 3, 4);
      pixel(palette.highlight, 12, 7, 3, 4);
      pixel(accent, 2, 8, 2, 2);
      pixel(accent, 12, 8, 2, 2);
      break;
    case "tail":
      pixel(accent, 11, 10, 3, 2);
      pixel(accent, 13, 8, 2, 3);
      break;
    case "glasses":
      pixel(palette.ink, 5, 4, 3, 2);
      pixel(palette.ink, 9, 4, 3, 2);
      pixel(palette.ink, 8, 5);
      break;
    case "antenna":
      pixel(palette.ink, 8, 1, 1, 3);
      pixel(accent, 7, 0, 3, 1);
      break;
    case "deerstalker":
      pixel(accent, 5, 0, 6, 1);
      pixel(accent, 4, 1, 8, 2);
      pixel(palette.highlight, 7, 1, 2, 1);
      pixel(accent, 3, 3, 10, 1);
      pixel(palette.shadow, 3, 4, 2, 2);
      pixel(palette.shadow, 11, 4, 2, 2);
      break;
    case "moustache":
      pixel(accent, 6, 6, 4, 1);
      pixel(accent, 5, 5, 2, 1);
      pixel(accent, 9, 5, 2, 1);
      break;
    case "bonnet":
      pixel(accent, 4, 1, 8, 2);
      pixel(accent, 3, 3, 10, 1);
      pixel(accent, 2, 4, 2, 2);
      pixel(accent, 12, 4, 2, 2);
      pixel(palette.highlight, 5, 3, 6, 1);
      break;
    case "bowler":
      pixel(accent, 5, 0, 6, 2);
      pixel(accent, 4, 2, 8, 2);
      pixel(palette.shadow, 5, 2, 6, 1);
      pixel(palette.highlight, 7, 1, 2, 1);
      break;
    case "top-hat":
      pixel(accent, 6, 0, 4, 3);
      pixel(accent, 4, 3, 8, 1);
      pixel(palette.shadow, 6, 2, 4, 1);
      pixel(palette.highlight, 7, 1, 2, 1);
      break;
    case "flat-cap":
      pixel(accent, 4, 1, 8, 2);
      pixel(accent, 3, 3, 10, 1);
      pixel(palette.shadow, 9, 2, 3, 1);
      pixel(palette.highlight, 6, 1, 2, 1);
      break;
    case "headscarf":
      pixel(accent, 4, 1, 8, 2);
      pixel(accent, 3, 3, 2, 4);
      pixel(accent, 11, 3, 2, 4);
      pixel(palette.highlight, 5, 2, 6, 1);
      break;
    case "monocle":
      pixel(palette.highlight, 8, 3, 4, 1);
      pixel(palette.highlight, 8, 6, 4, 1);
      pixel(palette.highlight, 8, 4, 1, 2);
      pixel(palette.highlight, 11, 4, 1, 2);
      pixel(accent, 11, 7, 1, 2);
      break;
    case "cravat":
      pixel(accent, 7, 7, 2, 2);
      pixel(palette.highlight, 7, 8, 1, 3);
      pixel(accent, 6, 9, 4, 2);
      break;
    case "veil":
      pixel(accent, 4, 1, 8, 2);
      pixel(accent, 3, 3, 1, 6);
      pixel(accent, 12, 3, 1, 6);
      pixel(palette.highlight, 5, 2, 6, 1);
      break;
    case "none":
      break;
  }

  return canvas;
}

export function getCharacterSprite(
  recipe: CharacterRecipe,
  paletteName: PaletteName,
  direction: Direction = "down",
  frame = 0,
): HTMLCanvasElement {
  const pose = Math.floor(frame) % recipe.walkFrames;
  const key = `${paletteName}:${JSON.stringify(recipe)}:${direction}:${pose}`;
  let canvas = spriteCache.get(key);
  if (!canvas) {
    canvas = paintCharacterSprite(recipe, paletteName, direction, pose);
    spriteCache.set(key, canvas);
  }
  return canvas;
}
