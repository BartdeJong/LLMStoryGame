// Story Forge bake step: gives every location of a story pack its layout (map, doors, decor, placements).
// Run through run-visual-tool.mjs:  npm run bake-areas -- [story-id] [--only <location-id>] [--force]
//   --force            regenerate locations that already have a complete area (the area text is kept)
//   --only <id>        only this location
//   --placements       keep map and decor, recompute where story things stand (after hand-editing a map)
//   --adopt <file>     apply hand-drawn layouts: { "<location id>": { "map": [...], "decor": [...], ... } }
//   --check            check every baked area and write nothing
//   --show             print the maps (with story things and doors) of the selected locations
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSeededRandom } from "../../src/art/random";
import { getLengthView } from "../../src/story/loader";
import type { AuthoredArea, Location, StoryPack } from "../../src/story/types";
import { bearingBetween, layoutStoryWorld } from "../../src/story/worldLayout";
import { parseAreaMap } from "../../src/world/mapLegend";
import { checkArea } from "./bake/checks";
import { chooseStart, collectThings, placeDecor, placeThings, type DecorItem, type Thing } from "./bake/furnish";
import type { Grid, Pt } from "./bake/grid";
import { DIRS4, gridRows, isDoorChar, key, walkableAt } from "./bake/grid";
import { classifyLocation } from "./bake/kinds";
import { buildLayout, sideForBearing, type DoorWish, type Side } from "./bake/layout";

const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(name);
const option = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const valueFlags = new Set(["--only", "--adopt"]);
const positional = args.filter((arg, i) => !arg.startsWith("--") && !valueFlags.has(args[i - 1] ?? ""));
const storyFilter = positional[0];
const only = option("--only");
const force = flag("--force");
const checkOnly = flag("--check");
const show = flag("--show");
const placementsOnly = flag("--placements");
const adoptFile = option("--adopt");
const adopt = adoptFile ? JSON.parse(readFileSync(resolve(adoptFile), "utf8")) as Record<string, Partial<AuthoredArea> & { doors?: string[] }> : {};

const storiesDir = resolve("public/stories");
let problems = 0;
const say = (text: string): void => console.log(text);
const complain = (text: string): void => { problems += 1; console.error(text); };

// ---- neighbours and door sides -------------------------------------------------------------------------------------

function neighboursOf(pack: StoryPack, location: Location): string[] {
  const known = new Set(pack.locations.map((l) => l.id));
  const outgoing = location.doors.map((d) => d.to);
  const incoming = pack.locations.filter((other) => other.doors.some((d) => d.to === location.id)).map((o) => o.id);
  return [...new Set([...outgoing, ...incoming])].filter((id) => id !== location.id && known.has(id));
}

function doorWishes(
  neighbours: readonly string[], here: { column: number; row: number } | undefined,
  cells: ReadonlyMap<string, { column: number; row: number }>,
): DoorWish[] {
  const items = neighbours.map((id, index) => {
    const there = cells.get(id);
    const bearing = here && there ? bearingBetween(here, there) : (180 + index * 90) % 360;
    return { index, bearing, side: sideForBearing(bearing) };
  });
  const wishes: DoorWish[] = new Array(items.length);
  for (const side of ["N", "E", "S", "W"] as Side[]) {
    const group = items.filter((item) => item.side === side);
    // along each side, doors run west to east (north and south) or north to south (east and west)
    const ascending = side === "N" || side === "E";
    const norm = (b: number): number => (side === "N" && b >= 315 ? b - 360 : b);
    group.sort((a, b) => (norm(a.bearing) - norm(b.bearing)) * (ascending ? 1 : -1));
    group.forEach((item, rank) => { wishes[item.index] = { side, rank, count: group.length }; });
  }
  return wishes;
}

// ---- baking --------------------------------------------------------------------------------------------------------

