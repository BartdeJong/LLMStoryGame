import { isRequirementMet } from "../story/requirements";
import { nextGoalState, resolveGoalState } from "../story/goals";
import { grantTruthsFromFoundClues, markClueFound } from "../story/state";
import type { StoryState } from "../story/state";
import type { CastMember, StoryPack } from "../story/types";

// Everything that changes the game during a conversation is decided here, in code. The model
// only words the result.

export interface AppliedEffects {
  resolvedGoal: string | null;
  givenItem: string | null;
  revealedClue: string | null;
}

export const NO_EFFECTS: AppliedEffects = { resolvedGoal: null, givenItem: null, revealedClue: null };

export type HandoverDirection = "player_gave" | "character_gave";

export interface Handover {
  goalId: string;
  direction: HandoverDirection;
  itemId: string | null; // the item the player handed over, if any
  receivedItemId: string | null; // the item the player now holds
}

export interface GiveOption {
  itemId: string;
  label: string;
}

function itemName(pack: StoryPack, itemId: string): string {
  return pack.items.find((item) => item.id === itemId)?.name ?? itemId;
}

// Items the player holds that the character's current goal state asks for. The goal's other
// requirements must already be met, so a "Give" button never appears too early.
export function giveOptions(pack: StoryPack, state: StoryState, character: CastMember): GiveOption[] {
  const goal = nextGoalState(character, state);
  if (!goal || !isRequirementMet(goal.requires, state)) return [];
  return (goal.requires.items ?? [])
    .filter((id) => state.itemsHeld.includes(id))
    .map((itemId) => ({ itemId, label: `Give ${itemName(pack, itemId)}` }));
}

function resolveCurrentGoal(
  pack: StoryPack,
  state: StoryState,
  character: CastMember,
  direction: HandoverDirection,
  itemId: string | null,
): Handover | null {
  const goal = nextGoalState(character, state);
  if (!goal) return null;
  const before = new Set(state.itemsHeld);
  const resolved = resolveGoalState(pack, state, character, goal.id);
  if (!resolved) return null;
  const received = resolved.gives_items?.find((id) => !before.has(id) && state.itemsHeld.includes(id)) ?? null;
  return { goalId: resolved.id, direction, itemId, receivedItemId: received };
}

// The player hands over an item the current goal state needs. Code applies the pack's transition.
export function giveItemToCharacter(pack: StoryPack, state: StoryState, character: CastMember, itemId: string): Handover | null {
  if (!giveOptions(pack, state, character).some((option) => option.itemId === itemId)) return null;
  return resolveCurrentGoal(pack, state, character, "player_gave", itemId);
}

// Goal states that need no item resolve as soon as the pack's conditions hold (the character
// hands over or reveals whatever the pack says). States that need an item wait for the player to give it.
export function resolveReadyGoal(pack: StoryPack, state: StoryState, character: CastMember): Handover | null {
  const goal = nextGoalState(character, state);
  if (!goal || (goal.requires.items ?? []).length > 0 || !isRequirementMet(goal.requires, state)) return null;
  return resolveCurrentGoal(pack, state, character, "character_gave", null);
}

export function handoverEffects(handover: Handover | null): AppliedEffects {
  return handover ? { resolvedGoal: handover.goalId, givenItem: handover.receivedItemId, revealedClue: null } : NO_EFFECTS;
}

// What the model may know about handovers: only what just happened, or what is still missing.
export function handoverPromptLines(
  pack: StoryPack,
  state: StoryState,
  character: CastMember,
  justHappened: readonly Handover[],
): string[] {
  const lines: string[] = [];
  for (const handover of justHappened) {
    if (handover.direction === "player_gave" && handover.itemId) {
      lines.push(`Just happened: the player gave you the ${itemName(pack, handover.itemId)}. Thank them.`);
    }
    if (handover.receivedItemId) lines.push(`Just happened: you gave the player the ${itemName(pack, handover.receivedItemId)}.`);
  }
  if (lines.length > 0) return lines;

  const goal = nextGoalState(character, state);
  if (!goal || (goal.gives_items ?? []).length === 0) return [];
  const rewards = (goal.gives_items ?? []).map((id) => itemName(pack, id)).join(" and ");
  const missingItems = (goal.requires.items ?? []).filter((id) => !state.itemsHeld.includes(id)).map((id) => itemName(pack, id));
  const needs = missingItems.length > 0
    ? `the player brings you the ${missingItems.join(" and the ")}`
    : "the player has learned more about what happened";
  return [`Nothing has been handed over. You give the ${rewards} only once ${needs}. Do not say you give it now.`];
}

// Telling a fact on purpose marks its clue found. Only clues this character really tells, and
// whose requirements are met, can be marked.
export function revealClueFromTalk(pack: StoryPack, state: StoryState, character: CastMember, clueId: string): string | null {
  const clue = pack.clues.find((candidate) => candidate.id === clueId);
  const toldHere = clue && [clue.where, ...clue.alternatives].some((source) => source.type === "character" && source.id === character.id);
  if (!clue || !toldHere || state.cluesFound.includes(clue.id) || !isRequirementMet(clue.requirements, state)) return null;
  markClueFound(state, clue.id);
  grantTruthsFromFoundClues(pack, state);
  return clue.id;
}
