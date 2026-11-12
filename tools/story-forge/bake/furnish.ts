// Decor and story placements for a baked layout. Everything is deterministic for a given rng.
import { getGlyph, resolveVisualSpec, tokenizeVisualText } from "../../../src/art/glyphs";
import { placedObjects } from "../../../src/story/slice";
import type { Location, StoryPack } from "../../../src/story/types";
import type { DecorRule } from "./kinds";
import type { Grid, Pt, Rng } from "./grid";
import {
  at, chebyshev, flood, inside, isDoorChar, key, shuffle, walkableAt,
} from "./grid";

export interface DecorItem { icon: string; x: number; y: number }

const FLOOR_CHARS = new Set([".", ","]);

function walkableNeighbours8(grid: Grid, decor: ReadonlySet<string>, p: Pt): number {
  let n = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) if ((dx || dy) && walkableAt(grid, p.x + dx, p.y + dy, decor)) n += 1;
  }
  return n;
}

function nearDoor(doors: readonly Pt[], p: Pt, radius: number): boolean {
  return doors.some((door) => chebyshev(door, p) <= radius);
}

// Blocking `blocked` must not cut the floor in pieces: everything else reachable from the hub stays reachable.
function staysConnected(grid: Grid, hub: Pt, blocked: ReadonlySet<string>, base: ReadonlySet<string>): boolean {
  const reach = flood(grid, hub, undefined, blocked);
  let blockedInside = 0;
  for (const k of blocked) if (base.has(k)) blockedInside += 1;
  return reach.size === base.size - blockedInside;
}

// ---- decor ---------------------------------------------------------------------------------------------------------

function isWall(grid: Grid, x: number, y: number): boolean {
  return at(grid, x, y) === "#";
}

function candidatesFor(grid: Grid, rule: DecorRule): Pt[] {
  const out: Pt[] = [];
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[0]!.length; x += 1) {
      if (!FLOOR_CHARS.has(grid[y]![x]!)) continue;
      const above = isWall(grid, x, y - 1);
      const below = isWall(grid, x, y + 1);
      const sides = (isWall(grid, x - 1, y) ? 1 : 0) + (isWall(grid, x + 1, y) ? 1 : 0);
      const ring = [at(grid, x, y - 1), at(grid, x, y + 1), at(grid, x - 1, y), at(grid, x + 1, y)];
      switch (rule.at) {
        case "wall": if (above) out.push({ x, y }); break;
        case "side": if (sides > 0 && !above && !below) out.push({ x, y }); break;
        case "corner": if ((above || below) && sides > 0) out.push({ x, y }); break;
        case "edge": if (ring.some((ch) => ch === "#" || ch === "T")) out.push({ x, y }); break;
        case "free": {
          let open = true;
          for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
            const ch = at(grid, x + dx, y + dy);
            if (!(FLOOR_CHARS.has(ch) || ch === "R" || ch === ":")) open = false;
          }
          if (open) out.push({ x, y });
          break;
        }
      }
    }
  }
  return out;
}

export function placeDecor(
  grid: Grid, rules: readonly DecorRule[], rng: Rng, doors: readonly Pt[], hub: Pt, avoidText: string,
  special?: { icon: string; at: Pt },
): DecorItem[] {
  const decor = new Set<string>();
  const items: DecorItem[] = [];
  const base = flood(grid, hub);
  const free = (icon: string): boolean => {
    const bare = icon.split("_")[0]!;
    return !avoidText.includes(bare) && !avoidText.includes(icon.replace(/_/g, " "));
  };
  const add = (p: Pt, icon: string, spacing: number): boolean => {
    if (!FLOOR_CHARS.has(at(grid, p.x, p.y)) || decor.has(key(p.x, p.y))) return false;
    if (nearDoor(doors, p, 2)) return false;
    if (items.some((other) => chebyshev(other, p) <= spacing)) return false;
    if (walkableNeighbours8(grid, decor, p) < 4) return false;
    decor.add(key(p.x, p.y));
    if (!staysConnected(grid, hub, decor, base)) { decor.delete(key(p.x, p.y)); return false; }
    items.push({ icon, x: p.x, y: p.y });
    return true;
  };
  if (special) {
    const { x, y } = special.at;
    if (free(special.icon) && FLOOR_CHARS.has(at(grid, x, y))) {
      decor.add(key(x, y));
      items.push({ icon: special.icon, x, y });
    }
  }
  for (const rule of rules) {
    const icons = rule.icons.filter(free);
    if (icons.length === 0) continue;
    const want = rule.n[0] + Math.floor(rng() * (rule.n[1] - rule.n[0] + 1));
    const pool = shuffle(rng, candidatesFor(grid, rule));
    let made = 0;
    for (const p of pool) {
      if (made >= want) break;
      const icon = icons[made % icons.length]!;
      if (add(p, icon, icon === "bookshelf" ? 0 : 1)) made += 1;
    }
  }
  return items;
}