function isComplete(area: AuthoredArea | undefined): area is AuthoredArea {
  return !!area && typeof area.description === "string" && Array.isArray(area.doors) && !!area.biome && !!area.palette
    && !!area.floor && !!area.wall && Array.isArray(area.map) && area.map.length > 0
    && typeof area.placements === "object" && Array.isArray(area.decor);
}

interface Context {
  pack: StoryPack;
  cells: ReadonlyMap<string, { column: number; row: number }>;
  starts: ReadonlySet<string>;
}

function gridFromMap(map: readonly string[]): Grid {
  return map.map((row) => [...row]);
}

function decorAvoidText(things: readonly Thing[]): string {
  return things.map((t) => `${t.name} ${t.text} ${t.icon ?? ""}`).join(" ").toLowerCase().replace(/_/g, " ");
}

function assemble(
  location: Location, base: Partial<AuthoredArea>, doorTexts: AuthoredArea["doors"], grid: Grid,
  decor: DecorItem[], placements: Record<string, [number, number]>,
): AuthoredArea {
  return {
    description: base.description!,
    doors: doorTexts,
    biome: base.biome!,
    palette: base.palette!,
    floor: base.floor!,
    wall: base.wall!,
    map: gridRows(grid),
    placements,
    decor: decor.map(({ icon, x, y }) => ({ icon, x, y })),
  };
}

function innerOf(grid: Grid, door: Pt): Pt {
  const found = DIRS4.map(([dx, dy]) => ({ x: door.x + dx, y: door.y + dy }))
    .find((q) => walkableAt(grid, q.x, q.y) && !isDoorChar(grid[q.y]![q.x]!));
  if (!found) throw new Error(`Door at ${door.x},${door.y} leads nowhere.`);
  return found;
}

function doorTilesOf(grid: Grid, count: number): Pt[] {
  const doors: Pt[] = [];
  grid.forEach((row, y) => row.forEach((ch, x) => {
    if (isDoorChar(ch)) doors[Number(ch) - 1] = { x, y };
  }));
  for (let n = 0; n < count; n += 1) if (!doors[n]) throw new Error(`Door ${n + 1} is not on the map.`);
  return doors;
}

function chooseHub(grid: Grid, doors: readonly Pt[]): Pt {
  const anchor = innerOf(grid, doors[0]!);
  return anchor;
}

function mapStart(grid: Grid): Pt | undefined {
  for (let y = 0; y < grid.length; y += 1) for (let x = 0; x < grid[0]!.length; x += 1) if (grid[y]![x] === "@") return { x, y };
  return undefined;
}

// New layout for one location.
function bakeLocation(ctx: Context, location: Location, doorTexts: AuthoredArea["doors"], neighbours: string[]): AuthoredArea {
  const { pack } = ctx;
  const classified = classifyLocation(location);
  const things = collectThings(pack, location);
  const wishes = doorWishes(neighbours, ctx.cells.get(location.id), ctx.cells);
  const isStart = ctx.starts.has(location.id);
  const description = location.area?.description ?? "";
  let lastError = "";
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const rng = createSeededRandom(`${pack.identity.id}:${location.id}:bake:${attempt}`);
    try {
      const { layout, doors } = buildLayout({ kind: classified.kind, rng, wishes });
      const anchor = chooseHub(layout.grid, doors);
      const special = classified.kind.name === "square" ? { icon: "fountain", at: layout.hub } : undefined;
      const decor = placeDecor(layout.grid, classified.kind.decor, rng, doors, anchor, decorAvoidText(things), special);
      const placements = placeThings({ grid: layout.grid, decor, doors, hub: anchor, rng, indoor: classified.kind.group === "room", things });
      if (isStart) {
        const start = chooseStart(layout.grid, decor, doors, anchor, Object.values(placements).map(([x, y]) => ({ x, y })));
        layout.grid[start.y]![start.x] = "@";
      }
      const area = assemble(location, { description, ...classified }, doorTexts, layout.grid, decor, placements);
      const errors = checkArea(area, { neighbours, thingIds: things.map((t) => t.id), isStart });
      if (errors.length === 0) return area;
      lastError = errors.join("; ");
    } catch (error) {
      lastError = (error as Error).message;
    }
  }
  throw new Error(`Could not bake "${location.id}" (${classified.kind.name}): ${lastError}`);
}

