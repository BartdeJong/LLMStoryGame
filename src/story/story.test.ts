import { describe, expect, it } from "vitest";
import fixture from "./fixtures/example-pack.json";
import publicExample from "../../public/stories/example.json";
import schema from "../../tools/story-forge/schema/story-pack.schema.json";
import { checkSchema } from "./jsonSchema";
import { getLengthView, loadStoryIndex, loadStoryPack, parseStoryIndex, StoryLoadError } from "./loader";
import { solveLength } from "./solver";
import type { StoryPack } from "./types";
import { formatIssue, validateStoryPack } from "./validate";
import { seededIconRecipe } from "./recipes";

const fresh = (): StoryPack => structuredClone(fixture) as unknown as StoryPack;
const codes = (data: unknown): string[] => validateStoryPack(data).errors.map((e) => e.code);

describe("example pack", () => {
  it("is identical to the public copy", () => {
    expect(publicExample).toEqual(fixture);
  });

  describe("semantic item icon fallbacks", () => {
    it.each([
      ["i_overdue_book", "An old repair book", "book"],
      ["i_charred_envelope", "A blackened envelope", "envelope"],
      ["i_glass_shard", "A curved piece of glass", "shard"],
      ["i_tower_key", "An iron key", "key"],
      ["i_spyglass", "A dented spyglass", "spyglass"],
    ])("recognizes %s", (id, description, shape) => {
      expect(seededIconRecipe(id, description).shape).toBe(shape);
    });
  });

  it("passes the schema and validator without non-visual warnings", () => {
    expect(checkSchema(fixture, schema as Record<string, unknown>)).toEqual([]);
    const report = validateStoryPack(fixture);
    expect(report.errors.map(formatIssue)).toEqual([]);
    expect(report.warnings.filter((issue) => !issue.code.startsWith("VISUAL_")).map(formatIssue)).toEqual([]);
  });

  it("can be solved to its ending", () => {
    const pack = fresh();
    const solved = solveLength(pack, pack.lengths.short!);
    expect(solved.endings).toEqual(["e_lantern_returns"]);
    expect(solved.locations.size).toBe(5);
  });
});

