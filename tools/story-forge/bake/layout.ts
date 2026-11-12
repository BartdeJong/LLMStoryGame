// Procedural layouts for the bake step. Rooms are one room (optionally L-shaped, octagonal, ship-shaped or split by a
// partition) inside a wall ring that is two tiles thick along the top; outdoor places get hedge/fence/rock edges.
import type { Kind } from "./kinds";
import type { Grid, Pt, Rng } from "./grid";
import {
  at, flood, inside, isDoorChar, key, makeGrid, pick, randInt, route, shuffle, walkableAt,
} from "./grid";

export type Side = "N" | "E" | "S" | "W";

export interface Layout {
  grid: Grid;
  width: number;
  height: number;
  interior: boolean[][];
  ground: string; // the plain floor character of this place ('.' or ',')
  kind: Kind;
  hub: Pt; // a walkable tile near the middle that every door is connected to
}

interface Box { x0: number; y0: number; x1: number; y1: number }

function bbox(interior: boolean[][]): Box {
  let x0 = Infinity; let y0 = Infinity; let x1 = -1; let y1 = -1;
  interior.forEach((row, y) => row.forEach((on, x) => {
    if (!on) return;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }));
  return { x0, y0, x1, y1 };
}

// ---- masks -------------------------------------------------------------------------------------------------------

function carveBlock(mask: boolean[][], x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) if (mask[y]?.[x] !== undefined) mask[y]![x] = false;
}

function shapeMask(kind: Kind, mask: boolean[][], rng: Rng, forceL: boolean): void {
  const b = bbox(mask);
  const w = b.x1 - b.x0 + 1;
  const h = b.y1 - b.y0 + 1;
  const shape = kind.shape ?? (forceL ? "L" : "rect");
  if (shape === "L") {
    const cw = Math.max(4, Math.round(w * (0.3 + rng() * 0.1)));
    const ch = Math.max(3, Math.round(h * (0.35 + rng() * 0.1)));
    const corner = pick(rng, ["tl", "tr", "br", "bl"] as const);
    const left = corner.endsWith("l");
    const top = corner.startsWith("t");
    carveBlock(mask, left ? b.x0 : b.x1 - cw + 1, top ? b.y0 : b.y1 - ch + 1, left ? b.x0 + cw - 1 : b.x1, top ? b.y0 + ch - 1 : b.y1);
  } else if (shape === "octagon") {
    const c = Math.max(3, Math.round(Math.min(w, h) * 0.3));
    for (let y = b.y0; y <= b.y1; y += 1) {
      for (let x = b.x0; x <= b.x1; x += 1) {
        if (Math.min(x - b.x0, b.x1 - x) + Math.min(y - b.y0, b.y1 - y) < c) mask[y]![x] = false;
      }
    }
  } else if (shape === "hull") {
    const cy = (b.y0 + b.y1) / 2;
    const half = (h - 1) / 2;
    for (let y = b.y0; y <= b.y1; y += 1) {
      for (let x = b.x0; x <= b.x1; x += 1) {
        const taper = Math.min(1, (b.x1 - x) / 8);
        const stern = Math.min(1, 0.55 + (x - b.x0) / 4);
        if (Math.abs(y - cy) > half * taper * stern + 0.1) mask[y]![x] = false;
      }
    }
  } else if (shape === "cave") {
    caveMask(mask, rng, b);
  }
}