// Keeps a hand-edited map and decor, only recomputes where things stand.
function replace(ctx: Context, location: Location, area: AuthoredArea, neighbours: string[], keepPlacements: boolean, fixed?: AuthoredArea["placements"]): AuthoredArea {
  const grid = gridFromMap(area.map);
  const doors = doorTilesOf(grid, area.doors.length);
  const things = collectThings(ctx.pack, location);
  const isStart = ctx.starts.has(location.id);
  const anchor = chooseHub(grid, doors);
  let placements = area.placements;
  if (!keepPlacements) {
    const start = mapStart(grid);
    if (start) grid[start.y]![start.x] = ".";
    const rng = createSeededRandom(`${ctx.pack.identity.id}:${location.id}:place`);
    placements = placeThings({ grid, decor: area.decor, doors, hub: anchor, rng, indoor: area.biome === "building" || area.biome === "ruins", things, fixed });
    if (isStart) {
      const spot = start && !Object.values(placements).some(([x, y]) => x === start.x && y === start.y) ? start
        : chooseStart(grid, area.decor, doors, anchor, Object.values(placements).map(([x, y]) => ({ x, y })));
      grid[spot.y]![spot.x] = "@";
    }
  }
  const next: AuthoredArea = { ...area, map: gridRows(grid), placements };
  const errors = checkArea(next, { neighbours, thingIds: things.map((t) => t.id), isStart });
  if (errors.length > 0) throw new Error(`"${location.id}": ${errors.join("; ")}`);
  return next;
}

// ---- writing -------------------------------------------------------------------------------------------------------

function formatArea(area: AuthoredArea, indent: string): string {
  const inner = `${indent}  `;
  const lines: string[] = ["{"];
  const compact = (value: unknown): string => JSON.stringify(value).replace(/,"/g, ', "').replace(/":/g, '": ').replace(/\{"/g, '{ "').replace(/"\}/g, '" }').replace(/(\d)\}/g, "$1 }");
  const doors = area.doors.map((d) => `{ "to": ${JSON.stringify(d.to)}, "label": ${JSON.stringify(d.label)}, "hint": ${JSON.stringify(d.hint)} }`);
  lines.push(`${inner}"description": ${JSON.stringify(area.description)},`);
  lines.push(`${inner}"doors": [${doors.join(", ")}],`);
  lines.push(`${inner}"biome": ${JSON.stringify(area.biome)}, "palette": ${JSON.stringify(area.palette)}, "floor": ${JSON.stringify(area.floor)}, "wall": ${JSON.stringify(area.wall)},`);
  lines.push(`${inner}"map": [`);
  area.map.forEach((row, i) => lines.push(`${inner}  ${JSON.stringify(row)}${i < area.map.length - 1 ? "," : ""}`));
  lines.push(`${inner}],`);
  const placements = Object.entries(area.placements).map(([id, [x, y]]) => `${JSON.stringify(id)}: [${x}, ${y}]`);
  lines.push(`${inner}"placements": { ${placements.join(", ")} },`);
  lines.push(`${inner}"decor": [${area.decor.map((d) => `{ "icon": ${JSON.stringify(d.icon)}, "x": ${d.x}, "y": ${d.y} }`).join(", ")}]`);
  lines.push(`${indent}}`);
  void compact;
  return lines.join("\n");
}

