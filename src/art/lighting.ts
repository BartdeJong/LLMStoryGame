import { TILE_SIZE, Tile, type Area } from "../world";
import { getGlyphLight, isWallMounted } from "./glyphs";
import { PALETTES, PALETTE_COLOR_SLOTS } from "./palettes";
import { hashSeed } from "./random";

export type { GlyphLight } from "./glyphs";

// A light placed in the view, in view pixels (world pixels minus the camera).
export interface LightSource {
  readonly x: number;
  readonly y: number;
  readonly color: string;
  readonly radius: number;
  readonly intensity: number;
  readonly flicker: number;
  readonly phase: number;
}

// Ambient colours multiplied over the view, and the colour the view edges darken to.
export interface StoryLighting {
  readonly outdoor: string;
  readonly indoor: string;
  readonly underground: string;
  readonly edge: string;
}

type LightWorld = Pick<Area, "biome" | "palette" | "layers" | "decor" | "entities">;

const WALL_MOUNT_SHIFT = 14;
const GLOW_COLOR = "#ffd9a0";

export function ambientFor(lighting: StoryLighting, biome: Area["biome"]): string {
  if (biome === "building") return lighting.indoor;
  if (biome === "cave" || biome === "ruins") return lighting.underground;
  return lighting.outdoor;
}

// Two summed sines near 7 Hz and 13 Hz; always within [1 - amount, 1 + amount].
export function flickerFactor(time: number, phase: number, amount: number, reduced: boolean): number {
  if (reduced || amount === 0) return 1;
  const wave = 0.6 * Math.sin(time * 7 * Math.PI * 2 + phase) + 0.4 * Math.sin(time * 13 * Math.PI * 2 + phase * 1.7);
  return 1 + amount * wave;
}

export function lightPhase(id: string): number {
  return (hashSeed(id) / 4294967296) * Math.PI * 2;
}

// Mirrors renderGlyph: a palette slot name resolves via the palette; otherwise only #rrggbb is usable.
function glowColor(accent: string | undefined, palette: Area["palette"]): string {
  const slot = PALETTE_COLOR_SLOTS.find((name) => name === accent);
  const resolved = slot ? PALETTES[palette]?.[slot] : accent;
  return resolved && /^#[0-9a-f]{6}$/i.test(resolved) ? resolved : GLOW_COLOR;
}

export function collectLights(
  world: LightWorld,
  camera: { x: number; y: number },
  view: { width: number; height: number },
  positions?: ReadonlyMap<string, { x: number; y: number }>,
): LightSource[] {
  const lights: LightSource[] = [];
  const features = world.layers.feature;

  const add = (
    tile: { x: number; y: number },
    light: { color: string; radius: number; intensity: number; flicker: number; offsetY?: number },
    shift: number,
    id: string,
  ): void => {
    const x = tile.x * TILE_SIZE + 8 - camera.x;
    const y = tile.y * TILE_SIZE + (light.offsetY ?? 8) - shift - camera.y;
    if (x + light.radius < 0 || y + light.radius < 0 || x - light.radius > view.width || y - light.radius > view.height) return;
    lights.push({
      x, y, color: light.color, radius: light.radius, intensity: light.intensity, flicker: light.flicker,
      phase: lightPhase(id),
    });
  };
  const mountShift = (icon: string, name: string, tileX: number, tileY: number): number =>
    features[Math.floor(tileY) - 1]?.[Math.floor(tileX)] === Tile.Wall && isWallMounted(icon, name) ? WALL_MOUNT_SHIFT : 0;

  for (const item of world.decor ?? []) {
    const light = getGlyphLight(item.icon);
    if (light) add(item, light, mountShift(item.icon, "", item.x, item.y), `${item.x},${item.y}`);
  }
  for (const entity of world.entities ?? []) {
    const tile = positions?.get(entity.id) ?? entity;
    const icon = entity.visual?.icon;
    const light = icon ? getGlyphLight(icon) : undefined;
    const shift = icon ? mountShift(icon, entity.name, entity.x, entity.y) : 0;
    if (icon && light) add(tile, light, shift, entity.id);
    if (entity.visual?.states?.includes("glow")) {
      const color = glowColor(entity.visual.accent, world.palette);
      add(tile, { color, radius: 20, intensity: 0.5, flicker: 0.08 }, shift, `${entity.id}:glow`);
    }
  }
  return lights;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

// A strip just inside a map edge that fades from the edge shade (at `from`) to nothing (at `to`).
export interface FeatherBand {
  readonly rect: Rect;
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
}

// A feathered corner square: the shade fades out radially from the map edge to its inner corner `center`.
export interface FeatherCorner {
  readonly rect: Rect;
  readonly center: { readonly x: number; readonly y: number };
  readonly radius: number;
}

const AMBIENT_MAX_LUMA = 0.78;
const AMBIENT_FLOOR = 0x80;
const MIN_LIGHT_RADIUS = 16;
const MAX_LIGHT_RADIUS_SHARE = 0.3;
export const MAP_FEATHER_PX = 24;
// How far a light's core is mixed toward white, and the alpha profile (distance 0..1 -> alpha) of the pool.
export const LIGHT_CORE_WHITE = 0.4;
export const LIGHT_FALLOFF_STOPS: readonly (readonly [number, number])[] = [
  [0, 1],
  [0.25, 0.75],
  [0.6, 0.22],
  [1, 0],
];

function parseHex(color: string): [number, number, number] | null {
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    const [r, g, b] = color.slice(1).split("").map((digit) => parseInt(digit + digit, 16));
    return [r, g, b];
  }
  if (!/^#[0-9a-f]{6}$/i.test(color)) return null;
  return [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16)) as [number, number, number];
}

