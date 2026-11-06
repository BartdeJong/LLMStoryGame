import { LLM_CONFIG } from "./config";
import { defaultValue, toJsonSchema, validate } from "./schema";
import type { ChatMessage, GenerationMetrics, JSONRequest, JSONResult, LLMBackend } from "./types";

const JSON_RULE = "Reply with a single JSON object only. No markdown, no commentary.";

export function parseJsonLoose(text: string): { ok: true; value: unknown } | { ok: false } {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const candidates = [trimmed];
  const start = trimmed.search(/[{[]/);
  const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      return { ok: true, value: JSON.parse(candidate) };
    } catch {
      // try the next candidate
    }
  }
  return { ok: false };
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function repairMessages(base: ChatMessage[], previous: string, issues: string[]): ChatMessage[] {
  const problems = issues.slice(0, 4).join("; ");
  return [
    ...base,
    { role: "assistant", content: previous.slice(0, 600) },
    { role: "user", content: `That reply had problems: ${problems}. Reply again with only the corrected JSON.` },
  ];
}

// Runs one request with validation and up to maxRetries repair prompts.
// Never throws: problems come back as a status plus a safe value.
export async function runJsonRequest<T>(
  backend: LLMBackend,
  request: JSONRequest<T>,
  id: string,
  signal: AbortSignal,
  onRetry: () => void = () => {},
): Promise<JSONResult<T>> {
  const startedAt = performance.now();
  const maxRetries = request.maxRetries ?? LLM_CONFIG.maxRetries;
  const baseMessages: ChatMessage[] = [
    { role: "system", content: `${request.system}\n${JSON_RULE}` },
    { role: "user", content: request.prompt },
  ];
  const metrics: GenerationMetrics = { attempts: 0, totalMs: 0, timeToFirstTokenMs: 0, tokensPerSecond: 0, tokens: 0 };
  const finish = (partial: Pick<JSONResult<T>, "status" | "value" | "issues" | "rawText"> & { error?: string }): JSONResult<T> => {
    metrics.totalMs = performance.now() - startedAt;
    return { id, retries: Math.max(0, metrics.attempts - 1), metrics, ...partial };
  };

  let messages = baseMessages;
  let best: { value: unknown; issues: string[]; rawText: string } | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (signal.aborted) return finish({ status: "cancelled", value: defaultValue(request.schema) as T, issues: [], rawText: "" });
    if (attempt > 0) onRetry();
    metrics.attempts += 1;

    let text: string;
    try {
      const raw = await backend.generate({
        messages,
        jsonSchema: toJsonSchema(request.schema),
        maxTokens: request.maxTokens ?? 700,
        temperature: request.temperature ?? 0.7,
        signal,
        tag: request.tag,
      });
      text = raw.text;
      if (attempt === 0) metrics.timeToFirstTokenMs = raw.timeToFirstTokenMs;
      metrics.tokens += raw.tokens;
      metrics.tokensPerSecond = raw.tokensPerSecond;
    } catch (error) {
      if (isAbort(error) || signal.aborted) {
        return finish({ status: "cancelled", value: defaultValue(request.schema) as T, issues: [], rawText: "" });
      }
      return finish({
        status: "failed",
        value: defaultValue(request.schema) as T,
        issues: [],
        rawText: "",
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const parsed = parseJsonLoose(text);
    const result = parsed.ok ? validate(request.schema, parsed.value) : { value: defaultValue(request.schema), issues: ["$: not valid JSON"] };
    if (result.issues.length === 0) return finish({ status: "ok", value: result.value as T, issues: [], rawText: text });

    if (!best || result.issues.length < best.issues.length) best = { ...result, rawText: text };
    messages = repairMessages(baseMessages, text, result.issues);
  }

  // Out of retries: keep the best attempt, with invalid fields already defaulted.
  const final = best!;
  return finish({ status: "defaulted", value: final.value as T, issues: final.issues, rawText: final.rawText });
}
