import { describe, expect, it } from "vitest";
import fixture from "../../public/stories/example.json";
import { buildLineRequest } from "../dialogue/prompt";
import { getLengthView } from "../story/loader";
import { createStoryState } from "../story/state";
import { buildSummaryRequest } from "../story/summary";
import type { StoryPack } from "../story/types";
import { DIALOGUE_SYSTEM, SYSTEM, dialogueSystemPrompt, systemPrompt } from "./prompts";

describe("language-aware system prompts", () => {
  it("keeps the English prompts unchanged", () => {
    expect(systemPrompt()).toBe(SYSTEM);
    expect(dialogueSystemPrompt()).toBe(DIALOGUE_SYSTEM);
    expect(SYSTEM).toContain("English only.");
    expect(DIALOGUE_SYSTEM).toContain("English only.");
  });

  it("asks for Dutch only in the nl variants", () => {
    for (const prompt of [systemPrompt("nl"), dialogueSystemPrompt("nl")]) {
      expect(prompt).toContain("Dutch (Nederlands) only");
      expect(prompt).not.toContain("English only");
    }
  });

  it("uses the Dutch dialogue prompt only when the language is nl", () => {
    expect(buildLineRequest("p", { language: "nl" }).system).toBe(dialogueSystemPrompt("nl"));
    expect(buildLineRequest("p").system).toBe(DIALOGUE_SYSTEM);
  });

  it("writes the summary request in Dutch for a nl pack", () => {
    const build = (language?: "nl"): ReturnType<typeof buildSummaryRequest> => {
      const pack = structuredClone(fixture) as unknown as StoryPack;
      if (language) pack.language = language;
      const view = getLengthView(pack);
      return buildSummaryRequest(pack, view, createStoryState(view));
    };
    const dutch = build("nl");
    expect(dutch.system).toBe(systemPrompt("nl"));
    expect(dutch.prompt).toContain("Antwoord uitsluitend in het Nederlands.");
    const english = build();
    expect(english.system).toBe(SYSTEM);
    expect(english.prompt).not.toContain("Nederlands");
  });
});
