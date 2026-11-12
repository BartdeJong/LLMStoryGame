import { parseAreaMap } from "./mapLegend";
import type { Area } from "./types";

// A bare Area built from an ASCII map (src/world/mapLegend.ts), for tests.
export function areaFromRows(rows: readonly string[], id = "test"): Area {
  const parsed = parseAreaMap(rows);
  const doors = [...parsed.doorSlots.entries()].map(([n, p]) => ({ id: `door-${n}`, label: `Door ${n}`, kind: "edge" as const, x: p.x, y: p.y }));
  const entry = parsed.start ?? (doors[0] ? { x: doors[0].x, y: doors[0].y } : { x: 1, y: 1 });
  return {
    id, seed: id, name: id, biome: "meadow", mood: "test", palette: "meadow",
    width: parsed.width, height: parsed.height, layers: parsed.layers, entry,
    spawnPoints: [], doors,
  };
}
