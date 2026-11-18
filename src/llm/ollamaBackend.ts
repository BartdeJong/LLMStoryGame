import type { GenerationParams, LLMBackend, LoadProgress, LoadResult, RawResult } from "./types";

export const OLLAMA_HOST = "http://localhost:11434";
export const DEFAULT_OLLAMA_MODEL = "qwen3.8:27b";

type FetchLike = typeof fetch;

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

// A blocked cross-origin request looks the same as Ollama not running, so name both causes
// when the page is not served from localhost.
export function ollamaUnreachableMessage(
  origin: string = typeof location === "undefined" ? "" : location.origin,
  hostname: string = typeof location === "undefined" ? "localhost" : location.hostname,
): string {
  const base = "Ollama is not running on this PC. Start Ollama on this PC and try again.";
  if (LOCAL_HOSTNAMES.has(hostname)) return base;
  return `${base} If it is running, Ollama must allow this site: set OLLAMA_ORIGINS to ${origin} and restart Ollama. `
    + "Safari blocks this, so use Chrome, Edge or Firefox. Chrome and Edge may ask permission to access local network devices; allow it.";
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
    || error instanceof Error && error.name === "AbortError";
}

export async function listOllamaModels(fetchImpl: FetchLike = fetch, signal?: AbortSignal): Promise<string[]> {
  let response: Response;
  try {
    response = await fetchImpl(`${OLLAMA_HOST}/api/tags`, { signal });
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new Error(ollamaUnreachableMessage());
  }
  if (!response.ok) throw new Error(`Ollama request failed (HTTP ${response.status}).`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`Unexpected response from Ollama at ${OLLAMA_HOST}.`);
  }
  const models = (body as { models?: unknown } | null)?.models;
  if (!Array.isArray(models)) throw new Error(`Unexpected response from Ollama at ${OLLAMA_HOST}.`);
  return models.flatMap((model: { name?: unknown } | null) => (typeof model?.name === "string" ? [model.name] : []));
}

export function pickOllamaModel(names: readonly string[], saved: string): string | undefined {
  if (saved && names.includes(saved)) return saved;
  if (names.includes(DEFAULT_OLLAMA_MODEL)) return DEFAULT_OLLAMA_MODEL;
  if (names.includes(`${DEFAULT_OLLAMA_MODEL}:latest`)) return `${DEFAULT_OLLAMA_MODEL}:latest`;
  return names[0];
}

interface ChatResponse {
  message?: { content?: unknown };
  eval_count?: unknown;
  eval_duration?: unknown;
}

export class OllamaBackend implements LLMBackend {
  readonly name = "ollama";
  readonly supportsSpeculation = false;
  private readonly fetchImpl: FetchLike;
  private model = "";

  constructor(options: { fetchImpl?: FetchLike } = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  async load(modelId: string, onProgress: (progress: LoadProgress) => void): Promise<LoadResult> {
    const startedAt = performance.now();
    const names = await listOllamaModels(this.fetchImpl);
    if (!modelId || !names.includes(modelId)) {
      throw new Error(`The model "${modelId}" is not installed in Ollama. Run \`ollama pull ${modelId || DEFAULT_OLLAMA_MODEL}\`.`);
    }
    this.model = modelId;
    onProgress({ progress: 1, text: "Ollama ready", timeMs: performance.now() - startedAt });
    return { loadTimeMs: performance.now() - startedAt, fromCache: true };
  }

  async generate(params: GenerationParams): Promise<RawResult> {
    const startedAt = performance.now();
    let response: Response;
    try {
      response = await this.fetchImpl(`${OLLAMA_HOST}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages: params.messages,
          stream: false,
          think: false,
          format: params.jsonSchema,
          options: { temperature: params.temperature, num_predict: params.maxTokens },
        }),
        signal: params.signal,
      });
    } catch (error) {
      if (isAbort(error)) throw error;
      throw new Error(ollamaUnreachableMessage());
    }
    if (!response.ok) {
      const text = (await response.text().catch(() => "")).slice(0, 200);
      throw new Error(`Ollama request failed (HTTP ${response.status}): ${text}`);
    }
    const result = await response.json() as ChatResponse;
    const content = result.message?.content;
    if (typeof content !== "string") throw new Error("Ollama response did not contain a message.");

    const elapsedMs = performance.now() - startedAt;
    const tokens = typeof result.eval_count === "number" ? result.eval_count : Math.ceil(content.length / 4);
    const evalSeconds = typeof result.eval_duration === "number" ? result.eval_duration / 1e9 : elapsedMs / 1000;
    return {
      text: content,
      tokens,
      timeToFirstTokenMs: elapsedMs,
      tokensPerSecond: tokens / Math.max(evalSeconds, 0.001),
    };
  }

  async unload(): Promise<void> {}
}