// Cellular-automata cave: smooth, wide and in one piece.
function caveMask(mask: boolean[][], rng: Rng, b: Box): void {
  let open = mask.map((row, y) => row.map((_, x) => x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1 && rng() > 0.44));
  for (let pass = 0; pass < 5; pass += 1) {
    open = open.map((row, y) => row.map((_, x) => {
      if (!(x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1)) return false;
      let walls = 0;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if (!open[y + dy]?.[x + dx]) walls += 1;
      return walls < 5;
    }));
  }
  // keep the largest piece
  const label = new Map<string, number>();
  let best: string[] = [];
  open.forEach((row, y) => row.forEach((on, x) => {
    if (!on || label.has(key(x, y))) return;
    const cells = [key(x, y)];
    label.set(key(x, y), 1);
    for (let i = 0; i < cells.length; i += 1) {
      const [cx, cy] = cells[i]!.split(",").map(Number);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const k = key(cx! + dx, cy! + dy);
        if (open[cy! + dy]?.[cx! + dx] && !label.has(k)) { label.set(k, 1); cells.push(k); }
      }
    }
    if (cells.length > best.length) best = cells;
  }));
  const keep = new Set(best);
  mask.forEach((row, y) => row.forEach((_, x) => { mask[y]![x] = keep.has(key(x, y)); }));
}

// Walls around every interior tile: one tile at the sides and bottom, two above (wall face + wall top).
function addWalls(grid: Grid, interior: boolean[][], ring: string): void {
  const h = grid.length;
  const w = grid[0]!.length;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (interior[y]![x]) continue;
      let touches = false;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if (interior[y + dy]?.[x + dx]) touches = true;
      if (touches) grid[y]![x] = ring;
    }
  }
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (interior[y]![x] && !interior[y - 1]?.[x] && y >= 2 && !interior[y - 2]![x]) grid[y - 2]![x] = ring;
    }
  }
}

// ---- drawing helpers -----------------------------------------------------------------------------------------------

const canPaint = (ch: string, ground: string): boolean => ch === ground || ch === "*" || ch === ",";

function paintBlob(L: Layout, cx: number, cy: number, rx: number, ry: number, ch: string, only?: string): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y += 1) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x += 1) {
      if (!inside(L.grid, x, y) || !L.interior[y]![x]) continue;
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1) continue;
      const cur = L.grid[y]![x]!;
      if (only ? cur === only : canPaint(cur, L.ground)) L.grid[y]![x] = ch;
    }
  }
}

function paintRect(L: Layout, x0: number, y0: number, x1: number, y1: number, ch: string, onlyGround = true): void {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (!inside(L.grid, x, y) || !L.interior[y]![x]) continue;
      if (!onlyGround || L.grid[y]![x] === L.ground) L.grid[y]![x] = ch;
    }
  }
}

function scatter(L: Layout, rng: Rng, ch: string, count: number, margin = 2, minGap = 0, from?: Box): number {
  const b = from ?? bbox(L.interior);
  const placed: Pt[] = [];
  for (let tries = 0; tries < count * 30 && placed.length < count; tries += 1) {
    const x = randInt(rng, b.x0 + margin, b.x1 - margin);
    const y = randInt(rng, b.y0 + margin, b.y1 - margin);
    if (!inside(L.grid, x, y) || !L.interior[y]![x] || L.grid[y]![x] !== L.ground) continue;
    if (placed.some((p) => Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) <= minGap)) continue;
    placed.push({ x, y });
    L.grid[y]![x] = ch;
  }
  return placed.length;
}

// ---- room furnishing -----------------------------------------------------------------------------------------------

