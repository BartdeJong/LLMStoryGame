import { hashSeed } from "../../src/art/random";
import type { ChatMessage, GenerationParams, LLMBackend, LoadProgress, LoadResult, RawResult } from "../../src/llm/types";

export interface RecordedCall {
  tag: string;
  messages: ChatMessage[];
  text: string;
}

export interface OllamaBackendOptions {
  host?: string;
  // Overrides the temperature of every request (dialogue included).
  temperature?: number;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
}

export const DEFAULT_OLLAMA_HOST = "http://localhost:11434";
// Ollama takes true/false for thinking, and "low" asks a model that supports levels for less of it.
export type ThinkSetting = boolean | "low";
export const NUM_CTX = 8192;
export const MAX_CONSECUTIVE_OUTAGES = 5;

// "http" and "connection" mean Ollama itself was unavailable; "context" means this one prompt did not fit.
// "request" is HTTP 400: the request itself is invalid (for example a think level the model lacks), not an outage.
export type OllamaFailureKind = "http" | "connection" | "context" | "request";

export class OllamaError extends Error {
  constructor(readonly kind: OllamaFailureKind, message: string) {
    super(message);
    this.name = "OllamaError";
  }
}

interface ChatResponse {
  message?: { content?: string };
  eval_count?: number;
  eval_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
}

