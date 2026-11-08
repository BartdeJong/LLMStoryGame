export const DIALOGUE_FEEDBACK_TAGS = [
  "good",
  "off-topic",
  "narration",
  "wrong-perspective",
  "repeated",
  "incoherent",
  "wrong-story-fact",
  "wrong-voice",
] as const;

export type DialogueFeedbackTag = (typeof DIALOGUE_FEEDBACK_TAGS)[number];

export interface DialogueFeedbackNote {
  text: string;
  tags: DialogueFeedbackTag[];
  skipped: boolean;
  createdAt: string;
}

export interface DialogueFeedbackMessage {
  id: string;
  speaker: "player" | "character";
  text: string;
  kind?: "intent";
  createdAt: string;
  quality?: "generated" | "repaired" | "fallback";
  notice?: string;
  feedback?: DialogueFeedbackNote;
}

export interface DialogueFeedbackSession {
  schemaVersion: 1;
  sessionId: string;
  startedAt: string;
  updatedAt: string;
  backend: "webllm" | "mock";
  modelId: string;
  story: {
    id: string;
    title: string;
    version: number;
    length: string;
  };
  character: {
    id: string;
    name: string;
  };
  setup: {
    truthsFound: string[];
    itemsHeld: string[];
  };
  turns: DialogueFeedbackMessage[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown, maxItems: number): value is string[] {
  return Array.isArray(value) && value.length <= maxItems && value.every((item) => typeof item === "string" && item.length <= 120);
}

function isFeedbackNote(value: unknown): value is DialogueFeedbackNote {
  if (!isRecord(value)) return false;
  return typeof value.text === "string"
    && value.text.length <= 4000
    && Array.isArray(value.tags)
    && value.tags.length <= DIALOGUE_FEEDBACK_TAGS.length
    && value.tags.every((tag) => DIALOGUE_FEEDBACK_TAGS.includes(tag as DialogueFeedbackTag))
    && typeof value.skipped === "boolean"
    && typeof value.createdAt === "string";
}

export function isDialogueFeedbackSession(value: unknown): value is DialogueFeedbackSession {
  if (!isRecord(value) || !isRecord(value.story) || !isRecord(value.character) || !isRecord(value.setup)) return false;
  if (value.schemaVersion !== 1 || typeof value.sessionId !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(value.sessionId)) return false;
  if (typeof value.startedAt !== "string" || typeof value.updatedAt !== "string") return false;
  if (value.backend !== "webllm" && value.backend !== "mock") return false;
  if (typeof value.modelId !== "string" || value.modelId.length > 120) return false;
  if (typeof value.story.id !== "string" || typeof value.story.title !== "string" || typeof value.story.version !== "number" || typeof value.story.length !== "string") return false;
  if (typeof value.character.id !== "string" || typeof value.character.name !== "string") return false;
  if (!isStringArray(value.setup.truthsFound, 100) || !isStringArray(value.setup.itemsHeld, 100)) return false;
  if (!Array.isArray(value.turns) || value.turns.length > 500) return false;
  return value.turns.every((turn) => {
    if (!isRecord(turn) || typeof turn.id !== "string" || typeof turn.text !== "string" || turn.text.length > 4000) return false;
    if (turn.speaker !== "player" && turn.speaker !== "character") return false;
    if (typeof turn.createdAt !== "string") return false;
    if (turn.kind !== undefined && turn.kind !== "intent") return false;
    if (turn.quality !== undefined && !["generated", "repaired", "fallback"].includes(turn.quality as string)) return false;
    if (turn.notice !== undefined && (typeof turn.notice !== "string" || turn.notice.length > 500)) return false;
    return turn.feedback === undefined || (turn.speaker === "character" && isFeedbackNote(turn.feedback));
  });
}