function furnishRoom(L: Layout, rng: Rng, big: boolean): void {
  const b = bbox(L.interior);
  const w = b.x1 - b.x0 + 1;
  const h = b.y1 - b.y0 + 1;
  const k = L.kind;
  const cx = Math.round((b.x0 + b.x1) / 2);
  const cy = Math.round((b.y0 + b.y1) / 2);
  const put = (x: number, y: number, ch: string): void => {
    if (inside(L.grid, x, y) && L.interior[y]![x] && L.grid[y]![x] === L.ground) L.grid[y]![x] = ch;
  };

  if (k.rug === "centre") {
    const rw = Math.max(4, Math.round(w * 0.4));
    const rh = Math.max(3, Math.round(h * 0.4));
    const x0 = cx - Math.floor(rw / 2);
    const y0 = cy - Math.floor(rh / 2) + 1;
    paintRect(L, x0, y0, x0 + rw - 1, y0 + rh - 1, "R");
  } else if (k.rug === "runner") {
    if (w >= h) paintRect(L, b.x0 + 1, cy - 1, b.x1 - 1, cy, "R");
    else paintRect(L, cx - 1, b.y0 + 1, cx, b.y1 - 1, "R");
  }

  if (k.counter === "shop") {
    const len = Math.max(5, Math.round(w * 0.4));
    const left = rng() < 0.5;
    const x0 = left ? b.x0 + 2 : b.x1 - 1 - len;
    const y = b.y0 + 2;
    for (let x = x0; x < x0 + len; x += 1) put(x, y, "C");
    for (let dy = 1; dy <= 2; dy += 1) put(left ? x0 + len - 1 : x0, y + dy, "C");
  } else if (k.counter === "kitchen") {
    const y = b.y0 + 1;
    for (let x = b.x0 + 3; x <= b.x1 - 3; x += 1) put(x, y, "C");
    if (w >= 18) for (let x = cx - 2; x <= cx + 1; x += 1) put(x, cy + 1, "C");
    for (let dy = 3; dy < Math.min(h - 2, 6); dy += 1) put(b.x0, b.y0 + dy, "C");
  } else if (k.counter === "desk") {
    const y = b.y0 + 2;
    const spots = [Math.round(b.x0 + w * 0.25), Math.round(b.x0 + w * 0.65)];
    for (const sx of spots.slice(0, big || w >= 20 ? 2 : 1)) for (let x = sx; x < sx + 3; x += 1) put(x, y, "C");
    if (h >= 12) for (let x = cx - 1; x <= cx + 1; x += 1) put(x, b.y1 - 2, "C");
  }

  if (k.partition && big && w >= 20 && h >= 12) {
    const px = b.x0 + Math.round(w * (0.4 + rng() * 0.2));
    const gap = randInt(rng, b.y0 + 3, b.y1 - 3);
    for (let y = b.y0; y <= b.y1; y += 1) {
      if (Math.abs(y - gap) <= 1) continue;
      if (L.interior[y]![px] && L.grid[y]![px] === L.ground) L.grid[y]![px] = "#";
    }
  }
}

const PAVED: ReadonlySet<string> = new Set(["street", "square", "market"]);

// ---- outdoor places ------------------------------------------------------------------------------------------------

