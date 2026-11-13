// Evidence-backed answers. The player picks a conclusion and shows up to PROOF_SLOTS items and clues; code
// decides the outcome. Nothing here depends on the model.

import { PROOF_SLOTS } from "./config";
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
