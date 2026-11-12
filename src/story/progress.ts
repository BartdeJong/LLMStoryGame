import type { LengthView } from "./loader";
import { caseResult, CASE_RESULT_LABELS, recapAnswers, type CaseResultKind, type RecapAnswer, type RecapStatements } from "./caseRecord";
import type { SummationQuestion } from "./deduction";
import { caseRecordOf, progressLogOf, type StoryState } from "./state";
import { isStatementBroken, isStatementHeard, lengthStatements } from "./statements";
import type { StoryPack } from "./types";

export interface CaseProgress {
  truthsFound: number;
  truthsTotal: number; // core truths of this length
}

// How many of this length's core truths the player has confirmed.
export function caseProgress(view: LengthView, state: StoryState): CaseProgress {
  return {
    truthsFound: view.coreTruths.filter((truth) => state.truthsFound.includes(truth.id)).length,
    truthsTotal: view.coreTruths.length,
  };
}

export interface RecapTruth {
  text: string;
  core: boolean;
  clue?: string; // the clue that revealed it
}

export interface CaseRecap {
  truths: RecapTruth[]; // in the order the player confirmed them
  people: string[];
  items: string[];
  optionalCluesFound: number;
  optionalCluesTotal: number;
  result: { kind: CaseResultKind; label: string };
  answers: RecapAnswer[]; // every final answer, right or wrong
  statements: RecapStatements;
}

// "How you solved it": everything is derived from state, so old saves without a progress log still get a recap.
export function buildRecap(
  pack: StoryPack,
  view: LengthView,
  state: StoryState,
  summationQuestions: readonly SummationQuestion[] = [],
): CaseRecap {
  const log = progressLogOf(state);
  const inOrder = (kind: "truth" | "item", held: readonly string[]): { id: string; at?: number }[] => {
    const logged = log.filter((entry) => entry.kind === kind && held.includes(entry.id))
      .map((entry) => ({ id: entry.id, at: entry.at }));
    const seen = new Set(logged.map((entry) => entry.id));
    return [...logged, ...held.filter((id) => !seen.has(id)).map((id) => ({ id }))];
  };
  const clueTimes = new Map(log.filter((entry) => entry.kind === "clue").map((entry) => [entry.id, entry.at]));

  const truths: RecapTruth[] = inOrder("truth", state.truthsFound).flatMap(({ id, at }) => {
    const truth = pack.truths.find((candidate) => candidate.id === id);
    if (!truth) return [];
    const found = pack.clues.filter((clue) => clue.truth_id === id && state.cluesFound.includes(clue.id));
    const before = found.filter((clue) => at === undefined || (clueTimes.get(clue.id) ?? 0) <= at);
    const clue = (before.length > 0 ? before : found)
      .sort((a, b) => (clueTimes.get(a.id) ?? 0) - (clueTimes.get(b.id) ?? 0)).at(-1);
    return [{ text: truth.text, core: truth.importance === "core", ...(clue ? { clue: clue.text } : {}) }];
  });

  const people = view.cast
    .filter((member) => (state.characterMemory[member.id]?.visits ?? 0) > 0)
    .map((member) => member.name);
  const items = inOrder("item", state.itemsHeld)
    .flatMap(({ id }) => pack.items.find((item) => item.id === id)?.name ?? []);

  const record = caseRecordOf(state);
  const result = caseResult(record);
  const statements = lengthStatements(pack, view.definition);
  const sideIds = new Set(view.sideTruths.map((truth) => truth.id));
  const optional = pack.clues.filter((clue) => clue.truth_id !== undefined && sideIds.has(clue.truth_id));
  return {
    truths,
    people,
    items,
    optionalCluesFound: optional.filter((clue) => state.cluesFound.includes(clue.id)).length,
    optionalCluesTotal: optional.length,
    result: { kind: result.kind, label: CASE_RESULT_LABELS[result.kind] },
    answers: recapAnswers(pack, state, summationQuestions),
    statements: {
      broken: statements.filter(({ statement }) => isStatementBroken(state, statement.id)).length,
      standing: statements.filter(({ statement }) => !isStatementBroken(state, statement.id)).length,
      heardStanding: statements.filter(({ statement }) => isStatementHeard(state, statement.id) && !isStatementBroken(state, statement.id)).length,
      missedChallenges: record.challenges.filter((entry) => !entry.fits).length,
    },
  };
}

export function formatPlayTime(milliseconds: number): string {
  const minutes = Math.max(1, Math.round(milliseconds / 60000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