function fillOutdoor(L: Layout, rng: Rng, waterSide: Side): void {
  const b = bbox(L.interior);
  const w = b.x1 - b.x0 + 1;
  const h = b.y1 - b.y0 + 1;
  const cx = Math.round((b.x0 + b.x1) / 2);
  const cy = Math.round((b.y0 + b.y1) / 2);
  const name = L.kind.name;
  // The rock tile sits on a grass tile, so it only belongs on grass; sand, deck and cobble get stones from the decor.
  const scatterRock = (count: number, margin: number, gap: number): void => {
    if (L.ground === ",") scatter(L, rng, "o", count, margin, gap);
  };

  const horizontalWater = waterSide === "N" || waterSide === "S";
  // A low building (wall block) against the land side of the place, as long as `len` along the side.
  const landBlock = (len: number, depth: number): void => {
    const land = oppositeOf(waterSide);
    const lo = horizontalWater ? b.x0 + 3 : b.y0 + 2;
    const hi = (horizontalWater ? b.x1 : b.y1) - len - 3;
    if (hi < lo) return;
    const start = randInt(rng, lo, hi);
    for (let i = 0; i < len; i += 1) {
      for (let d = 0; d < depth; d += 1) {
        const x = horizontalWater ? start + i : land === "W" ? b.x0 + d : b.x1 - d;
        const y = !horizontalWater ? start + i : land === "N" ? b.y0 + d : b.y1 - d;
        if (L.grid[y]?.[x] === L.ground) L.grid[y]![x] = "#";
      }
    }
  };
  // Dunes or a grassy bank along the land side, with a few flowers.
  const bank = (depth: number): void => {
    for (let y = b.y0; y <= b.y1; y += 1) {
      for (let x = b.x0; x <= b.x1; x += 1) {
        const along = horizontalWater ? x : y;
        const wave = Math.round(Math.sin(along * 0.8 + 1) * 0.8);
        const land = oppositeOf(waterSide);
        const dist = land === "N" ? y - b.y0 : land === "S" ? b.y1 - y : land === "W" ? x - b.x0 : b.x1 - x;
        if (dist < depth + wave && L.grid[y]![x] === L.ground && L.interior[y]![x]) L.grid[y]![x] = rng() < 0.18 ? "*" : ",";
      }
    }
  };
  const waterBand = (depth: number, jetties: number, wide = false): void => {
    for (let y = b.y0; y <= b.y1; y += 1) {
      for (let x = b.x0; x <= b.x1; x += 1) {
        const along = waterSide === "N" || waterSide === "S" ? x : y;
        const wave = Math.round(Math.sin(along * 0.55 + b.x0) * 0.9);
        const dist = waterSide === "N" ? y - b.y0 : waterSide === "S" ? b.y1 - y : waterSide === "W" ? x - b.x0 : b.x1 - x;
        if (dist < depth + wave && L.interior[y]![x]) L.grid[y]![x] = "~";
      }
    }
    for (let j = 0; j < jetties; j += 1) {
      const frac = (j + 1) / (jetties + 1);
      const horiz = waterSide === "N" || waterSide === "S";
      const pos = horiz ? Math.round(b.x0 + w * frac) : Math.round(b.y0 + h * frac);
      for (let step = 0; step <= depth + 2; step += 1) {
        const x = horiz ? pos : waterSide === "W" ? b.x0 + depth + 1 - step : b.x1 - depth - 1 + step;
        const y = !horiz ? pos : waterSide === "N" ? b.y0 + depth + 1 - step : b.y1 - depth - 1 + step;
        if (!inside(L.grid, x, y) || !L.interior[y]![x]) continue;
        const dist = waterSide === "N" ? y - b.y0 : waterSide === "S" ? b.y1 - y : waterSide === "W" ? x - b.x0 : b.x1 - x;
        if (dist >= 1 && (L.grid[y]![x] === "~" || step <= 1)) L.grid[y]![x] = "=";
        if (wide) {
          const x2 = horiz ? x + 1 : x;
          const y2 = horiz ? y : y + 1;
          if (inside(L.grid, x2, y2) && L.interior[y2]![x2] && (L.grid[y2]![x2] === "~" || step <= 1)) L.grid[y2]![x2] = "=";
        }
      }
    }
  };

  switch (name) {
    case "garden": {
      paintRect(L, cx - 3, cy - 1, cx + 3, cy + 1, ":");
      const beds: [number, number][] = [[b.x0 + 3, b.y0 + 2], [b.x1 - 6, b.y0 + 2], [b.x0 + 3, b.y1 - 3], [b.x1 - 6, b.y1 - 3]];
      for (const [x, y] of beds) paintRect(L, x, y, x + 2, y + 1, "*");
      if (rng() < 0.5) paintBlob(L, cx + (rng() < 0.5 ? -6 : 6), cy + (rng() < 0.5 ? -3 : 3), 3, 2, "~");
      scatter(L, rng, "T", 3, 1, 3);
      break;
    }
    case "park": {
      const m = 3;
      for (let x = b.x0 + m; x <= b.x1 - m; x += 1) { L.grid[b.y0 + m]![x] = ":"; L.grid[b.y1 - m]![x] = ":"; }
      for (let y = b.y0 + m; y <= b.y1 - m; y += 1) { L.grid[y]![b.x0 + m] = ":"; L.grid[y]![b.x1 - m] = ":"; }
      paintBlob(L, cx + (rng() < 0.5 ? -5 : 5), cy, 5, 3, "~");
      scatter(L, rng, "T", 8, 1, 2);
      scatter(L, rng, "*", 6, 2, 1);
      break;
    }
    case "street": {
      // Houses step forward from the front wall; the far side is a grass verge with trees.
      for (let x = b.x0 + 2; x + 3 < b.x1 - 1; x += randInt(rng, 7, 10)) {
        const bay = randInt(rng, 3, 5);
        for (let dx = 0; dx < bay; dx += 1) if (L.grid[b.y0]![x + dx] === L.ground) L.grid[b.y0]![x + dx] = "#";
      }
      for (let x = b.x0; x <= b.x1; x += 1) {
        const depth = Math.sin(x * 0.7) > 0.2 ? 2 : 1;
        for (let d = 0; d < depth; d += 1) if (L.grid[b.y1 - d]![x] === L.ground) L.grid[b.y1 - d]![x] = rng() < 0.12 ? "*" : ",";
      }
      for (let x = b.x0 + 3; x < b.x1 - 2; x += randInt(rng, 5, 8)) if (L.grid[b.y1]![x] === ",") L.grid[b.y1]![x] = "T";
      break;
    }
    case "square": {
      // A planted bed with the fountain in the middle, trees in the corners.
      paintBlob(L, cx, cy, 4.5, 2.6, ",");
      for (let y = cy - 3; y <= cy + 3; y += 1) for (let x = cx - 5; x <= cx + 5; x += 1) {
        if (L.grid[y]?.[x] === "," && (x !== cx || y !== cy) && rng() < 0.3) L.grid[y]![x] = "*";
      }
      for (const [dx, dy] of [[-10, -4], [10, -4], [-10, 4], [10, 4]] as const) if (L.grid[cy + dy]?.[cx + dx] === L.ground) L.grid[cy + dy]![cx + dx] = "T";
      break;
    }
    case "market": {
      // Rows of stalls (a table and the stand behind it) with an aisle between the rows.
      for (const y of [b.y0 + 3, b.y1 - 4]) {
        for (let x = b.x0 + 3; x + 4 <= b.x1 - 2; x += 7) {
          if (rng() < 0.15) continue;
          for (let dx = 0; dx < 4; dx += 1) {
            if (L.grid[y]![x + dx] === L.ground) L.grid[y]![x + dx] = "C";
            if (L.grid[y + 1]![x + dx] === L.ground) L.grid[y + 1]![x + dx] = "C";
          }
        }
      }
      break;
    }
    case "yard": {
      for (let n = 0; n < 7; n += 1) {
        const x = randInt(rng, b.x0 + 3, b.x1 - 5);
        const y = randInt(rng, b.y0 + 2, b.y1 - 2);
        for (let dx = 0; dx < 2; dx += 1) if (L.grid[y]![x + dx] === L.ground && L.grid[y]![x + 2] !== "C") L.grid[y]![x + dx] = "C";
      }
      break;
    }
    case "harbour": {
      waterBand(5, 2, true);
      landBlock(horizontalWater ? 7 : 5, horizontalWater ? 2 : 3);
      scatter(L, rng, "C", 3, 2, 4);
      scatterRock(3, 1, 3);
      break;
    }
    case "shore": {
      waterBand(7, 1);
      bank(3);
      scatterRock(7, 1, 2);
      break;
    }
    case "islet": {
      waterBand(4, 0);
      scatterRock(14, 1, 1);
      break;
    }
    case "tidepool": {
      bank(2);
      for (let n = 0; n < 5; n += 1) paintBlob(L, randInt(rng, b.x0 + 4, b.x1 - 4), randInt(rng, b.y0 + 3, b.y1 - 3), randInt(rng, 2, 4), randInt(rng, 1, 2), "~");
      scatterRock(10, 1, 2);
      break;
    }
    case "reeds": {
      paintBlob(L, b.x0 + w * 0.3, cy, w * 0.22, h * 0.34, "~");
      paintBlob(L, b.x1 - w * 0.25, cy + 2, w * 0.15, h * 0.25, "~");
      for (let y = b.y0; y <= b.y1; y += 1) for (let x = b.x0; x <= b.x1; x += 1) {
        const nearWater = L.grid[y]![x] === L.ground && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => L.grid[y + dy!]?.[x + dx!] === "~");
        if (nearWater && rng() < 0.45) L.grid[y]![x] = "T";
      }
      scatter(L, rng, "*", 8, 2, 1);
      break;
    }
    case "kelp":
    case "forest": {
      const dense = name === "forest" ? 0.5 : 0.47;
      let trees = L.grid.map((row, y) => row.map((_, x) => L.interior[y]![x] && rng() < dense));
      for (let pass = 0; pass < 3; pass += 1) {
        trees = trees.map((row, y) => row.map((_, x) => {
          if (!L.interior[y]![x]) return false;
          let n = 0;
          for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if (trees[y + dy]?.[x + dx]) n += 1;
          return n >= 5;
        }));
      }
      trees.forEach((row, y) => row.forEach((on, x) => { if (on && L.grid[y]![x] === L.ground) L.grid[y]![x] = "T"; }));
      paintBlob(L, cx, cy, 4, 3, L.ground, "T");
      scatter(L, rng, "*", 5, 2, 2);
      scatterRock(3, 2, 3);
      break;
    }
    case "meadow": {
      for (let n = 0; n < 5; n += 1) paintBlob(L, randInt(rng, b.x0 + 3, b.x1 - 3), randInt(rng, b.y0 + 2, b.y1 - 2), randInt(rng, 2, 4), randInt(rng, 1, 2), "*");
      scatter(L, rng, "T", 6, 1, 3);
      scatterRock(3, 1, 3);
      break;
    }
    case "roof": {
      scatter(L, rng, "C", 2, 2, 4);
      break;
    }
    default:
      break;
  }
}

