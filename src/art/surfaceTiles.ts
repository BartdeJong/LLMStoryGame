import { PALETTES, SURFACES, type PaletteName } from "./palettes";

// Floors, walls, rugs and counters for rooms. Every painter draws a full 16x16 tile using fillRect only.

// Mirrors FLOOR_STYLES / WALL_STYLES in src/world/types.ts (kept here so art does not import the world).
export const FLOOR_ART_STYLES = ["boards", "tiles", "carpet", "flagstone", "cobble", "dirt", "grass", "sand", "deck"] as const;
export const WALL_ART_STYLES = ["plaster", "brick", "wood", "stone", "hedge", "rock", "fence"] as const;
export type FloorArtStyle = (typeof FLOOR_ART_STYLES)[number];
export type WallArtStyle = (typeof WALL_ART_STYLES)[number];

// Rug borders: a set bit draws a border on that side (the neighbour there is not a rug).
export const RUG_EDGE = { north: 1, east: 2, south: 4, west: 8 } as const;

export type Pixel = (color: string, x: number, y: number, width?: number, height?: number) => void;
export type Fill = (color: string) => void;
export type Random = () => number;
type Palette = (typeof PALETTES)[PaletteName];
type Surface = (typeof SURFACES)[PaletteName];

const WHITE = "#ffffff";
const BLACK = "#000000";

export function mix(a: string, b: string, amount: number): string {
  const channel = (hex: string, index: number) => parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
  let out = "#";
  for (let index = 0; index < 3; index += 1) {
    const value = Math.round(channel(a, index) * (1 - amount) + channel(b, index) * amount);
    out += value.toString(16).padStart(2, "0");
  }
  return out;
}

export function paintFloor(
  style: FloorArtStyle,
  palette: Palette,
  surface: Surface,
  random: Random,
  pixel: Pixel,
  ground: Fill,
): void {
  const { floor, floorAlt, seam } = surface;
  switch (style) {
    case "boards": {
      ground(floor);
      for (let row = 0; row < 4; row += 1) {
        const y = row * 4;
        pixel(mix(floor, floorAlt, random()), 0, y, 16, 3);
        pixel(mix(floor, WHITE, 0.16), 0, y, 16, 1);
        pixel(mix(floor, seam, 0.65), 0, y + 3, 16, 1);
        const joint = 2 + Math.floor(random() * 12);
        pixel(mix(floor, seam, 0.65), joint, y, 1, 3);
        for (let grain = 0; grain < 2; grain += 1) {
          pixel(mix(floor, seam, 0.25), Math.floor(random() * 14), y + 1 + Math.floor(random() * 2), 2, 1);
        }
      }
      break;
    }
    case "tiles":
      for (let ty = 0; ty < 2; ty += 1) {
        for (let tx = 0; tx < 2; tx += 1) {
          const color = (tx + ty) % 2 === 0 ? floor : floorAlt;
          pixel(color, tx * 8, ty * 8, 8, 8);
          pixel(mix(color, WHITE, 0.3), tx * 8 + 1, ty * 8 + 1, 3, 1);
          pixel(mix(color, WHITE, 0.2), tx * 8 + 1, ty * 8 + 2, 1, 1);
          pixel(mix(color, seam, 0.55), tx * 8, ty * 8, 8, 1);
          pixel(mix(color, seam, 0.55), tx * 8, ty * 8, 1, 8);
        }
      }
      break;
    case "carpet":
      ground(floor);
      for (let index = 0; index < 26; index += 1) {
        const color = random() > 0.5 ? floorAlt : mix(floor, WHITE, 0.2);
        pixel(color, Math.floor(random() * 16), Math.floor(random() * 16));
      }
      for (let index = 0; index < 4; index += 1) {
        pixel(mix(floor, seam, 0.3), Math.floor(random() * 14), Math.floor(random() * 16), 2, 1);
      }
      break;
    case "flagstone": {
      ground(mix(floor, seam, 0.6));
      const rows: readonly (readonly [number, number])[] = [[0, 5], [5, 5], [10, 6]];
      rows.forEach(([top, height], index) => {
        const cut = 4 + Math.floor(random() * 8);
        const edges = index % 2 === 0 ? [0, cut, 16] : [0, 16 - cut, 16];
        for (let stone = 0; stone < 2; stone += 1) {
          const left = edges[stone]!;
          const right = edges[stone + 1]!;
          const color = mix(floor, random() > 0.5 ? floorAlt : WHITE, random() * 0.25);
          pixel(color, left + 1, top + 1, right - left - 1, height - 1);
          pixel(mix(color, WHITE, 0.25), left + 1, top + 1, right - left - 1, 1);
        }
      });
      break;
    }
    case "cobble": {
      ground(mix(floorAlt, seam, 0.7));
      for (let row = 0; row < 4; row += 1) {
        const shift = row % 2 === 0 ? 0 : 2;
        for (let column = -1; column < 3; column += 1) {
          const x = column * 5 + shift + 1;
          const left = Math.max(0, x);
          const right = Math.min(16, x + 4);
          const color = mix(floor, random() > 0.5 ? floorAlt : palette.cream, random() * 0.4);
          if (right <= left) continue;
          pixel(color, left, row * 4, right - left, 3);
          pixel(mix(color, WHITE, 0.25), left, row * 4, right - left, 1);
        }
      }
      break;
    }
    case "dirt": {
      const base = mix(palette.earth, floor, 0.45);
      ground(base);
      for (let index = 0; index < 14; index += 1) {
        const color = random() > 0.5 ? mix(base, WHITE, 0.2) : mix(base, seam, 0.4);
        pixel(color, Math.floor(random() * 15), Math.floor(random() * 15), 1 + Math.floor(random() * 2), 1);
      }
      pixel(mix(base, seam, 0.55), Math.floor(random() * 13), Math.floor(random() * 13), 2, 2);
      break;
    }
    case "grass":
      ground(palette.leaf);
      for (let index = 0; index < 12; index += 1) {
        const color = random() > 0.53 ? palette.leafLight : palette.shadow;
        pixel(color, 1 + Math.floor(random() * 14), 1 + Math.floor(random() * 14), 1 + Math.floor(random() * 2), 1);
      }
      break;
    case "sand": {
      const base = mix(palette.cream, floor, 0.4);
      ground(base);
      for (let index = 0; index < 10; index += 1) {
        pixel(mix(base, random() > 0.5 ? WHITE : seam, 0.25), Math.floor(random() * 14), Math.floor(random() * 16), 2, 1);
      }
      break;
    }
    case "deck":
      ground(floor);
      for (let row = 0; row < 3; row += 1) {
        const y = row * 5 + (row === 2 ? 1 : 0);
        pixel(mix(floor, floorAlt, random()), 0, y, 16, 4);
        pixel(mix(floor, WHITE, 0.14), 0, y, 16, 1);
        pixel(mix(floor, seam, 0.7), 0, y + 4, 16, 1);
        pixel(mix(floor, seam, 0.5), 2, y + 2);
        pixel(mix(floor, seam, 0.5), 13, y + 2);
      }
      pixel(mix(floor, seam, 0.7), 0, 15, 16, 1);
      break;
  }
}

