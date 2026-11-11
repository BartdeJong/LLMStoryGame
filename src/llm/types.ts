import type { TypedSchema } from "./schema";

export const Priority = { Dialogue: 0, Area: 1, Prefetch: 2, Low: 3, Speculative: 4 } as const;
export type Priority = (typeof Priority)[keyof typeof Priority];

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenerationParams {
  messages: ChatMessage[];
  jsonSchema?: Record<string, unknown>;
  maxTokens: number;
  temperature: number;
  signal: AbortSignal;
  // Lets the mock pick canned output; ignored by the real backend.
  tag?: string;
}

export interface RawResult {
  text: string;
  tokens: number;
  timeToFirstTokenMs: number;
  tokensPerSecond: number;
}

export interface LoadProgress {
  progress: number; // 0..1
  text: string;
  timeMs: number;
}

export interface LoadResult {
  loadTimeMs: number;
  fromCache: boolean;
}

export type DialoguePromptStyle = "standard" | "compact";

// Both the WebLLM backend and the mock implement this.
export interface LLMBackend {
  readonly name: string;
  readonly dialoguePromptStyle?: DialoguePromptStyle;
  // False when each request costs money, so replies must not be generated before they are needed.
  readonly supportsSpeculation: boolean;
  load(modelId: string, onProgress: (progress: LoadProgress) => void): Promise<LoadResult>;
  generate(params: GenerationParams): Promise<RawResult>;
  unload(): Promise<void>;
}

export interface JSONRequest<T = unknown> {
  id?: string;
  priority: Priority;
  system: string;
  prompt: string;
  schema: TypedSchema<T>;
  tag?: string;
  maxTokens?: number;
  temperature?: number;
  maxRetries?: number;
  signal?: AbortSignal;
}

export interface GenerationMetrics {
  attempts: number;
  totalMs: number;
  timeToFirstTokenMs: number;
  tokensPerSecond: number;
  tokens: number;
}

export type ResultStatus =
  | "ok" // valid first time or after repair
  | "defaulted" // still invalid after retries; bad fields replaced by defaults
  | "failed" // backend error; whole value is the default
  | "cancelled";

export interface JSONResult<T> {
  id: string;
  status: ResultStatus;
  value: T;
  retries: number;
  issues: string[];
  rawText: string;
  metrics: GenerationMetrics;
  error?: string;
}

export type JobState = "queued" | "running" | "retrying" | "requeued" | "done" | "cancelled";

export interface JobEvent {
  id: string;
  priority: Priority;
  state: JobState;
}

export interface LLMEvents {
  "load-progress": LoadProgress;
  job: JobEvent;
}