// ---- doors ---------------------------------------------------------------------------------------------------------

export interface DoorWish {
  side: Side;
  rank: number; // position among the doors on the same side, 0 = first along the side
  count: number; // how many doors are on that side
}

export function sideForBearing(bearing: number): Side {
  const d = ((bearing % 360) + 360) % 360;
  return d >= 315 || d < 45 ? "N" : d < 135 ? "E" : d < 225 ? "S" : "W";
}

// Ring tiles with exactly one interior neighbour that is not a nook: a door can sit there.
function doorCandidates(L: Layout): { p: Pt; side: Side; inner: Pt }[] {
  const result: { p: Pt; side: Side; inner: Pt }[] = [];
  const b = bbox(L.interior);
  for (let y = 0; y < L.height; y += 1) {
    for (let x = 0; x < L.width; x += 1) {
      if (L.interior[y]![x]) continue;
      const ch = L.grid[y]![x]!;
      if (ch === " " || isDoorChar(ch)) continue;
      const inner: { p: Pt; side: Side }[] = [];
      if (L.interior[y + 1]?.[x]) inner.push({ p: { x, y: y + 1 }, side: "N" });
      if (L.interior[y - 1]?.[x]) inner.push({ p: { x, y: y - 1 }, side: "S" });
      if (L.interior[y]?.[x + 1]) inner.push({ p: { x: x + 1, y }, side: "W" });
      if (L.interior[y]?.[x - 1]) inner.push({ p: { x: x - 1, y }, side: "E" });
      if (inner.length !== 1) continue;
      const side = inner[0]!.side;
      const horizontal = side === "N" || side === "S";
      const a = horizontal ? { x: x - 1, y } : { x, y: y - 1 };
      const c = horizontal ? { x: x + 1, y } : { x, y: y + 1 };
      if (L.interior[a.y]?.[a.x] || L.interior[c.y]?.[c.x]) continue;
      if (!inside(L.grid, a.x, a.y) || !inside(L.grid, c.x, c.y)) continue;
      if (horizontal ? x <= b.x0 || x >= b.x1 : y <= b.y0 || y >= b.y1) continue;
      result.push({ p: { x, y }, side, inner: inner[0]!.p });
    }
  }
  return result;
}

