import type { StoryState } from "./state";
import type { DoorLock, Requirement, StoryPack } from "./types";

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

// A door's lock is written on whichever side names the other location; doors work both ways.
export function findDoorLock(pack: StoryPack, locationId: string, targetLocationId: string): DoorLock | undefined {
  const here = pack.locations.find((candidate) => candidate.id === locationId);
  const outgoing = here?.doors.find((door) => door.to === targetLocationId)?.lock;
  if (outgoing) return outgoing;
  const there = pack.locations.find((candidate) => candidate.id === targetLocationId);
  return there?.doors.find((door) => door.to === locationId)?.lock;
}