// ---- story things --------------------------------------------------------------------------------------------------

export interface Thing {
  id: string;
  kind: "object" | "item" | "character";
  name: string;
  text: string; // description, personality, clue text...
  icon?: string;
  required: boolean;
  related?: string; // extra words for matching (goal, secret, where...)
}

// Everything that gets a tile in a location. Clues have none: each is anchored to an object (clue.object_id).
export function collectThings(pack: StoryPack, location: Location): Thing[] {
  const things: Thing[] = [];
  for (const object of placedObjects(pack, location)) {
    const icon = object.visual?.icon ?? resolveVisualSpec(object.name, object.description).icon;
    things.push({ id: `obj:${object.id}`, kind: "object", name: object.name, text: object.description, icon, required: true });
  }
  for (const item of pack.items) {
    if (item.found_at?.type === "location" && item.found_at.id === location.id) {
      const icon = item.visual?.icon ?? resolveVisualSpec(item.name, item.description).icon;
      things.push({ id: `item:${item.id}`, kind: "item", name: item.name, text: item.description, icon, required: true });
    }
  }
  for (const id of location.required_characters) {
    const member = pack.cast.find((c) => c.id === id);
    if (!member) throw new Error(`Location "${location.id}" requires unknown character "${id}".`);
    things.push({
      id: `char:${id}`, kind: "character", name: member.name, text: member.personality, required: true,
      related: `${member.species} ${member.goal} ${member.secret}`,
    });
  }
  return things;
}

const STOP = new Set([
  "about", "after", "again", "also", "been", "before", "being", "could", "found", "from", "have", "help", "into",
  "just", "keep", "near", "once", "place", "room", "someone", "something", "stay", "that", "their", "there", "they",
  "this", "through", "thing", "want", "what", "when", "where", "which", "with", "would", "your",
]);
export const words = (text: string): Set<string> => new Set(tokenizeVisualText(text).filter((w) => w.length > 2 && !STOP.has(w)));
export const overlap = (a: ReadonlySet<string>, b: ReadonlySet<string>): number => [...a].filter((w) => b.has(w)).length;

const WALL_MOUNTED = new Set(["window", "shelf", "poster", "banner", "plaque", "hook", "rail", "notice", "board", "painting", "mirror", "clock", "peg"]);
const AGAINST_WALL = new Set(["desk", "cot", "cupboard", "bench", "chair", "table", "bed", "cabinet", "wardrobe", "stove", "oven", "bin", "bookshelf", "workbench", "counter", "basket"]);
const OUTDOOR = new Set(["path", "trail", "road", "water", "river", "sea", "shore", "beach", "bank", "garden", "flower", "tree", "plant", "reed", "boat", "pond", "fog", "tidepool", "edge"]);

type Placement = "wall-mounted" | "against-wall" | "free" | "outdoor" | "waterside" | "flowers";

// Outdoors, a pond fountain stands at the pond and a flowerbed in the flowers, whatever the icon's category says.
const WATERSIDE = new Set(["pond", "fountain", "tidepool", "boat", "fog", "reed", "reeds", "tide"]);
const FLOWERY = new Set(["flower", "flowers", "flowerbed", "rose", "roses", "herb", "herbs", "bloom", "blooms"]);

