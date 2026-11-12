import type { GenerationParams } from "../llm/types";
import { CHARACTER_START, GREETING_END, GREETING_START, THINGS_END, THINGS_START } from "../dialogue/prompt";
import { ENDING_END, ENDING_START } from "./ending";
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
