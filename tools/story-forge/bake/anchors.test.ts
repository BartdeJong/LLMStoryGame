import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { StoryPack } from "../../../src/story/types";
import { anchorClues } from "./anchors";

const dir = resolve("public/stories");
const packs = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "index.json")
  .map((f) => JSON.parse(readFileSync(resolve(dir, f), "utf8")) as StoryPack);

describe("clue anchors in the story packs", () => {
  for (const pack of packs) {
    it(`${pack.identity.id}: every clue found at a location has an object there, placed in that area`, () => {
      for (const clue of pack.clues) {
        for (const source of [clue.where, ...clue.alternatives]) {
          if (source.type !== "location") continue;
          const location = pack.locations.find((candidate) => candidate.id === source.id)!;
          expect(clue.object_id, `clue ${clue.id}`).toBeDefined();
          expect(location.objects.some((object) => object.id === clue.object_id), `${clue.id} at ${location.id}`).toBe(true);
          expect(location.area?.placements[`obj:${clue.object_id}`], `${clue.id} placed at ${location.id}`).toBeDefined();
        }
      }
    });
  }
});

describe("anchorClues", () => {
  const load = (id: string): StoryPack => structuredClone(packs.find((p) => p.identity.id === id)!);
  const unanchored = (pack: StoryPack): void => pack.clues.forEach((clue) => { delete clue.object_id; });

  it("uses the location object with the clue's own id when there is one", () => {
    const pack = load("holmesashenvelope");
    unanchored(pack);
    const decisions = anchorClues(pack);
    const clueDecisions = decisions.filter((d) => d.type === "clue");
    expect(clueDecisions.length).toBeGreaterThan(0);
    expect(clueDecisions.every((d) => d.type === "clue" && d.reason === "same id")).toBe(true);
    expect(pack.clues.find((clue) => clue.id === "cl_wren_docket")?.object_id).toBe("cl_wren_docket");
  });

  it("otherwise uses the location object that shares the most words with the clue", () => {
    const pack = load("example");
    unanchored(pack);
    anchorClues(pack);
    expect(pack.clues.find((clue) => clue.id === "cl_notice_board")?.object_id).toBe("o_notice_board");
    expect(pack.clues.find((clue) => clue.id === "cl_workbench")?.object_id).toBe("o_workbench");
  });

  it("adds an object named after the clue when nothing at the location matches", () => {
    const pack = load("example");
    unanchored(pack);
    pack.clues.push({
      id: "cl_gate_hinge", kind: "place", where: { type: "location", id: "l_square" }, alternatives: [],
      requirements: {}, text: "The gate hinge is rusted through.",
    });
    const decisions = anchorClues(pack);
    const square = pack.locations.find((l) => l.id === "l_square")!;
    const added = square.objects.find((object) => object.id === "cl_gate_hinge");
    expect(added).toMatchObject({ name: "Gate hinge", description: "The gate hinge is rusted through." });
    expect(added?.visual?.icon).toBeTruthy();
    expect(pack.clues.find((clue) => clue.id === "cl_gate_hinge")?.object_id).toBe("cl_gate_hinge");
    expect(decisions.filter((d) => d.type === "clue" && d.reason === "new object")).toHaveLength(1);
  });

  it("does nothing to a clue that is already anchored, and is deterministic", () => {
    const pack = load("holmesashenvelope");
    expect(anchorClues(pack)).toEqual([]);
    const first = load("holmesashenvelope");
    unanchored(first);
    const second = load("holmesashenvelope");
    unanchored(second);
    expect(anchorClues(first)).toEqual(anchorClues(second));
  });
});
