import { PALETTE_COLOR_SLOTS, PALETTES, type PaletteName } from "../palettes";
import { GLYPH_CATALOG, type GlyphDefinition, type GlyphMaterial, type GlyphState } from "./catalog";
import { hashSeed } from "../random";

type Ramp = Readonly<Record<"o" | "b" | "h" | "s" | "d", string>>;
type PixelColor = "o" | "b" | "h" | "s" | "d" | "a" | "g";

export const MATERIAL_RAMPS: Readonly<Record<GlyphMaterial, Ramp>> = {
  metal: { o: "#2c3038", b: "#858b96", h: "#e5e8ec", s: "#555b66", d: "#252832" },
  glass: { o: "#33444a", b: "#80aeb5", h: "#e2f6ef", s: "#557a84", d: "#293d45" },
  wood: { o: "#3d302a", b: "#98704a", h: "#d8b27b", s: "#674832", d: "#302820" },
  paper: { o: "#4b4030", b: "#d5c596", h: "#fff1c8", s: "#a18a5d", d: "#443929" },
  cloth: { o: "#39394a", b: "#8a7a78", h: "#d4c2b1", s: "#62596a", d: "#302d3b" },
  stone: { o: "#363b3e", b: "#8a8980", h: "#d6d3c3", s: "#626766", d: "#292e31" },
  organic: { o: "#354033", b: "#77935e", h: "#b5c77a", s: "#536c49", d: "#29362e" },
  liquid: { o: "#293e4b", b: "#5b9da7", h: "#c5eff0", s: "#426c7a", d: "#22333f" },
  light: { o: "#51422d", b: "#d3a94e", h: "#fff3a6", s: "#a47739", d: "#493720" },
  misc: { o: "#393b3e", b: "#98938a", h: "#e6dec9", s: "#67625e", d: "#2d3033" },
};

const cache = new Map<string, HTMLCanvasElement>();

function mixColor(left: string, right: string, amount: number): string {
  const parse = (value: string): [number, number, number] => [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
  const a = parse(left);
  const b = parse(right);
  return `#${a.map((channel, index) => Math.round(channel * (1 - amount) + b[index]! * amount)
    .toString(16).padStart(2, "0")).join("")}`;
}

function randomFrom(seed: string): () => number {
  let value = hashSeed(seed);
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function normalizeStates(states: readonly GlyphState[]): GlyphState[] {
  return [...new Set(states)].sort();
}

function opaquePoints(glyph: GlyphDefinition): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  glyph.rows.forEach((row, y) => [...row].forEach((character, x) => {
    if (character !== ".") points.push({ x, y });
  }));
  return points;
}

function overlayPoints(
  context: CanvasRenderingContext2D,
  points: readonly { x: number; y: number }[],
  color: string,
  seed: string,
  count: number,
): void {
  const random = randomFrom(seed);
  const available = [...points];
  for (let index = 0; index < Math.min(count, available.length); index += 1) {
    const pointIndex = Math.floor(random() * available.length);
    const [point] = available.splice(pointIndex, 1);
    if (!point) continue;
    context.fillStyle = color;
    context.fillRect(point.x, point.y, 1, 1);
  }
}

export interface GlyphRenderOptions {
  readonly palette: PaletteName;
  readonly material?: GlyphMaterial;
  readonly accent?: string;
  readonly states?: readonly GlyphState[];
  readonly seed?: string;
}

export function renderGlyph(glyph: GlyphDefinition, options: GlyphRenderOptions): HTMLCanvasElement {
  const material = options.material ?? glyph.material;
  const states = normalizeStates(options.states ?? []);
  const seed = options.seed ?? glyph.id;
  const accentSlot = PALETTE_COLOR_SLOTS.find((slot) => slot === options.accent);
  const accent = accentSlot
    ? PALETTES[options.palette][accentSlot]
    : options.accent ?? PALETTES[options.palette].accent;
  const key = JSON.stringify([glyph.id, material, accent, states, options.palette, seed]);
  const cached = cache.get(key);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not create a glyph canvas context.");
  context.imageSmoothingEnabled = false;
  const ramp = MATERIAL_RAMPS[material];
  const palette = PALETTES[options.palette];
  const colors: Record<PixelColor, string> = {
    o: mixColor(ramp.o, palette.ink, 0.25),
    b: mixColor(ramp.b, palette.earth, 0.3),
    h: mixColor(ramp.h, palette.highlight, 0.25),
    s: mixColor(ramp.s, palette.shadow, 0.3),
    d: mixColor(ramp.d, palette.ink, 0.25),
    a: accent,
    g: mixColor(accent, palette.highlight, 0.35),
  };
  const points = opaquePoints(glyph);

  if (states.includes("glow")) {
    const occupied = new Set(points.map(({ x, y }) => `${x},${y}`));
    const halo = new Set<string>();
    for (const { x, y } of points) {
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const hx = x + dx;
        const hy = y + dy;
        const id = `${hx},${hy}`;
        if (hx >= 0 && hx < 16 && hy >= 0 && hy < 16 && !occupied.has(id)) halo.add(id);
      }
    }
    context.fillStyle = mixColor(accent, palette.highlight, 0.5);
    for (const point of halo) {
      const [x, y] = point.split(",").map(Number);
      context.fillRect(x!, y!, 1, 1);
    }
  }

  glyph.rows.forEach((row, y) => [...row].forEach((character, x) => {
    if (character === ".") return;
    context.fillStyle = colors[character as PixelColor];
    context.fillRect(x, y, 1, 1);
  }));

  if (states.includes("cracked")) {
    const offset = hashSeed(seed) % 8;
    for (let y = 2; y < 14; y += 1) {
      const x = (y + offset) % 16;
      if (glyph.rows[y]?.[x] !== ".") {
        context.fillStyle = colors.d;
        context.fillRect(x, y, 1, 1);
      }
    }
  }
  if (states.includes("stained")) overlayPoints(context, points, "#8f3437", `${seed}:stained`, 5);
  if (states.includes("rusty") && material === "metal") {
    overlayPoints(context, points, "#c66d3d", `${seed}:rusty`, 6);
  }
  if (states.includes("dusty")) overlayPoints(context, points, "#e5d6ad", `${seed}:dusty`, 5);

  cache.set(key, canvas);
  return canvas;
}

export function renderGlyphById(id: string, options: GlyphRenderOptions): HTMLCanvasElement | null {
  const glyph = GLYPH_CATALOG.find((entry) => entry.id === id);
  return glyph ? renderGlyph(glyph, options) : null;
}
