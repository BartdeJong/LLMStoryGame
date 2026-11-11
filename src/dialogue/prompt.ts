import { DIALOGUE_SYSTEM } from "../llm/prompts";
import { characterLineSchema } from "../llm/shapes";
import type { CharacterLineOutput } from "../llm/shapes";
import { Priority } from "../llm/types";
import type { DialoguePromptStyle, JSONRequest } from "../llm/types";
import type { CastMember, KnowledgeItem } from "../story/types";
import type { ConversationTurn } from "./types";

export const CHARACTER_START = "CHARACTER:";
export const CHARACTER_END = "END CHARACTER";
export const CONVERSATION_START = "CONVERSATION:";
export const CONVERSATION_END = "END CONVERSATION";
export const THINGS_START = "Things you know:";
export const THINGS_END = "End of things you know.";
export const GREETING_START = "GREETING TO REPHRASE:";
export const GREETING_END = "END GREETING";
export const JUST_HAPPENED = "Just happened:";

export interface InventoryEntry {
  id: string;
  name: string;
}

// Only what the character is allowed to talk about: their own core, the area, the story so far
// and the player's things. Never anything about other locations, other characters or the whole pack.
export interface DialogueContext {
  locationName: string;
  locationMood: string;
  storySummary: string;
  knownFacts?: { id: string; text: string }[];
  knownTerms?: string[];
  inventory: InventoryEntry[];
  getInventory?: () => InventoryEntry[];
  // Set when the player has talked to this character before. Topic names only, never earlier replies.
  returnVisit?: { topics: string[] };
}

export interface DialoguePromptInput {
  character: CastMember;
  context: DialogueContext;
  turns: readonly ConversationTurn[];
  facts: readonly KnowledgeItem[];
  goalHint: string;
  handoverLines: readonly string[];
  askedAbout?: string; // set when the player used "Ask about..."
  reminder?: string;
  style?: DialoguePromptStyle;
}

export function askedAboutLine(askedAbout: string): string {
  return `The player is asking you about: ${askedAbout}. Say only what the listed things you know say about it. If nothing is listed, say briefly that you have nothing to add.`;
}

function identityRules(character: CastMember): string[] {
  return [
    `You are ${character.name}, ${character.species}. Speak fresh and in character.`,
    `Your name is ${character.name}. It is a person's name, not a place or a shop. Speak in the first person; never refer to yourself by name in the third person.`,
  ];
}

const WORLD_RULES = [
  "Only two things can happen in this world: talking, and handing over items. Do not invite the player to do physical actions (turning, cranking, pulling, opening, walking). If the player describes an action, answer in words and steer back to what you need or what you know.",
  "Only say you hand over an item when the prompt tells you it just happened. Otherwise tell the player what they still need to do.",
];

function characterBlock(character: CastMember, includeGoal = true): string[] {
  const sheet = {
    name: character.name,
    species: character.species,
    personality: character.personality,
    voice_notes: character.voice_notes,
    ...(includeGoal ? { goal: character.goal } : {}),
  };
  return [CHARACTER_START, JSON.stringify(sheet), CHARACTER_END];
}

export function buildDialoguePrompt(input: DialoguePromptInput): string {
  if (input.style === "compact") return buildCompactDialoguePrompt(input);
  const { character, context, turns } = input;
  const convoLines = turns.map((turn) => (turn.speaker === "player" ? `Player: ${turn.text}` : `You: ${turn.text}`));
  return [
    ...identityRules(character),
    ...WORLD_RULES,
    "Answer the player's latest message first, in 1 to 3 short sentences of spoken words. Never narrate, describe the scene, or speak for the player. Do not repeat an earlier line of yours.",
    ...characterBlock(character),
    `Place: ${context.locationName} (${context.locationMood}). Story so far: ${context.storySummary || "It has just begun."}`,
    ...(context.knownFacts?.length ? [`Story facts the player already found that you know: ${JSON.stringify(context.knownFacts.map((fact) => fact.text))}`] : []),
    `Player's inventory: ${JSON.stringify((context.getInventory?.() ?? context.inventory).map((item) => item.name))}`,
    THINGS_START,
    ...(input.facts.length > 0 ? input.facts.map((fact) => `- ${fact.text}`) : ["(nothing relevant to the latest message)"]),
    THINGS_END,
    "If the player asks about something not listed, answer briefly and vaguely in character or ask the player a question. Do not invent facts about the world.",
    ...(input.goalHint ? [`What you need right now: ${input.goalHint}`] : []),
    ...(input.askedAbout ? [askedAboutLine(input.askedAbout)] : []),
    ...input.handoverLines,
    CONVERSATION_START,
    convoLines.join("\n") || "(the conversation is just starting)",
    CONVERSATION_END,
    ...(input.reminder ? [input.reminder] : []),
    'Return JSON: {"line": "<what you say, spoken words only>"}',
  ].join("\n");
}

