// Code-side dialogue knowledge: which authored facts apply to a player message, which quick
// replies to offer and which goal hint to show. The model only phrases what code selects.

import { goalStatus } from "../story/goals";
import { isRequirementMet } from "../story/requirements";
import type { StoryState } from "../story/state";
import type { CastMember, KnowledgeItem, StoryPack } from "../story/types";

export const MAX_FACTS = 2;
export const MAX_TOPIC_BUTTONS = 3;
export const QUICK_NEED = "What do you need?";
export const QUICK_GOODBYE = "Goodbye.";

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "do", "does", "for", "from", "have", "how", "i", "in", "is", "it",
  "me", "my", "of", "on", "or", "so", "that", "the", "this", "to", "was", "what", "when", "where", "who", "why", "with", "you", "your",
]);

// Light stemmer: enough for "lanterns", "pressing", "tides" to meet "lantern", "press", "tide".
export function stem(word: string): string {
  let w = word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && /(?:ss|x|z|ch|sh)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  if (w.length > 3 && /([^aeiou])\1$/.test(w)) w = w.slice(0, -1);
  return w;
}

export function stemmedWords(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+(?:'[\p{L}]+)?/gu) ?? [])
    .map((word) => word.replace(/'s$/, ""))
    .filter((word) => !STOP_WORDS.has(word))
    .map(stem)
    .filter(Boolean);
}

function normalized(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

export function keywordScore(item: KnowledgeItem, playerText: string): number {
  const words = new Set(stemmedWords(playerText));
  let score = 0;
  for (const keyword of item.keywords) {
    const parts = stemmedWords(keyword);
    if (parts.length > 0 && parts.every((part) => words.has(part))) score += 1;
  }
  return score;
}

export interface RetrievedFact {
  item: KnowledgeItem;
  score: number;
  // The player asked for this fact on purpose: sent its quick reply text, or matched 2+ keywords.
  explicit: boolean;
}

export function retrieveKnowledge(items: readonly KnowledgeItem[], playerText: string): RetrievedFact[] {
  const typed = normalized(playerText);
  return items
    .map((item, order) => {
      const exactAsk = normalized(item.ask) === typed;
      const score = keywordScore(item, playerText);
      return { item, score, explicit: exactAsk || score >= 2, order, rank: exactAsk ? Number.MAX_SAFE_INTEGER : score };
    })
    .filter((entry) => entry.rank >= 1)
    .sort((a, b) => b.rank - a.rank || a.order - b.order)
    .slice(0, MAX_FACTS)
    .map(({ item, score, explicit }) => ({ item, score, explicit }));
}

// Facts behind an unmet clue requirement stay locked, so the character cannot spoil them early.
export function availableKnowledge(pack: StoryPack, state: StoryState, character: CastMember): KnowledgeItem[] {
  return character.knowledge.filter((item) => {
    if (!item.clue_id) return true;
    const clue = pack.clues.find((candidate) => candidate.id === item.clue_id);
    return !clue || isRequirementMet(clue.requirements, state);
  });
}

// Up to three buttons for topics not discussed yet (unfound clues first), plus the two fixed ones.
export function buildQuickReplies(
  available: readonly KnowledgeItem[],
  discussed: ReadonlySet<string>,
  state: StoryState,
): string[] {
  const open = available.filter((item) => !discussed.has(item.id));
  const unfound = open.filter((item) => item.clue_id && !state.cluesFound.includes(item.clue_id));
  const rest = open.filter((item) => !unfound.includes(item));
  const topics = [...unfound, ...rest].slice(0, MAX_TOPIC_BUTTONS).map((item) => item.ask);
  return [...topics, QUICK_NEED, QUICK_GOODBYE];
}

export function goalHintLine(character: CastMember, state: StoryState, turnIndex: number): string {
  // A character without goal states keeps wanting the same thing, so they stay "unmet".
  const status = character.goal_states.length === 0 ? "unmet" : goalStatus(character, state);
  const hints = character.goal_hints[status];
  return hints[turnIndex % hints.length] ?? "";
}
