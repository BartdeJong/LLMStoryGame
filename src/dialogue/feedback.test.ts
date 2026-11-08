import { describe, expect, it } from "vitest";
import { isDialogueFeedbackSession } from "./feedback";

const session = {
  schemaVersion: 1,
  sessionId: "test-session_1",
  startedAt: "2026-11-07T21:00:00.000Z",
  updatedAt: "2026-11-07T21:01:00.000Z",
  backend: "webllm",
  modelId: "local-model",
  story: { id: "lanterntide", title: "Lantern Tide", version: 1, length: "short" },
  character: { id: "c_hester", name: "Hester Wick" },
  setup: { truthsFound: [], itemsHeld: [] },
  turns: [
    {
      id: "reply-1",
      speaker: "character",
      text: "The light flickered again last night.",
      createdAt: "2026-11-07T21:00:02.000Z",
      feedback: { text: "This sounds like narration.", tags: ["narration"], skipped: false, createdAt: "2026-11-07T21:00:02.000Z" },
    },
  ],
};

describe("dialogue feedback session validation", () => {
  it("accepts a complete session with feedback attached to a character response", () => {
    expect(isDialogueFeedbackSession(session)).toBe(true);
  });

  it("rejects unsafe session IDs and oversized message content", () => {
    expect(isDialogueFeedbackSession({ ...session, sessionId: "../other-file" })).toBe(false);
    expect(isDialogueFeedbackSession({
      ...session,
      turns: [{ id: "too-long", speaker: "player", text: "x".repeat(4001), createdAt: "now" }],
    })).toBe(false);
  });
});
