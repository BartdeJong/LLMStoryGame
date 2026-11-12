import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createSeededRandom } from "../../../src/art/random";
import type { StoryPack } from "../../../src/story/types";
import { checkArea } from "./checks";
import { collectThings } from "./furnish";
import { classifyLocation, KINDS } from "./kinds";
import { buildLayout, type DoorWish } from "./layout";
import { gridRows } from "./grid";

const dir = resolve("public/stories");
const packs = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "index.json")
  .map((f) => JSON.parse(readFileSync(resolve(dir, f), "utf8")) as StoryPack);

describe("baked areas in the story packs", () => {
  for (const pack of packs) {
    it(`${pack.identity.id}: every location has a complete, valid area`, () => {
      const starts = new Set(Object.values(pack.lengths).map((l) => l!.start_location));
      for (const location of pack.locations) {
        const area = location.area as never;
        expect(area, location.id).toBeTruthy();
        const neighbours = [...new Set([
          ...location.doors.map((d) => d.to),
          ...pack.locations.filter((o) => o.doors.some((d) => d.to === location.id)).map((o) => o.id),
        ])].filter((id) => id !== location.id);
        const errors = checkArea(area, {
          neighbours, thingIds: collectThings(pack, location).map((t) => t.id), isStart: starts.has(location.id),
        });
        expect(errors, location.id).toEqual([]);
      }
    });
  }
});

describe("layouts", () => {
  const wishes: DoorWish[] = [
    { side: "N", rank: 0, count: 1 }, { side: "E", rank: 0, count: 1 }, { side: "S", rank: 0, count: 1 },
  ];
  it.each(Object.keys(KINDS))("%s is deterministic and keeps its doors reachable", (name) => {
    const make = () => buildLayout({ kind: KINDS[name]!, rng: createSeededRandom(`test:${name}`), wishes });
    const a = make();
    expect(gridRows(a.layout.grid)).toEqual(gridRows(make().layout.grid));
    expect(a.doors).toHaveLength(3);
  });

  it("reads room types from names and biomes", () => {
    const where = (name: string, biome: string) => classifyLocation({ name, biome, palette: "village", role: "" });
    expect(where("The Kitchen", "house interior").kind.name).toBe("kitchen");
    expect(where("Mr Gruber's Shop", "antique shop").palette).toBe("shop");
    expect(where("Mr Gruber's Back Room", "workshop").kind.name).toBe("workshop");
    expect(where("Windsor Gardens", "london street").palette).toBe("london");
    expect(where("Drowned Gallery", "underwater hall").palette).toBe("underwater");
    expect(where("Portobello Market", "street market").palette).toBe("market");
  });
});
