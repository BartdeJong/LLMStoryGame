import { describe, expect, it } from "vitest";
import example from "../../public/stories/example.json";
import { formatReadthrough } from "../../tools/story-forge/readthrough";
import type { StoryPack } from "./types";

describe("story read-through output", () => {
  it("prints the solved short path and story discoveries for the example pack", () => {
    const output = formatReadthrough(example as unknown as StoryPack, "short");

    expect(output).toContain("The Missing Moon Lantern - short (15 min)");
    expect(output).toContain([
      "Locations:",
      "1. Pebblebrook Square",
      "2. Mira's Bakery",
      "3. Herb Garden",
      "4. Owl Library",
      "5. Clock Tower",
    ].join("\n"));
    expect(output).toContain("Clues found:");
    expect(output).toContain("[cl_mira_talk]");
    expect(output).toContain("Characters met:");
    expect(output).toContain("- Mira (human)");
    expect(output).toContain("Items used:");
    expect(output).toContain("- Overdue book [i_overdue_book]");
    expect(output).toContain("- Tower key [i_tower_key]");
    expect(output).toContain("- Glass shard [i_glass_shard]");
    expect(output).toContain("Truths revealed:");
    expect(output).toContain("[t_motive]");
    expect(output).toContain("Ending reached:");
    expect(output).toContain("[e_lantern_returns]");
  });

  it("reports when a requested length is not in the pack", () => {
    expect(() => formatReadthrough(example as unknown as StoryPack, "long")).toThrow(
      'Story "example" has no "long" length.',
    );
  });
});
