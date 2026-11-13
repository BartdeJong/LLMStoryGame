import { QUICK_GOODBYE } from "../../src/dialogue/knowledge";
import type { AskOptions } from "../../src/dialogue/askAbout";
import { parseJsonLoose } from "../../src/llm/json";
import { defineSchema, s, toJsonSchema } from "../../src/llm/schema";
import type { ChatMessage } from "../../src/llm/types";
import type { CastMember, SubjectRef } from "../../src/story/types";
import type { Random } from "./sampleState";

export interface PlayerMessagesOutput {
  messages: string[];
}

export const playerMessagesSchema = defineSchema<PlayerMessagesOutput>(
  s.object({ messages: s.array(s.string("", { maxLength: 160 }), { minItems: 4, maxItems: 8 }) }),
);

const KINDS = [
  "on-topic: asks about something this person plausibly knows or has (use the topics below)",
  "on-topic: asks about something this person plausibly knows or has (use the topics below)",
  "small talk (weather, how they are, the place)",
  "off-topic or silly (nothing to do with the story)",
  "pushy or impatient, demanding answers",
  "short and typo-ridden, lowercase, like typed on a phone",
  "asks what they need or how the player can help",
  "thanks them or reacts to what they said",
  "a vague one-word or two-word message",
];

function shuffled<T>(items: readonly T[], rng: Random): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(rng() * (index + 1));
    [copy[index], copy[other]] = [copy[other]!, copy[index]!];
  }
  return copy;
}

export interface PlayerTurnsInput {
  character: CastMember;
  locationName: string;
  summary: string;
  topics: readonly string[]; // what a player could bring up (knowledge asks)
}

export function playerMessagesRequest(input: PlayerTurnsInput, count: number, rng: Random): { messages: ChatMessage[]; schema: Record<string, unknown> } {
  const kinds = shuffled(KINDS, rng).slice(0, count).map((kind, index) => `${index + 1}. ${kind}`);
  const prompt = [
    `A player is talking to ${input.character.name} (${input.character.species}, ${input.character.personality}) at ${input.locationName} in a cozy mystery game.`,
    input.summary ? `Story so far: ${input.summary}` : "The story has just begun.",
    input.topics.length > 0 ? `Topics the player could bring up: ${input.topics.join(" | ")}` : "",
    `Write ${count} different messages the player might type to ${input.character.name}, one per line of this list:`,
    ...kinds,
    "Each message is the player's own words, 1 to 20 words, no quotation marks, no names of speakers.",
    'Be specific and varied: refer to concrete things (a name, object or place from the topics or the story so far) where it fits, mix short and long messages, and vary mood and phrasing. Do not write bare "Goodbye", "Thanks" or "What do you need?".',
    'Return JSON: {"messages": [<one string per item>]}',
  ].filter(Boolean).join("\n");
  return {
    messages: [
      { role: "system", content: "You write realistic messages that a human player types to a character in a game. English only." },
      { role: "user", content: prompt },
    ],
    schema: toJsonSchema(playerMessagesSchema),
  };
}

// Reads the teacher's answer; anything unusable is dropped. Returns a few clean, distinct messages.
export function parsePlayerMessages(text: string): string[] {
  const parsed = parseJsonLoose(text);
  if (!parsed.ok) return [];
  const list = (parsed.value as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const messages: string[] = [];
  for (const entry of list) {
    if (typeof entry !== "string") continue;
    const cleaned = entry.trim().replace(/^["'“]+|["'”]+$/g, "").trim();
    const key = cleaned.toLowerCase();
    if (cleaned.length === 0 || seen.has(key)) continue;
    seen.add(key);
    messages.push(cleaned);
  }
  return messages;
}

export type PlayerAction =
  | { kind: "reply"; text: string; source: "teacher" | "chip" }
  | { kind: "ask"; subject: SubjectRef; label: string };

// Chooses the next thing the player does: a teacher-written message, one of the quick replies the game
// just offered, or "Ask about..." on a person, item or clue. `askable` lists the options that get an answer.
export function pickPlayerAction(
  rng: Random,
  input: {
    teacher: string[]; // unused messages; the chosen one is removed
    choices: readonly string[]; // quick replies of the last turn
    askable: readonly { subject: SubjectRef; label: string }[];
    last: boolean;
  },
): PlayerAction | null {
  const chips = input.choices.filter((choice) => choice !== QUICK_GOODBYE || input.last);
  const roll = rng();
  if (input.last && roll < 0.2 && input.choices.includes(QUICK_GOODBYE)) return { kind: "reply", text: QUICK_GOODBYE, source: "chip" };
  if (roll < 0.25 && input.askable.length > 0) {
    const pick = input.askable[Math.floor(rng() * input.askable.length)]!;
    return { kind: "ask", subject: pick.subject, label: pick.label };
  }
  if (roll < 0.55 && chips.length > 0) {
    return { kind: "reply", text: chips[Math.floor(rng() * chips.length)]!, source: "chip" };
  }
  const message = input.teacher.shift();
  if (message) return { kind: "reply", text: message, source: "teacher" };
  if (chips.length > 0) return { kind: "reply", text: chips[Math.floor(rng() * chips.length)]!, source: "chip" };
  if (input.askable.length > 0) {
    const pick = input.askable[Math.floor(rng() * input.askable.length)]!;
    return { kind: "ask", subject: pick.subject, label: pick.label };
  }
  return null;
}

export function flattenAskOptions(options: AskOptions): { subject: SubjectRef; label: string }[] {
  return [...options.people, ...options.items, ...options.evidence].map((entry) => ({ subject: entry.subject, label: entry.label }));
}

// "What can you tell me about <label>?" is the game's own ask-about text. Clue labels are whole sentences cut to
// 60 characters, which reads badly there, so only short names (people, items) are asked about.
export function askLabelReadsWell(label: string): boolean {
  const text = label.trim();
  return text.length > 0 && text.length <= 40 && !/[.!?\u2026,;:]/.test(text);
}

const WATCHED_PHRASES = new Set(["goodbye", "thanks", "thank you", "what do you need", "what do you need from me"]);

function phraseKey(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

// Stock phrases (goodbye, thanks, "what do you need") may be used only a few times per run, so they do not dominate.
export class PhraseBudget {
  private readonly used = new Map<string, number>();

  constructor(private readonly perPhrase = 3) {}

  canUse(text: string): boolean {
    const key = phraseKey(text);
    return !WATCHED_PHRASES.has(key) || (this.used.get(key) ?? 0) < this.perPhrase;
  }

  use(text: string): void {
    const key = phraseKey(text);
    if (WATCHED_PHRASES.has(key)) this.used.set(key, (this.used.get(key) ?? 0) + 1);
  }
}

// Which turns (1-based) of a conversation become records: at most `cap`, one from each equal stretch of the
// conversation, so they are spread out instead of consecutive. Every turn is still played so the history builds up.
export function pickRecordedTurns(turnCount: number, cap: number, rng: Random): Set<number> {
  const turns = new Set<number>();
  if (turnCount <= cap) {
    for (let turn = 1; turn <= turnCount; turn += 1) turns.add(turn);
    return turns;
  }
  for (let part = 0; part < cap; part += 1) {
    const from = Math.floor((part * turnCount) / cap);
    const to = Math.floor(((part + 1) * turnCount) / cap);
    turns.add(from + 1 + Math.floor(rng() * Math.max(1, to - from)));
  }
  return turns;
}
