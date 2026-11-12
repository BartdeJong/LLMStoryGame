// The case record turned into a result, and the finale's one-pass summation. Code decides; nothing here
// depends on the model.

import { isAssistedDeductions } from "./assist";
import { CASE_RESULT } from "./config";
import type { SummationQuestion } from "./deduction";
import { caseRecordOf } from "./state";
import type { CaseRecord, StoryState } from "./state";
import type { Ending, FlawedEnding, StoryPack } from "./types";

export type CaseResultKind = "clean" | "mistakes" | "flawed" | "assisted";

export interface CaseResult {
  kind: CaseResultKind;
  mistakes: number; // wrong answers plus failed challenges (unweighted)
  share: number; // weighted share of mistakes, 0..1
}

export function caseResult(record: CaseRecord, thresholds = CASE_RESULT): CaseResult {
  const wrongAnswers = record.deductions.filter((entry) => !entry.correct).length
    + record.summation.filter((entry) => !entry.correct).length;
  const answers = record.deductions.length + record.summation.length;
  const missedChallenges = record.challenges.filter((entry) => !entry.fits).length;
  const mistakes = wrongAnswers + missedChallenges;
  const weightedTotal = answers + thresholds.challengeWeight * record.challenges.length;
  const share = weightedTotal === 0 ? 0 : (wrongAnswers + thresholds.challengeWeight * missedChallenges) / weightedTotal;
  if (record.assisted) return { kind: "assisted", mistakes, share };
  const kind: CaseResultKind = mistakes === 0 ? "clean" : share >= thresholds.flawedShare ? "flawed" : "mistakes";
  return { kind, mistakes, share };
}

export const CASE_RESULT_LABELS: Record<CaseResultKind, string> = {
  clean: "A clean solve",
  mistakes: "Solved, with mistakes",
  flawed: "A flawed case",
  assisted: "An assisted case",
};

// The scene to play: the authored flawed variant when the case is flawed and the ending has one.
export function endingVariant(ending: Ending, result: CaseResult): FlawedEnding | null {
  return result.kind === "flawed" && ending.flawed ? ending.flawed : null;
}

// ---- the finale's summation: each question answered once, in order ----

// Index of the first question the player has not answered yet; questions.length when all are answered.
export function nextSummationIndex(state: StoryState, questions: readonly SummationQuestion[]): number {
  const answered = new Set(caseRecordOf(state).summation.map((entry) => entry.truthId));
  const index = questions.findIndex((question) => !answered.has(question.truthId));
  return index < 0 ? questions.length : index;
}

export function summationComplete(state: StoryState, questions: readonly SummationQuestion[]): boolean {
  return nextSummationIndex(state, questions) >= questions.length;
}

// Records the player's one answer to a summation question. A second answer to the same question is ignored.
export function answerSummation(state: StoryState, question: SummationQuestion, answerTruthId: string): boolean {
  const record = caseRecordOf(state);
  if (record.summation.some((entry) => entry.truthId === question.truthId)) return false;
  const correct = answerTruthId === question.truthId;
  record.summation.push({ truthId: question.truthId, answerId: answerTruthId, correct });
  return correct;
}

// Assisted mode keeps the old, stake-free finale: free retries and nothing recorded.
export function finaleHasStakes(): boolean {
  return !isAssistedDeductions();
}

export function markAssisted(state: StoryState): void {
  caseRecordOf(state).assisted = true;
}

export interface RecapAnswer {
  question: string;
  answer: string; // what the player chose
  correctAnswer: string;
  correct: boolean;
  kind: "deduction" | "summation";
}

export interface RecapStatements {
  broken: number;
  standing: number; // statements of this length that were not broken
  heardStanding: number; // of those, heard but never broken
  missedChallenges: number;
}

// Every final answer, in the order given, with what was right.
export function recapAnswers(pack: StoryPack, state: StoryState, summationQuestions: readonly SummationQuestion[] = []): RecapAnswer[] {
  const record = caseRecordOf(state);
  const truthText = (id: string): string => pack.truths.find((truth) => truth.id === id)?.text ?? id;
  const deductions = record.deductions.flatMap((entry): RecapAnswer[] => {
    const truth = pack.truths.find((candidate) => candidate.id === entry.truthId);
    if (!truth?.deduction) return [];
    return [{ question: truth.deduction.question, answer: entry.answer, correctAnswer: truth.deduction.answer, correct: entry.correct, kind: "deduction" }];
  });
  const summation = record.summation.map((entry): RecapAnswer => {
    const authored = summationQuestions.find((question) => question.truthId === entry.truthId)?.question
      ?? pack.endings.flatMap((ending) => ending.summation ?? []).find((question) => question.truth_id === entry.truthId)?.question
      ?? truthText(entry.truthId);
    return { question: authored, answer: truthText(entry.answerId), correctAnswer: truthText(entry.truthId), correct: entry.correct, kind: "summation" };
  });
  return [...deductions, ...summation];
}
