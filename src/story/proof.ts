// Evidence-backed answers. The player picks a conclusion and shows up to PROOF_SLOTS items and clues; code
// decides the outcome. Nothing here depends on the model.

import { EVIDENCE_OPTIONS, PROOF_SLOTS } from "./config";
import { stableShuffle } from "./deduction";
import type { LengthView } from "./loader";
import { evidenceList, holdsEvidence } from "./statements";
import type { EvidenceRef } from "./statements";
import type { AnswerOutcome, StoryState } from "./state";
import type { Proof, StoryPack } from "./types";

// Every piece the author lists as backing the answer.
export function proofPieces(proof?: Proof): EvidenceRef[] {
  return proof ? evidenceList(proof) : [];
}

// How many relevant pieces must be shown: 0 without a proof, otherwise `required` (default 1) but never more
// than the pieces listed.
export function requiredCount(proof?: Proof): number {
  if (!proof) return 0;
  return Math.min(proof.required ?? 1, proofPieces(proof).length);
}

// What the player really shows: only pieces they hold, each once, at most PROOF_SLOTS.
export function sanitizeShown(state: StoryState, shown: readonly EvidenceRef[]): EvidenceRef[] {
  const result: EvidenceRef[] = [];
  for (const piece of shown) {
    if (!holdsEvidence(state, piece)) continue;
    if (result.some((entry) => entry.type === piece.type && entry.id === piece.id)) continue;
    result.push({ type: piece.type, id: piece.id });
  }
  return result.slice(0, PROOF_SLOTS);
}

// Pieces outside the proof list are ignored without penalty. Without a proof the answer is judged alone.
export function judgeAnswer(correct: boolean, proof: Proof | undefined, shown: readonly EvidenceRef[]): AnswerOutcome {
  if (!proof) return correct ? "proven" : "wrong";
  const listed = proofPieces(proof);
  const relevant = new Set(
    shown.filter((piece) => listed.some((entry) => entry.type === piece.type && entry.id === piece.id))
      .map((piece) => `${piece.type}:${piece.id}`),
  );
  if (correct) return relevant.size >= requiredCount(proof) ? "proven" : "unproven";
  return relevant.size > 0 ? "misread" : "wrong";
}

export interface ProofChoice {
  ref: EvidenceRef;
  label: string;
  group: "item" | "clue";
}

// What the player can show right now: items held, then clues found. Labels are the item name or the clue text.
export function proofChoices(pack: StoryPack, state: StoryState): ProofChoice[] {
  const items = state.itemsHeld.flatMap((id): ProofChoice[] => {
    const item = pack.items.find((candidate) => candidate.id === id);
    return item ? [{ ref: { type: "item", id }, label: item.name, group: "item" }] : [];
  });
  const clues = state.cluesFound.flatMap((id): ProofChoice[] => {
    const clue = pack.clues.find((candidate) => candidate.id === id);
    return clue ? [{ ref: { type: "clue", id }, label: clue.text, group: "clue" }] : [];
  });
  return [...items, ...clues];
}

const refKey = (ref: EvidenceRef): string => `${ref.type}:${ref.id}`;

// A short, believable list for an evidence picker instead of everything held: the held pieces that really back the
// answer (`correct`) plus distractors from what else is held, at least EVIDENCE_OPTIONS.minDistractors of them
// whenever that many are held. Distractors that look related (setup clues of red herrings and twists, or clues of
// the same or a prerequisite truth) come first. Only held pieces are ever returned; the choice is deterministic for
// a seed. `required` pieces are always kept so the player can still meet the proof.
export function pickEvidenceOptions(
  pack: StoryPack,
  view: LengthView | undefined,
  state: StoryState,
  heldPieces: readonly EvidenceRef[],
  correct: readonly EvidenceRef[],
  seed: string,
  required = 1,
): EvidenceRef[] {
  const held = heldPieces.filter((piece) => holdsEvidence(state, piece));
  const correctKeys = new Set(correct.map(refKey));
  const heldCorrect = stableShuffle(held.filter((piece) => correctKeys.has(refKey(piece))), `${seed}:correct`, refKey)
    .slice(0, Math.max(required, EVIDENCE_OPTIONS.size - EVIDENCE_OPTIONS.minDistractors));
  const rest = held.filter((piece) => !correctKeys.has(refKey(piece)));

  const herringIds = new Set(view?.definition.red_herrings ?? pack.red_herrings.map((herring) => herring.id));
  const twistIds = new Set(view?.definition.twists ?? pack.twists.map((twist) => twist.id));
  const setupClues = new Set([
    ...pack.red_herrings.filter((herring) => herringIds.has(herring.id)).flatMap((herring) => herring.setup_clues),
    ...pack.twists.filter((twist) => twistIds.has(twist.id)).flatMap((twist) => twist.setup_clues),
  ]);
  const relatedTruths = new Set<string>();
  for (const piece of correct) {
    const truthId = piece.type === "clue" ? pack.clues.find((clue) => clue.id === piece.id)?.truth_id : undefined;
    if (!truthId) continue;
    relatedTruths.add(truthId);
    for (const id of pack.truths.find((truth) => truth.id === truthId)?.depends_on ?? []) relatedTruths.add(id);
  }
  const related = (piece: EvidenceRef): boolean => {
    if (piece.type !== "clue") return false;
    const clue = pack.clues.find((candidate) => candidate.id === piece.id);
    return setupClues.has(piece.id) || (clue?.truth_id !== undefined && relatedTruths.has(clue.truth_id));
  };
  const tierA = stableShuffle(rest.filter(related), `${seed}:a`, refKey);
  const tierB = stableShuffle(rest.filter((piece) => !related(piece)), `${seed}:b`, refKey);

  const total = Math.max(EVIDENCE_OPTIONS.size, required + EVIDENCE_OPTIONS.minDistractors);
  const distractors = [...tierA, ...tierB].slice(0, Math.max(0, total - heldCorrect.length));
  return [...heldCorrect, ...distractors];
}
