// Renders a layered SpriteSpec (see spriteSpec.ts) as a 16x24 pixel sprite with an outline, four directions and a
// four-pose walk cycle. Every colour comes from the spec, so the same character looks the same in every story palette.
// The feet stand on row FEET_ROW; draw the canvas 8 pixels above the top of the tile the character stands on.

import { drawArms, drawBackGear, drawBody, drawLegs, drawTail } from "./spriteBody";
import { Grid, FEET_ROW, SPRITE_HEIGHT, SPRITE_WIDTH, luminance, tone, type Cell, type Ctx, type View } from "./spriteGrid";
import { drawFaceAccessories, drawBodyAccessories, drawHeldItems } from "./spriteItems";
import { drawHair, drawHead, drawHeadwear } from "./spriteHead";
import type { SpriteSpec, SpriteSpecies } from "./spriteSpec";
import { mix } from "./surfaceTiles";
import type { Direction } from "./sprites";

export { SPRITE_HEIGHT, SPRITE_WIDTH } from "./spriteGrid";

// Poses 0..3 are the walk cycle (0 and 2 stand, 1 and 3 step). Pose 4 is the slight bob of a character standing still.
export const WALK_POSES = 4;
export const IDLE_POSE = 4;

const BIRDS: readonly SpriteSpecies[] = ["owl", "magpie", "crow", "wren", "heron"];
const BEAK: Partial<Record<SpriteSpecies, string>> = {
  owl: "#e3a93d", magpie: "#26262c", crow: "#26262c", wren: "#9b7348", heron: "#e0b24a",
};

const BUILD = {
  tiny: { leg: 2, torso: 4, head: 7, widths: [4, 6, 8] },
  short: { leg: 3, torso: 5, head: 6, widths: [6, 8, 10] },
  average: { leg: 4, torso: 6, head: 6, widths: [6, 8, 10] },
  tall: { leg: 5, torso: 7, head: 6, widths: [6, 8, 10] },
} as const;
const GIRTH_INDEX = { slim: 0, average: 1, stout: 2 } as const;

function viewOf(direction: Direction): View {
  return direction === "left" || direction === "right" ? "side" : direction === "up" ? "back" : "front";
}

function buildContext(spec: SpriteSpec, direction: Direction, pose: number, g: Grid): Ctx {
  const build = BUILD[spec.height];
  const bird = BIRDS.includes(spec.species);
  const heron = spec.species === "heron";
  const legH = build.leg + (heron ? 2 : 0);
  const torsoH = build.torso - (heron ? 1 : 0);
  const headH = build.head;
  const tw = build.widths[GIRTH_INDEX[spec.girth]];
  const sd = Math.max(4, tw - 2);
  const view = viewOf(direction);
  const stepping = pose === 1 || pose === 3;
  const bob = stepping || pose === IDLE_POSE ? 1 : 0;
  const skin = tone(spec.skin);
  const accent = tone(spec.accent ?? mix(spec.skin, "#ffffff", 0.4));
  const outfitSpec = spec.outfit ?? (spec.species === "human" ? { style: "shirt" as const, color: "#c8c2b4" } : { style: "none" as const, color: spec.skin });
  const outfitColor = tone(outfitSpec.color);
  const style = outfitSpec.style;
  const legsColor = outfitSpec.legs
    ?? (style === "dress" || style === "robe" || style === "none" ? spec.skin : style === "overalls" ? outfitSpec.color : mix(outfitSpec.color, "#1c1c2c", 0.45));
  const legTop = FEET_ROW - legH + 1;
  const torsoTop = legTop - torsoH + bob;
  const h0 = torsoTop - headH;
  const h1 = h0 + headH - 1;
  const bodyWidth = view === "side" ? sd : tw;
  const tl = 8 - bodyWidth / 2;
  return {
    g,
    spec,
    view,
    pose,
    skin,
    accent,
    eye: luminance(spec.skin) < 80 ? "#e9e4d4" : "#1d1517",
    beak: BEAK[spec.species] ?? "#d9a441",
    outfit: { style, color: outfitColor, trim: tone(outfitSpec.trim ?? mix(outfitSpec.color, "#000000", 0.35)), legs: tone(legsColor) },
    tw,
    sd,
    legH,
    torsoH,
    headH,
    bob,
    legLift: pose === 1 ? -1 : pose === 3 ? 1 : 0,
    legTop,
    torsoTop,
    h0,
    h1,
    ey: h1 - 2,
    tl,
    tr: tl + bodyWidth - 1,
    bird,
  };
}

