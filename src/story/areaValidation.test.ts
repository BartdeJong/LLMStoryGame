import { describe, expect, it } from "vitest";
import example from "../../public/stories/example.json";
import { bakeSimple } from "./fixtures/bakeSimple";
import type { Location, StoryPack } from "./types";
import { validateStoryPack } from "./validate";

// Every location gets a plain room (see bakeSimple); each test then breaks one thing.
const fresh = (): StoryPack => bakeSimple(example) as StoryPack;
const square = (pack: StoryPack): Location => pack.locations.find((l) => l.id === "l_square")!;
const library = (pack: StoryPack): Location => pack.locations.find((l) => l.id === "l_library")!;
const codes = (pack: StoryPack): string[] => validateStoryPack(pack).errors.map((e) => e.code);

function setTile(location: Location, x: number, y: number, char: string): void {
  const map = location.area!.map;
  map[y] = map[y]!.slice(0, x) + char + map[y]!.slice(x + 1);
}

describe("baked area validation", () => {
  it("accepts plain hand-made areas", () => {
    const report = validateStoryPack(fresh());
    expect(report.errors.map((e) => e.message)).toEqual([]);
  });

  it("requires an area block on every location", () => {
    const pack = fresh();
    delete square(pack).area;
    expect(codes(pack)).toContain("AREA_MISSING");
  });

  it("rejects maps that are too small, ragged or use unknown characters", () => {
    let pack = fresh();
    square(pack).area!.map = square(pack).area!.map.slice(0, 5);
    expect(codes(pack)).toContain("AREA_MAP_SIZE");

    pack = fresh();
    square(pack).area!.map[2] += "..";
    expect(codes(pack)).toContain("AREA_MAP_INVALID");

    pack = fresh();
    setTile(square(pack), 5, 3, "?");
    expect(codes(pack)).toContain("AREA_MAP_INVALID");

    pack = fresh();
    square(pack).area!.map = square(pack).area!.map.map((row) => row + ".".repeat(30));
    expect(codes(pack)).toContain("AREA_MAP_SIZE");
  });

  it("needs each door digit exactly once and no extra digits", () => {
    let pack = fresh();
    setTile(square(pack), 2, 0, "#");
    expect(codes(pack)).toContain("AREA_DOOR_DIGIT_MISSING");

    pack = fresh();
    setTile(square(pack), 9, 0, "7");
    expect(codes(pack)).toContain("AREA_DOOR_DIGIT_EXTRA");

    pack = fresh();
    setTile(square(pack), 9, 0, "1");
    expect(codes(pack)).toContain("AREA_MAP_INVALID");
  });

  it("checks door signs: neighbours only, no duplicates, no other place's name, every neighbour present", () => {
    let pack = fresh();
    library(pack).area!.doors.push({ to: "l_garden", label: "Garden", hint: "A gate." });
    expect(codes(pack)).toContain("AREA_DOOR_NOT_NEIGHBOUR");

    pack = fresh();
    square(pack).area!.doors[1]!.to = "l_bakery";
    expect(codes(pack)).toContain("AREA_DOOR_DUPLICATE");

    pack = fresh();
    square(pack).area!.doors[0]!.label = "Past Owl Library";
    expect(codes(pack)).toContain("AREA_DOOR_MISLEADING");

    pack = fresh();
    square(pack).area!.doors.pop();
    setTile(square(pack), 6, 0, "#");
    expect(codes(pack)).toContain("AREA_DOOR_MISSING");

    pack = fresh();
    square(pack).area!.doors[0]!.label = "The very long way round";
    const report = validateStoryPack(pack);
    expect(report.ok).toBe(true);
    expect(report.warnings.map((w) => w.code)).toContain("AREA_DOOR_LABEL_LONG");
  });

  it("checks that placements match the things that can appear at the location", () => {
    let pack = fresh();
    square(pack).area!.placements["obj:o_nowhere"] = [5, 3];
    expect(codes(pack)).toContain("AREA_PLACEMENT_UNKNOWN");

    pack = fresh();
    square(pack).area!.placements["char:c_mira"] = [5, 3];
    expect(codes(pack)).toContain("AREA_PLACEMENT_UNKNOWN");

    pack = fresh();
    delete square(pack).area!.placements["obj:o_notice_board"];
    expect(codes(pack)).toContain("AREA_PLACEMENT_MISSING");

    pack = fresh();
    delete library(pack).area!.placements["char:c_oswin"];
    expect(codes(pack)).toContain("AREA_PLACEMENT_MISSING");
  });

  it("accepts plain pack ids when they are unambiguous, and asks for entity ids when they are not", () => {
    let pack = fresh();
    const placements = square(pack).area!.placements;
    placements.o_notice_board = placements["obj:o_notice_board"]!;
    delete placements["obj:o_notice_board"];
    expect(validateStoryPack(pack).errors).toEqual([]);

    pack = fresh();
    library(pack).objects.push({ id: "c_oswin", name: "Oswin's cup", description: "A cup." });
    library(pack).area!.placements.c_oswin = [6, 1];
    expect(codes(pack)).toContain("AREA_PLACEMENT_AMBIGUOUS");
  });

  it("checks placement tiles: in bounds, walkable floor, one thing per tile", () => {
    let pack = fresh();
    square(pack).area!.placements["obj:o_notice_board"] = [40, 3];
    expect(codes(pack)).toContain("AREA_PLACEMENT_OUT_OF_BOUNDS");

    pack = fresh();
    square(pack).area!.placements["obj:o_notice_board"] = [0, 3]; // wall
    expect(codes(pack)).toContain("AREA_PLACEMENT_BLOCKED");

    pack = fresh();
    square(pack).area!.placements["obj:o_notice_board"] = [2, 0]; // door
    expect(codes(pack)).toContain("AREA_PLACEMENT_BLOCKED");

    for (const solid of [" ", "C", "~", "T"]) {
      pack = fresh();
      setTile(square(pack), 5, 3, solid);
      square(pack).area!.placements["obj:o_notice_board"] = [5, 3];
      expect(codes(pack), `tile "${solid}"`).toContain("AREA_PLACEMENT_BLOCKED");
    }

    pack = fresh();
    square(pack).objects.push({ id: "o_bench", name: "Bench", description: "A bench." });
    const placements = square(pack).area!.placements;
    placements["obj:o_bench"] = [...placements["obj:o_notice_board"]!] as [number, number];
    expect(codes(pack)).toContain("AREA_PLACEMENT_OVERLAP");
  });

  it("checks decor: known icon, walkable tile, not on a placement", () => {
    let pack = fresh();
    square(pack).area!.decor = [{ icon: "no_such_glyph", x: 5, y: 3 }];
    expect(codes(pack)).toContain("AREA_DECOR_ICON_UNKNOWN");

    pack = fresh();
    square(pack).area!.decor = [{ icon: "leaf", x: 0, y: 3 }];
    expect(codes(pack)).toContain("AREA_DECOR_BLOCKED");

    pack = fresh();
    const [x, y] = square(pack).area!.placements["obj:o_notice_board"]!;
    square(pack).area!.decor = [{ icon: "leaf", x: x!, y: y! }];
    expect(codes(pack)).toContain("AREA_DECOR_ON_PLACEMENT");

    pack = fresh();
    square(pack).area!.decor = [{ icon: "leaf", x: 5, y: 3 }];
    expect(validateStoryPack(pack).errors).toEqual([]);
  });

  it("reports things and doors that cannot be reached from the start", () => {
    let pack = fresh();
    for (let y = 1; y <= 6; y += 1) setTile(square(pack), 11, y, "#");
    square(pack).objects.push({ id: "o_bench", name: "Bench", description: "A bench." });
    square(pack).area!.placements["obj:o_bench"] = [12, 5];
    expect(codes(pack)).toContain("AREA_UNREACHABLE");

    // A decor item that closes a one-tile corridor cuts the rest off as well.
    pack = fresh();
    for (let y = 1; y <= 6; y += 1) if (y !== 3) setTile(square(pack), 11, y, "#");
    square(pack).objects.push({ id: "o_bench", name: "Bench", description: "A bench." });
    square(pack).area!.placements["obj:o_bench"] = [12, 5];
    expect(codes(pack)).not.toContain("AREA_UNREACHABLE");
    square(pack).area!.decor = [{ icon: "leaf", x: 11, y: 3 }];
    expect(codes(pack)).toContain("AREA_UNREACHABLE");
  });

  it("needs a start tile or an active door at the start location", () => {
    const pack = fresh();
    const area = square(pack).area!;
    area.map = area.map.map((row) => row.replace(/[1-9@]/g, (char) => (char === "@" ? "." : "#")));
    area.doors = [];
    expect(codes(pack)).toContain("AREA_START_NO_ENTRY");
  });
});

