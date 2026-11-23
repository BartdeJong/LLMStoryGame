import { describe, expect, it } from "vitest";
import fixture from "../../public/stories/example.json";
import english from "../../public/stories/paddingtonhat.json";
import dutch from "../../public/stories/paddingtonhat_nl.json";
import schema from "../../tools/story-forge/schema/story-pack.schema.json";
import { checkSchema } from "./jsonSchema";
import { formatIssue, validateStoryPack } from "./validate";

// Fields that must be identical in a translation: ids, references and anything the engine reads.
const ID_LEAVES = new Set([
  "id", "cast_id", "about", "to", "start_location", "home_location", "location", "clue_id", "truth_id", "object_id", "type",
  "kind", "importance", "suggested_category", "schema_version", "version", "icon_recipe", "biome", "mood", "palette", "floor", "wall",
]);
// Lists of ids: the nearest named parent decides.
const ID_LISTS = new Set([
  "requires", "found_requires", "must_find", "knows_truths", "revealed_by", "depends_on", "setup_clues", "rules_out", "broken_by",
  "proof", "endings", "choices", "goal_states", "gives_items", "required_characters", "core_truths", "twists", "red_herrings",
  "cast", "locations", "items", "truths", "clues", "alternatives",
]);
const ENGINE_BLOCKS = new Set(["sprite", "player_sprite", "visual", "map", "placements", "decor"]);

function isShared(path: string): boolean {
  const segments = path.split(".");
  if (segments.some((segment) => ENGINE_BLOCKS.has(segment))) return true;
  const named = segments.filter((segment) => !/^\d+$/.test(segment));
  const leaf = named[named.length - 1]!;
  const lastIsIndex = /^\d+$/.test(segments[segments.length - 1]!);
  if (lastIsIndex) return ID_LISTS.has(leaf);
  return ID_LEAVES.has(leaf);
}

function paths(value: unknown, path: string[] = []): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (Array.isArray(value)) {
    out.set(`${path.join(".")}.length`, value.length);
    value.forEach((item, i) => paths(item, [...path, String(i)]).forEach((v, k) => out.set(k, v)));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) paths(v, [...path, k]).forEach((v2, k2) => out.set(k2, v2));
  } else {
    out.set(path.join("."), value);
  }
  return out;
}

describe("Dutch Paddington pack", () => {
  it("passes the schema and validator with no errors", () => {
    expect(checkSchema(dutch, schema as Record<string, unknown>)).toEqual([]);
    expect(validateStoryPack(dutch).errors.map(formatIssue)).toEqual([]);
    expect((dutch as { language?: string }).language).toBe("nl");
  });

  it("has the same structure as the English pack", () => {
    const en = paths(english);
    const nl = paths(dutch);
    const enKeys = [...en.keys()].sort();
    const nlKeys = [...nl.keys()].filter((key) => key !== "language").sort();
    expect(nlKeys).toEqual(enKeys);
  });

  it("keeps ids, references and engine fields identical", () => {
    const en = paths(english);
    const nl = paths(dutch);
    const mismatches: string[] = [];
    for (const [path, value] of en) {
      if (path === "identity.id") continue;
      if (isShared(path) && nl.get(path) !== value) mismatches.push(path);
    }
    expect(mismatches).toEqual([]);
    expect(dutch.identity.id).toBe("paddingtonhat_nl");
  });

  it("accepts a pack with no language and rejects an unknown one", () => {
    expect(checkSchema(fixture, schema as Record<string, unknown>)).toEqual([]);
    const bad = { ...structuredClone(fixture), language: "xx" };
    const report = validateStoryPack(bad);
    expect(report.errors.map((issue) => issue.code)).toContain("SCHEMA");
  });
});