// The dark top of a wall, seen from above. Used where the tile below is also wall or outside the area.
export function paintWallTop(
  style: WallArtStyle,
  palette: Palette,
  surface: Surface,
  random: Random,
  pixel: Pixel,
  ground: Fill,
): void {
  const base = surface.wallTop;
  switch (style) {
    case "plaster":
    case "wood":
      ground(base);
      pixel(mix(base, WHITE, 0.07), 0, 0, 16, 1);
      for (let index = 0; index < 5; index += 1) {
        pixel(mix(base, WHITE, 0.05), Math.floor(random() * 14), Math.floor(random() * 15), 2, 1);
      }
      break;
    case "brick":
    case "stone":
      ground(base);
      for (const y of [3, 7, 11, 15]) pixel(mix(base, WHITE, 0.08), 0, y, 16, 1);
      for (let row = 0; row < 4; row += 1) {
        pixel(mix(base, WHITE, 0.08), (row % 2) * 4 + Math.floor(random() * 2) * 8, row * 4, 1, 3);
      }
      break;
    case "hedge": {
      ground(mix(palette.leaf, palette.ink, 0.5));
      for (let index = 0; index < 12; index += 1) {
        pixel(
          mix(palette.leaf, palette.ink, random() > 0.5 ? 0.3 : 0.6),
          Math.floor(random() * 14),
          Math.floor(random() * 14),
          2 + Math.floor(random() * 2),
          2,
        );
      }
      break;
    }
    case "rock": {
      const dark = mix(palette.shadow, palette.ink, 0.45);
      ground(dark);
      for (let index = 0; index < 8; index += 1) {
        pixel(
          mix(dark, WHITE, 0.1 + random() * 0.08),
          Math.floor(random() * 13),
          Math.floor(random() * 13),
          2 + Math.floor(random() * 3),
          2,
        );
      }
      break;
    }
    case "fence":
      paintFence(palette, surface, random, pixel, ground);
      break;
  }
}

