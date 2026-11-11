import { describe, expect, it } from "vitest";
import { DEFAULT_CHARACTER_RECIPE } from "../art";
import { reachableTiles } from "../world/connectivity";
import { entitySolidityIsSafe, selectSolidEntityIds } from "../world/solidity";
import { Tile } from "../world/types";
import type { Biome } from "../world/types";
import type { BriefObject, StoryAreaBrief } from "./briefs";
import { buildStoryArea } from "./briefToMap";

const biomes: readonly Biome[] = ["meadow", "forest", "shore", "cave", "building", "ruins", "village"];
const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

function object(name: string, icon: string): BriefObject {
  return {
    packId: name.toLowerCase().replace(/ /g, "_"),
    kind: "ordinary",
    name,
    description: name,
    icon: { shape: "shelf", primaryColor: "earth", secondaryColor: "cream" },
    visual: { icon, states: [] },
    visualInferred: false,
    contents: [],
    required: true,
    keyItem: false,
  };
}

function placementBrief(biome: Biome): StoryAreaBrief {
  return {
    locationId: `placement_${biome}`,
    name: "The Old Ferry",
    biome,
    mood: "quiet",
    palette: "village",
    description: "A place for testing.",
    characters: [
      {
        castId: "c_mothkeeper",
        name: "Moth keeper",
        species: "human",
        personality: "Patient and fond of moths.",
        goal: "Tend the Mothlight lantern.",
        secret: "Keeps a tiny notebook.",
        recipe: DEFAULT_CHARACTER_RECIPE,
        required: true,
      },
      {
        castId: "c_archivist",
        name: "Archivist",
        species: "human",
        personality: "Thoughtful and reserved.",
        goal: "Keep the local history in order.",
        secret: "Enjoys quiet mornings.",
        recipe: DEFAULT_CHARACTER_RECIPE,
        required: true,
      },
    ],
    objects: [
      object("Window", "generic_prop"),
      object("Ink shelf", "bookshelf"),
      object("Work table", "table"),
      object("Bench", "bench"),
      object("Mothlight lantern", "lantern"),
      object("Trail bell", "generic_prop"),
    ],
    clues: [
      {
        id: "clue_lantern_note",
        truthId: "t_lantern",
        where: "nearby",
        text: "The Mothlight lantern carries a faint salt smell.",
      },
    ],
    doors: [{ to: "other", label: "To the lane", hint: "A familiar path." }],
    source: "fallback",
  };
}

function manhattan(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

describe("story area placement", () => {
  it("places required entities deterministically and accessibly over 200 seeds per biome", () => {
    for (const biome of biomes) {
      const brief = placementBrief(biome);
      for (let seed = 0; seed <= 200; seed += 1) {
        const area = buildStoryArea(brief, `placement-seed-${seed}`);
        expect(buildStoryArea(brief, `placement-seed-${seed}`)).toEqual(area);

        const entities = area.entities ?? [];
        expect(entities).toHaveLength(brief.characters.length + brief.objects.length + brief.clues.length);
        const reachable = reachableTiles(area);
        for (const entity of entities) {
          expect(reachable.has(`${entity.x},${entity.y}`), `${biome} seed ${seed}: ${entity.id}`).toBe(true);
          expect(area.doors.some((door) => door.x === entity.x && door.y === entity.y)).toBe(false);
        }

        const solidIds = selectSolidEntityIds(area);
        expect(entitySolidityIsSafe(area, solidIds), `${biome} seed ${seed}: solidity`).toBe(true);
        expect(area.doors.every((door) => !entities.some((entity) =>
          solidIds.has(entity.id) && entity.x === door.x && entity.y === door.y,
        ))).toBe(true);

        const mothkeeper = entities.find((entity) => entity.id === "char:c_mothkeeper")!;
        const lantern = entities.find((entity) => entity.name === "Mothlight lantern")!;
        const clue = entities.find((entity) => entity.id === "clue:clue_lantern_note")!;
        expect(manhattan(mothkeeper, lantern), `${biome} seed ${seed}: character-object pairing`).toBe(1);
        expect(manhattan(clue, lantern), `${biome} seed ${seed}: clue-object pairing`).toBe(1);

        if (biome === "building" || biome === "ruins") {
          for (const name of ["Window", "Ink shelf"]) {
            const entity = entities.find((candidate) => candidate.name === name)!;
            expect(area.layers.ground[entity.y]?.[entity.x]).toBe(Tile.Floor);
            expect(area.layers.feature[entity.y - 1]?.[entity.x]).toBe(Tile.Wall);
          }
          for (const name of ["Work table", "Bench"]) {
            const entity = entities.find((candidate) => candidate.name === name)!;
            expect(area.layers.ground[entity.y]?.[entity.x]).toBe(Tile.Floor);
            expect(directions.some(([dx, dy]) => area.layers.feature[entity.y + dy]?.[entity.x + dx] === Tile.Wall)).toBe(true);
          }
        }
      }
    }
  }, 60_000);
});
