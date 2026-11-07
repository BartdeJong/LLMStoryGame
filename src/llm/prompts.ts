import { PALETTE_COLOR_SLOTS, PALETTE_NAMES, BODY_SHAPES, CHARACTER_FEATURES, ICON_SHAPES } from "../art";
import type { JSONRequest } from "./types";
import { Priority } from "./types";
import { areaBriefSchema, BIOMES, characterSchema, dialogueTurnSchema, OBJECT_KINDS } from "./shapes";
import type { AreaBriefOutput, CharacterOutput, DialogueTurnOutput } from "./shapes";

export const SYSTEM =
  "You are the narrator of a cozy mystery exploration game. Write warm, gentle, short text. English only. " +
  "Never invent plot facts beyond what you are told.";

export const recipeHelp =
  `sprite_recipe: {body: ${BODY_SHAPES.join("|")}, bodyColor/accentColor/skinColor: ${PALETTE_COLOR_SLOTS.join("|")}, feature: ${CHARACTER_FEATURES.join("|")}}. ` +
  `icon_recipe: {shape: ${ICON_SHAPES.join("|")}, primaryColor/secondaryColor: ${PALETTE_COLOR_SLOTS.join("|")}}.`;

export function areaBriefRequest(priority: Priority = Priority.Area): JSONRequest<AreaBriefOutput> {
  return {
    priority,
    system: SYSTEM,
    tag: "area",
    schema: areaBriefSchema,
    maxTokens: 900,
    prompt:
      "Describe one location: the old lighthouse keeper's garden on a misty shore, where a prized lantern went missing. " +
      `Keys: name, biome (${BIOMES.join("|")}), mood, palette (${PALETTE_NAMES.join("|")}), description (2 sentences), ` +
      `characters (1-2: name, species, sprite_recipe, personality, goal, secret), ` +
      `objects (2-3: kind (${OBJECT_KINDS.join("|")}), name, description, icon_recipe, contents), ` +
      `clue (null or {truth_id, where, text}), doors (1-3: label, hint). ${recipeHelp}`,
  };
}

export function characterRequest(priority: Priority = Priority.Area): JSONRequest<CharacterOutput> {
  return {
    priority,
    system: SYSTEM,
    tag: "character",
    schema: characterSchema,
    maxTokens: 300,
    prompt:
      "Invent one minor character for a misty seaside village: an animal or a gentle mythical creature. " +
      `Keys: name, species, sprite_recipe, personality, goal, secret. ${recipeHelp}`,
  };
}

export function dialogueTurnRequest(priority: Priority = Priority.Dialogue): JSONRequest<DialogueTurnOutput> {
  return {
    priority,
    system: SYSTEM,
    tag: "dialogue",
    schema: dialogueTurnSchema,
    maxTokens: 300,
    temperature: 0.8,
    prompt:
      "You are Maribel, a cheerful baker whose goal is to find out who borrowed her prize-winning recipe book. " +
      'The player says: "Have you seen anything strange this morning?" ' +
      'Keys: line (1-2 sentences), mode ("choices" or "free"), choices (0-3 short replies), ' +
      "effects {give_item: string|null, reveal_clue: string|null, goal_progress: number 0..1 or null}.",
  };
}
