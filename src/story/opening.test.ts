import { describe, expect, it } from "vitest";
import example from "../../public/stories/example.json";
import type { StoryPack } from "./types";
import { validateStoryPack } from "./validate";

describe("story openings and objectives", () => {
  it.each([
    ["The Missing Moon Lantern", example],
  ])("%s gives every length an opening and actionable beat guidance", (_title, rawPack) => {
    const report = validateStoryPack(rawPack);
    expect(report.errors).toEqual([]);
    const pack = report.pack;
    expect(pack).toBeDefined();
    if (!pack) return;

    for (const [lengthId, definition] of Object.entries(pack.lengths)) {
      if (!definition) continue;
      expect(definition.opening?.context.trim(), `${lengthId} opening context`).not.toBe("");
      expect(definition.beats[0]?.locations, `${lengthId} start location`).toContain(definition.start_location);
      for (const beat of definition.beats) {
        expect(beat.objective?.trim(), `${lengthId}/${beat.id} objective`).not.toBe("");
        expect(beat.guidance?.trim(), `${lengthId}/${beat.id} guidance`).not.toBe("");
      }
    }
    expect(report.warnings.map(({ code }) => code)).not.toContain("OPENING_MISSING");
    expect(report.warnings.map(({ code }) => code)).not.toContain("BEAT_OBJECTIVE_MISSING");
    expect(report.warnings.map(({ code }) => code)).not.toContain("BEAT_GUIDANCE_MISSING");
  });

  it("still accepts older packs that do not contain opening metadata", () => {
    const legacy = structuredClone(example) as unknown as StoryPack;
    const definition = legacy.lengths.short;
    if (!definition) throw new Error("The example pack is missing its short length.");
    delete definition.opening;
    for (const beat of definition.beats) {
      delete beat.objective;
      delete beat.guidance;
    }

    const report = validateStoryPack(legacy);
    expect(report.ok).toBe(true);
    expect(report.warnings.map(({ code }) => code)).toContain("OPENING_MISSING");
    expect(report.warnings.map(({ code }) => code)).toContain("BEAT_OBJECTIVE_MISSING");
    expect(report.warnings.map(({ code }) => code)).toContain("BEAT_GUIDANCE_MISSING");
  });
});
