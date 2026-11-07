import { SYSTEM } from "../llm/prompts";
import type { DialogueTurnOutput } from "../llm/shapes";
import { dialogueTurnSchema } from "../llm/shapes";
import { Priority } from "../llm/types";
import type { JSONRequest } from "../llm/types";
import { nextGoalState } from "../story/goals";
import type { StoryState } from "../story/state";
import type { CastMember } from "../story/types";
import type { ConversationTurn } from "./types";

export const CHARACTER_START = "CHARACTER:";
export const CHARACTER_END = "END CHARACTER";
export const CONVERSATION_START = "CONVERSATION:";
export const CONVERSATION_END = "END CONVERSATION";
export const AVAILABLE_CLUES_START = "AVAILABLE CLUES:";
export const AVAILABLE_CLUES_END = "END AVAILABLE CLUES";

export interface InventoryEntry {
  id: string;
  name: string;
}

// Only what the character is allowed to talk about: their own core, the area, the story so far
// and the player's things. Never anything about other locations, other characters or the whole pack.
export interface DialogueContext {
  locationName: string;
  locationMood: string;
  storySummary: string;
  inventory: InventoryEntry[];
  getAvailableClues?: () => { id: string; text: string }[];
}

function characterFacts(character: CastMember, state: StoryState) {
  const goal = nextGoalState(character, state);
  return {
    name: character.name,
    species: character.species,
    personality: character.personality,
    goal: character.goal,
    secret: character.secret,
    // The pending goal carries the ids the character may hand over or reveal once it is actually met.
    goal_state: goal
      ? { id: goal.id, description: goal.description, requires: goal.requires, gives_items: goal.gives_items ?? [], reveals: goal.reveals ?? null }
      : "resolved",
  };
}

export function buildDialoguePrompt(character: CastMember, state: StoryState, context: DialogueContext, turns: readonly ConversationTurn[]): string {
  const facts = characterFacts(character, state);
  const convoLines = turns.map((turn) => `${turn.speaker === "player" ? "Player" : character.name}: ${turn.text}`);
  return [
    "You play ONE character in a cozy mystery game. Speak only as this character. " +
      "Write a fresh line every time: never repeat an earlier line and never check this reply against anything said before.",
    CHARACTER_START,
    JSON.stringify(facts),
    CHARACTER_END,
    `Place: ${context.locationName} (${context.locationMood}). Story so far: ${context.storySummary || "The story has just begun."}`,
    `Player's inventory: ${JSON.stringify(context.inventory)}`,
    AVAILABLE_CLUES_START,
    JSON.stringify(context.getAvailableClues?.() ?? []),
    AVAILABLE_CLUES_END,
    CONVERSATION_START,
    convoLines.join("\n") || "(the conversation is just starting)",
    CONVERSATION_END,
    "Return JSON with keys: line (1-3 sentences, in character), mode (\"choices\" or \"free\"), " +
      "choices (2-3 short replies when mode is choices, otherwise empty), " +
      "effects {give_item: the goal_state's gives_items id to hand over if it truly fits right now, or null; " +
      "reveal_clue: a clue id to reveal if it truly fits right now, or null; goal_progress: 0..1 or null}. " +
      "Use goal_progress: 1 only when this character's current goal is genuinely resolved. " +
      "Only propose give_item or reveal_clue when the goal_state and the player's inventory truly justify it; " +
      "reveal_clue must be one of the listed available clue ids. Otherwise use null.",
  ].join("\n");
}

export function buildDialogueRequest(
  character: CastMember,
  state: StoryState,
  context: DialogueContext,
  turns: readonly ConversationTurn[],
  priority: Priority = Priority.Dialogue,
  signal?: AbortSignal,
): JSONRequest<DialogueTurnOutput> {
  return {
    priority,
    system: SYSTEM,
    tag: "dialogue",
    schema: dialogueTurnSchema,
    maxTokens: 300,
    temperature: 0.8,
    prompt: buildDialoguePrompt(character, state, context, turns),
    signal,
  };
}