function drawMoth(g: Grid, spec: SpriteSpec, direction: Direction, pose: number): void {
  const body = tone(spec.skin);
  const wing = tone(spec.accent ?? mix(spec.skin, "#ffffff", 0.4));
  const eye = luminance(spec.skin) < 80 ? "#e9e4d4" : "#1d1517";
  const view = viewOf(direction);
  // Wings beat: raised on odd poses.
  const up = pose === 1 || pose === 3 ? 1 : 0;
  const lift = pose === IDLE_POSE ? 1 : 0;
  const top = 7 + lift;
  const wingRows = up ? ["...aa", "..aaa", ".aaaa", "aaaab", "aaabb", ".abb."] : [".....", "..aaa", ".aaaa", "aaaab", ".aabb", "..bb."];
  const paint = { a: wing.base, b: wing.dark };
  const mirror = (rows: readonly string[]): string[] => rows.map((row) => [...row].reverse().join(""));
  if (view === "side") {
    g.art(7, top - 2 + (up ? -1 : 0), ["..aaa", ".aaaa", "aaaab", "aaabb", ".abb."], paint);
    g.shaded(5, top + 3, 5, 8, body);
    g.shaded(4, top, 5, 4, body);
    g.set(5, top + 1, eye);
    g.set(3, top - 2, wing.dark);
    g.set(2, top - 3, wing.base);
    g.set(4, top - 1, wing.dark);
    g.rect(6, top + 11, 3, 1, body.dark);
  } else {
    g.art(1, top - 1, wingRows, paint);
    g.art(10, top - 1, mirror(wingRows), paint);
    g.shaded(6, top + 3, 4, 8, body);
    g.rect(7, top + 4, 2, 4, body.light);
    g.shaded(5, top, 6, 4, body);
    g.set(5, top, null);
    g.set(10, top, null);
    if (view === "front") {
      g.set(6, top + 2, eye);
      g.set(9, top + 2, eye);
      g.set(7, top + 3, wing.dark);
      g.set(8, top + 3, wing.dark);
    }
    g.set(5, top - 2, wing.dark);
    g.set(6, top - 1, wing.base);
    g.set(10, top - 2, wing.dark);
    g.set(9, top - 1, wing.base);
    g.rect(7, top + 11, 2, 1, body.dark);
  }
}

function renderGrid(spec: SpriteSpec, direction: Direction, pose: number): Cell[] {
  const g = new Grid();
  if (spec.species === "moth") {
    drawMoth(g, spec, direction, pose);
  } else {
    const c = buildContext(spec, direction, pose, g);
    if (c.view !== "back") drawTail(c);
    drawBackGear(c, "behind");
    drawLegs(c);
    drawBody(c);
    drawBodyAccessories(c);
    drawArms(c);
    drawHeldItems(c);
    drawHead(c);
    drawHair(c);
    drawFaceAccessories(c);
    drawHeadwear(c);
    if (c.view === "back") drawTail(c);
    drawBackGear(c, "over");
  }
  return finish(g, spec.species === "moth", direction === "right");
}

