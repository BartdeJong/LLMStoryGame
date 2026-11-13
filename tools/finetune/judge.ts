import { parseJsonLoose } from "../../src/llm/json";
import { defineSchema, s, toJsonSchema } from "../../src/llm/schema";
import type { ChatMessage } from "../../src/llm/types";
import { OllamaError } from "./ollamaBackend";
import type { OllamaBackend, ThinkSetting } from "./ollamaBackend";

export type JudgeKind = "line" | "summary" | "ending";

const LINE_PROBLEMS = {
  invents_fact: "any claim, motive, cause, relationship, habit or event the prompt does not support (also set automatically for every unsupported claim)",
  contradicts_prompt: "says the opposite of something in the prompt, or claims a handover or action the prompt does not list",
  reveals_secret: "tells something the prompt says to withhold, or something not yet unlocked",
  ignores_player: "does not respond to the last player message: a goodbye must be answered as a goodbye, and \"What do you need?\" must be answered by saying what the character needs (or that they need nothing)",
  repeats_earlier_line: "repeats or nearly repeats an earlier line of the NPC in the conversation",
  too_long: "more than 3 sentences",
  out_of_character: "does not sound like the persona, narrates, or speaks for the player",
  modern_or_meta: "mentions AI, the game, prompts, or modern things that do not fit the story",
  breaks_answer_plan: "breaks a rule the prompt itself gives (the answer plan, no unneeded question, no change of subject, no physical actions)",
  copies_seed_greeting: "a greeting that is the authored greeting word for word instead of a light rephrasing",
} as const;

const TEXT_PROBLEMS = {
  invents_fact: "any person, place, event, cause or detail that the given facts or outline do not support (also set automatically for every unsupported claim)",
  contradicts_prompt: "says something that conflicts with the given facts or outline",
  too_long: "longer than the prompt allows",
} as const;

export const JUDGE_SEED = 42;
export const SUPPORT_OVERLAP = 0.6; // share of a quote's words that must be in the prompt
export const JUDGE_MAX_TOKENS = 3072; // the judge thinks first, then answers
export const JUDGE_CONTEXT_CHARS = 11000;

export interface JudgeClaim {
  text: string;
  support: string | null;
}

export interface JudgeVerdict {
  verdict: "pass" | "fail"; // derived in code, never the model's own word
  modelSaidFail: boolean; // the model said fail but listed no problem and no unsupported claim, so the pass stands
  problems: string[];
  claims: JudgeClaim[];
  unsupported: string[]; // the claims with no support in the prompt
  note: string;
}

function problemsFor(kind: JudgeKind): Record<string, string> {
  return kind === "line" ? LINE_PROBLEMS : TEXT_PROBLEMS;
}

export function judgeProblemNames(kind: JudgeKind): string[] {
  return Object.keys(problemsFor(kind));
}

function verdictSchema(kind: JudgeKind) {
  return defineSchema<unknown>(
    s.object({
      claims: s.array(s.object({ text: s.string("", { maxLength: 200 }), support: s.nullable(s.string("", { maxLength: 300 })) })),
      problems: s.array(s.string("invents_fact", { oneOf: judgeProblemNames(kind) })),
      verdict: s.string("fail", { oneOf: ["pass", "fail"] }),
    }),
  );
}

// Keeps the start (persona, facts) and the end (the conversation) of a very long prompt.
function boundedContext(text: string): string {
  if (text.length <= JUDGE_CONTEXT_CHARS) return text;
  return `${text.slice(0, 3000)}\n...\n${text.slice(text.length - (JUDGE_CONTEXT_CHARS - 3000))}`;
}

const LINE_CLAIM_SCOPE = [
  "Step 1: list the factual claims the text makes. A claim is something asserted as true about: case facts and events (what happened, when); objects and documents and what they contain; people (identity, role, relationships, whereabouts, actions); the speaker's own history and habits when they bear on the case or on other characters; motives, dates and times.",
  "NOT claims: sensory flavour (a warm bun, the weather right now); the speaker's feelings, opinions and hedged guesses (\"that's unusual for him\", \"that doesn't prove who ordered it\"); offers and pleasantries; restating what the player said. A conclusion is a claim only when it asserts a new case fact as true (\"the receipt confirms the ward was paid\").",
  "For each claim give support: a short quote from what the writer was given that backs it, or null if nothing does. Do not excuse a case claim because it sounds plausible: if the prompt does not say it, support is null.",
  "Examples:",
  "- \"Grab a warm bun!\" -> no claims (flavour) -> pass.",
  "- \"I haven't been up the clock tower myself, but Hollis keeps things very tidy.\" -> claims: she has not been up the clock tower; Hollis keeps things tidy -> support null for both (a whereabouts and a habit the prompt never gives) -> fail.",
  "- \"The receipt in your hand confirms the ward was paid.\" -> claim: the receipt confirms the ward was paid -> support null -> fail.",
  "- \"That is very unusual for him.\" -> opinion, no claims -> pass.",
].join("\n");

