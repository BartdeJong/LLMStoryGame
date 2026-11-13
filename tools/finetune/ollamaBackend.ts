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
export const NUM_CTX = 8192;
export const MAX_CONSECUTIVE_OUTAGES = 5;

// "http" and "connection" mean Ollama itself was unavailable; "context" means this one prompt did not fit.
export type OllamaFailureKind = "http" | "connection" | "context";

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
  private seedKey = "";
  private callIndex = 0;
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
  }

  drainFailures(): OllamaError[] {
    return this.failures.splice(0, this.failures.length);
  }

  async load(tag: string, onProgress: (progress: LoadProgress) => void = () => {}): Promise<LoadResult> {
    const started = Date.now();
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

  // A free-form JSON request outside the game's pipeline (player messages). Returns the raw text.
  async chatJson(messages: ChatMessage[], schema: Record<string, unknown>, options: { temperature?: number; maxTokens?: number } = {}): Promise<string> {
    const body = await this.chat(messages, schema, {
      temperature: this.options.temperature ?? options.temperature ?? 1,
      num_predict: options.maxTokens ?? 600,
    });
    return body.message?.content ?? "";
  }

  async unload(): Promise<void> {}

  private async chat(
    messages: ChatMessage[],
    format: Record<string, unknown> | undefined,
    options: Record<string, number>,
    signal?: AbortSignal,
  ): Promise<ChatResponse> {
    if (!this.model) throw new Error("OllamaBackend.load() must be called before generating.");
    try {
      const body = await this.request(messages, format, options, signal);
      this.consecutiveOutages = 0;
      return body;
    } catch (error) {
      if (error instanceof OllamaError) {
        if (error.kind !== "context") {
          this.consecutiveOutages += 1;
          this.totalOutages += 1;
        } else this.consecutiveOutages = 0;
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
  ): Promise<ChatResponse> {
    // Conservative size check before sending (about 3 characters per token): prompt_eval_count can read low
    // when Ollama reuses a cached prefix, so it is not the only guard.
    const chars = messages.reduce((sum, message) => sum + message.content.length, 0);
    if (chars / 3 > NUM_CTX - (options.num_predict ?? 0)) {
      throw new OllamaError("context", `context overflow: about ${Math.ceil(chars / 3)} prompt tokens plus ${options.num_predict ?? 0} to generate do not fit in ${NUM_CTX}`);
    }
    const timeout = AbortSignal.timeout(this.options.requestTimeoutMs ?? 300_000);
    this.callIndex += 1;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.host}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: false,
          think: false,
          ...(format ? { format } : {}),
          options: { ...options, num_ctx: NUM_CTX, seed: hashSeed(`${this.seedKey}:${this.callIndex}`) },
        }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      throw new OllamaError("connection", `Could not reach Ollama at ${this.host}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) throw new OllamaError("http", `Ollama /api/chat failed with HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
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
