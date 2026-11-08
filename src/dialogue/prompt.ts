import { DIALOGUE_SYSTEM } from "../llm/prompts";
import { characterLineSchema } from "../llm/shapes";
import type { CharacterLineOutput } from "../llm/shapes";
import { Priority } from "../llm/types";
import type { JSONRequest } from "../llm/types";
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
  inventory: InventoryEntry[];
  getInventory?: () => InventoryEntry[];
}

export interface DialoguePromptInput {
  character: CastMember;
  context: DialogueContext;
  turns: readonly ConversationTurn[];
  facts: readonly KnowledgeItem[];
  goalHint: string;
  handoverLines: readonly string[];
  reminder?: string;
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

function characterBlock(character: CastMember): string[] {
  const sheet = {
    name: character.name,
    species: character.species,
    personality: character.personality,
    voice_notes: character.voice_notes,
    goal: character.goal,
  };
  return [CHARACTER_START, JSON.stringify(sheet), CHARACTER_END];
}

export function buildDialoguePrompt(input: DialoguePromptInput): string {
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
    ...input.handoverLines,
    CONVERSATION_START,
    convoLines.join("\n") || "(the conversation is just starting)",
    CONVERSATION_END,
    ...(input.reminder ? [input.reminder] : []),
    'Return JSON: {"line": "<what you say, spoken words only>"}',
  ].join("\n");
}

// The opening line starts from an authored greeting; the model may only rephrase it lightly.
export function buildGreetingPrompt(character: CastMember, context: DialogueContext, greeting: string, reminder?: string): string {
  return [
    ...identityRules(character),
    "Rephrase the greeting below lightly, in the same voice and with the same meaning. Spoken words only, 1 to 2 short sentences. Do not describe the surroundings.",
    ...characterBlock(character),
    `Place: ${context.locationName}`,
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
