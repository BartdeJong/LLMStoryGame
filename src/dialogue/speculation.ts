import type { LLMClient } from "../llm/client";
import { Priority } from "../llm/types";
import type { CastMember } from "../story/types";
import { cleanCharacterLine } from "./lineCleanup";
import { buildGreetingPrompt, buildLineRequest } from "./prompt";
import type { DialogueContext } from "./prompt";
import { isUsableCharacterLine } from "./quality";

export const BASE_TEMPERATURE = 0.8;

// Mutable handle for one line of work. Raising `priority` and promoting `jobId` turns a
// speculative job into a real one when the player asks for it.
export interface LineJob {
  priority: Priority;
  jobId: string;
  readonly signal?: AbortSignal;
}

export interface GreetingResult {
  greeting: string; // the authored greeting the model rephrased
  line: string | null; // a validated rephrasing, or null when the authored greeting should be used
  status: "ok" | "failed";
  error?: string;
}

// Resolves to null when the job was cancelled, so the caller can fall back to a real request.
export async function generateGreeting(
  client: LLMClient,
  character: CastMember,
  context: DialogueContext,
  greeting: string,
  job: LineJob,
  jobId: string,
): Promise<GreetingResult | null> {
  job.jobId = jobId;
  const result = await client.generateJSON({
    ...buildLineRequest(buildGreetingPrompt(character, context, greeting), { temperature: BASE_TEMPERATURE, priority: job.priority, signal: job.signal }),
    id: jobId,
  });
  if (result.status === "cancelled") return null;
  const rephrased = cleanCharacterLine(result.value.line, character.name);
  const usable = result.status !== "failed" && isUsableCharacterLine(rephrased, character.name);
  return {
    greeting,
    line: usable ? rephrased : null,
    status: result.status === "failed" ? "failed" : "ok",
    ...(result.status === "failed" ? { error: result.error ?? "the model did not return a response." } : {}),
  };
}

interface GreetingEntry {
  greeting: string;
  key: string;
  job: LineJob;
  abort: AbortController;
  promise: Promise<GreetingResult | null>;
}

// Pre-generates the rephrased greeting for characters in the current area. Nothing here touches story state.
export class GreetingPrefetcher {
  private readonly entries = new Map<string, GreetingEntry>();
  private counter = 0;

  constructor(
    private readonly client: LLMClient,
    private readonly random: () => number = Math.random,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  prefetch(character: CastMember, context: DialogueContext): void {
    if (!this.client.supportsSpeculation || this.entries.has(character.id) || character.greetings.length === 0) return;
    const greeting = character.greetings[Math.floor(this.random() * character.greetings.length)] ?? "";
    const abort = new AbortController();
    const job: LineJob = { priority: Priority.Speculative, jobId: "", signal: abort.signal };
    const promise = generateGreeting(this.client, character, context, greeting, job, `greet-${character.id}-${++this.counter}`)
      .catch(() => null);
    this.entries.set(character.id, { greeting, key: buildGreetingPrompt(character, context, greeting), job, abort, promise });
  }

  // Hands over the pre-generated greeting if it still matches what a fresh request would ask for.
  take(character: CastMember, context: DialogueContext): Promise<GreetingResult | null> | undefined {
    const entry = this.entries.get(character.id);
    if (!entry) return undefined;
    this.entries.delete(character.id);
    if (entry.key !== buildGreetingPrompt(character, context, entry.greeting)) {
      entry.abort.abort();
      return undefined;
    }
    entry.job.priority = Priority.Dialogue;
    this.client.promote(entry.job.jobId, Priority.Dialogue);
    return entry.promise;
  }

  cancelAll(): void {
    for (const entry of this.entries.values()) entry.abort.abort();
    this.entries.clear();
  }
}