const TEXT_CLAIM_SCOPE = [
  "Step 1: list only the case facts the text asserts: who did what, how and why, and the evidence. Support each with a short quote from the outline, notes or state the writer was given, or null if nothing does.",
  "NOT claims: scene flavour and atmosphere (cheering villagers, warm buns, lantern light, weather, mood), wording and pleasantries. Only a changed or added case fact counts.",
].join("\n");

// `context` is the system and user message the model was given; `candidate` is the text it produced.
export function judgeRequest(kind: JudgeKind, context: readonly ChatMessage[], candidate: string): { messages: ChatMessage[]; schema: Record<string, unknown> } {
  const claimScope = kind === "line" ? LINE_CLAIM_SCOPE : TEXT_CLAIM_SCOPE;
  const what = kind === "line" ? "a reply spoken by a character (NPC)" : kind === "summary" ? "a summary of the player's progress" : "an ending scene and epilogue";
  const problems = Object.entries(problemsFor(kind)).map(([name, meaning]) => `- ${name}: ${meaning}`).join("\n");
  const system = [
    `You are a strict fact-checker for a cozy mystery game. You see everything the writer was given, then ${what}. Judge only that text.`,
    claimScope,
    "Step 2: list any problems from this list (leave it empty if none):",
    problems,
    'Answer with JSON: {"claims": [{"text": "...", "support": "quote or null"}], "problems": [names], "verdict": "pass" or "fail"}.',
  ].join("\n");
  // The writer's generic system message adds nothing for a fact check, so only the user prompt is passed on.
  const given = boundedContext(context.filter((message) => message.role !== "system").map((message) => message.content).join("\n\n"));
  return {
    messages: [
      { role: "system", content: system },
      { role: "user", content: `GIVEN TO THE WRITER:\n${given}\n\nTEXT TO CHECK:\n${candidate}` },
    ],
    schema: toJsonSchema(verdictSchema(kind)),
  };
}

// Case, punctuation and possessives are normalised away, so "Vale's" and "vale" match.
function wordsOf(text: string): string[] {
  return text.toLowerCase().replace(/[\u2019]/g, "'").replace(/'s\b/g, "").replace(/'/g, "").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((word) => word.length > 2);
}

function normalizedText(text: string): string {
  return text.toLowerCase().replace(/[\u2019]/g, "'").replace(/'s\b/g, "").replace(/'/g, "").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean).join(" ");
}

// A claim is supported when it names a quote and enough of the quote's words are really in the prompt. Only
// words of 4 or more letters count; a quote with fewer than 2 of them must appear in the prompt as it is
// (normalised), so a few filler words cannot support anything.
function isSupported(support: string | null, promptWords: ReadonlySet<string>, promptText: string): boolean {
  if (!support || support.trim().toLowerCase() === "null") return false;
  const words = wordsOf(support).filter((word) => word.length >= 4);
  if (words.length < 2) {
    const quote = normalizedText(support);
    return quote !== "" && ` ${promptText} `.includes(` ${quote} `);
  }
  return words.filter((word) => promptWords.has(word)).length / words.length >= SUPPORT_OVERLAP;
}

// Reads the judge's answer and decides the verdict in code: fail when any claim has no support in the prompt or any
// problem is listed. The model's own verdict field is ignored. Unreadable answers are null.
export function parseVerdict(text: string, kind: JudgeKind, prompt: string): JudgeVerdict | null {
  const parsed = parseJsonLoose(text);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") return null;
  // A reasoning block that was not cut out means the text is not a clean answer.
  if (text.includes("<think")) return null;
  const value = parsed.value as { claims?: unknown; problems?: unknown; verdict?: unknown };
  if (!Array.isArray(value.claims)) return null;
  const promptWords = new Set(wordsOf(prompt));
  const promptText = normalizedText(prompt);
  const claims: JudgeClaim[] = [];
  for (const entry of value.claims) {
    const claim = entry as { text?: unknown; support?: unknown } | null;
    if (!claim || typeof claim.text !== "string" || claim.text.trim() === "") continue;
    claims.push({ text: claim.text.trim(), support: typeof claim.support === "string" ? claim.support : null });
  }
  const known = new Set(judgeProblemNames(kind));
  const listed = Array.isArray(value.problems) ? value.problems.filter((entry): entry is string => typeof entry === "string" && known.has(entry)) : [];
  const unsupported = claims.filter((claim) => !isSupported(claim.support, promptWords, promptText)).map((claim) => claim.text);
  const problems = [...new Set([...listed, ...(unsupported.length > 0 ? ["invents_fact"] : [])])];
  const modelSaidFail = value.verdict === "fail" && problems.length === 0;
  return {
    verdict: problems.length > 0 ? "fail" : "pass",
    modelSaidFail,
    problems,
    claims,
    unsupported,
    note: modelSaidFail ? "model said fail" : unsupported.map((claim) => `unsupported: ${claim}`).join("; "),
  };
}

