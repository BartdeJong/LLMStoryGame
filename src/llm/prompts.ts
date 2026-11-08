import { PALETTE_COLOR_SLOTS, PALETTE_NAMES, BODY_SHAPES, CHARACTER_FEATURES, ICON_SHAPES } from "../art";
import type { JSONRequest } from "./types";
import { Priority } from "./types";
import { areaBriefSchema, BIOMES, characterSchema, dialogueTurnSchema, OBJECT_KINDS } from "./shapes";
import type { AreaBriefOutput, CharacterOutput, DialogueTurnOutput } from "./shapes";

export const SYSTEM =
  "You are the narrator of a cozy mystery exploration game. Write warm, gentle, short text. English only. " +
  "Never invent plot facts beyond what you are told.";

export const DIALOGUE_SYSTEM =
  "You speak as one character in a cozy mystery exploration game. English only. " +
  "Reply with spoken words only; never narrate, describe the scene or the character from outside, or speak for the player.";

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
    system: DIALOGUE_SYSTEM,
    tag: "dialogue",
    schema: dialogueTurnSchema,
    maxTokens: 300,
    temperature: 0.8,
    prompt:
      "Character: Maribel, a cheerful baker. Voice: warm, quick-witted. Goal: find out who borrowed her prize-winning recipe book. " +
      'Player asks: "Have you seen anything strange this morning?" ' +
      "Answer the question directly using only supplied facts. If Maribel does not know, say so; do not change the subject. " +
      "Do not narrate or speak for the player. Do not repeat an earlier character line. " +
      'line (1-3 short, natural spoken sentences), mode ("choices" or "free"), ' +
      'choices (0-3 distinct player-intent labels such as "Ask about the recipe book", not first-person dialogue), ' +
      "effects {give_item: string|null, reveal_clue: string|null, goal_progress: number 0..1 or null}.",
  };
}
