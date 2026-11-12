// Checks for a baked area. The bake tool runs them before writing; `bake-areas --check` runs them on a whole pack.
import { getGlyph } from "../../../src/art/glyphs";
import {
  MAP_MAX_HEIGHT, MAP_MAX_WIDTH, MAP_MIN_HEIGHT, MAP_MIN_WIDTH, parseAreaMap,
} from "../../../src/world/mapLegend";
import { isWalkable } from "../../../src/world/connectivity";
import type { Area, Biome } from "../../../src/world/types";
import { FLOOR_STYLES, WALL_STYLES } from "../../../src/world/types";
import { PALETTE_NAMES } from "../../../src/art/palettes";
import type { AuthoredArea } from "../../../src/story/types";
import { DIRS4, key } from "./grid";

const BIOMES: readonly Biome[] = ["meadow", "forest", "shore", "cave", "building", "ruins", "village"];

export interface AreaExpectation {
  neighbours: readonly string[]; // every id that needs a door
  thingIds: readonly string[]; // every id that needs a placement
  isStart: boolean;
}

export function checkArea(area: AuthoredArea, expect: AreaExpectation): string[] {
  const errors: string[] = [];
  const fail = (text: string): void => { errors.push(text); };
  if (!area.description) fail("description is empty");
  if (!BIOMES.includes(area.biome)) fail(`unknown biome "${area.biome}"`);
  if (!(PALETTE_NAMES as readonly string[]).includes(area.palette)) fail(`unknown palette "${area.palette}"`);
  if (!(FLOOR_STYLES as readonly string[]).includes(area.floor)) fail(`unknown floor "${area.floor}"`);
  if (!(WALL_STYLES as readonly string[]).includes(area.wall)) fail(`unknown wall "${area.wall}"`);

  const rows = area.map;
  const width = rows[0]?.length ?? 0;
  if (rows.length < MAP_MIN_HEIGHT || rows.length > MAP_MAX_HEIGHT) fail(`map has ${rows.length} rows (${MAP_MIN_HEIGHT}-${MAP_MAX_HEIGHT})`);
  if (width < MAP_MIN_WIDTH || width > MAP_MAX_WIDTH) fail(`map is ${width} wide (${MAP_MIN_WIDTH}-${MAP_MAX_WIDTH})`);
  let parsed;
  try {
    parsed = parseAreaMap(rows);
  } catch (error) {
    fail((error as Error).message);
    return errors;
  }

  // doors
  const doorCount = area.doors.length;
  for (let n = 1; n <= doorCount; n += 1) if (!parsed.doorSlots.has(n)) fail(`door ${n} (${area.doors[n - 1]?.to}) is missing from the map`);
  for (const n of parsed.doorSlots.keys()) if (n > doorCount) fail(`map has door ${n} but only ${doorCount} door texts`);
  const targets = area.doors.map((d) => d.to);
  if (new Set(targets).size !== targets.length) fail("two doors lead to the same place");
  for (const id of expect.neighbours) if (!targets.includes(id)) fail(`no door text for neighbour "${id}"`);
  for (const id of targets) if (!expect.neighbours.includes(id)) fail(`door text for "${id}", which is not a neighbour`);
  for (const d of area.doors) {
    if (!d.label || d.label.split(/\s+/).length > 4) fail(`door label "${d.label}" must be 1-4 words`);
  }

  // decor
  const decor = new Set<string>();
  for (const item of area.decor) {
    const k = key(item.x, item.y);
    if (!getGlyph(item.icon)) fail(`decor icon "${item.icon}" is not in the glyph catalog`);
    if (decor.has(k)) fail(`two decor items at ${item.x},${item.y}`);
    decor.add(k);
    const g = parsed.layers.ground[item.y]?.[item.x];
    const f = parsed.layers.feature[item.y]?.[item.x];
    if (g === undefined) fail(`decor ${item.icon} at ${item.x},${item.y} is outside the map`);
    else if (!areaLike(parsed, new Set()).walkable(item.x, item.y)) fail(`decor ${item.icon} at ${item.x},${item.y} is not on walkable floor (${f})`);
  }

  const view = areaLike(parsed, decor);
  // placements
  const wanted = new Set(expect.thingIds);
  for (const id of wanted) if (!area.placements[id]) fail(`no placement for "${id}"`);
  const used = new Map<string, string>();
  const doorKeys = new Set([...parsed.doorSlots.values()].map((p) => key(p.x, p.y)));
  for (const [id, [x, y]] of Object.entries(area.placements)) {
    if (!wanted.has(id)) fail(`placement for "${id}", which does not belong here`);
    const k = key(x, y);
    if (!view.walkable(x, y)) fail(`"${id}" at ${x},${y} is not on walkable floor`);
    if (decor.has(k)) fail(`"${id}" at ${x},${y} is on decor`);
    if (doorKeys.has(k)) fail(`"${id}" at ${x},${y} is on a door`);
    if (used.has(k)) fail(`"${id}" and "${used.get(k)}" share ${x},${y}`);
    used.set(k, id);
  }

  // reachability: floor only, door tiles count as walls (doors outside a length are walls at runtime)
  const slots = [...parsed.doorSlots.entries()];
  const anchors = slots.map(([n, p]) => {
    const inner = DIRS4.map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy })).find((q) => view.walkable(q.x, q.y) && !doorKeys.has(key(q.x, q.y)));
    if (!inner) fail(`door ${n} has no walkable tile in front of it`);
    return inner;
  });
  const first = anchors.find((a) => a !== undefined);
  if (first) {
    const reach = view.flood(first, doorKeys, new Set());
    anchors.forEach((a, i) => { if (a && !reach.has(key(a.x, a.y))) fail(`door ${slots[i]![0]} cannot be reached from the other doors`); });
    for (const [id, [x, y]] of Object.entries(area.placements)) if (!reach.has(key(x, y))) fail(`"${id}" at ${x},${y} cannot be reached from the doors`);
    if (expect.isStart && !parsed.start) fail("start location has no '@'");
    if (parsed.start && !reach.has(key(parsed.start.x, parsed.start.y))) fail("the '@' start cannot be reached from the doors");
    // things are solid in the worst case: everything must still be reachable, and each thing needs an open neighbour
    const things = new Set(Object.values(area.placements).map(([x, y]) => key(x, y)));
    const reach2 = view.flood(first, doorKeys, things);
    anchors.forEach((a, i) => { if (a && !reach2.has(key(a.x, a.y))) fail(`door ${slots[i]![0]} is cut off when story things are solid`); });
    for (const [id, [x, y]] of Object.entries(area.placements)) {
      if (!DIRS4.some(([dx, dy]) => reach2.has(key(x + dx, y + dy)))) fail(`"${id}" at ${x},${y} is boxed in`);
    }
  }
  return errors;
}

function areaLike(parsed: ReturnType<typeof parseAreaMap>, decor: ReadonlySet<string>) {
  const area = {
    width: parsed.width,
    height: parsed.height,
    layers: parsed.layers,
    decor: [...decor].map((k) => {
      const [x, y] = k.split(",").map(Number);
      return { icon: "x", x: x!, y: y! };
    }),
  } as unknown as Area;
  const walkable = (x: number, y: number): boolean => isWalkable(area, x, y);
  return {
    walkable,
    flood(start: { x: number; y: number }, doorKeys: ReadonlySet<string>, blocked: ReadonlySet<string>): Set<string> {
      const seen = new Set<string>();
      if (!walkable(start.x, start.y) || doorKeys.has(key(start.x, start.y))) return seen;
      seen.add(key(start.x, start.y));
      const queue = [start];
      for (let i = 0; i < queue.length; i += 1) {
        const p = queue[i]!;
        for (const [dx, dy] of DIRS4) {
          const x = p.x + dx;
          const y = p.y + dy;
          const k = key(x, y);
          if (seen.has(k) || doorKeys.has(k) || blocked.has(k) || !walkable(x, y)) continue;
          seen.add(k);
          queue.push({ x, y });
        }
      }
      return seen;
    },
  };
}
