// The case record turned into a result, and the finale's one-pass summation. Code decides; nothing here
// depends on the model.

import { isAssistedDeductions } from "./assist";
import { CASE_RESULT } from "./config";
import type { SummationQuestion } from "./deduction";
import { judgeAnswer, sanitizeShown } from "./proof";
import { caseRecordOf } from "./state";
import type { AnswerOutcome, CaseRecord, StoryState } from "./state";
import type { EvidenceRef } from "./statements";
import type { Ending, FlawedEnding, StoryPack } from "./types";

export type CaseResultKind = "clean" | "mistakes" | "flawed" | "assisted";

export interface CaseResult {
  kind: CaseResultKind;
  mistakes: number; // wrong, misread and unproven answers plus failed challenges (unweighted)
  share: number; // weighted share of mistakes, 0..1
}

export function caseResult(record: CaseRecord, thresholds = CASE_RESULT): CaseResult {
  const answered = [...record.deductions, ...record.summation];
  const wrongAnswers = answered.filter((entry) => entry.outcome === "wrong" || entry.outcome === "misread").length;
  const unproven = answered.filter((entry) => entry.outcome === "unproven").length;
  const answers = answered.length;
  const missedChallenges = record.challenges.filter((entry) => !entry.fits).length;
  const mistakes = wrongAnswers + unproven + missedChallenges;
  const weightedTotal = answers + thresholds.challengeWeight * record.challenges.length;
  const weightedMistakes = wrongAnswers + thresholds.unprovenWeight * unproven + thresholds.challengeWeight * missedChallenges;
  const share = weightedTotal === 0 ? 0 : weightedMistakes / weightedTotal;
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

// How a summation answer would be judged, without recording anything (the assisted finale uses this).
export function judgeSummation(
  state: StoryState,
  question: SummationQuestion,
  answerTruthId: string,
  evidence: readonly EvidenceRef[] = [],
): AnswerOutcome {
  return judgeAnswer(answerTruthId === question.truthId, question.proof, sanitizeShown(state, evidence));
}

// Records the player's one answer to a summation question and returns how it turned out. A second answer to the
// same question is ignored (null).
export function answerSummation(
  state: StoryState,
  question: SummationQuestion,
  answerTruthId: string,
  evidence: readonly EvidenceRef[] = [],
): AnswerOutcome | null {
  const record = caseRecordOf(state);
  if (record.summation.some((entry) => entry.truthId === question.truthId)) return null;
  const shown = sanitizeShown(state, evidence);
  const correct = answerTruthId === question.truthId;
  const outcome = judgeAnswer(correct, question.proof, shown);
  record.summation.push({ truthId: question.truthId, answerId: answerTruthId, correct, outcome, evidence: shown });
  return outcome;
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
  correct: boolean; // the conclusion was right
  outcome: AnswerOutcome;
  shown: string[]; // labels of the evidence the player showed
  hadProof: boolean; // the question had an authored proof; without one a right answer is just right
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
  const shownLabels = (evidence: readonly EvidenceRef[]): string[] => evidence.map((piece) =>
    (piece.type === "item" ? pack.items.find((item) => item.id === piece.id)?.name : pack.clues.find((clue) => clue.id === piece.id)?.text) ?? piece.id);
  const deductions = record.deductions.flatMap((entry): RecapAnswer[] => {
    const truth = pack.truths.find((candidate) => candidate.id === entry.truthId);
    if (!truth?.deduction) return [];
    return [{ question: truth.deduction.question, answer: entry.answer, correctAnswer: truth.deduction.answer, correct: entry.correct, outcome: entry.outcome, shown: shownLabels(entry.evidence), hadProof: truth.deduction.proof !== undefined, kind: "deduction" }];
  });
  const summation = record.summation.map((entry): RecapAnswer => {
    const fromQuestions = summationQuestions.find((question) => question.truthId === entry.truthId);
    const fromEndings = pack.endings.flatMap((ending) => ending.summation ?? []).find((question) => question.truth_id === entry.truthId);
    const authored = fromQuestions?.question ?? fromEndings?.question ?? truthText(entry.truthId);
    const hadProof = (fromQuestions ? fromQuestions.proof : fromEndings?.proof) !== undefined;
    return { question: authored, answer: truthText(entry.answerId), correctAnswer: truthText(entry.truthId), correct: entry.correct, outcome: entry.outcome, shown: shownLabels(entry.evidence), hadProof, kind: "summation" };
  });
  return [...deductions, ...summation];
}