describe("validator rejects broken packs", () => {
  it("missing required field (schema)", () => {
    const pack = fresh() as unknown as Record<string, any>;
    delete pack.cast[0].id;
    const report = validateStoryPack(pack);
    expect(report.errors[0]).toMatchObject({ code: "SCHEMA", path: "cast[0].id" });
  });

  it("unknown id reference", () => {
    const pack = fresh();
    pack.clues[0].truth_id = "t_nope";
    const report = validateStoryPack(pack);
    expect(report.errors.some((e) => e.code === "REF_UNKNOWN" && e.path === "clues[0].truth_id" && e.message.includes("t_nope"))).toBe(true);
  });

  it("duplicate id", () => {
    const pack = fresh();
    pack.items[1].id = pack.items[0].id;
    expect(codes(pack)).toContain("ID_DUPLICATE");
  });

  it("rejects area door signs that lead nowhere or name another place", () => {
    const pack = fresh();
    pack.locations[1].area!.doors.push({ to: "l_clocktower", label: "Tower", hint: "Up the stair." });
    pack.locations[0].area!.doors[0]!.label = "Past Owl Library";
    const codes = validateStoryPack(pack).errors.map((e) => e.code);
    expect(codes).toContain("AREA_DOOR_NOT_NEIGHBOUR");
    expect(codes).toContain("AREA_DOOR_MISLEADING");
  });

  it("unreachable location (no door leads to it)", () => {
    const pack = fresh();
    pack.locations[0].doors = pack.locations[0].doors.filter((d) => d.to !== "l_garden");
    const report = validateStoryPack(pack);
    expect(report.errors.map((e) => e.code)).toContain("LOCATION_DISCONNECTED");
    expect(report.errors.some((e) => e.code === "LOCATION_UNREACHABLE" && e.message.includes("l_garden"))).toBe(true);
  });

  it("location unreachable because its door lock can never be met", () => {
    const pack = fresh();
    pack.locations[3].doors[0].lock = { items: ["i_glass_shard", "i_tower_key"] };
    pack.cast[1].goal_states[0].requires = { items: ["i_overdue_book"], truths: ["t_taker"] };
    expect(codes(pack)).toContain("LOCATION_UNREACHABLE");
  });

  it("core truth with only one route", () => {
    const pack = fresh();
    pack.clues = pack.clues.filter((c) => c.id !== "cl_notice_board");
    pack.truths[0].revealed_by = ["cl_mira_talk"];
    const report = validateStoryPack(pack);
    expect(report.errors.some((e) => e.code === "CORE_TRUTH_ROUTES" && e.message.includes("t_missing"))).toBe(true);
  });

  it("two clues that share a requirement are not independent routes", () => {
    const pack = fresh();
    pack.clues.find((c) => c.id === "cl_mira_talk")!.requirements = { items: ["i_overdue_book"] };
    pack.clues.find((c) => c.id === "cl_notice_board")!.requirements = { items: ["i_overdue_book"] };
    expect(codes(pack)).toContain("CORE_TRUTH_ROUTES");
  });

  it("circular requirements", () => {
    const pack = fresh();
    pack.items[0].found_requires = { goal_states: ["gs_oswin_book"] };
    const report = validateStoryPack(pack);
    const cycle = report.errors.find((e) => e.code === "CIRCULAR_REQUIREMENT");
    expect(cycle?.message).toContain("item:i_overdue_book -> goal:gs_oswin_book");
  });

  it("requirement that is only available after it is needed", () => {
    const pack = fresh();
    pack.lengths.short!.beats[0].must_find = { items: ["i_tower_key"] }; // key needs the library, in beat 2
    const report = validateStoryPack(pack);
    expect(report.errors.some((e) => e.code === "LOCATION_UNREACHABLE" && e.message.includes("l_library"))).toBe(true);
  });

  it("too few locations for the length", () => {
    const pack = fresh();
    pack.lengths.short!.beats[1].locations = ["l_library"];
    const report = validateStoryPack(pack);
    expect(report.errors.some((e) => e.code === "COMPLEXITY_TOO_LOW" && e.message.includes("locations"))).toBe(true);
  });

  it("an ending whose conditions cannot be met", () => {
    const pack = fresh();
    pack.cast[3].goal_states[0].requires = { truths: ["t_motive"], items: ["i_glass_shard", "i_overdue_book"] };
    pack.items[0].found_requires = { goal_states: ["gs_hollis_forgiven"] };
    const found = codes(pack);
    expect(found).toContain("ENDING_UNREACHABLE");
    expect(found).toContain("CIRCULAR_REQUIREMENT");
  });

  it("text over the length limit", () => {
    const pack = fresh();
    pack.identity.title = "x".repeat(200);
    expect(validateStoryPack(pack).errors.some((e) => e.code === "TEXT_TOO_LONG" && e.path === "identity.title")).toBe(true);
  });

  it("warns about unused cast and items without failing", () => {
    const pack = fresh();
    pack.lengths.short!.cast = ["c_mira", "c_oswin", "c_pip", "c_hollis"];
    pack.cast.push({
      ...pack.cast[2],
      id: "c_extra",
      name: "Extra",
      sprite: { species: "fox", height: "tall", girth: "stout", skin: "#c0602a", outfit: { style: "robe", color: "#335577" }, headwear: { style: "top-hat", color: "#222222" } },
      goal_states: [],
      knowledge: pack.cast[2].knowledge.map(({ clue_id: _clue, truth_id: _truth, ...rest }) => rest),
    });
    pack.items.push({ ...pack.items[2], id: "i_spare", found_at: { type: "character", id: "c_mira" } });
    const report = validateStoryPack(pack);
    expect(report.ok).toBe(true);
    expect(report.warnings.filter((w) => !w.code.startsWith("VISUAL_")).map((w) => w.code).sort()).toEqual(["UNUSED_CAST", "UNUSED_ITEM"]);
  });
});

describe("loader", () => {
  const respond = (files: Record<string, unknown>) => async (url: string): Promise<Response> => {
    const name = url.split("/").pop() as string;
    return name in files ? new Response(JSON.stringify(files[name])) : new Response("", { status: 404 });
  };

  it("loads the index and a pack, then exposes the length view in beat order", async () => {
    const fetcher = respond({
      "index.json": { stories: [{ id: "example", title: "T", logline: "L", lengths: ["short"], estimated_minutes: { short: 15 } }] },
      "example.json": fixture,
    });
    const index = await loadStoryIndex(fetcher);
    expect(index.stories[0].lengths).toEqual(["short"]);
    const view = getLengthView(await loadStoryPack("example", fetcher), "short");
    expect(view.locations.map((l) => l.id)).toEqual(["l_square", "l_bakery", "l_garden", "l_library", "l_clocktower"]);
    expect(view.cast).toHaveLength(4);
    expect(view.coreTruths).toHaveLength(4);
    expect(view.endings.map((e) => e.id)).toEqual(["e_lantern_returns"]);
    expect(view.beats).toHaveLength(2);
  });

  it("rejects an invalid pack at load time with the validator messages", async () => {
    const broken = fresh();
    broken.clues[0].truth_id = "t_nope";
    const error = await loadStoryPack("example", respond({ "example.json": broken })).catch((e) => e);
    expect(error).toBeInstanceOf(StoryLoadError);
    expect((error as StoryLoadError).details.join("\n")).toContain("t_nope");
  });

  it("reports missing files, missing lengths and bad indexes", async () => {
    await expect(loadStoryPack("nope", respond({}))).rejects.toThrow(/HTTP 404/);
    expect(() => getLengthView(fresh(), "long")).toThrow(/no "long" length/);
    expect(() => parseStoryIndex({ stories: [{ id: "x" }] })).toThrow(/stories\[0\]/);
  });
});