function classify(thing: Thing): Placement {
  const glyph = thing.icon ? getGlyph(thing.icon) ?? getGlyph(thing.icon.replace(/_open$/, "")) : undefined;
  const named = words(`${thing.name} ${glyph?.name ?? ""}`);
  const tags = new Set(glyph?.tags.flatMap((t) => tokenizeVisualText(t)) ?? []);
  if ([...WALL_MOUNTED].some((w) => named.has(w)) || glyph?.id === "hook") return "wall-mounted";
  if ([...AGAINST_WALL].some((w) => named.has(w)) || glyph?.category === "furniture") return "against-wall";
  const all = new Set([...named, ...tags, ...words(thing.text)]);
  if ([...OUTDOOR].some((w) => all.has(w))) return "outdoor";
  return "free";
}

export function keywords(thing: Thing): Set<string> {
  const glyph = thing.icon ? getGlyph(thing.icon) : undefined;
  return words(`${thing.name} ${glyph?.name ?? ""}`);
}

export interface PlaceOptions {
  grid: Grid;
  decor: ReadonlyArray<{ x: number; y: number }>;
  doors: readonly Pt[];
  hub: Pt;
  rng: Rng;
  indoor: boolean;
  things: readonly Thing[];
  fixed?: Readonly<Record<string, readonly [number, number]>>; // hand-chosen tiles, kept as they are
}

