import type { AreaBriefOutput } from "../llm/shapes";
import type { GenerationParams } from "../llm/types";
import { CHARACTER_START, GREETING_END, GREETING_START, THINGS_END, THINGS_START } from "../dialogue/prompt";
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

// Deterministic dialogue: rephrases nothing, repeats the facts the prompt selected.
export function mockDialogueLine(prompt: string): string {
  const greeting = textBetween(prompt, GREETING_START, GREETING_END);
  if (greeting) return greeting;
  const things = textBetween(prompt, THINGS_START, THINGS_END);
  const facts = things.split("\n").filter((entry) => entry.startsWith("- ")).map((entry) => entry.slice(2));
  const gave = prompt.match(/Just happened: the player gave you the ([^.]+)\./);
  if (gave) return `Thank you for the ${gave[1]}. That is exactly what I needed.`;
  if (facts.length > 0) return facts.join(" ");
  return "I'm not sure about that. What would you like to know?";
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
    if (!prompt.includes(CHARACTER_START)) return undefined;
    return JSON.stringify({ line: mockDialogueLine(prompt) });
  }
  if (params.tag === "ending") {
    const ending = between(prompt, ENDING_START, ENDING_END) as { outline: string; epilogue_notes: string } | null;
    return ending ? JSON.stringify({ scene: ending.outline, epilogue: ending.epilogue_notes }) : undefined;
  }
  return undefined;
}