// The lit front of a wall, seen where the tile below is walkable.
export function paintWallFace(
  style: WallArtStyle,
  palette: Palette,
  surface: Surface,
  random: Random,
  pixel: Pixel,
  ground: Fill,
): void {
  const face = surface.wallFace;
  const baseLine = (color: string) => pixel(mix(color, BLACK, 0.4), 0, 15, 16, 1);
  switch (style) {
    case "plaster": {
      ground(face);
      for (let x = 0; x < 16; x += 4) pixel(mix(face, surface.trim, 0.1), x, 0, 1, 11);
      for (const [x, y] of [[2, 5], [10, 5], [6, 8], [14, 8]] as const) pixel(mix(face, surface.trim, 0.22), x, y, 2, 1);
      pixel(mix(face, surface.wallTop, 0.45), 0, 0, 16, 1);
      pixel(mix(face, surface.wallTop, 0.2), 0, 1, 16, 1);
      pixel(mix(surface.trim, WHITE, 0.3), 0, 11, 16, 1);
      pixel(surface.trim, 0, 12, 16, 3);
      pixel(mix(surface.trim, BLACK, 0.2), 0, 14, 16, 1);
      baseLine(surface.trim);
      break;
    }
    case "brick": {
      ground(mix(face, WHITE, 0.35));
      for (let row = 0; row < 4; row += 1) {
        const shift = row % 2 === 0 ? 0 : 4;
        for (let column = -1; column < 3; column += 1) {
          const x = column * 8 + shift;
          const left = Math.max(0, x);
          const right = Math.min(16, x + 7);
          if (right <= left) continue;
          const color = mix(face, random() > 0.5 ? surface.wallTop : WHITE, random() * 0.16);
          pixel(color, left, row * 4, right - left, 3);
          pixel(mix(color, WHITE, 0.22), left, row * 4, right - left, 1);
        }
      }
      pixel(mix(face, surface.wallTop, 0.4), 0, 0, 16, 1);
      baseLine(face);
      break;
    }
    case "wood": {
      ground(face);
      for (let x = 0; x < 16; x += 4) {
        pixel(mix(face, BLACK, 0.3), x, 0, 1, 16);
        pixel(mix(face, WHITE, 0.12), x + 1, 0, 1, 16);
        pixel(mix(face, surface.wallTop, 0.25), x + 2 + Math.floor(random() * 2), Math.floor(random() * 6), 1, 2);
      }
      pixel(mix(face, surface.wallTop, 0.5), 0, 0, 16, 1);
      pixel(mix(face, surface.wallTop, 0.2), 0, 1, 16, 1);
      pixel(mix(face, BLACK, 0.15), 0, 10, 16, 6);
      for (let x = 0; x < 16; x += 4) pixel(mix(face, BLACK, 0.4), x, 10, 1, 6);
      pixel(surface.trim, 0, 8, 16, 2);
      pixel(mix(surface.trim, WHITE, 0.3), 0, 8, 16, 1);
      baseLine(face);
      break;
    }
    case "stone": {
      ground(mix(face, surface.wallTop, 0.4));
      const rows: readonly (readonly [number, number])[] = [[0, 5], [5, 5], [10, 6]];
      rows.forEach(([top, height], index) => {
        const cut = 5 + Math.floor(random() * 6);
        const edges = index % 2 === 0 ? [0, cut, 16] : [0, 16 - cut, 16];
        for (let block = 0; block < 2; block += 1) {
          const left = edges[block]!;
          const right = edges[block + 1]!;
          const color = mix(face, random() > 0.5 ? WHITE : surface.wallTop, random() * 0.2);
          pixel(color, left + 1, top + 1, right - left - 1, height - 1);
          pixel(mix(color, WHITE, 0.22), left + 1, top + 1, right - left - 1, 1);
        }
      });
      baseLine(face);
      break;
    }
    case "hedge": {
      ground(mix(palette.leaf, palette.leafLight, 0.35));
      for (let index = 0; index < 26; index += 1) {
        const color = random() > 0.5 ? palette.leafLight : palette.leaf;
        pixel(color, Math.floor(random() * 14), 1 + Math.floor(random() * 11), 2 + Math.floor(random() * 2), 2);
      }
      for (let index = 0; index < 5; index += 1) {
        pixel(palette.highlight, Math.floor(random() * 15), 1 + Math.floor(random() * 10));
      }
      pixel(mix(palette.leaf, palette.ink, 0.45), 0, 0, 16, 2);
      pixel(mix(palette.leaf, palette.ink, 0.35), 0, 13, 16, 3);
      for (let x = 0; x < 16; x += 3) pixel(mix(palette.leaf, palette.ink, 0.5), x, 12, 2, 1);
      break;
    }
    case "rock": {
      ground(face);
      for (let index = 0; index < 6; index += 1) {
        pixel(mix(face, WHITE, 0.15), Math.floor(random() * 12), Math.floor(random() * 12), 3 + Math.floor(random() * 3), 2);
      }
      for (let index = 0; index < 3; index += 1) {
        const x = Math.floor(random() * 13);
        const y = 2 + Math.floor(random() * 8);
        pixel(mix(face, surface.wallTop, 0.55), x, y, 1, 3);
        pixel(mix(face, surface.wallTop, 0.55), x + 1, y + 3, 2, 1);
      }
      pixel(mix(face, surface.wallTop, 0.5), 0, 0, 16, 2);
      pixel(mix(face, surface.wallTop, 0.35), 0, 12, 16, 3);
      baseLine(face);
      break;
    }
    case "fence":
      paintFence(palette, surface, random, pixel, ground);
      break;
  }
}

