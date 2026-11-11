// "Ask about..." for any person, item or piece of evidence. Code decides what the character may say;
// the model only phrases the selection. Nothing here touches state.

import { nextGoalState } from "../story/goals";
import { isRequirementMet } from "../story/requirements";
import { characterMemoryFor, subjectKey } from "../story/state";
import type { StoryState } from "../story/state";
import type { CastMember, KnowledgeItem, Reaction, StoryPack, SubjectRef } from "../story/types";
import { availableKnowledge, retrieveKnowledge } from "./knowledge";
import type { RetrievedFact } from "./knowledge";

export const MAX_RETURN_TOPICS = 3;
const CLUE_LABEL_CHARS = 60;

export interface AskEntry {
  subject: SubjectRef;
  label: string;
  fresh: boolean; // this character has not been asked about it yet
}

export interface AskOptions {
  people: AskEntry[];
  items: AskEntry[];
  evidence: AskEntry[];
}

export type AskSource = "reaction" | "knowledge" | "relationship" | "need" | "deflection";

// What the character may say about the subject. Deflections carry no facts and never reach the model.
export interface AskResolution {
  source: AskSource;
  label: string;
  facts: RetrievedFact[];
  requestedItems: string[]; // items the character says they need
  reactionClueId?: string;
}

export function sameSubject(a: SubjectRef, b: SubjectRef): boolean {
  return a.type === b.type && a.id === b.id;
}

function clueLabel(text: string): string {
  return text.length > CLUE_LABEL_CHARS ? `${text.slice(0, CLUE_LABEL_CHARS - 1).trimEnd()}…` : text;
}

export function subjectLabel(pack: StoryPack, subject: SubjectRef): string | undefined {
  if (subject.type === "cast") return pack.cast.find((member) => member.id === subject.id)?.name;
  if (subject.type === "item") return pack.items.find((item) => item.id === subject.id)?.name;
  const clue = pack.clues.find((candidate) => candidate.id === subject.id);
  return clue ? clueLabel(clue.text) : undefined;
}

// People met, items held and clues found, so the player can only ask about what they know of.
export function askOptions(pack: StoryPack, state: StoryState, character: CastMember): AskOptions {
  const asked = new Set(characterMemoryFor(state, character.id).askedAbout);
  const entry = (subject: SubjectRef, label: string): AskEntry => ({ subject, label, fresh: !asked.has(subjectKey(subject)) });
  return {
    people: pack.cast
      .filter((member) => member.id !== character.id && characterMemoryFor(state, member.id).visits > 0)
      .map((member) => entry({ type: "cast", id: member.id }, member.name)),
    items: state.itemsHeld.flatMap((id) => {
      const item = pack.items.find((candidate) => candidate.id === id);
      return item ? [entry({ type: "item", id }, item.name)] : [];
    }),
    evidence: state.cluesFound.flatMap((id) => {
      const clue = pack.clues.find((candidate) => candidate.id === id);
      return clue ? [entry({ type: "clue", id }, clueLabel(clue.text))] : [];
    }),
  };
}

export function isAskable(pack: StoryPack, state: StoryState, subject: SubjectRef): boolean {
  if (subject.type === "cast") return pack.cast.some((member) => member.id === subject.id);
  if (subject.type === "item") return state.itemsHeld.includes(subject.id) && pack.items.some((item) => item.id === subject.id);
  return state.cluesFound.includes(subject.id) && pack.clues.some((clue) => clue.id === subject.id);
}

// A reaction is usable once its own requirements hold and, when it reveals a clue, the clue's too.
function availableReactions(pack: StoryPack, state: StoryState, character: CastMember, subject: SubjectRef): Reaction[] {
  return (character.reactions ?? []).filter((reaction) => {
    if (!sameSubject(reaction.about, subject) || !isRequirementMet(reaction.requires ?? {}, state)) return false;
    const clue = reaction.clue_id ? pack.clues.find((candidate) => candidate.id === reaction.clue_id) : undefined;
    return !reaction.clue_id || (clue !== undefined && isRequirementMet(clue.requirements, state));
  });
}

function syntheticFact(id: string, text: string): RetrievedFact {
  return { item: { id, topic: "", ask: "", text, keywords: [] } satisfies KnowledgeItem, score: 1, explicit: false };
}

// Order: authored reaction, matching knowledge, relationship or needed item, authored deflection.
export function resolveAsk(pack: StoryPack, state: StoryState, character: CastMember, subject: SubjectRef): AskResolution {
  const label = subjectLabel(pack, subject) ?? subject.id;
  const base = { label, facts: [] as RetrievedFact[], requestedItems: [] as string[] };

  const reactions = availableReactions(pack, state, character, subject);
  const reaction = reactions.find((candidate) => candidate.clue_id && !state.cluesFound.includes(candidate.clue_id)) ?? reactions[0];
  if (reaction) {
    return {
      ...base,
      source: "reaction",
      facts: [syntheticFact(`reaction:${reaction.id}`, reaction.text)],
      ...(reaction.clue_id ? { reactionClueId: reaction.clue_id } : {}),
    };
  }

  const known = retrieveKnowledge(availableKnowledge(pack, state, character), label);
  if (known.length > 0) return { ...base, source: "knowledge", facts: known };

  if (subject.type === "cast") {
    const relation = character.relationships.find((entry) => entry.cast_id === subject.id);
    if (relation) {
      return { ...base, source: "relationship", facts: [syntheticFact(`relationship:${subject.id}`, `Your relationship with ${label}: ${relation.relation}.`)] };
    }
  }
  if (subject.type === "item" && (nextGoalState(character, state)?.requires.items ?? []).includes(subject.id)) {
    return { ...base, source: "need", requestedItems: [subject.id] };
  }
  return { ...base, source: "deflection" };
}

// Up to three subjects asked about most recently, by name, for the return-visit greeting.
export function returnVisitFor(pack: StoryPack, state: StoryState, character: CastMember): { topics: string[] } | undefined {
  const memory = characterMemoryFor(state, character.id);
  if (memory.visits === 0) return undefined;
  const topics: string[] = [];
  for (const key of [...memory.askedAbout].reverse()) {
    const separator = key.indexOf(":");
    const subject = { type: key.slice(0, separator), id: key.slice(separator + 1) } as SubjectRef;
    const name = subject.type === "clue" ? undefined : subjectLabel(pack, subject);
    if (name && !topics.includes(name)) topics.push(name);
    if (topics.length === MAX_RETURN_TOPICS) break;
  }
  return { topics };
}
