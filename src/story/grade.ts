// The case grade shown on the ending screen: how much of the case the player found and answered, from state alone.
// Pure; nothing here depends on the model.

import { GRADE } from "./config";
import { stableShuffle } from "./deduction";
import type { LengthView } from "./loader";
import { caseRecordOf, hintsOf } from "./state";
import type { StoryState } from "./state";
import { lengthStatements, isStatementBroken } from "./statements";
import type { Clue, StoryPack } from "./types";

export interface CaseGrade {
  cluesFound: number;
  cluesTotal: number;
  deductionsRight: number; // right conclusions among the answered deductions
  deductionsAnswered: number;
  deductionsTotal: number;
  wrongAnswers: number; // wrong or misread, deductions and finale together
  missedChallenges: number;
  hintsUsed: number;
  missed: string[]; // up to MAX_MISSED lines about what the player never found
  score: number; // 0..100
  title: string;
  assisted: boolean;
}

const MAX_MISSED = 3;
const MAX_CLUE_CHARS = 90;

// The clues of this length: those found at one of its places or with one of its people (the main source or an alternative).
export function lengthClues(pack: StoryPack, view: LengthView): Clue[] {
  const places = new Set(view.locations.map((location) => location.id));
  const cast = new Set(view.cast.map((member) => member.id));
  return pack.clues.filter((clue) => [clue.where, ...clue.alternatives].some((source) =>
    (source.type === "location" ? places : cast).has(source.id)));
}

function truncate(text: string): string {
  return text.length <= MAX_CLUE_CHARS ? text : `${text.slice(0, MAX_CLUE_CHARS - 1).trimEnd()}…`;
}

function sourceName(pack: StoryPack, clue: Clue): string {
  const locationName = (id: string): string => pack.locations.find((location) => location.id === id)?.name ?? id;
  if (clue.where.type === "character") return pack.cast.find((member) => member.id === clue.where.id)?.name ?? clue.where.id;
  const place = locationName(clue.where.id);
  const object = clue.object_id
    ? pack.locations.flatMap((location) => location.objects).find((candidate) => candidate.id === clue.object_id)
    : undefined;
  return object ? `${object.name} in ${place}` : place;
}

export function buildGrade(pack: StoryPack, view: LengthView, state: StoryState): CaseGrade {
  const record = caseRecordOf(state);
  const clues = lengthClues(pack, view);
  const found = clues.filter((clue) => state.cluesFound.includes(clue.id));
  const missedClues = clues.filter((clue) => !state.cluesFound.includes(clue.id));

  const asked = [...view.coreTruths, ...view.sideTruths].filter((truth) => truth.deduction !== undefined);
  const askedIds = new Set(asked.map((truth) => truth.id));
  const deductions = record.deductions.filter((entry) => askedIds.has(entry.truthId));
  const answers = [...record.deductions, ...record.summation];
  const wrongAnswers = answers.filter((entry) => entry.outcome === "wrong" || entry.outcome === "misread").length;
  const missedChallenges = record.challenges.filter((entry) => !entry.fits).length;
  const hintsUsed = hintsOf(state).length;

  // What was never found: core-truth clues first, then side truths, then the clues that set up herrings and twists.
  const coreIds = new Set(view.coreTruths.map((truth) => truth.id));
  const sideIds = new Set(view.sideTruths.map((truth) => truth.id));
  const rank = (clue: Clue): number => (clue.truth_id && coreIds.has(clue.truth_id) ? 0 : clue.truth_id && sideIds.has(clue.truth_id) ? 1 : 2);
  const ordered = [0, 1, 2].flatMap((tier) => stableShuffle(missedClues.filter((clue) => rank(clue) === tier), "grade", (clue) => clue.id));
  const missed = ordered.slice(0, 2).map((clue) => `You never found: "${truncate(clue.text)}" (${sourceName(pack, clue)})`);
  if (missed.length < MAX_MISSED) {
    const standing = stableShuffle(
      lengthStatements(pack, view.definition).filter(({ statement }) => !isStatementBroken(state, statement.id)),
      "grade", ({ statement }) => statement.id,
    )[0];
    if (standing) missed.push(`${standing.character.name}'s claim about "${standing.statement.topic}" was never broken.`);
  }
  // Room left after the standing statement: more clues.
  for (const clue of ordered.slice(2)) {
    if (missed.length >= MAX_MISSED) break;
    missed.push(`You never found: "${truncate(clue.text)}" (${sourceName(pack, clue)})`);
  }

  const clueShare = clues.length === 0 ? 1 : found.length / clues.length;
  const proven = answers.filter((entry) => entry.outcome === "proven").length;
  const unproven = answers.filter((entry) => entry.outcome === "unproven").length;
  const rightShare = answers.length === 0 ? 1 : (proven + 0.5 * unproven) / answers.length;
  const assisted = record.assisted;
  const raw = assisted
    ? 100 * clueShare
    : 100 * (GRADE.clueWeight * clueShare + GRADE.answerWeight * rightShare) - Math.min(hintsUsed * GRADE.hintPenalty, GRADE.maxHintPenalty);
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  const title = assisted ? "Assisted case" : (GRADE.tiers.find((tier) => score >= tier.min)?.title ?? GRADE.tiers[GRADE.tiers.length - 1]!.title);

  return {
    cluesFound: found.length,
    cluesTotal: clues.length,
    deductionsRight: deductions.filter((entry) => entry.correct).length,
    deductionsAnswered: deductions.length,
    deductionsTotal: asked.length,
    wrongAnswers,
    missedChallenges,
    hintsUsed,
    missed,
    score,
    title,
    assisted,
  };
}
