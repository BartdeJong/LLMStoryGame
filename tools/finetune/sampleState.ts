import { createSeededRandom } from "../../src/art/random";
import { returnVisitFor } from "../../src/dialogue/askAbout";
import type { DialogueContext } from "../../src/dialogue/prompt";
import { isRequirementMet } from "../../src/story/requirements";
import type { LengthView } from "../../src/story/loader";
import { endingTitle } from "../../src/story/ending";
import { lockNotesFor } from "../../src/story/locks";
import {
  addResolvedGoalState,
  addTruth,
  createStoryState,
  giveItem,
  markClueFound,
  markVisited,
  recordVisit,
} from "../../src/story/state";
import type { StoryState } from "../../src/story/state";
import { canHearStatement, markStatementHeard, statementsOf } from "../../src/story/statements";
import type { CastMember, Requirement, StoryPack } from "../../src/story/types";

export { createSeededRandom };
export type Random = () => number;

export const ENDING_REACHED_CHANCE = 0.05;

export interface SampledState {
  state: StoryState;
  beatIndex: number; // index of the furthest open beat
  endingReached: boolean;
}

type Entry = { kind: "items" | "goal_states" | "truths"; id: string };

// Mirrors StorySession.openBeatCount (private there): the furthest beat whose predecessors' must_find hold.
export function openBeatCount(view: LengthView, state: StoryState): number {
  let open = 1;
  while (open < view.beats.length && isRequirementMet(view.beats[open - 1]?.must_find, state)) open += 1;
  return open;
}

function pickOne<T>(items: readonly T[], rng: Random): T | undefined {
  return items[Math.floor(rng() * items.length)];
}

function requirementEntries(req: Requirement | undefined): Entry[] {
  return [
    ...(req?.items ?? []).map((id): Entry => ({ kind: "items", id })),
    ...(req?.goal_states ?? []).map((id): Entry => ({ kind: "goal_states", id })),
    ...(req?.truths ?? []).map((id): Entry => ({ kind: "truths", id })),
  ];
}

function applyTruth(pack: StoryPack, state: StoryState, truthId: string): void {
  const truth = pack.truths.find((entry) => entry.id === truthId);
  if (!truth) return;
  for (const dependency of truth.depends_on) applyTruth(pack, state, dependency);
  addTruth(state, truthId);
  // The clues that confirm a truth were found along the way.
  for (const clue of pack.clues) if (clue.truth_id === truthId) markClueFound(state, clue.id);
}

function applyEntry(pack: StoryPack, view: LengthView, state: StoryState, entry: Entry): void {
  if (entry.kind === "items") giveItem(state, entry.id);
  else if (entry.kind === "truths") applyTruth(pack, state, entry.id);
  else {
    addResolvedGoalState(state, entry.id);
    const goal = view.cast.flatMap((member) => member.goal_states).find((candidate) => candidate.id === entry.id);
    for (const itemId of goal?.gives_items ?? []) giveItem(state, itemId);
  }
}

function applyBeats(pack: StoryPack, view: LengthView, state: StoryState, count: number): void {
  for (let index = 0; index < count; index += 1) {
    for (const entry of requirementEntries(view.beats[index]?.must_find)) applyEntry(pack, view, state, entry);
  }
}

// Picks a point in the story: beat k is the furthest open beat, every earlier must_find holds, and only part of
// beat k's must_find does. Random clues, heard statements, visited areas and visit counts come from open beats.
export function sampleStoryState(pack: StoryPack, view: LengthView, rng: Random): SampledState {
  const last = view.beats.length - 1;
  // A beat with an empty must_find opens the next one at once, so it can only be the furthest beat when it is the last.
  const candidates = view.beats.flatMap((beat, index) => (index === last || requirementEntries(beat.must_find).length > 0 ? [index] : []));
  const k = pickOne(candidates, rng) ?? last;
  const state = createStoryState(view);
  const epilogue = view.definition.epilogue;
  const endingReached = epilogue !== undefined && view.endings.length > 0 && rng() < ENDING_REACHED_CHANCE;

  applyBeats(pack, view, state, endingReached ? view.beats.length : k);
  if (!endingReached) {
    const entries = requirementEntries(view.beats[k]?.must_find);
    const keep = entries.filter(() => rng() < 0.5);
    // Never everything, unless this is the last beat: otherwise the next beat would open.
    const partial = k < last && keep.length === entries.length ? keep.slice(0, Math.max(0, keep.length - 1)) : keep;
    for (const entry of partial) applyEntry(pack, view, state, entry);
    if (k < last && openBeatCount(view, state) !== k + 1) {
      // A goal's items or a truth's prerequisites completed the beat after all: keep only the earlier beats.
      const fresh = createStoryState(view);
      applyBeats(pack, view, fresh, k);
      Object.assign(state, fresh);
    }
  }

  const open = new Set(view.beats.slice(0, openBeatCount(view, state)).flatMap((beat) => beat.locations));
  const lastShown = endingReached ? view.beats.length - 1 : k;
  markVisited(state, view.startLocation);
  view.beats.slice(0, lastShown + 1).forEach((beat, index) => {
    const chance = index === lastShown ? 0.5 : 0.85;
    for (const locationId of beat.locations) if (rng() < chance) markVisited(state, locationId);
  });
  const visited = new Set(state.visitedAreas);

  for (const clue of pack.clues) {
    const place = clue.where.type === "location" ? clue.where.id : pack.cast.find((member) => member.id === clue.where.id)?.home_location;
    if (!place || !open.has(place) || !visited.has(place) || !isRequirementMet(clue.requirements, state)) continue;
    const truthFound = !clue.truth_id || state.truthsFound.includes(clue.truth_id);
    if (truthFound && rng() < 0.35) markClueFound(state, clue.id);
  }
  for (const item of pack.items) {
    const place = item.found_at?.type === "location" ? item.found_at.id : undefined;
    if (place && open.has(place) && visited.has(place) && isRequirementMet(item.found_requires, state) && rng() < 0.3) giveItem(state, item.id);
  }
  for (const member of view.cast) {
    if (!open.has(member.home_location) || !visited.has(member.home_location)) continue;
    const visits = Math.floor(rng() * 3);
    for (let count = 0; count < visits; count += 1) recordVisit(state, member.id);
    for (const statement of statementsOf(member)) {
      if (canHearStatement(state, statement) && rng() < 0.3) markStatementHeard(state, statement.id);
    }
  }

  if (endingReached) {
    const ending = pickOne(view.endings, rng)!;
    for (const truthId of ending.conditions.truths) applyTruth(pack, state, truthId);
    for (const goalId of ending.conditions.goal_states) applyEntry(pack, view, state, { kind: "goal_states", id: goalId });
    state.endingReached = { endingId: ending.id, endingTitle: endingTitle(ending.id), scene: ending.scene_outline, epilogue: ending.epilogue_notes };
  }
  return { state, beatIndex: endingReached ? last : openBeatCount(view, state) - 1, endingReached };
}