describe("clue anchors and items", () => {
  const clue = (pack: StoryPack, id: string) => pack.clues.find((candidate) => candidate.id === id)!;

  it("needs an object at each location where a clue can be found, and accepts the anchored example", () => {
    expect(validateStoryPack(fresh()).errors).toEqual([]);

    let pack = fresh();
    delete clue(pack, "cl_notice_board").object_id;
    expect(codes(pack)).toContain("CLUE_ANCHOR_MISSING");

    pack = fresh();
    clue(pack, "cl_library_log").object_id = "o_notice_board";
    expect(codes(pack)).toContain("CLUE_ANCHOR_ELSEWHERE");

    pack = fresh();
    clue(pack, "cl_library_log").object_id = "o_nowhere";
    expect(codes(pack)).toContain("REF_UNKNOWN");

    // a clue that only a character tells is not found at a place, so it needs no object
    pack = fresh();
    clue(pack, "cl_pip_saw").object_id = "o_notice_board";
    expect(codes(pack)).toContain("CLUE_ANCHOR_ELSEWHERE");
  });

  it("does not let a location object duplicate an item found there", () => {
    const pack = fresh();
    const bakery = pack.locations.find((location) => location.id === "l_bakery")!;
    bakery.objects.push({ id: "i_overdue_book", name: "Overdue book", description: "A dusty book." });
    const report = validateStoryPack(pack);
    expect(report.errors.map((e) => e.code)).toEqual(["OBJECT_DUPLICATES_ITEM"]);
  });
});
