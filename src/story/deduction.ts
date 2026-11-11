import type { LengthView } from "./loader";
import { isRequirementMet } from "./requirements";
import { confirmTruth, grantTruthsFromFoundClues } from "./state";
import type { StoryState } from "./state";
import type { Ending, RedHerring, StoryPack, Truth, Twist } from "./types";

// Truths whose evidence is in and that wait for the player's answer.
export function openDeductions(pack: StoryPack, state: StoryState): Truth[] {
  return pack.truths.filter((truth) =>
    truth.deduction !== undefined && state.truthsReady.includes(truth.id) && !state.truthsFound.includes(truth.id));
}

export interface DeductionAnswer {
  correct: boolean;
  ruledOut: RedHerring[]; // red herrings newly settled by this answer
}

// Code decides the outcome. A wrong answer changes nothing; a right one confirms the truth.
export function answerDeduction(pack: StoryPack, state: StoryState, truthId: string, answer: string): DeductionAnswer {
  const truth = pack.truths.find((candidate) => candidate.id === truthId);
  if (!truth?.deduction || !state.truthsReady.includes(truthId) || state.truthsFound.includes(truthId)) {
    return { correct: false, ruledOut: [] };
  }
  if (answer !== truth.deduction.answer) return { correct: false, ruledOut: [] };
  const before = new Set(state.herringsRuledOut);
  confirmTruth(state, truth);
  grantTruthsFromFoundClues(pack, state);
  const ruledOut = pack.red_herrings.filter((herring) =>
    state.herringsRuledOut.includes(herring.id) && !before.has(herring.id));
  return { correct: true, ruledOut };
}

export function ruledOutHerrings(pack: StoryPack, state: StoryState): RedHerring[] {
  return pack.red_herrings.filter((herring) => state.herringsRuledOut.includes(herring.id));
}

// The clues the player has already found for a truth, shown as evidence under its question.
export function evidenceFor(pack: StoryPack, state: StoryState, truthId: string): string[] {
  return pack.clues
    .filter((clue) => clue.truth_id === truthId && state.cluesFound.includes(clue.id))
    .map((clue) => clue.text);
}

// A stable pseudo-random order so buttons do not jump around when the casebook re-renders.
export function stableShuffle<T>(items: readonly T[], seed: string, key: (item: T) => string): T[] {
  const hash = (text: string): number => {
    let value = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      value = Math.imul(value ^ text.charCodeAt(index), 16777619) >>> 0;
    }
    return value;
  };
  return [...items].sort((a, b) => hash(`${seed}:${key(a)}`) - hash(`${seed}:${key(b)}`) || key(a).localeCompare(key(b)));
}

export function deductionOptions(truth: Truth): string[] {
  if (!truth.deduction) return [];
  return stableShuffle([truth.deduction.answer, ...truth.deduction.wrong_answers], truth.id, (text) => text);
}

// Twists whose payoff has just become true. Each is returned once and then remembered.
export function collectTwistReveals(pack: StoryPack, view: LengthView, state: StoryState): Twist[] {
  const reveals: Twist[] = [];
  for (const twistId of view.definition.twists) {
    const twist = pack.twists.find((candidate) => candidate.id === twistId);
    if (!twist || state.twistsSeen.includes(twist.id) || !isRequirementMet(twist.payoff_trigger, state)) continue;
    state.twistsSeen.push(twist.id);
    reveals.push(twist);
  }
  return reveals;
}

export interface SummationQuestion {
  question: string;
  truthId: string;
}

// The summation for the finale: the most specific ending whose facts are met and that defines one.
export function pickSummation(endings: readonly Ending[]): SummationQuestion[] | null {
  const specificity = (ending: Ending): number =>
    ending.conditions.truths.length + ending.conditions.goal_states.length + ending.conditions.choices.length;
  const ending = endings
    .filter((candidate) => (candidate.summation?.length ?? 0) > 0)
    .sort((a, b) => specificity(b) - specificity(a))[0];
  return ending?.summation?.map((entry) => ({ question: entry.question, truthId: entry.truth_id })) ?? null;
}

export function summationOptions(pack: StoryPack, state: StoryState): { id: string; text: string }[] {
  const confirmed = pack.truths
    .filter((truth) => state.truthsFound.includes(truth.id))
    .map((truth) => ({ id: truth.id, text: truth.text }));
  return stableShuffle(confirmed, "summation", (option) => option.id);
}
