// Small ASCII-grid helpers shared by the Story Forge bake step. Map legend: src/world/mapLegend.ts.

export interface Pt {
  x: number;
  y: number;
}

export type Grid = string[][];
export type Rng = () => number;

export const SOLID_CHARS = new Set([" ", "#", "C", "O", "T", "o", "~"]);

export const key = (x: number, y: number): string => `${x},${y}`;
export const isDoorChar = (ch: string): boolean => ch >= "1" && ch <= "9";

export function makeGrid(width: number, height: number, ch = " "): Grid {
  return Array.from({ length: height }, () => Array<string>(width).fill(ch));
}

export function gridRows(grid: Grid): string[] {
  return grid.map((row) => row.join(""));
}

export function inside(grid: Grid, x: number, y: number): boolean {
  return y >= 0 && y < grid.length && x >= 0 && x < grid[0]!.length;
}

export function at(grid: Grid, x: number, y: number): string {
  return inside(grid, x, y) ? grid[y]![x]! : " ";
}

// Walkable in the game: everything except void, wall, counter, boulder, tree, rock, water and decor.
export function walkableAt(grid: Grid, x: number, y: number, decor?: ReadonlySet<string>): boolean {
  if (!inside(grid, x, y)) return false;
  if (SOLID_CHARS.has(grid[y]![x]!)) return false;
  return !decor?.has(key(x, y));
}

export const DIRS4: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

// Tiles reachable by floor only, never stepping on door digits (doors to places outside a length become walls).
export function flood(
  grid: Grid,
  start: Pt,
  decor?: ReadonlySet<string>,
  blocked?: ReadonlySet<string>,
  throughDoors = false,
): Set<string> {
  const seen = new Set<string>();
  const ok = (x: number, y: number): boolean =>
    walkableAt(grid, x, y, decor) && !blocked?.has(key(x, y)) && (throughDoors || !isDoorChar(at(grid, x, y)));
  if (!ok(start.x, start.y)) return seen;
  seen.add(key(start.x, start.y));
  const queue: Pt[] = [start];
  for (let i = 0; i < queue.length; i += 1) {
    const p = queue[i]!;
    for (const [dx, dy] of DIRS4) {
      const x = p.x + dx;
      const y = p.y + dy;
      if (!seen.has(key(x, y)) && ok(x, y)) {
        seen.add(key(x, y));
        queue.push({ x, y });
      }
    }
  }
  return seen;
}

export function chebyshev(a: Pt, b: Pt): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

// Cheapest route between two tiles; solid props (tree, counter, rock, flowers) may be cleared, walls and water may not.
// Returns the tiles from `from` to `to` inclusive, or undefined.
export function route(grid: Grid, from: Pt, to: Pt, preferred?: ReadonlySet<string>): Pt[] | undefined {
  const cost = (x: number, y: number): number => {
    if (!inside(grid, x, y)) return Infinity;
    const ch = grid[y]![x]!;
    if (ch === " " || ch === "#" || ch === "~" || isDoorChar(ch)) return Infinity;
    if (ch === "T" || ch === "o" || ch === "O" || ch === "C") return 4;
    if (preferred?.has(key(x, y))) return 0.4;
    if (ch === ":" || ch === "=" || ch === "R") return 0.6;
    return 1;
  };
  const dist = new Map<string, number>([[key(from.x, from.y), 0]]);
  const prev = new Map<string, string>();
  const open: { p: Pt; d: number }[] = [{ p: from, d: 0 }];
  while (open.length > 0) {
    let best = 0;
    for (let i = 1; i < open.length; i += 1) if (open[i]!.d < open[best]!.d) best = i;
    const { p, d } = open.splice(best, 1)[0]!;
    if (p.x === to.x && p.y === to.y) {
      const result: Pt[] = [p];
      let k = prev.get(key(p.x, p.y));
      while (k) {
        const [x, y] = k.split(",").map(Number);
        result.unshift({ x: x!, y: y! });
        k = prev.get(k);
      }
      return result;
    }
    if (d > (dist.get(key(p.x, p.y)) ?? Infinity)) continue;
    for (const [dx, dy] of DIRS4) {
      const x = p.x + dx;
      const y = p.y + dy;
      const step = cost(x, y);
      if (step === Infinity) continue;
      const nd = d + step;
      if (nd < (dist.get(key(x, y)) ?? Infinity)) {
        dist.set(key(x, y), nd);
        prev.set(key(x, y), key(p.x, p.y));
        open.push({ p: { x, y }, d: nd });
      }
    }
  }
  return undefined;
}