// Adds the outline, the ground shadow (or glow), and turns the picture around for the right-hand view.
function finish(g: Grid, floating: boolean, mirrored: boolean): Cell[] {
  const source = g.cells;
  const out: Cell[] = source.slice();
  const at = (x: number, y: number): Cell => (x < 0 || y < 0 || x >= SPRITE_WIDTH || y >= SPRITE_HEIGHT ? null : source[y * SPRITE_WIDTH + x] ?? null);
  for (let y = 0; y < SPRITE_HEIGHT; y += 1) {
    for (let x = 0; x < SPRITE_WIDTH; x += 1) {
      if (at(x, y)) continue;
      const neighbour = at(x, y + 1) ?? at(x - 1, y) ?? at(x + 1, y) ?? at(x, y - 1);
      if (neighbour) out[y * SPRITE_WIDTH + x] = mix(neighbour, "#120d16", 0.72);
    }
  }
  if (floating) {
    for (let y = 3; y < 20; y += 1) {
      for (let x = 0; x < SPRITE_WIDTH; x += 1) {
        const distance = Math.hypot((x - 7.5) / 1.1, y - 12);
        if (distance < 8 && !out[y * SPRITE_WIDTH + x]) out[y * SPRITE_WIDTH + x] = `rgba(255, 238, 160, ${(0.3 * (1 - distance / 8)).toFixed(2)})`;
      }
    }
  }
  const shadow = (x0: number, x1: number, y: number, alpha: number): void => {
    for (let x = x0; x <= x1; x += 1) if (!out[y * SPRITE_WIDTH + x]) out[y * SPRITE_WIDTH + x] = `rgba(14, 10, 18, ${alpha})`;
  };
  if (floating) {
    shadow(5, 10, 21, 0.25);
    shadow(6, 9, 22, 0.2);
  } else {
    shadow(3, 12, 22, 0.3);
    shadow(5, 10, 23, 0.22);
  }
  if (!mirrored) return out;
  const flipped: Cell[] = new Array<Cell>(out.length).fill(null);
  for (let y = 0; y < SPRITE_HEIGHT; y += 1) {
    for (let x = 0; x < SPRITE_WIDTH; x += 1) flipped[y * SPRITE_WIDTH + (SPRITE_WIDTH - 1 - x)] = out[y * SPRITE_WIDTH + x] ?? null;
  }
  return flipped;
}

// The pixels of one frame, row by row (null is transparent). Pure; used by tests and by the canvas painter.
export function renderSpriteCells(spec: SpriteSpec, direction: Direction = "down", pose = 0): Cell[] {
  return renderGrid(spec, direction, pose);
}

export function paintSpriteCanvas(spec: SpriteSpec, direction: Direction = "down", pose = 0): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SPRITE_WIDTH;
  canvas.height = SPRITE_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not create a character sprite canvas.");
  context.imageSmoothingEnabled = false;
  const cells = renderGrid(spec, direction, pose);
  for (let y = 0; y < SPRITE_HEIGHT; y += 1) {
    let x = 0;
    while (x < SPRITE_WIDTH) {
      const color = cells[y * SPRITE_WIDTH + x];
      if (!color) {
        x += 1;
        continue;
      }
      let run = 1;
      while (x + run < SPRITE_WIDTH && cells[y * SPRITE_WIDTH + x + run] === color) run += 1;
      context.fillStyle = color;
      context.fillRect(x, y, run, 1);
      x += run;
    }
  }
  return canvas;
}

const keys = new WeakMap<SpriteSpec, string>();
const cache = new Map<string, HTMLCanvasElement>();

export function spriteKey(spec: SpriteSpec): string {
  let key = keys.get(spec);
  if (key === undefined) {
    key = JSON.stringify(spec);
    keys.set(spec, key);
  }
  return key;
}

export function normalizePose(pose: number): number {
  return pose === IDLE_POSE ? IDLE_POSE : ((Math.floor(pose) % WALK_POSES) + WALK_POSES) % WALK_POSES;
}

export function getSpriteCanvas(spec: SpriteSpec, direction: Direction = "down", pose = 0): HTMLCanvasElement {
  const normalized = normalizePose(pose);
  const key = `${spriteKey(spec)}|${direction}|${normalized}`;
  let canvas = cache.get(key);
  if (!canvas) {
    canvas = paintSpriteCanvas(spec, direction, normalized);
    cache.set(key, canvas);
  }
  return canvas;
}
