import type { DialogueTurnOutput } from "../llm/shapes";
import type { AreaBriefOutput } from "../llm/shapes";
import type { GenerationParams } from "../llm/types";
import { AVAILABLE_CLUES_END, AVAILABLE_CLUES_START, CHARACTER_END, CHARACTER_START, CONVERSATION_END, CONVERSATION_START } from "../dialogue/prompt";
import { ENDING_END, ENDING_START } from "./ending";
import { SLICE_END, SLICE_START } from "./briefPrompt";
import type { LocationSlice } from "./slice";
import { STATE_END, STATE_START } from "./summary";

function between(text: string, start: string, end: string): unknown {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from);
  if (from < 0 || to < 0) return null;
  return JSON.parse(text.slice(from + start.length, to));
}

function textBetween(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from);
  if (from < 0 || to < 0) return "";
  return text.slice(from + start.length, to).trim();
}

const FEATURES = ["hat", "glasses", "tail", "none", "wings"] as const;

// Builds a pack-consistent brief from the prompt's slice, so the mock exercises the same pipeline as a real model.
export function mockAreaBrief(slice: Omit<LocationSlice, "style">): AreaBriefOutput {
  return {
    name: slice.name,
    biome: "meadow",
    mood: slice.mood.slice(0, 40) || "calm",
    palette: "meadow",
    description: `${slice.name} waits quietly. Everything here feels ${slice.mood || "calm"}.`.slice(0, 400),
    characters: slice.characters.map((character, index) => ({
      name: character.name,
      species: character.species,
      sprite_recipe: { body: "round", bodyColor: "leaf", accentColor: "accent", skinColor: "skin", feature: FEATURES[index % FEATURES.length]! },
      personality: character.personality.slice(0, 80),
      goal: character.goal.slice(0, 100),
      secret: character.secret.slice(0, 100),
    })),
    objects: slice.objects.map((object) => ({
      kind: object.kind === "key_item" ? "table" : "chest",
      name: object.name,
      description: object.description.slice(0, 160),
      icon_recipe: { shape: "key", primaryColor: "accent", secondaryColor: "cream" },
      contents: [],
    })),
    clue: slice.clues[0]
      ? { truth_id: slice.clues[0].truth_id ?? "none", where: "by the nearest wall", text: slice.clues[0].text.slice(0, 200) }
      : null,
    doors: slice.doors.map((door) => ({ label: `Way to ${door.to_name}`.slice(0, 30), hint: "It looks well used." })),
  };
}

interface MockGoalState {
  id: string;
  description: string;
  gives_items?: string[];
}

interface MockCharacterFacts {
  name: string;
  goal_state: MockGoalState | "resolved";
}

// Deterministic dialogue so the mock exercises the same effect-validation path as a real model:
// it proposes the goal's reward once a conversation is under way, and the code decides whether it sticks.
export function mockDialogueTurn(facts: MockCharacterFacts, conversationText: string): DialogueTurnOutput {
  const playerTurns = (conversationText.match(/^Player:/gm) ?? []).length;
  const goal = facts.goal_state;
  const pendingReward = goal !== "resolved" ? goal.gives_items?.[0] ?? null : null;
  const mode: DialogueTurnOutput["mode"] = playerTurns % 2 === 0 ? "choices" : "free";
  const line = goal === "resolved" || !goal
    ? `${facts.name} chats warmly about the day.`
    : `${facts.name} thinks about it: ${goal.description}`;
  return {
    line,
    mode,
    choices: mode === "choices" ? ["Tell me more.", "I should get going.", "Anything else?"] : [],
    effects: {
      give_item: playerTurns > 0 ? pendingReward : null,
      reveal_clue: null,
      goal_progress: playerTurns > 0 && goal !== "resolved" ? 1 : pendingReward ? 0.5 : null,
    },
  };
}

// Plug into MockBackend({ respond }). Returns undefined for tags it does not handle.
export function storyMockRespond(params: GenerationParams): string | undefined {
  const prompt = params.messages.map((message) => message.content).join("\n");
  if (params.tag === "area") {
    const slice = between(prompt, SLICE_START, SLICE_END) as Omit<LocationSlice, "style"> | null;
    return slice ? JSON.stringify(mockAreaBrief(slice)) : undefined;
  }
  if (params.tag === "summary") {
    const state = between(prompt, STATE_START, STATE_END) as { visited_areas: string[]; truths_found: string[] } | null;
    if (!state) return undefined;
    return JSON.stringify({
      summary: `Explored ${state.visited_areas.length} places and learned ${state.truths_found.length} truth(s).`,
    });
  }
  if (params.tag === "dialogue") {
    const facts = between(prompt, CHARACTER_START, CHARACTER_END) as MockCharacterFacts | null;
    if (!facts) return undefined;
    const conversationText = textBetween(prompt, CONVERSATION_START, CONVERSATION_END);
    const turn = mockDialogueTurn(facts, conversationText);
    const clues = between(prompt, AVAILABLE_CLUES_START, AVAILABLE_CLUES_END) as { id: string; text: string }[] | null;
    turn.effects.reveal_clue = clues?.[0]?.id ?? null;
    return JSON.stringify(turn);
  }
  if (params.tag === "ending") {
    const ending = between(prompt, ENDING_START, ENDING_END) as { outline: string; epilogue_notes: string } | null;
    return ending ? JSON.stringify({ scene: ending.outline, epilogue: ending.epilogue_notes }) : undefined;
  }
  return undefined;
}
