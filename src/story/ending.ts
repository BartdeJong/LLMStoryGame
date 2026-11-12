import { SYSTEM } from "../llm/prompts";
import { endingSceneSchema } from "../llm/shapes";
import { Priority } from "../llm/types";
import type { LLMClient } from "../llm/client";
import type { Ending, FlawedEnding, StoryPack } from "./types";

export const ENDING_START = "ENDING:";
export const ENDING_END = "END ENDING";

export interface EndingScene {
  endingId: string;
  endingTitle: string;
  scene: string;
  epilogue: string;
  flawed?: boolean; // the authored flawed variant played
}

export interface EndingChoice {
  choices: string[];
  label: string;
}

export function endingTitle(endingId: string): string {
  return titleCase(endingId.replace(/^e_/, ""));
}

export function endingChoiceLabel(choiceIds: readonly string[]): string {
  if (choiceIds.length === 0) return "See how the story ends";
  return choiceIds.map((id) => titleCase(id.replace(/^choice_/, ""))).join(" and ");
}

function titleCase(value: string): string {
  return value
    .split(/[_-]+/)
    .map((word) => word.charAt(0).toLocaleUpperCase() + word.slice(1))
    .join(" ");
}

// The variant, when given, replaces the outline, tone and epilogue notes (a flawed case).
export function buildEndingPrompt(pack: StoryPack, ending: Ending, variant?: FlawedEnding | null): string {
  const source = variant ?? ending;
  return [
    "Write the final scene for this cozy mystery. Keep every plot fact within the outline; do not add a new twist.",
    ENDING_START,
    JSON.stringify({
      story_title: pack.identity.title,
      outline: source.scene_outline,
      tone: source.tone,
      epilogue_notes: source.epilogue_notes,
    }),
    ENDING_END,
    "Return JSON with scene (a short, warm ending scene) and epilogue (one or two concise sentences honoring the notes).",
  ].join("\n");
}

export async function writeEnding(client: LLMClient, pack: StoryPack, ending: Ending, variant?: FlawedEnding | null): Promise<EndingScene> {
  const source = variant ?? ending;
  const result = await client.generateJSON({
    priority: Priority.Dialogue,
    system: SYSTEM,
    tag: "ending",
    schema: endingSceneSchema,
    maxTokens: 400,
    prompt: buildEndingPrompt(pack, ending, variant),
  });
  const generated = result.status === "ok" && result.value.scene.trim() && result.value.epilogue.trim();
  return {
    endingId: ending.id,
    endingTitle: endingTitle(ending.id),
    scene: generated ? result.value.scene.trim() : source.scene_outline,
    epilogue: generated ? result.value.epilogue.trim() : source.epilogue_notes,
    ...(variant ? { flawed: true } : {}),
  };
}
