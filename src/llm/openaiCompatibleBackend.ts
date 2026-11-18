import type { GenerationParams, LLMBackend, LoadProgress, LoadResult, RawResult } from "./types";
import { normalizeOpenAIBaseUrl, validateOpenAIBaseUrl } from "./providerSettings";

type FetchLike = typeof fetch;

export interface OpenAICompatibleSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: unknown } }[];
  usage?: { completion_tokens?: unknown };
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
    || error instanceof Error && error.name === "AbortError";
}

export class OpenAICompatibleBackend implements LLMBackend {
  readonly name = "openai-compatible";
  readonly supportsSpeculation = false;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly settings: OpenAICompatibleSettings, options: { fetchImpl?: FetchLike } = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  async load(_modelId: string, onProgress: (progress: LoadProgress) => void): Promise<LoadResult> {
    const urlError = validateOpenAIBaseUrl(normalizeOpenAIBaseUrl(this.settings.baseUrl));
    if (urlError) throw new Error(urlError);
    if (!this.settings.apiKey.trim()) throw new Error("Enter the API key.");
    if (!this.settings.model.trim()) throw new Error("Enter the model name.");
    onProgress({ progress: 1, text: "OpenAI-compatible endpoint ready", timeMs: 0 });
    return { loadTimeMs: 0, fromCache: false };
  }

  private async post(base: string, body: Record<string, unknown>, signal: AbortSignal | undefined): Promise<Response> {
    try {
      return await this.fetchImpl(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.settings.apiKey.trim()}`,
        },
        body: JSON.stringify(body),
        signal,
        credentials: "omit",
      });
    } catch (error) {
      if (isAbort(error)) throw error;
      let host = base;
      try {
        host = new URL(base).host;
      } catch {
        // Keep the raw value.
      }
      const origin = typeof location === "undefined" ? "this site" : location.origin;
      throw new Error(`Could not reach the endpoint at ${host}. It must be reachable and allow browser requests from ${origin} (CORS).`);
    }
  }

  async generate(params: GenerationParams): Promise<RawResult> {
    const startedAt = performance.now();
    const base = normalizeOpenAIBaseUrl(this.settings.baseUrl);
    let host = "";
    try {
      host = new URL(base).hostname;
    } catch {
      // Validation in load() reports a bad URL.
    }
    const tokenField = host === "api.openai.com" ? "max_completion_tokens" : "max_tokens";
    const build = (
      responseFormat: Record<string, unknown> | undefined,
      withTemperature: boolean,
    ): Record<string, unknown> => ({
      model: this.settings.model,
      messages: params.messages,
      ...(withTemperature ? { temperature: params.temperature } : {}),
      [tokenField]: params.maxTokens,
      stream: false,
      ...(responseFormat ? { response_format: responseFormat } : {}),
    });

    const schemaFormat = params.jsonSchema
      ? { type: "json_schema", json_schema: { name: "response", schema: params.jsonSchema, strict: false } }
      : undefined;
    let response = await this.post(base, build(schemaFormat, true), params.signal);
    // Some servers reject json_schema or temperature: retry with simpler requests.
    if (response.status === 400) {
      response = await this.post(base, build(params.jsonSchema ? { type: "json_object" } : undefined, false), params.signal);
      // Only a schema request has a response_format left to drop; without one the first retry was already the plain request.
      if (response.status === 400 && params.jsonSchema) {
        response = await this.post(base, build(undefined, false), params.signal);
      }
    }
    if (!response.ok) {
      const hint = response.status === 401 || response.status === 403
        ? " Check the API key."
        : response.status === 400 ? " Check the model name and endpoint." : "";
      throw new Error(`OpenAI-compatible request failed (HTTP ${response.status}).${hint}`);
    }

    let result: ChatCompletionResponse;
    try {
      result = await response.json() as ChatCompletionResponse;
    } catch {
      throw new Error("OpenAI-compatible endpoint returned invalid JSON.");
    }
    const content = result?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("OpenAI-compatible response did not contain choices[0].message.content text.");
    }

    const elapsedMs = performance.now() - startedAt;
    const completion = result.usage?.completion_tokens;
    const tokens = typeof completion === "number" ? completion : Math.ceil(content.length / 4);
    return {
      text: content,
      tokens,
      timeToFirstTokenMs: elapsedMs,
      tokensPerSecond: tokens / Math.max(elapsedMs / 1000, 0.001),
    };
  }

  async unload(): Promise<void> {}
}
