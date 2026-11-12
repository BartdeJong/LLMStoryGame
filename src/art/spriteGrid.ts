// Shared pieces of the layered character sprite renderer: a pixel grid, colour tones and the layout of one frame.

import { mix } from "./surfaceTiles";
import type { SpriteSpec } from "./spriteSpec";

export const SPRITE_WIDTH = 16;
export const SPRITE_HEIGHT = 24;
// The row the feet stand on. Row 22 and 23 hold the outline and the shadow, so the entity's tile ends below this sprite.
export const FEET_ROW = 21;

export type Cell = string | null;
export type View = "front" | "back" | "side";

export interface Tone {
  readonly base: string;
  readonly light: string;
  readonly dark: string;
  readonly deep: string;
}

const toneCache = new Map<string, Tone>();

export function tone(color: string): Tone {
  let result = toneCache.get(color);
  if (!result) {
    result = {
      base: color,
      light: mix(color, "#ffffff", 0.24),
      dark: mix(color, "#000000", 0.26),
      deep: mix(color, "#000000", 0.5),
    };
    toneCache.set(color, result);
  }
  return result;
}

export function luminance(hex: string): number {
  const channel = (index: number) => parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
  return channel(0) * 0.3 + channel(1) * 0.59 + channel(2) * 0.11;
}

export class Grid {
  readonly cells: Cell[] = new Array<Cell>(SPRITE_WIDTH * SPRITE_HEIGHT).fill(null);
  // When set, everything is drawn mirrored left to right (used for items held on the far side in back views).
  flip = false;

  set(x: number, y: number, color: Cell): void {
    const column = this.flip ? SPRITE_WIDTH - 1 - x : x;
    if (column < 0 || y < 0 || column >= SPRITE_WIDTH || y >= SPRITE_HEIGHT) return;
    this.cells[y * SPRITE_WIDTH + column] = color;
  }

  get(x: number, y: number): Cell {
    if (x < 0 || y < 0 || x >= SPRITE_WIDTH || y >= SPRITE_HEIGHT) return null;
    return this.cells[y * SPRITE_WIDTH + x] ?? null;
  }

  rect(x: number, y: number, width: number, height: number, color: Cell): void {
    for (let row = 0; row < height; row += 1) for (let column = 0; column < width; column += 1) this.set(x + column, y + row, color);
  }

  // A filled block with a light top edge and a dark right edge.
  shaded(x: number, y: number, width: number, height: number, t: Tone): void {
    this.rect(x, y, width, height, t.base);
    if (height >= 3) this.rect(x, y, width - (width >= 3 ? 1 : 0), 1, t.light);
    if (width >= 3) this.rect(x + width - 1, y + (height >= 3 ? 1 : 0), 1, height - (height >= 3 ? 1 : 0), t.dark);
  }

  // Paints ASCII art: '.' is empty, other characters are looked up in the palette.
  art(x: number, y: number, rows: readonly string[], palette: Readonly<Record<string, string>>): void {
    rows.forEach((row, dy) => {
      [...row].forEach((letter, dx) => {
        const color = palette[letter];
        if (color) this.set(x + dx, y + dy, color);
      });
    });
  }

  // Mixes a colour over whatever is already there (veils, glass).
  blend(x: number, y: number, color: string, amount: number): void {
    const current = this.get(this.flip ? SPRITE_WIDTH - 1 - x : x, y);
    if (current) this.set(x, y, mix(current, color, amount));
  }
}

export interface OutfitInfo {
  readonly style: string;
  readonly color: Tone;
  readonly trim: Tone;
  readonly legs: Tone;
}

// Everything a part needs to know about the frame being drawn.
export interface Ctx {
  readonly g: Grid;
  readonly spec: SpriteSpec;
  readonly view: View;
  readonly pose: number;
  readonly skin: Tone;
  readonly accent: Tone;
  readonly eye: string;
  readonly beak: string;
  readonly outfit: OutfitInfo;
  readonly tw: number; // torso width seen from the front or back
  readonly sd: number; // torso depth seen from the side
  readonly legH: number;
  readonly torsoH: number;
  readonly headH: number;
  readonly bob: number; // the upper body sits this many pixels lower while stepping or breathing
  readonly legLift: number; // -1 left leg lifted, 1 right leg lifted, 0 standing
  readonly legTop: number;
  readonly torsoTop: number;
  readonly h0: number; // top row of the head
  readonly h1: number; // bottom row of the head
  readonly ey: number; // eye row
  readonly tl: number; // left column of the torso in this view
  readonly tr: number; // right column of the torso in this view
  readonly bird: boolean;
}

// First row below the torso that the outfit covers (relative to the leg top), by garment.
export function outfitBottom(c: Ctx): number {
  const hip = c.legTop - 1 + c.bob;
  switch (c.outfit.style) {
    case "dress": return hip + Math.max(1, c.legH - 3);
    case "smock": return hip + 1;
    case "coat":
    case "duffle-coat":
    case "cape": return hip + Math.max(1, c.legH - 2);
    case "robe": return FEET_ROW - 1;
    default: return hip;
  }
}

// How many pixels the garment sticks out on each side of the torso at a row below the hip.
export function flare(style: string, below: number): number {
  switch (style) {
    case "dress": return Math.min(2, 1 + (below > 1 ? 1 : 0));
    case "robe": return Math.min(2, 1 + (below > 2 ? 1 : 0));
    case "cape": return below > 1 ? 2 : 1;
    case "coat":
    case "duffle-coat": return below > 1 ? 1 : 0;
    case "smock": return 1;
    default: return 0;
  }
}

export function hasOutfit(c: Ctx, ...styles: string[]): boolean {
  return styles.includes(c.outfit.style);
}
