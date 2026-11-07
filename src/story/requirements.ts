import type { StoryState } from "./state";
import type { Requirement, StoryPack } from "./types";

// Code-side check of a pack Requirement against the player's current progress. Nothing here is proposed
// by the LLM; it is the single source of truth for whether a door, goal state or clue is available.
export function isRequirementMet(req: Requirement | undefined, state: StoryState): boolean {
  if (!req) return true;
  return (
    (req.items ?? []).every((id) => state.itemsHeld.includes(id))
    && (req.goal_states ?? []).every((id) => state.resolvedGoalStates.includes(id))
    && (req.truths ?? []).every((id) => state.truthsFound.includes(id))
  );
}

// Names of the still-missing requirement entries, for a friendly "you need..." message.
export function missingRequirementNames(pack: StoryPack, req: Requirement | undefined, state: StoryState): string[] {
  if (!req) return [];
  const missing: string[] = [];
  for (const id of req.items ?? []) {
    if (!state.itemsHeld.includes(id)) missing.push(pack.items.find((item) => item.id === id)?.name ?? id);
  }
  for (const id of req.truths ?? []) {
    if (!state.truthsFound.includes(id)) missing.push("more of the story");
  }
  for (const id of req.goal_states ?? []) {
    if (!state.resolvedGoalStates.includes(id)) missing.push("someone's help");
  }
  return missing;
}

// A door's lock is written on whichever side names the other location; doors work both ways.
export function findDoorLock(pack: StoryPack, locationId: string, targetLocationId: string): Requirement | undefined {
  const here = pack.locations.find((candidate) => candidate.id === locationId);
  const outgoing = here?.doors.find((door) => door.to === targetLocationId)?.lock;
  if (outgoing) return outgoing;
  const there = pack.locations.find((candidate) => candidate.id === targetLocationId);
  return there?.doors.find((door) => door.to === locationId)?.lock;
}