// Local Ollama as the "teacher" backend. It plugs into the game's own LLMClient, so the game builds every
// prompt; this class only sends them and records each call (tag, messages, raw text) in `calls`.
export class OllamaBackend implements LLMBackend {
  readonly name = "ollama";
  readonly dialoguePromptStyle = "compact" as const;
  readonly supportsSpeculation = false;
  readonly calls: RecordedCall[] = [];
  readonly failures: OllamaError[] = [];
  // HTTP or connection failures in a row; any good answer resets it. The CLI stops at MAX_CONSECUTIVE_OUTAGES.
  consecutiveOutages = 0;
  // Every HTTP or connection failure so far, so a session can tell whether an outage touched it.
  totalOutages = 0;
  // Judge answers in a row that could not be parsed. The CLI stops at MAX_CONSECUTIVE_OUTAGES.
  consecutiveUnreadable = 0;
  // HTTP 400 answers in a row (game, summary, ending and player-message calls reject the sample; the CLI stops at the limit).
  consecutiveRequestErrors = 0;
  private seedKey = "";
  private callIndex = 0; // game calls of this session; seeds them
  private sideIndex = 0; // chatJson calls (player messages, the judge); they never move callIndex
  private model = "";
  private readonly host: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OllamaBackendOptions = {}) {
    this.host = (options.host ?? DEFAULT_OLLAMA_HOST).replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  get modelTag(): string {
    return this.model;
  }

  // Takes the recorded calls and clears the list.
  drain(): RecordedCall[] {
    return this.calls.splice(0, this.calls.length);
  }

  // Seeds are derived from this key and the call index, so a rerun of a session repeats its samples.
  beginSession(key: string): void {
    this.seedKey = key;
    this.callIndex = 0;
    this.sideIndex = 0;
  }

  drainFailures(): OllamaError[] {
    return this.failures.splice(0, this.failures.length);
  }

  // Throws, listing the installed tags, when the model is not installed.
  async checkModel(tag: string): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.host}/api/tags`);
    } catch (error) {
      throw new Error(`Could not reach Ollama at ${this.host}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) throw new Error(`Ollama at ${this.host} answered HTTP ${response.status} for /api/tags.`);
    const data = (await response.json()) as { models?: { name?: string }[] };
    const names = (data.models ?? []).map((entry) => entry.name ?? "").filter(Boolean);
    if (!names.includes(tag) && !names.includes(`${tag}:latest`)) {
      throw new Error(`Model "${tag}" is not installed in Ollama. Available tags: ${names.join(", ") || "(none)"}`);
    }
  }

  async load(tag: string, onProgress: (progress: LoadProgress) => void = () => {}): Promise<LoadResult> {
    const started = Date.now();
    await this.checkModel(tag);
    this.model = tag;
    onProgress({ progress: 1, text: `Using ${tag}`, timeMs: Date.now() - started });
    return { loadTimeMs: Date.now() - started, fromCache: true };
  }

  async generate(params: GenerationParams): Promise<RawResult> {
    const tag = params.tag ?? "other";
    // The dialogue settings mirror the WebLLM backend (src/llm/webllmBackend.ts).
    const isDialogue = tag === "dialogue";
    const temperature = this.options.temperature ?? (isDialogue ? 0.7 : params.temperature);
    const body = await this.chat(params.messages, params.jsonSchema, {
      temperature,
      // Same sampling as the WebLLM backend; top_k 0 turns the cut-off off.
      ...(isDialogue ? { top_p: 0.8, top_k: 0, repeat_penalty: 1, presence_penalty: 0, frequency_penalty: 0 } : {}),
      num_predict: isDialogue ? Math.max(params.maxTokens, 256) : params.maxTokens,
    }, params.signal);
    const text = body.message?.content ?? "";
    this.calls.push({ tag, messages: params.messages.map((message) => ({ ...message })), text });
    const tokens = body.eval_count ?? 0;
    const decodeSeconds = Math.max((body.eval_duration ?? 0) / 1e9, 0.001);
    return { text, tokens, timeToFirstTokenMs: (body.prompt_eval_duration ?? 0) / 1e6, tokensPerSecond: tokens / decodeSeconds };
  }

  // A free-form JSON request outside the game's pipeline (player messages, the judge). Returns the raw text and is
  // never recorded in `calls`. `exact` keeps the given temperature even when a --temperature override is set.
  async chatJson(
    messages: ChatMessage[],
    schema: Record<string, unknown>,
    options: { temperature?: number; maxTokens?: number; seed?: number; exact?: boolean; think?: ThinkSetting; model?: string } = {},
  ): Promise<string> {
    const temperature = options.exact ? options.temperature ?? 0 : this.options.temperature ?? options.temperature ?? 1;
    const body = await this.chat(messages, schema, {
      temperature,
      num_predict: options.maxTokens ?? 600,
      ...(options.seed !== undefined ? { seed: options.seed } : {}),
    }, undefined, { side: true, think: options.think ?? false, ...(options.model ? { model: options.model } : {}) });
    // With thinking on, the reasoning comes in its own field; a model that inlines it gets the tags cut out.
    // An unclosed <think> runs to the end of the text, so what follows it is not an answer.
    return (body.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").replace(/<think>[\s\S]*$/, "").trim();
  }

  // An answer that came back but could not be used (an unreadable judge verdict) has its own count, separate
  // from HTTP and connection failures. Only a parsed verdict (noteVerdict) resets it.
  noteUnreadable(): void {
    this.consecutiveUnreadable += 1;
  }

  noteVerdict(): void {
    this.consecutiveUnreadable = 0;
  }

  async unload(): Promise<void> {}

  private async chat(
    messages: ChatMessage[],
    format: Record<string, unknown> | undefined,
    options: Record<string, number>,
    signal?: AbortSignal,
    extra: { side?: boolean; think?: ThinkSetting; model?: string } = {},
  ): Promise<ChatResponse> {
    if (!this.model) throw new Error("OllamaBackend.load() must be called before generating.");
    try {
      const body = await this.request(messages, format, options, signal, extra);
      this.consecutiveOutages = 0;
      this.consecutiveRequestErrors = 0;
      return body;
    } catch (error) {
      if (error instanceof OllamaError) {
        if (error.kind === "http" || error.kind === "connection") {
          this.consecutiveOutages += 1;
          this.totalOutages += 1;
        } else if (error.kind === "context") this.consecutiveOutages = 0;
        if (error.kind === "request") this.consecutiveRequestErrors += 1;
        this.failures.push(error);
      }
      throw error;
    }
  }

  private async request(
    messages: ChatMessage[],
    format: Record<string, unknown> | undefined,
    options: Record<string, number>,
    signal?: AbortSignal,
    extra: { side?: boolean; think?: ThinkSetting; model?: string } = {},
  ): Promise<ChatResponse> {
    const side = extra.side === true;
    // Conservative size check before sending (about 3 characters per token): prompt_eval_count can read low
    // when Ollama reuses a cached prefix, so it is not the only guard.
    const chars = messages.reduce((sum, message) => sum + message.content.length, 0);
    if (chars / 3 > NUM_CTX - (options.num_predict ?? 0)) {
      throw new OllamaError("context", `context overflow: about ${Math.ceil(chars / 3)} prompt tokens plus ${options.num_predict ?? 0} to generate do not fit in ${NUM_CTX}`);
    }
    const timeout = AbortSignal.timeout(this.options.requestTimeoutMs ?? 300_000);
    const seedKey = side ? `${this.seedKey}:side:${++this.sideIndex}` : `${this.seedKey}:${++this.callIndex}`;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.host}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: extra.model ?? this.model,
          messages,
          stream: false,
          think: extra.think ?? false,
          ...(format ? { format } : {}),
          options: { num_ctx: NUM_CTX, seed: hashSeed(seedKey), ...options },
        }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      throw new OllamaError("connection", `Could not reach Ollama at ${this.host}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) throw new OllamaError(response.status === 400 ? "request" : "http", `Ollama /api/chat failed with HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    let body: ChatResponse;
    try {
      body = (await response.json()) as ChatResponse;
    } catch (error) {
      throw new OllamaError("http", `Ollama sent an unreadable response: ${error instanceof Error ? error.message : String(error)}`);
    }
    // A prompt that fills the context window was cut short by Ollama, so its answer is not trustworthy.
    if ((body.prompt_eval_count ?? 0) >= NUM_CTX - (options.num_predict ?? 0)) {
      throw new OllamaError("context", `context overflow: the prompt used ${body.prompt_eval_count} of ${NUM_CTX} (${options.num_predict ?? 0} reserved for the answer)`);
    }
    return body;
  }
}
