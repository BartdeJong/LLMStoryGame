import { BIOMES, OBJECT_KINDS, storyAreaBriefSchema } from "../llm/shapes";
import type { AreaBriefOutput } from "../llm/shapes";
import { recipeHelp, SYSTEM } from "../llm/prompts";
import { Priority } from "../llm/types";
import type { JSONRequest } from "../llm/types";
import { PALETTE_NAMES } from "../art";
import type { LocationSlice } from "./slice";

export const SLICE_START = "LOCATION:";
export const SLICE_END = "END LOCATION";

// The prompt carries only this location's slice, never the rest of the pack.
export function buildBriefPrompt(slice: LocationSlice): string {
  const { style, ...facts } = slice;
  return [
    "Write the flavor for ONE location of a cozy mystery game. The facts below are fixed. Describe them; never change them and never add plot.",
    SLICE_START,
    JSON.stringify(facts),
    SLICE_END,
    `Style guide:\n${style}`,
    "Return JSON with keys: name (exactly the location name), " +
      `biome (${BIOMES.join("|")}), mood, palette (${PALETTE_NAMES.join("|")}), description (2 sentences), ` +
      "characters (one entry per listed character, same order, exact name and species, plus at most 1 extra minor animal or gentle creature: " +
      "name, species, sprite_recipe, personality, goal, secret), " +
      `objects (one entry per listed object, same order, exact name, plus at most 2 extra decorations: kind (${OBJECT_KINDS.join("|")}), name, description, icon_recipe, contents (empty for listed objects)), ` +
      "clue (null if no clues are listed, otherwise {truth_id: the first listed truth_id or \"none\", where: a short spot in this place, text}), " +
      "doors (one entry per listed door, same order: label of at most 4 words, hint). " +
      recipeHelp,
  ].join("\n");
}

export function buildBriefRequest(slice: LocationSlice, priority: Priority = Priority.Area, signal?: AbortSignal): JSONRequest<AreaBriefOutput> {
  return {
    priority,
    system: SYSTEM,
    tag: "area",
    schema: storyAreaBriefSchema,
    maxTokens: 1100,
    prompt: buildBriefPrompt(slice),
    signal,
  };
}