const clearable = new Set(["T", "o", "O", "C", "*", "R", "#"]);

// Puts door digits 1..n in the ring and clears the two tiles in front of each. Returns the door tiles, in order.
export function placeDoors(L: Layout, wishes: readonly DoorWish[], ground: string): Pt[] {
  const candidates = doorCandidates(L);
  const b = bbox(L.interior);
  const doors: Pt[] = [];
  const innerOf = new Map<string, Pt>();
  wishes.forEach((wish, index) => {
    const horizontal = wish.side === "N" || wish.side === "S";
    const lo = horizontal ? b.x0 : b.y0;
    const hi = horizontal ? b.x1 : b.y1;
    const ideal = lo + (hi - lo) * ((wish.rank + 1) / (wish.count + 1));
    let best: (typeof candidates)[number] | undefined;
    let bestCost = Infinity;
    for (const c of candidates) {
      if (isDoorChar(L.grid[c.p.y]![c.p.x]!)) continue;
      const innerCh = L.grid[c.inner.y]![c.inner.x]!;
      if (innerCh === "~" || innerCh === " " || innerCh === "#") continue;
      const pos = horizontal ? c.p.x : c.p.y;
      let cost = Math.abs(pos - ideal);
      if (c.side !== wish.side) cost += 60 + (c.side === oppositeOf(wish.side) ? 20 : 0);
      for (const other of doors) cost += Math.max(0, 7 - (Math.abs(other.x - c.p.x) + Math.abs(other.y - c.p.y))) * 3;
      if (innerCh !== ground && innerCh !== ":" && innerCh !== "." && innerCh !== ",") cost += 2;
      if (cost < bestCost) { bestCost = cost; best = c; }
    }
    if (!best) throw new Error(`No place for door ${index + 1} (${wish.side}).`);
    L.grid[best.p.y]![best.p.x] = String(index + 1);
    doors.push(best.p);
    innerOf.set(key(best.p.x, best.p.y), best.inner);
    // clear the way in: the tile inside the door and one more
    const dx = best.inner.x - best.p.x;
    const dy = best.inner.y - best.p.y;
    for (let step = 1; step <= 2; step += 1) {
      for (const lateral of [0]) {
        const x = best.p.x + dx * step + (dy !== 0 ? lateral : 0);
        const y = best.p.y + dy * step + (dx !== 0 ? lateral : 0);
        if (inside(L.grid, x, y) && L.interior[y]![x] && clearable.has(L.grid[y]![x]!)) L.grid[y]![x] = ground;
      }
    }
  });
  return doors;
}