// Finds the `{ ... }` value of every "area" key in the pack text, in order.
function areaSpans(text: string): { start: number; end: number; indent: string }[] {
  const spans: { start: number; end: number; indent: string }[] = [];
  let i = 0;
  const skipString = (from: number): number => {
    let j = from + 1;
    while (text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
    return j;
  };
  while (i < text.length) {
    if (text[i] === '"') {
      const end = skipString(i);
      if (text.slice(i + 1, end) === "area") {
        let j = end + 1;
        while (/\s/.test(text[j]!)) j += 1;
        if (text[j] === ":") {
          j += 1;
          while (/\s/.test(text[j]!)) j += 1;
          if (text[j] === "{") {
            let depth = 0;
            let k = j;
            for (; k < text.length; k += 1) {
              if (text[k] === '"') { k = skipString(k); continue; }
              if (text[k] === "{") depth += 1;
              if (text[k] === "}") { depth -= 1; if (depth === 0) break; }
            }
            const lineStart = text.lastIndexOf("\n", i) + 1;
            spans.push({ start: j, end: k + 1, indent: /^\s*/.exec(text.slice(lineStart, i))![0] });
            i = k + 1;
            continue;
          }
        }
      }
      i = end + 1;
      continue;
    }
    i += 1;
  }
  return spans;
}

// ---- display -------------------------------------------------------------------------------------------------------

function showArea(location: Location, area: AuthoredArea, thingNames: ReadonlyMap<string, string>): void {
  const grid = gridFromMap(area.map);
  for (const d of area.decor) grid[d.y]![d.x] = "&";
  const legend: string[] = [];
  let letter = 0;
  for (const [id, [x, y]] of Object.entries(area.placements)) {
    const ch = String.fromCharCode(97 + (letter % 26));
    letter += 1;
    grid[y]![x] = ch;
    legend.push(`${ch}=${id}(${thingNames.get(id) ?? "?"})`);
  }
  say(`\n== ${location.id}  ${location.name}   ${area.biome}/${area.palette}/${area.floor}/${area.wall}  ${area.map[0]!.length}x${area.map.length}`);
  say(gridRows(grid).join("\n"));
  say(`doors: ${area.doors.map((d, i) => `${i + 1}=${d.to}`).join("  ")}`);
  say(`things: ${legend.join("  ")}`);
  say(`decor: ${area.decor.map((d) => `${d.icon}@${d.x},${d.y}`).join(" ")}`);
}

// ---- main ----------------------------------------------------------------------------------------------------------

function processPack(file: string): void {
  const path = resolve(storiesDir, file);
  const original = readFileSync(path, "utf8");
  const pack = JSON.parse(original) as StoryPack;
  const lengthIds = Object.keys(pack.lengths) as (keyof StoryPack["lengths"])[];
  const views = lengthIds.map((id) => getLengthView(pack, id));
  const longest = views.reduce((best, view) => (view.locations.length > best.locations.length ? view : best), views[0]!);
  if (longest.locations.length < pack.locations.length) {
    say(`note: ${pack.identity.id}: the longest length uses ${longest.locations.length} of ${pack.locations.length} locations; the layout uses all of them.`);
  }
  const cells = layoutStoryWorld(pack, { ...longest, locations: pack.locations });
  const ctx: Context = { pack, cells, starts: new Set(views.map((v) => v.startLocation)) };
  const spans = areaSpans(original);
  if (spans.length !== pack.locations.length) {
    throw new Error(`${file}: expected one "area" block per location (${pack.locations.length}) but found ${spans.length}.`);
  }
  const names = new Map<string, string>();
  for (const l of pack.locations) {
    l.objects.forEach((o) => names.set(o.id, o.name));
  }
  pack.cast.forEach((c) => names.set(c.id, c.name));
  pack.items.forEach((i) => names.set(i.id, i.name));

  const results: (AuthoredArea | null)[] = [];
  let changed = 0;
  pack.locations.forEach((location) => {
    const selected = !only || only === location.id;
    const existing = location.area as (Partial<AuthoredArea> & { clue_spot?: string }) | undefined;
    const neighbours = neighboursOf(pack, location);
    const keep = (): AuthoredArea => existing as AuthoredArea;
    try {
      const texts = (existing?.doors ?? []) as AuthoredArea["doors"];
      const byTarget = new Map(texts.map((d) => [d.to, d]));
      const adopted = adopt[`${pack.identity.id}/${location.id}`] ?? adopt[location.id];
      let order = neighbours;
      if (adopted?.doors) order = adopted.doors;
      else if (isComplete(existing as AuthoredArea)) order = existing!.doors!.map((d) => d.to);
      for (const id of neighbours) if (!byTarget.has(id)) throw new Error(`no door text for neighbour "${id}" (write it in area.doors first)`);
      const doorTexts = order.map((id) => byTarget.get(id)!).filter(Boolean);
      if (!existing?.description) throw new Error("no area.description (write the area text first)");

      let area: AuthoredArea;
      const complete = isComplete(existing as AuthoredArea);
      if (checkOnly) {
        if (!complete) throw new Error("area is not baked yet");
        const things = collectThings(pack, location);
        const errors = checkArea(existing as AuthoredArea, { neighbours, thingIds: things.map((t) => t.id), isStart: ctx.starts.has(location.id) });
        if (errors.length > 0) throw new Error(errors.join("; "));
        area = keep();
      } else if (selected && adopted) {
        const merged = { ...(existing as AuthoredArea), ...adopted, doors: doorTexts } as AuthoredArea;
        merged.decor = adopted.decor ?? merged.decor ?? [];
        merged.placements = {};
        area = replace(ctx, location, merged, neighbours, false, adopted.placements);
      } else if (selected && complete && placementsOnly) {
        area = replace(ctx, location, existing as AuthoredArea, neighbours, false);
      } else if (selected && (!complete || force)) {
        area = bakeLocation(ctx, location, doorTexts, neighbours);
      } else if (complete) {
        area = keep();
      } else {
        results.push(null);
        return;
      }
      if (JSON.stringify(area) !== JSON.stringify(existing)) changed += 1;
      results.push(area);
      if (show && selected) showArea(location, area, names);
    } catch (error) {
      complain(`ERROR ${pack.identity.id}/${location.id}: ${(error as Error).message}`);
      results.push(null);
    }
  });

  if (checkOnly || problems > 0) {
    if (!checkOnly) say(`${pack.identity.id}: not written because of errors.`);
    return;
  }
  // replace the area blocks back to front so earlier offsets stay valid
  let updated = original;
  for (let i = spans.length - 1; i >= 0; i -= 1) {
    const span = spans[i]!;
    if (!results[i]) continue;
    updated = updated.slice(0, span.start) + formatArea(results[i]!, span.indent) + updated.slice(span.end);
  }
  // safety net: nothing but the area blocks may change
  const before = JSON.parse(original) as StoryPack;
  const after = JSON.parse(updated) as StoryPack;
  before.locations.forEach((l, i) => { l.area = after.locations[i]!.area; });
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`${file}: rewriting changed more than the area blocks.`);
  // every written map must parse
  for (const l of after.locations) parseAreaMap(l.area!.map);
  // the area blocks are written with LF; give the whole file the line ends it already has
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  if (updated !== original) writeFileSync(path, updated.replace(/\r?\n/g, eol));
  say(`${pack.identity.id}: ${changed} area(s) ${changed ? "written" : "unchanged"} (${pack.locations.length} locations).`);
}

const files = readdirSync(storiesDir)
  .filter((f) => f.endsWith(".json") && f !== "index.json")
  .filter((f) => !storyFilter || f === `${storyFilter}.json`);
if (files.length === 0) throw new Error(`No story pack matches "${storyFilter ?? ""}".`);
for (const file of files) {
  try {
    processPack(file);
  } catch (error) {
    complain(`ERROR ${file}: ${(error as Error).message}`);
  }
}
void key;
if (problems > 0) {
  console.error(`${problems} problem(s).`);
  process.exit(1);
}