export function placeThings(opts: PlaceOptions): Record<string, [number, number]> {
  const { grid, doors, hub, rng, things } = opts;
  const decor = new Set(opts.decor.map((d) => key(d.x, d.y)));
  const reach = flood(grid, hub, decor);
  const base = flood(grid, hub);
  const w = grid[0]!.length;
  const h = grid.length;
  const all: Pt[] = [];
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) if (reach.has(key(x, y))) all.push({ x, y });
  const order = shuffle(rng, all);
  const zone = (p: Pt): boolean => nearDoor(doors, p, 1);
  const onPath = (p: Pt): boolean => at(grid, p.x, p.y) === ":" || at(grid, p.x, p.y) === "=";
  const roomy = (p: Pt, n: number): boolean => walkableNeighbours8(grid, decor, p) >= n;
  const open = order.filter((p) => !zone(p) && roomy(p, 7) && !onPath(p));
  const beside = (p: Pt, ch: string): boolean => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => at(grid, p.x + dx!, p.y + dy!) === ch);
  const shore = order.filter((p) => !zone(p) && !onPath(p) && roomy(p, 4) && beside(p, "~"));
  const flowerbeds = order.filter((p) => !zone(p) && !onPath(p) && at(grid, p.x, p.y) === "*" && roomy(p, 6));
  const openAny = order.filter((p) => !zone(p) && roomy(p, 5));
  const wallMounted = order.filter((p) => !zone(p) && isWall(grid, p.x, p.y - 1) && roomy(p, 5) && !onPath(p));
  const againstWall = order.filter((p) => !zone(p) && roomy(p, 5) && !onPath(p)
    && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => ["#", "C"].includes(at(grid, p.x + dx!, p.y + dy!))));
  const fallback = order.filter((p) => !zone(p));

  const placed = new Map<string, Pt>();
  const blocked = new Set<string>(decor);
  const taken = (): Pt[] => [...placed.values()];

  const choose = (pools: readonly (readonly Pt[])[], strict = true): Pt | undefined => {
    for (const spacing of [3, 2, 1, 0]) {
      for (const pool of pools) {
        for (const p of pool) {
          const k = key(p.x, p.y);
          if (blocked.has(k) || placed.size > 0 && taken().some((q) => chebyshev(q, p) < spacing)) continue;
          const trial = new Set(blocked);
          trial.add(k);
          for (const q of taken()) trial.add(key(q.x, q.y));
          if (strict && !staysConnected(grid, hub, trial, base)) continue;
          return p;
        }
      }
      if (!strict) break;
    }
    return undefined;
  };
  const commit = (thing: Thing, p: Pt): void => {
    placed.set(thing.id, p);
    blocked.add(key(p.x, p.y));
  };

  for (const thing of things) {
    const f = opts.fixed?.[thing.id];
    if (f) commit(thing, { x: f[0], y: f[1] });
  }
  const todo = things.filter((t) => !placed.has(t.id));
  const objects = todo.filter((t) => t.kind === "object" || t.kind === "item");
  const placedObjects: { thing: Thing; p: Pt }[] = [];
  const nearTo = (thing: Thing): Pt | undefined => {
    const text = words(`${thing.id.replace(/[_-]/g, " ")} ${thing.name} ${thing.text} ${thing.related ?? ""}`);
    return placedObjects
      .map(({ thing: other, p }) => ({ p, score: overlap(text, keywords(other)) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.p;
  };
  const adjacent = (p: Pt): Pt[] => [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]
    .map(([dx, dy]) => ({ x: p.x + dx!, y: p.y + dy! }))
    .filter((q) => reach.has(key(q.x, q.y)) && !zone(q));

  // objects that characters refer to keep their neighbours free
  const referenced = (thing: Thing): boolean => things.some((other) =>
    other.kind === "character"
    && overlap(words(`${other.id.replace(/[_-]/g, " ")} ${other.name} ${other.text} ${other.related ?? ""}`), keywords(thing)) > 0);

  for (const thing of [...objects].sort((a, b) => Number(referenced(b)) - Number(referenced(a)))) {
    const nameWords = words(`${thing.name} ${thing.id.replace(/[_:-]/g, " ")}`);
    const kind: Placement = opts.indoor ? classify(thing)
      : [...WATERSIDE].some((w) => nameWords.has(w)) ? "waterside"
        : [...FLOWERY].some((w) => nameWords.has(w)) ? "flowers" : classify(thing);
    const indoorPools = kind === "waterside" ? [shore, outdoorPool(grid, thing, open)]
      : kind === "flowers" ? [flowerbeds, open]
      : kind === "wall-mounted" ? [wallMounted, againstWall, open]
      : kind === "against-wall" ? [againstWall, open]
        : kind === "outdoor" && !opts.indoor ? [outdoorPool(grid, thing, open), open] : [open];
    const p = choose([...indoorPools, openAny, fallback]) ?? choose([fallback], false);
    if (!p) throw new Error(`No reachable tile for "${thing.id}".`);
    commit(thing, p);
    placedObjects.push({ thing, p });
  }
  for (const thing of todo.filter((t) => t.kind === "character")) {
    const near = nearTo(thing);
    const pools = near ? [adjacent(near).filter((q) => !onPath(q)), open, openAny] : [open, openAny];
    const p = choose([...pools, fallback]) ?? choose([fallback], false);
    if (!p) throw new Error(`No reachable tile for "${thing.id}".`);
    commit(thing, p);
  }
  const result: Record<string, [number, number]> = {};
  for (const thing of things) result[thing.id] = [placed.get(thing.id)!.x, placed.get(thing.id)!.y];
  return result;
}

function outdoorPool(grid: Grid, thing: Thing, open: readonly Pt[]): Pt[] {
  const content = words(`${thing.name} ${thing.text}`);
  const target = ["water", "river", "sea", "shore", "beach", "bank", "pond", "reed", "boat", "tidepool", "fog"].some((w) => content.has(w)) ? "~" : ":";
  const dist = (p: Pt): number => {
    let best = Infinity;
    for (let y = p.y - 3; y <= p.y + 3; y += 1) for (let x = p.x - 3; x <= p.x + 3; x += 1) {
      if (inside(grid, x, y) && grid[y]![x] === target) best = Math.min(best, Math.abs(p.x - x) + Math.abs(p.y - y));
    }
    return best;
  };
  return [...open].sort((a, b) => dist(a) - dist(b));
}

// The tile where the player starts: near the middle, away from story things and doors.
export function chooseStart(grid: Grid, decor: ReadonlyArray<{ x: number; y: number }>, doors: readonly Pt[], hub: Pt, taken: readonly Pt[]): Pt {
  const set = new Set(decor.map((d) => key(d.x, d.y)));
  const reach = flood(grid, hub, set);
  const options = [...reach].map((k) => {
    const [x, y] = k.split(",").map(Number);
    return { x: x!, y: y! };
  }).filter((p) => !nearDoor(doors, p, 1) && walkableNeighbours8(grid, set, p) >= 7
    && taken.every((q) => chebyshev(q, p) >= 2) && !isDoorChar(at(grid, p.x, p.y)));
  options.sort((a, b) => (Math.abs(a.x - hub.x) + Math.abs(a.y - hub.y)) - (Math.abs(b.x - hub.x) + Math.abs(b.y - hub.y)));
  const start = options[0];
  if (!start) throw new Error("No tile for the player start.");
  return start;
}