// Who the player can be talking to: people at places they have been to (the epilogue cast after the ending).
export function pickCharacter(pack: StoryPack, view: LengthView, state: StoryState, rng: Random): CastMember {
  const epilogue = view.definition.epilogue;
  if (state.endingReached && epilogue) {
    const endingId = state.endingReached.endingId;
    const ids = epilogue.cast.filter((entry) => !entry.endings || entry.endings.includes(endingId)).map((entry) => entry.id);
    const member = pickOne(view.cast.filter((candidate) => ids.includes(candidate.id)), rng);
    if (member) return member;
  }
  const visited = new Set(state.visitedAreas);
  const here = view.cast.filter((member) => visited.has(member.home_location));
  const member = pickOne(here.length > 0 ? here : view.cast, rng);
  if (!member) throw new Error(`Story "${pack.identity.id}" has no cast.`);
  return member;
}

// Mirrors Game.buildDialogueContext (src/game.ts), with the pack's location in place of the area brief.
// Keep it in step with that function when the game's context changes.
export function buildContext(pack: StoryPack, view: LengthView, state: StoryState, character: CastMember): DialogueContext {
  const ending = state.endingReached;
  const epilogue = view.definition.epilogue;
  const afterEnding = ending !== undefined && epilogue !== undefined;
  const locationId = afterEnding ? epilogue.location : character.home_location;
  const location = pack.locations.find((entry) => entry.id === locationId);
  const open = openBeatCount(view, state);
  const beat = view.beats[open - 1];
  const inventory = (): { id: string; name: string }[] =>
    state.itemsHeld.flatMap((itemId) => {
      const item = pack.items.find((entry) => entry.id === itemId);
      return item ? [{ id: item.id, name: item.name }] : [];
    });
  return {
    locationName: location?.name ?? pack.identity.title,
    locationMood: location?.mood ?? pack.identity.tone,
    returnVisit: returnVisitFor(pack, state, character),
    storySummary: afterEnding ? `${ending.scene} ${ending.epilogue}` : state.summary,
    ...(afterEnding ? { afterEnding: true } : {}),
    // After the ending every confirmed truth is common knowledge.
    knownFacts: (afterEnding ? state.truthsFound : character.knows_truths)
      .filter((truthId) => state.truthsFound.includes(truthId))
      .flatMap((truthId) => {
        const truth = pack.truths.find((entry) => entry.id === truthId);
        return truth ? [{ id: truth.id, text: truth.text }] : [];
      }),
    knownTerms: [
      pack.identity.title,
      pack.identity.logline,
      beat?.title ?? "",
      beat?.objective ?? "",
      beat?.guidance ?? "",
      ...(location?.objects.map((object) => `${object.name} ${object.description}`) ?? []),
      ...pack.cast.filter((member) => member.home_location === locationId).map((member) => member.name),
      ...state.visitedAreas.flatMap((id) => pack.locations.find((entry) => entry.id === id)?.name ?? []),
    ],
    lockNotes: afterEnding ? [] : lockNotesFor(pack, view, state, character.id, (id) => {
      const index = view.beats.findIndex((entry) => entry.locations.includes(id));
      return index >= 0 && index < open;
    }),
    inventory: inventory(),
    getInventory: inventory,
  };
}
