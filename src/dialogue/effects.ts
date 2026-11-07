import type { DialogueTurnOutput } from "../llm/shapes";
import { isRequirementMet } from "../story/requirements";
import { nextGoalState, resolveGoalState } from "../story/goals";
import { grantTruthsFromFoundClues, markClueFound } from "../story/state";
import type { StoryState } from "../story/state";
import type { CastMember, StoryPack } from "../story/types";

export interface AppliedEffects {
  resolvedGoal: string | null;
  givenItem: string | null;
  revealedClue: string | null;
}

const NONE_APPLIED: AppliedEffects = { resolvedGoal: null, givenItem: null, revealedClue: null };

// Validates the LLM's proposed effects against the pack's own rules and applies only what checks out.
// Anything that does not match a real, currently-available reward or clue is silently ignored.
export function applyDialogueEffects(
  pack: StoryPack,
  state: StoryState,
  character: CastMember,
  effects: DialogueTurnOutput["effects"],
): AppliedEffects {
  const applied: AppliedEffects = { ...NONE_APPLIED };

  const goal = nextGoalState(character, state);
  const validReward = goal && effects.give_item && (goal.gives_items ?? []).includes(effects.give_item);
  if (goal && (validReward || effects.goal_progress === 1)) {
    const beforeItems = new Set(state.itemsHeld);
    const resolved = resolveGoalState(pack, state, character, goal.id);
    if (resolved) {
      applied.resolvedGoal = resolved.id;
      applied.givenItem = goal.gives_items?.find((id) => !beforeItems.has(id)) ?? null;
    }
  }

  if (effects.reveal_clue) {
    const clue = pack.clues.find((candidate) => candidate.id === effects.reveal_clue);
    const spokenHere = clue && [clue.where, ...clue.alternatives].some(
      (source) => source.type === "character" && source.id === character.id,
    );
    if (clue && spokenHere && !state.cluesFound.includes(clue.id)
      && isRequirementMet(clue.requirements, state)) {
      markClueFound(state, clue.id);
      grantTruthsFromFoundClues(pack, state);
      applied.revealedClue = clue.id;
    }
  }

  return applied;
}