export type JudgeOutcome =
  | { status: "pass"; modelSaidFail?: true } // modelSaidFail: the model said fail but gave no reason, so the pass stands
  | { status: "fail"; reason: string; note: string }
  // "outage": Ollama failed (the backend counts it); "context": the judge prompt did not fit; "unreadable": no usable verdict.
  | { status: "unavailable"; kind: "outage" | "context" | "unreadable" | "request"; error: string };

// One extra Ollama call with thinking on, temperature 0 and a fixed seed. It is not part of the game's calls, so it
// never reaches `backend.calls` and cannot count against the one-call accept rule. A null backend means --no-judge.
// Ollama failures are recorded by the backend (for the circuit breaker) and reported as "unavailable".
export async function runJudge(
  backend: Pick<OllamaBackend, "chatJson"> | null,
  kind: JudgeKind,
  context: readonly ChatMessage[],
  candidate: string,
  options: { model?: string; think?: ThinkSetting } = {},
): Promise<JudgeOutcome> {
  if (!backend) return { status: "pass" };
  const request = judgeRequest(kind, context, candidate);
  let text: string;
  try {
    text = await backend.chatJson(request.messages, request.schema, {
      temperature: 0,
      maxTokens: JUDGE_MAX_TOKENS,
      seed: JUDGE_SEED,
      exact: true,
      think: options.think ?? true,
      ...(options.model ? { model: options.model } : {}),
    });
  } catch (error) {
    const kindOfFailure = error instanceof OllamaError && (error.kind === "context" || error.kind === "request") ? error.kind : "outage";
    return { status: "unavailable", kind: kindOfFailure, error: error instanceof Error ? error.message : String(error) };
  }
  const verdict = parseVerdict(text, kind, context.filter((message) => message.role !== "system").map((message) => message.content).join("\n"));
  if (!verdict) return { status: "unavailable", kind: "unreadable", error: "the judge did not return a readable verdict" };
  if (verdict.verdict === "pass") return verdict.modelSaidFail ? { status: "pass", modelSaidFail: true } : { status: "pass" };
  return { status: "fail", reason: `judge ${verdict.problems.join(",")}`, note: verdict.note };
}

// The reject reason to log when the judge could not give a verdict, or null when it did or Ollama itself failed
// (an outage is already counted by the backend and is not logged as a reject).
export function judgeProblemReason(outcome: JudgeOutcome): "judge unreadable" | "judge context" | null {
  if (outcome.status !== "unavailable") return null;
  return outcome.kind === "unreadable" ? "judge unreadable" : outcome.kind === "context" ? "judge context" : null;
}

export type SummaryAction =
  | { kind: "emit" }
  | { kind: "skip" } // the quota is full: the summary is only used as the story state
  | { kind: "reject"; reason: string; note?: string }
  | { kind: "incomplete"; outcome: JudgeOutcome }; // no verdict: the session is not done

// A summary that passed the cheap checks always becomes the state's summary. Whether it also becomes a record
// is decided here: only then is it deduped and judged, and a failure stops the record, never the state.
export async function decideSummary(input: {
  willEmit: boolean;
  duplicate: () => "duplicate" | "repeat" | null;
  judge: () => Promise<JudgeOutcome>;
}): Promise<SummaryAction> {
  if (!input.willEmit) return { kind: "skip" };
  const duplicate = input.duplicate();
  if (duplicate) return { kind: "reject", reason: `${duplicate} summary` };
  const outcome = await input.judge();
  if (outcome.status === "fail") return { kind: "reject", reason: outcome.reason, note: outcome.note };
  if (outcome.status === "unavailable") return { kind: "incomplete", outcome };
  return { kind: "emit" };
}
