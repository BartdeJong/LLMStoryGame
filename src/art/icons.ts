import { createPixelCanvas } from "./canvas";
import { PALETTES, type PaletteColorSlot, type PaletteName } from "./palettes";

export const ICON_SHAPES = ["key", "potion", "book", "gem", "leaf", "feather", "lantern", "coin"] as const;
export type IconShape = (typeof ICON_SHAPES)[number];

export interface IconRecipe {
  readonly shape: IconShape;
  readonly primaryColor: PaletteColorSlot;
  readonly secondaryColor: PaletteColorSlot;
}

const iconCache = new Map<string, HTMLCanvasElement>();

export function paintIcon(recipe: IconRecipe, paletteName: PaletteName): HTMLCanvasElement {
  const { canvas, context } = createPixelCanvas();
  const palette = PALETTES[paletteName];
  const primary = palette[recipe.primaryColor];
  const secondary = palette[recipe.secondaryColor];
  const pixel = (color: string, x: number, y: number, width = 1, height = 1) => {
    context.fillStyle = color;
    context.fillRect(x, y, width, height);
  };

  switch (recipe.shape) {
    case "key":
      pixel(primary, 3, 4, 5, 5);
      pixel(secondary, 4, 5, 3, 3);
      pixel(primary, 7, 6, 7, 2);
      pixel(primary, 11, 8, 2, 3);
      pixel(primary, 13, 8, 2, 2);
      break;
    case "potion":
      pixel(secondary, 6, 2, 4, 2);
      pixel(primary, 7, 4, 2, 2);
      pixel(palette.highlight, 5, 6, 6, 7);
      pixel(primary, 4, 7, 8, 5);
      pixel(secondary, 5, 12, 6, 2);
      pixel(palette.highlight, 6, 8, 1, 2);
      break;
    case "book":
      pixel(palette.shadow, 3, 3, 10, 11);
      pixel(primary, 4, 4, 8, 9);
      pixel(secondary, 7, 4, 1, 9);
      pixel(palette.highlight, 5, 6, 1, 1);
      pixel(palette.highlight, 8, 7, 3, 1);
      break;
    case "gem":
      pixel(secondary, 6, 2, 4, 2);
      pixel(primary, 4, 4, 8, 2);
      pixel(primary, 3, 6, 10, 4);
      pixel(primary, 5, 10, 6, 2);
      pixel(secondary, 7, 6, 2, 3);
      pixel(palette.highlight, 5, 5, 2, 2);
      break;
    case "leaf":
      pixel(primary, 7, 2, 4, 3);
      pixel(primary, 5, 4, 7, 5);
      pixel(primary, 4, 7, 7, 4);
      pixel(primary, 6, 10, 4, 3);
      pixel(secondary, 5, 8, 6, 1);
      pixel(secondary, 8, 9, 1, 5);
      break;
    case "feather":
      pixel(primary, 7, 2, 4, 3);
      pixel(primary, 5, 4, 6, 4);
      pixel(primary, 4, 7, 6, 3);
      pixel(primary, 5, 10, 3, 2);
      pixel(secondary, 7, 3, 1, 10);
      pixel(secondary, 5, 5, 3, 1);
      pixel(secondary, 4, 8, 3, 1);
      break;
    case "lantern":
      pixel(secondary, 6, 2, 4, 2);
      pixel(palette.highlight, 7, 4, 2, 1);
      pixel(palette.shadow, 4, 5, 8, 8);
      pixel(primary, 5, 6, 6, 6);
      pixel(palette.highlight, 7, 7, 2, 4);
      pixel(secondary, 6, 13, 4, 1);
      break;
    case "coin":
      pixel(secondary, 5, 2, 6, 2);
      pixel(primary, 3, 4, 10, 8);
      pixel(secondary, 4, 12, 8, 2);
      pixel(palette.highlight, 5, 5, 1, 6);
      pixel(secondary, 8, 5, 3, 1);
      pixel(secondary, 7, 7, 3, 1);
      pixel(secondary, 8, 9, 3, 1);
      break;
  }

  return canvas;
}

export function getIconCanvas(recipe: IconRecipe, paletteName: PaletteName): HTMLCanvasElement {
  const key = `${paletteName}:${JSON.stringify(recipe)}`;
  let canvas = iconCache.get(key);
  if (!canvas) {
    canvas = paintIcon(recipe, paletteName);
    iconCache.set(key, canvas);
  }
  return canvas;
}
