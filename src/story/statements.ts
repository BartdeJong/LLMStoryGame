// Statements: things a character claims that are false or leave out the important part. Code decides when
// a statement can be heard, whether a piece of evidence breaks it and what the admission reveals; the
// model only phrases the cover story and, after the break, the admission.

import { isAssistedDeductions } from "./assist";
import { isRequirementMet } from "./requirements";
import { caseRecordOf, grantTruthsFromFoundClues, markClueFound } from "./state";
import type { StoryState } from "./state";
import type { CastMember, KnowledgeItem, LengthDefinition, Statement, StatementEvidence, StoryPack, SubjectRef } from "./types";

export const STATEMENT_FACT_PREFIX = "statement:";

export type EvidenceRef = SubjectRef & { type: "item" | "clue" };

export interface StatementRef {
  character: CastMember;
  statement: Statement;
}

export function statementsOf(character: CastMember): Statement[] {
  return character.statements ?? [];
}

export function findStatement(pack: StoryPack, statementId: string): StatementRef | undefined {
  for (const character of pack.cast) {
    const statement = statementsOf(character).find((candidate) => candidate.id === statementId);
    if (statement) return { character, statement };
  }
  return undefined;
}

export function evidenceList(evidence: StatementEvidence): EvidenceRef[] {
  return [
    ...(evidence.items ?? []).map((id): EvidenceRef => ({ type: "item", id })),
    ...(evidence.clues ?? []).map((id): EvidenceRef => ({ type: "clue", id })),
  ];
}

export function isStatementHeard(state: StoryState, statementId: string): boolean {
  return (state.statementsHeard ?? []).includes(statementId);
}

export function isStatementBroken(state: StoryState, statementId: string): boolean {
  return caseRecordOf(state).challenges.some((entry) => entry.statementId === statementId && entry.fits);
}

// Returns true the first time the statement is heard.
export function markStatementHeard(state: StoryState, statementId: string): boolean {
  state.statementsHeard ??= [];
  if (state.statementsHeard.includes(statementId)) return false;
  state.statementsHeard.push(statementId);
  return true;
}

export function canHearStatement(state: StoryState, statement: Statement): boolean {
  return isRequirementMet(statement.requires, state);
}

// The statements a player can challenge this character on: heard and still standing.
export function challengeableStatements(state: StoryState, character: CastMember): Statement[] {
  return statementsOf(character).filter((statement) =>
    isStatementHeard(state, statement.id) && !isStatementBroken(state, statement.id));
}

// What the character may say about a statement's topic, as a knowledge item for retrieval: the cover story
// while it stands, the admission once it is broken. Never the admission before the break.
export function statementFacts(state: StoryState, character: CastMember): KnowledgeItem[] {
  return statementsOf(character).flatMap((statement): KnowledgeItem[] => {
    const broken = isStatementBroken(state, statement.id);
    if (!broken && !canHearStatement(state, statement)) return [];
    return [{
      id: `${STATEMENT_FACT_PREFIX}${statement.id}`,
      topic: statement.topic,
      ask: statement.ask,
      text: broken ? statement.admission : statement.text,
      keywords: statement.keywords,
    }];
  });
}

export function statementIdOfFact(factId: string): string | undefined {
  return factId.startsWith(STATEMENT_FACT_PREFIX) ? factId.slice(STATEMENT_FACT_PREFIX.length) : undefined;
}

export function holdsEvidence(state: StoryState, evidence: EvidenceRef): boolean {
  return evidence.type === "item" ? state.itemsHeld.includes(evidence.id) : state.cluesFound.includes(evidence.id);
}

export function evidenceFits(statement: Statement, evidence: EvidenceRef): boolean {
  return evidenceList(statement.broken_by).some((entry) => entry.type === evidence.type && entry.id === evidence.id);
}

// A clue that this character only reveals by admitting the truth.
export function statementForClue(pack: StoryPack, characterId: string, clueId: string): Statement | undefined {
  const character = pack.cast.find((member) => member.id === characterId);
  return character ? statementsOf(character).find((statement) => statement.clue_id === clueId) : undefined;
}

export interface ChallengeResult {
  fits: boolean;
  statement: Statement;
  revealedClue: string | null;
}

// Code decides the challenge. A fitting piece of evidence breaks the statement and reveals its clue; one that
// does not fit is recorded as a miss (except in assisted mode). Throws when the challenge is not allowed.
export function challengeStatement(
  pack: StoryPack,
  state: StoryState,
  character: CastMember,
  statementId: string,
  evidence: EvidenceRef,
): ChallengeResult {
  const statement = statementsOf(character).find((candidate) => candidate.id === statementId);
  if (!statement) throw new Error(`${character.name} made no statement "${statementId}".`);
  if (!isStatementHeard(state, statement.id)) throw new Error("The player has not heard that statement.");
  if (isStatementBroken(state, statement.id)) throw new Error("That statement is already broken.");
  if (!holdsEvidence(state, evidence)) throw new Error("The player does not have that evidence.");
  const fits = evidenceFits(statement, evidence);
  const record = caseRecordOf(state);
  if (fits || !isAssistedDeductions()) {
    record.challenges.push({ statementId: statement.id, evidence: { type: evidence.type, id: evidence.id }, fits });
  }
  let revealedClue: string | null = null;
  if (fits && statement.clue_id && pack.clues.some((clue) => clue.id === statement.clue_id)) {
    if (markClueFound(state, statement.clue_id)) revealedClue = statement.clue_id;
    grantTruthsFromFoundClues(pack, state);
  }
  return { fits, statement, revealedClue };
}

// The statements of a length: those of its cast.
export function lengthStatements(pack: StoryPack, definition: LengthDefinition): StatementRef[] {
  const cast = new Set(definition.cast);
  return pack.cast
    .filter((member) => cast.has(member.id))
    .flatMap((character) => statementsOf(character).map((statement) => ({ character, statement })));
}