function oppositeOf(side: Side): Side {
  return side === "N" ? "S" : side === "S" ? "N" : side === "E" ? "W" : "E";
}

export function innerOfDoor(grid: Grid, door: Pt): Pt | undefined {
  for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
    if (walkableAt(grid, door.x + dx, door.y + dy) && !isDoorChar(at(grid, door.x + dx, door.y + dy))) return { x: door.x + dx, y: door.y + dy };
  }
  return undefined;
}

// Joins every door to the hub; outdoors the route is painted as a path.
function connect(L: Layout, doors: readonly Pt[], pathChar: string | null): void {
  const preferred = new Set<string>();
  for (const door of doors) {
    const start = innerOfDoor(L.grid, door);
    if (!start) continue;
    const found = route(L.grid, start, L.hub, preferred);
    if (!found) continue;
    for (const p of found) {
      const cur = L.grid[p.y]![p.x]!;
      preferred.add(key(p.x, p.y));
      if (pathChar && (cur === L.ground || cur === "*" || cur === "T" || cur === "o")) L.grid[p.y]![p.x] = pathChar;
      else if (cur === "T" || cur === "o" || cur === "O" || cur === "C") L.grid[p.y]![p.x] = L.ground;
    }
  }
}

// ---- entry point -----------------------------------------------------------------------------------------------------

