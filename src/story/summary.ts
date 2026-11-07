import type { LLMClient } from "../llm/client";
import { SYSTEM } from "../llm/prompts";
import { defineSchema, s } from "../llm/schema";
import { Priority } from "../llm/types";
import type { JSONRequest } from "../llm/types";
import type { LengthView } from "./loader";
import type { StoryState } from "./state";
import type { StoryPack } from "./types";

export const STATE_START = "STATE:";
export const STATE_END = "END STATE";

interface SummaryOutput {
  summary: string;
}

const summarySchema = defineSchema<SummaryOutput>(
  s.object({ summary: s.string("", { maxLength: 280 }) }),
);

// Built only from structured state, so the model cannot drift from what actually happened.
export function buildSummaryRequest(pack: StoryPack, view: LengthView, state: StoryState): JSONRequest<SummaryOutput> {
  const names = state.visitedAreas.map((id) => pack.locations.find((location) => location.id === id)?.name ?? id);
  const truths = state.truthsFound.map((id) => pack.truths.find((truth) => truth.id === id)?.text ?? id);
  const facts = { story: pack.identity.title, length: view.length, visited_areas: names, truths_found: truths, previous_summary: state.summary };
  return {
    priority: Priority.Low,
    system: SYSTEM,
    tag: "summary",
    schema: summarySchema,
    maxTokens: 160,
    prompt:
      "Summarize the player's progress in at most 2 short sentences, using only these facts.\n" +
      `${STATE_START}\n${JSON.stringify(facts)}\n${STATE_END}\nReturn JSON with key: summary.`,
  };
}

// Regenerates the rolling summary. On any failure the previous summary is kept.
export async function refreshSummary(client: LLMClient, pack: StoryPack, view: LengthView, state: StoryState): Promise<boolean> {
  try {
    const result = await client.generateJSON(buildSummaryRequest(pack, view, state));
    if (result.status !== "ok" || result.value.summary.trim() === "") return false;
    state.summary = result.value.summary.trim();
    state.areasSinceSummary = 0;
    return true;
  } catch {
    return false;
  }
}
