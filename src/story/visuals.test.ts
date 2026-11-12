import { describe, expect, it } from "vitest";
import fixture from "../../public/stories/example.json";
import exampleStory from "../../public/stories/example.json";
import lanternTide from "../../public/stories/lanterntide.json";
import holmesAshEnvelope from "../../public/stories/holmesashenvelope.json";
import schema from "../../tools/story-forge/schema/story-pack.schema.json";
import { resolveVisual } from "../art/glyphs";
import { loadStoryPack } from "./loader";
import type { StoryPack } from "./types";
import { checkSchema } from "./jsonSchema";
import { validateStoryPack } from "./validate";

const fresh = (): StoryPack => structuredClone(fixture) as unknown as StoryPack;

describe("story visuals", () => {
  it("uses the lighthouse glyph for Lantern Tide's Thirteenth Light", async () => {
    const pack = await loadStoryPack("lanterntide", async () => new Response(JSON.stringify(lanternTide), { status: 200 }));
    const light = pack.locations
      .find((location) => location.id === "l_drowned_lamp")
      ?.objects.find((object) => object.id === "o_thirteenth_light");

    expect(light?.visual).toEqual({ icon: "lighthouse", accent: "water", states: ["glow"] });
  });

  it("uses specific glyphs for every current story item and room object", () => {
    const stories = [exampleStory, lanternTide, holmesAshEnvelope];
    const genericMatches = stories.flatMap((story) => [
      ...story.items.map((item) => ({ name: item.name, description: item.description })),
      ...story.locations.flatMap((location) => location.objects.map((object) => ({
        name: object.name,
        description: object.description,
      }))),
    ]).filter((entry) => resolveVisual(entry.name, entry.description).icon.startsWith("generic_"));

    expect(genericMatches).toEqual([]);
  });

  it("reports weak matches and rejects unknown glyphs and states", () => {
    const pack = fresh();
    const data = {
      ...pack,
      items: pack.items.map((item, index) => index === 0
        ? { ...item, name: "Unknown widgets", visual: { icon: "not_in_catalog", accent: "ultraviolet", states: ["mysterious"] } }
        : item),
    };
    const report = validateStoryPack(data);
    expect(report.errors.map((issue) => issue.code)).toContain("VISUAL_ICON_UNKNOWN");
    expect(report.errors.map((issue) => issue.code)).toContain("VISUAL_STATE_UNKNOWN");
    expect(report.errors.map((issue) => issue.code)).toContain("VISUAL_ACCENT_INVALID");
    expect(report.warnings.some((issue) => issue.code === "VISUAL_WEAK_MATCH")).toBe(true);
  });

  it("warns when more than three entries share the same visual", () => {
    const pack = fresh();
    pack.items[0]!.visual = { icon: "generic_container" };
    pack.items[1]!.visual = { icon: "generic_container" };
    pack.locations[0]!.objects[0]!.visual = { icon: "generic_container" };
    pack.locations[1]!.objects[0]!.visual = { icon: "generic_container" };
    expect(validateStoryPack(pack).warnings.some((issue) => issue.code === "VISUAL_DUPLICATE")).toBe(true);
  });

  it("reports missing visual request fields through schema validation", () => {
    const pack = fresh();
    const data = { ...pack, visual_requests: [{ name: "unmatched thing" }] };
    expect(validateStoryPack(data).errors.some((issue) => issue.code === "SCHEMA" && issue.path.includes("visual_requests[0].description"))).toBe(true);
  });

  it("resolves visuals during loading without changing legacy pack serialization", async () => {
    const pack = fresh();
    const loaded = await loadStoryPack("example", async () => new Response(JSON.stringify(pack), { status: 200 }));
    expect(loaded.items[0]!.visual?.icon).toBe("book");
    expect(Object.keys(loaded.items[0]!)).not.toContain("visualInferred");
    expect(checkSchema(loaded, schema as Record<string, unknown>)).toEqual([]);
  });
});