export interface LayoutRequest {
  kind: Kind;
  rng: Rng;
  wishes: readonly DoorWish[];
}

export function buildLayout(req: LayoutRequest): { layout: Layout; doors: Pt[] } {
  const { kind, rng, wishes } = req;
  const [minW, maxW, minH, maxH] = kind.size;
  const width = randInt(rng, minW, maxW);
  let height = randInt(rng, minH, maxH);
  // More doors need more wall.
  if (wishes.length >= 5) height = Math.max(height, 13);
  const interior = makeGrid(width, height, "").map((row) => row.map(() => false));
  for (let y = 2; y <= height - 2; y += 1) for (let x = 1; x <= width - 2; x += 1) interior[y]![x] = true;
  const grassy = kind.group === "outdoor" && (kind.floor === "grass" || kind.name === "kelp");
  const ground = grassy && kind.name !== "kelp" ? "," : kind.name === "kelp" ? "," : ".";
  const mediumUp = width >= 20;
  const forceL = kind.group === "room" && !kind.shape && mediumUp && !kind.counter && rng() < 0.35 && wishes.length <= 3;
  if (kind.group === "room") shapeMask(kind, interior, rng, forceL);
  else if (kind.shape === "L") shapeMask(kind, interior, rng, true);
  const grid = makeGrid(width, height, " ");
  interior.forEach((row, y) => row.forEach((on, x) => { if (on) grid[y]![x] = ground; }));
  const treeRing = kind.name === "meadow" || kind.name === "forest" || kind.name === "kelp" || kind.name === "reeds";
  // Streets, squares and markets are open to the sides: building fronts along the top, a ring of trees elsewhere.
  const frontRing = PAVED.has(kind.name);
  addWalls(grid, interior, treeRing || frontRing ? "T" : "#");
  if (frontRing) {
    for (let y = 2; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (interior[y]![x] && !interior[y - 1]?.[x]) { grid[y - 1]![x] = "#"; if (y >= 2) grid[y - 2]![x] = "#"; }
      }
    }
  }

  const b = bbox(interior);
  const layout: Layout = {
    grid, width, height, interior, ground, kind,
    hub: { x: Math.round((b.x0 + b.x1) / 2), y: Math.round((b.y0 + b.y1) / 2) },
  };

  if (kind.group === "room") furnishRoom(layout, rng, width >= 26 || kind.name === "hall");
  else {
    const used = new Set(wishes.map((wish) => wish.side));
    const waterSide = (["S", "N", "E", "W"] as const).find((side) => !used.has(side)) ?? "S";
    fillOutdoor(layout, rng, waterSide);
  }
  if (kind.name === "ruins") {
    scatter(layout, rng, ",", 18, 1, 0);
    scatter(layout, rng, "T", 3, 1, 3);
  }

  // The hub must be walkable; otherwise take the nearest walkable tile.
  if (!walkableAt(grid, layout.hub.x, layout.hub.y)) {
    let best: Pt | undefined;
    let bestDist = Infinity;
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      if (!interior[y]![x] || !walkableAt(grid, x, y)) continue;
      const d = Math.abs(x - layout.hub.x) + Math.abs(y - layout.hub.y);
      if (d < bestDist) { bestDist = d; best = { x, y }; }
    }
    if (best) layout.hub = best;
  }

  const doors = placeDoors(layout, wishes, ground);
  const pathChar = kind.group === "outdoor" && ground === "," ? ":" : null;
  connect(layout, doors, pathChar);
  // Pockets of floor that the hub cannot reach (behind a partition, say) are filled in, so nothing hides there.
  const reach = flood(grid, layout.hub, undefined, undefined, true);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (interior[y]![x] && walkableAt(grid, x, y) && !reach.has(key(x, y)) && !isDoorChar(grid[y]![x]!)) {
        grid[y]![x] = kind.group === "room" ? "#" : "T";
      }
    }
  }
  return { layout, doors };
}

export function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  return shuffle(rng, items);
}