function toHex(rgb: readonly number[]): string {
  return `#${rgb.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
}

// Perceived brightness 0..1 (Rec. 601 weights); 0 for an unusable colour.
export function luma(hex: string): number {
  const rgb = parseHex(hex);
  return rgb ? (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255 : 0;
}

export function lightCoreColor(color: string): string {
  const rgb = parseHex(color);
  return rgb ? toHex(rgb.map((value) => value + (255 - value) * LIGHT_CORE_WHITE)) : color;
}

// A light only adds to the multiplied ambient, so a bright ambient leaves it no room to show.
// When the area has lights, darken the ambient (same hue) until there is headroom, but never
// below a readable floor.
export function effectiveAmbient(ambient: string, areaHasLights: boolean): string {
  const rgb = parseHex(ambient);
  if (!rgb || !areaHasLights) return ambient;
  const brightness = luma(ambient);
  if (brightness <= AMBIENT_MAX_LUMA) return ambient;
  const scale = AMBIENT_MAX_LUMA / brightness;
  return toHex(rgb.map((value) => Math.max(Math.round(value * scale), Math.min(value, AMBIENT_FLOOR))));
}

const decorHasLights = new WeakMap<object, boolean>();

// Early-exit scan; the decor result is memoised per area, entities (which can change) are checked live.
export function areaHasLights(world: LightWorld): boolean {
  let decor = decorHasLights.get(world);
  if (decor === undefined) {
    decor = false;
    for (const item of world.decor ?? []) {
      if (getGlyphLight(item.icon)) {
        decor = true;
        break;
      }
    }
    decorHasLights.set(world, decor);
  }
  if (decor) return true;
  for (const entity of world.entities ?? []) {
    if (entity.visual?.states?.includes("glow")) return true;
    if (entity.visual?.icon && getGlyphLight(entity.visual.icon)) return true;
  }
  return false;
}

// Big pools in a small room wash everything out, so reach is limited to a share of the room.
export function capLightRadius(radius: number, areaWidthPx: number, areaHeightPx: number): number {
  const cap = MAX_LIGHT_RADIUS_SHARE * Math.min(areaWidthPx, areaHeightPx);
  return Math.max(MIN_LIGHT_RADIUS, Math.min(radius, cap));
}

export function lightFalloff(distance: number): number {
  const stops = LIGHT_FALLOFF_STOPS;
  if (distance <= 0) return stops[0][1];
  for (let index = 1; index < stops.length; index += 1) {
    const [d1, a1] = stops[index];
    if (distance <= d1) {
      const [d0, a0] = stops[index - 1];
      return a0 + ((a1 - a0) * (distance - d0)) / (d1 - d0);
    }
  }
  return 0;
}

// Luminance a light adds on top of the ambient at `distance` (0 = centre, 1 = edge of its reach).
export function poolLift(
  ambientHex: string,
  light: { readonly color: string; readonly intensity: number },
  distance = 0,
): number {
  const base = parseHex(ambientHex);
  const core = parseHex(lightCoreColor(light.color));
  if (!base || !core) return 0;
  const alpha = Math.min(1, light.intensity) * lightFalloff(distance);
  const lit = toHex(base.map((value, index) => Math.min(255, value + core[index] * alpha)));
  return luma(lit) - luma(ambientHex);
}

// Where the map sits in the view when it is smaller than (or scrolled near the edge of) the view:
// rectangles outside the map to blacken, and bands inside the edge to feather. Empty when the map
// fills the view.
export function mapBoundaryShapes(
  map: Rect,
  view: { readonly width: number; readonly height: number },
  feather = MAP_FEATHER_PX,
): { outside: Rect[]; bands: FeatherBand[]; corners: FeatherCorner[] } {
  const left = map.x;
  const top = map.y;
  const right = map.x + map.w;
  const bottom = map.y + map.h;
  const clampX = (value: number) => Math.min(view.width, Math.max(0, value));
  const clampY = (value: number) => Math.min(view.height, Math.max(0, value));
  const cx0 = clampX(left);
  const cx1 = clampX(right);
  const cy0 = clampY(top);
  const cy1 = clampY(bottom);
  const outside: Rect[] = [];
  if (cy0 > 0) outside.push({ x: 0, y: 0, w: view.width, h: cy0 });
  if (cy1 < view.height) outside.push({ x: 0, y: cy1, w: view.width, h: view.height - cy1 });
  if (cx0 > 0) outside.push({ x: 0, y: cy0, w: cx0, h: cy1 - cy0 });
  if (cx1 < view.width) outside.push({ x: cx1, y: cy0, w: view.width - cx1, h: cy1 - cy0 });

  // Bands never overlap: top/bottom run between the corners, left/right between the corners, and each
  // corner square gets one radial gradient, so no pixel is darkened twice.
  const f = Math.max(0, Math.min(feather, map.w / 2, map.h / 2));
  const bands: FeatherBand[] = [];
  const corners: FeatherCorner[] = [];
  const clip = (x0: number, y0: number, x1: number, y1: number): Rect => ({
    x: clampX(x0),
    y: clampY(y0),
    w: clampX(x1) - clampX(x0),
    h: clampY(y1) - clampY(y0),
  });
  const addBand = (rect: Rect, from: { x: number; y: number }, to: { x: number; y: number }) => {
    if (rect.w > 0 && rect.h > 0) bands.push({ rect, from, to });
  };
  const addCorner = (rect: Rect, center: { x: number; y: number }) => {
    if (rect.w > 0 && rect.h > 0) corners.push({ rect, center, radius: f });
  };
  if (f > 0) {
    addBand(clip(left + f, top, right - f, top + f), { x: 0, y: top }, { x: 0, y: top + f });
    addBand(clip(left + f, bottom - f, right - f, bottom), { x: 0, y: bottom }, { x: 0, y: bottom - f });
    addBand(clip(left, top + f, left + f, bottom - f), { x: left, y: 0 }, { x: left + f, y: 0 });
    addBand(clip(right - f, top + f, right, bottom - f), { x: right, y: 0 }, { x: right - f, y: 0 });
    addCorner(clip(left, top, left + f, top + f), { x: left + f, y: top + f });
    addCorner(clip(right - f, top, right, top + f), { x: right - f, y: top + f });
    addCorner(clip(left, bottom - f, left + f, bottom), { x: left + f, y: bottom - f });
    addCorner(clip(right - f, bottom - f, right, bottom), { x: right - f, y: bottom - f });
  }
  return { outside, bands, corners };
}