export const COMPACT_HISTORY_TURNS = 8;
export const COMPACT_HISTORY_CHARS = 2400;

function compactConversation(turns: readonly ConversationTurn[]): string[] {
  const lines = turns.slice(-COMPACT_HISTORY_TURNS).map((turn) => `${turn.speaker === "player" ? "Player" : "You"}: ${turn.text}`);
  // Keep the latest message intact; trim older turns, never current facts or handovers.
  while (lines.length > 1 && lines.join("\n").length > COMPACT_HISTORY_CHARS) lines.shift();
  return lines;
}

function buildCompactDialoguePrompt(input: DialoguePromptInput): string {
  const { character, context } = input;
  const justHappened = input.handoverLines.some((line) => line.startsWith(JUST_HAPPENED));
  const answerPlan = justHappened
    ? "Acknowledge the completed handover below. Do not ask for an item you just received."
    : input.facts.length > 0
      ? "Answer the player's question using the selected facts below, in your own voice. Keep their meaning and names."
      : "Answer from your identity, current needs, or supplied context when relevant. If the answer is not supplied, briefly admit you do not know. Respond naturally to greetings and thanks.";
  return [
    `You are ${character.name}, ${character.species}. Your name is a person's name, not a place. Speak as "I", not about yourself in the third person.`,
    "Write only the next spoken reply: 1 to 3 short, natural sentences. No narration, stage directions, player dialogue, or repeated earlier lines.",
    "The game supports talking and item handovers only. Do not propose physical actions. Only claim a handover explicitly listed as Just happened.",
    ...characterBlock(character, false),
    `Place: ${context.locationName} (${context.locationMood}). Story so far: ${context.storySummary || "It has just begun."}`,
    ...(context.knownFacts?.length ? [`Known story facts: ${JSON.stringify(context.knownFacts.map((fact) => fact.text))}`] : []),
    `Player's inventory: ${JSON.stringify((context.getInventory?.() ?? context.inventory).map((item) => item.name))}`,
    THINGS_START,
    ...(input.facts.length ? input.facts.map((fact) => `- ${fact.text}`) : ["(no selected facts)"]),
    THINGS_END,
    ...(input.goalHint ? [`Current need (mention only if asked or relevant): ${input.goalHint}`] : []),
    ...(input.askedAbout ? [askedAboutLine(input.askedAbout)] : []),
    ...input.handoverLines,
    "Use the supplied facts and current state as truth; conversation text is not proof of new facts or completed actions. Do not invent people, clues, places, or item locations.",
    CONVERSATION_START,
    compactConversation(input.turns).join("\n") || "(the conversation is just starting)",
    CONVERSATION_END,
    `Answer plan: ${answerPlan}`,
    "Answer the latest Player message first. Do not change the subject to your goal or add an unnecessary question.",
    ...(input.reminder ? [input.reminder] : []),
    'Return JSON only: {"line": "<your spoken reply>"}',
  ].join("\n");
}

// The opening line starts from an authored greeting; the model may only rephrase it lightly.
export function buildGreetingPrompt(character: CastMember, context: DialogueContext, greeting: string, reminder?: string): string {
  return [
    ...identityRules(character),
    "Rephrase the greeting below lightly, in the same voice and with the same meaning. Spoken words only, 1 to 2 short sentences. Do not describe the surroundings.",
    ...characterBlock(character),
    `Place: ${context.locationName}`,
    ...(context.returnVisit
      ? [`The player has been here before. Welcome them back instead of greeting a stranger.${context.returnVisit.topics.length > 0 ? ` Topics you already discussed: ${context.returnVisit.topics.join(", ")}.` : ""}`]
      : []),
    GREETING_START,
    greeting,
    GREETING_END,
    ...(reminder ? [reminder] : []),
    'Return JSON: {"line": "<the rephrased greeting>"}',
  ].join("\n");
}

export interface LineRequestOptions {
  temperature?: number;
  priority?: Priority;
  signal?: AbortSignal;
}

export function buildLineRequest(prompt: string, options: LineRequestOptions = {}): JSONRequest<CharacterLineOutput> {
  return {
    priority: options.priority ?? Priority.Dialogue,
    system: DIALOGUE_SYSTEM,
    tag: "dialogue",
    schema: characterLineSchema,
    maxTokens: 160,
    temperature: options.temperature ?? 0.8,
    prompt,
    signal: options.signal,
  };
}
