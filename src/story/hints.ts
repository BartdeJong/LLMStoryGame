// Journal hints: a vague nudge and a clearer one for what the player is stuck on. Pure and derived from state and
// the pack; nothing here depends on the model. Hints never point into beats that are still closed.

import { openDeductions } from "./deduction";
import type { LengthView } from "./loader";
import { describeMissing } from "./locks";
import { isRequirementMet } from "./requirements";
import { caseRecordOf, leadsOf } from "./state";
import type { StoryState } from "./state";
import { isStatementBroken, statementForClue } from "./statements";
import type { Clue, SourceRef, StoryPack } from "./types";

export interface Hint {
  key: string; // what the hint is about; "<key>#1" and "<key>#2" are remembered in the save
  vague: string;
  clear: string;
}

// Changes whenever the player makes progress of any kind, so the "stuck" timer knows when to start over.
export function progressMark(state: StoryState, beatIndex: number): string {
  return [
    state.cluesFound.length,
    state.truthsFound.length,
    state.truthsReady.length,
    state.visitedAreas.length,
    leadsOf(state).length,
    state.itemsHeld.length,
    state.resolvedGoalStates.length,
    caseRecordOf(state).deductions.length,
    caseRecordOf(state).summation.length,
    caseRecordOf(state).challenges.length,
    (state.statementsHeard ?? []).length,
    beatIndex,
  ].join(":");
}

export function hintFor(
  pack: StoryPack,
  view: LengthView,
  state: StoryState,
  beatIndex: number,
  isOpen: (locationId: string) => boolean,
): Hint | null {
  const beat = view.beats[beatIndex];
  if (!beat) return null;
  const fallback = beat.guidance ?? `Your goal: ${beat.objective ?? beat.title}`;

  const [open] = openDeductions(pack, state);
  if (open?.deduction) {
    return {
      key: `question:${open.id}`,
      vague: "You know enough to answer a question in your journal.",
      clear: `Answer the question in your journal: ${open.deduction.question}`,
    };
  }

  const req = beat.must_find;
  const goalId = (req.goal_states ?? []).find((id) => !state.resolvedGoalStates.includes(id));
  if (goalId) {
    return { key: `${beat.id}:goal:${goalId}`, vague: fallback, clear: describeMissing(pack, state, { goal_states: [goalId] }).line };
  }
  const itemId = (req.items ?? []).find((id) => !state.itemsHeld.includes(id));
  if (itemId) {
    return { key: `${beat.id}:item:${itemId}`, vague: fallback, clear: describeMissing(pack, state, { items: [itemId] }).line };
  }
  const truthId = (req.truths ?? []).find((id) => !state.truthsFound.includes(id));
  if (truthId) {
    return { key: `${beat.id}:truth:${truthId}`, vague: fallback, clear: truthHint(pack, state, truthId, isOpen) ?? fallback };
  }

  if (beatIndex === view.beats.length - 1) {
    const places = beat.locations.map((id) => pack.locations.find((location) => location.id === id)?.name ?? id);
    return {
      key: "finale",
      vague: "Everything is in place for the end.",
      clear: `Go to ${places.join(", ")} and present your case.`,
    };
  }
  return null;
}

// The clearest next step toward a missing truth: an unfound clue whose source can be reached now.
function truthHint(pack: StoryPack, state: StoryState, truthId: string, isOpen: (locationId: string) => boolean): string | null {
  const truth = pack.truths.find((candidate) => candidate.id === truthId);
  if (!truth) return null;
  const sourceOpen = (source: SourceRef): boolean => source.type === "location"
    ? isOpen(source.id)
    : isOpen(pack.cast.find((member) => member.id === source.id)?.home_location ?? "");
  const candidates: Clue[] = [
    ...truth.revealed_by.flatMap((id) => pack.clues.find((clue) => clue.id === id) ?? []),
    ...pack.clues.filter((clue) => clue.truth_id === truthId && !truth.revealed_by.includes(clue.id)),
  ];
  for (const clue of candidates) {
    if (state.cluesFound.includes(clue.id)) continue;
    const source = [clue.where, ...clue.alternatives].find(sourceOpen);
    if (!source) continue;
    if (!isRequirementMet(clue.requirements, state)) return describeMissing(pack, state, clue.requirements).line;
    if (source.type === "character") {
      const member = pack.cast.find((candidate) => candidate.id === source.id);
      if (!member) continue;
      const statement = statementForClue(pack, member.id, clue.id);
      return statement && !isStatementBroken(state, statement.id)
        ? `${member.name} has not told you everything about "${statement.topic}". Challenge them with evidence.`
        : `${member.name} may know something that explains this.`;
    }
    const place = pack.locations.find((location) => location.id === source.id);
    const object = clue.object_id ? place?.objects.find((candidate) => candidate.id === clue.object_id) : undefined;
    return object && place ? `Look closely at the ${object.name} in ${place.name}.` : `Something in ${place?.name ?? "that place"} may explain this.`;
  }
  return null;
}