function paintFence(palette: Palette, surface: Surface, random: Random, pixel: Pixel, ground: Fill): void {
  ground(palette.leaf);
  for (let index = 0; index < 8; index += 1) {
    pixel(random() > 0.5 ? palette.leafLight : palette.shadow, Math.floor(random() * 15), Math.floor(random() * 15));
  }
  const wood = mix(surface.trim, WHITE, 0.3);
  pixel(mix(palette.shadow, BLACK, 0.2), 0, 14, 16, 2);
  pixel(mix(wood, BLACK, 0.25), 0, 5, 16, 2);
  pixel(mix(wood, BLACK, 0.25), 0, 10, 16, 2);
  for (let x = 1; x < 16; x += 5) {
    pixel(wood, x, 3, 3, 11);
    pixel(wood, x + 1, 2);
    pixel(mix(wood, WHITE, 0.3), x, 3, 1, 11);
    pixel(mix(wood, BLACK, 0.3), x + 2, 3, 1, 11);
  }
}

export function paintRug(palette: Palette, surface: Surface, edges: number, pixel: Pixel): void {
  const base = surface.rug;
  const deep = mix(base, BLACK, 0.3);
  const light = mix(base, palette.cream, 0.45);
  pixel(base, 0, 0, 16, 16);
  for (const [x, y] of [[4, 4], [12, 4], [4, 12], [12, 12], [8, 8]] as const) {
    pixel(mix(base, light, 0.5), x - 1, y, 3, 1);
    pixel(mix(base, light, 0.5), x, y - 1, 1, 3);
    pixel(light, x, y);
  }
  const north = (edges & RUG_EDGE.north) !== 0;
  const east = (edges & RUG_EDGE.east) !== 0;
  const south = (edges & RUG_EDGE.south) !== 0;
  const west = (edges & RUG_EDGE.west) !== 0;
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const depth = Math.min(north ? y : 99, south ? 15 - y : 99, west ? x : 99, east ? 15 - x : 99);
      if (depth > 3) continue;
      pixel(depth === 0 ? deep : depth === 1 ? light : depth === 2 ? deep : base, x, y);
    }
  }
}

export function paintCounter(palette: Palette, surface: Surface, random: Random, pixel: Pixel): void {
  const wood = mix(mix(palette.earth, surface.trim, 0.2), surface.wallTop, 0.4);
  const top = mix(wood, WHITE, 0.2);
  pixel(top, 0, 0, 16, 10);
  pixel(mix(top, WHITE, 0.3), 0, 0, 16, 1);
  for (let index = 0; index < 3; index += 1) {
    pixel(mix(top, BLACK, 0.12), Math.floor(random() * 12), 2 + Math.floor(random() * 6), 3, 1);
  }
  pixel(mix(top, BLACK, 0.35), 0, 9, 16, 1);
  pixel(mix(wood, BLACK, 0.3), 0, 10, 16, 6);
  for (const x of [1, 9]) {
    pixel(mix(wood, BLACK, 0.12), x, 11, 6, 4);
    pixel(mix(wood, WHITE, 0.1), x, 11, 6, 1);
  }
  pixel(mix(wood, BLACK, 0.6), 0, 15, 16, 1);
}
