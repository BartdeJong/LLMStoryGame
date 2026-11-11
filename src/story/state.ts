import type { LengthView } from "./loader";
import { isAssistedDeductions } from "./assist";
import type { LengthId } from "./types";
import type { StoryPack, Truth } from "./types";

// How often (in newly visited areas) the rolling summary is regenerated.
export const SUMMARY_EVERY_AREAS = 3;

export interface CharacterMemory {
  visits: number;
  askedAbout: string[]; // subject keys: "<type>:<id>"
}

export interface StoryState {
  packId: string;
  packVersion: number;
  length: LengthId;
  visitedAreas: string[];
  truthsFound: string[]; // confirmed truths
  truthsReady: string[]; // truths with a deduction whose evidence is in, waiting for the player's answer
  herringsRuledOut: string[];
  twistsSeen: string[];

  cluesFound: string[];
  resolvedGoalStates: string[];
  choicesMade: string[];
  itemsHeld: string[];
  needsRecorded: { characterId: string; itemId: string }[];
  knowledgeTold: string[];
  // Per cast id: how often the player talked to them and which subjects were asked about. Ids only, never reply text.
  characterMemory: Record<string, CharacterMemory>;
  collectedEntities: string[]; // world entity ids already taken, so repeat pickups cannot duplicate
  summary: string;
  areasSinceSummary: number;
}

export function createStoryState(view: LengthView): StoryState {
  return {
    packId: view.storyId,
    packVersion: view.storyVersion,
    length: view.length,
    visitedAreas: [],
    truthsFound: [],
    truthsReady: [],
    herringsRuledOut: [],
    twistsSeen: [],
    cluesFound: [],
    resolvedGoalStates: [],
    choicesMade: [],
    itemsHeld: [],
    needsRecorded: [],
    knowledgeTold: [],
    characterMemory: {},
    collectedEntities: [],
    summary: "",
    areasSinceSummary: 0,
  };
}

export function hasItem(state: StoryState, itemId: string): boolean {
  return state.itemsHeld.includes(itemId);
}

// Adds an item once. Returns true only the first time, so repeat pickups cannot duplicate it.
export function giveItem(state: StoryState, itemId: string): boolean {
  if (hasItem(state, itemId)) return false;
  state.itemsHeld.push(itemId);
  return true;
}

export function isResolved(state: StoryState, goalStateId: string): boolean {
  return state.resolvedGoalStates.includes(goalStateId);
}

export function addResolvedGoalState(state: StoryState, goalStateId: string): boolean {
  if (isResolved(state, goalStateId)) return false;
  state.resolvedGoalStates.push(goalStateId);
  return true;
}

export function hasCollected(state: StoryState, entityId: string): boolean {
  return state.collectedEntities.includes(entityId);
}

export function markCollected(state: StoryState, entityId: string): boolean {
  if (hasCollected(state, entityId)) return false;
  state.collectedEntities.push(entityId);
  return true;
}

// Returns true when the area was not visited before.
export function markVisited(state: StoryState, locationId: string): boolean {
  if (state.visitedAreas.includes(locationId)) return false;
  state.visitedAreas.push(locationId);
  state.areasSinceSummary += 1;
  return true;
}

export function addTruth(state: StoryState, truthId: string): boolean {
  if (state.truthsFound.includes(truthId)) return false;
  state.truthsFound.push(truthId);
  return true;
}

export function markClueFound(state: StoryState, clueId: string): boolean {
  if (state.cluesFound.includes(clueId)) return false;
  state.cluesFound.push(clueId);
  return true;
}

export function rememberNeed(state: StoryState, characterId: string, itemId: string): boolean {
  if (state.needsRecorded.some((need) => need.characterId === characterId && need.itemId === itemId)) return false;
  state.needsRecorded.push({ characterId, itemId });
  return true;
}

export function subjectKey(subject: { type: string; id: string }): string {
  return `${subject.type}:${subject.id}`;
}

export function characterMemoryFor(state: StoryState, characterId: string): CharacterMemory {
  return state.characterMemory[characterId] ?? { visits: 0, askedAbout: [] };
}

export function recordVisit(state: StoryState, characterId: string): void {
  const memory = characterMemoryFor(state, characterId);
  state.characterMemory[characterId] = { ...memory, visits: memory.visits + 1 };
}

export function rememberAskedAbout(state: StoryState, characterId: string, subject: { type: string; id: string }): boolean {
  const memory = characterMemoryFor(state, characterId);
  const key = subjectKey(subject);
  if (memory.askedAbout.includes(key)) return false;
  state.characterMemory[characterId] = { ...memory, askedAbout: [...memory.askedAbout, key] };
  return true;
}

export function rememberKnowledge(state: StoryState, characterId: string, knowledgeId: string): boolean {
  const key = `${characterId}:${knowledgeId}`;
  if (state.knowledgeTold.includes(key)) return false;
  state.knowledgeTold.push(key);
  return true;
}

export function grantTruthsFromFoundClues(pack: StoryPack, state: StoryState): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const clue of pack.clues) {
      if (!state.cluesFound.includes(clue.id) || !clue.truth_id || state.truthsFound.includes(clue.truth_id)) continue;
      const truth = pack.truths.find((candidate) => candidate.id === clue.truth_id);
      if (!truth || !truth.depends_on.every((id) => state.truthsFound.includes(id))) continue;
      if (!truth.deduction || isAssistedDeductions()) {
        confirmTruth(state, truth);
        changed = true;
      } else if (!state.truthsReady.includes(truth.id)) {
        state.truthsReady.push(truth.id);
        changed = true;
      }
    }
  }
}

// Confirms a truth and settles the red herrings its deduction rules out.
export function confirmTruth(state: StoryState, truth: Truth): void {
  addTruth(state, truth.id);
  state.truthsReady = state.truthsReady.filter((id) => id !== truth.id);
  for (const herringId of truth.deduction?.rules_out ?? []) {
    if (!state.herringsRuledOut.includes(herringId)) state.herringsRuledOut.push(herringId);
  }
}


export function summaryDue(state: StoryState): boolean {
  return state.areasSinceSummary >= SUMMARY_EVERY_AREAS;
}
