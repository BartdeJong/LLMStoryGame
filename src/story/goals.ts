import { isRequirementMet } from "./requirements";
import { addResolvedGoalState, giveItem, isResolved } from "./state";
import type { StoryState } from "./state";
import type { CastMember, GoalState, StoryPack } from "./types";

// Goal states are stages: the first unresolved one in order is the character's current state.
// With none left unresolved, the character is simply "resolved".
export function nextGoalState(character: CastMember, state: StoryState): GoalState | null {
  return character.goal_states.find((goal) => !isResolved(state, goal.id)) ?? null;
}

export type GoalStatus = "unmet" | "in_progress" | "resolved";

export function goalStatus(character: CastMember, state: StoryState): GoalStatus {
  const next = nextGoalState(character, state);
  if (!next) return "resolved";
  return character.goal_states[0]?.id === next.id ? "unmet" : "in_progress";
}

// Resolves `goalStateId` for `character` only if it is still pending and the pack's requirement for it
// is actually met right now. Gives its reward items. Returns the goal state when it resolved, otherwise null.
export function resolveGoalState(pack: StoryPack, state: StoryState, character: CastMember, goalStateId: string): GoalState | null {
  const goal = character.goal_states.find((candidate) => candidate.id === goalStateId);
  if (!goal || isResolved(state, goal.id) || !isRequirementMet(goal.requires, state)) return null;
  addResolvedGoalState(state, goal.id);
  for (const itemId of goal.gives_items ?? []) {
    if (pack.items.some((item) => item.id === itemId)) giveItem(state, itemId);
  }
  return goal;
}
