import { LLM_CONFIG } from "./config";
import { runJsonRequest } from "./json";
import { RequestQueue } from "./queue";
import { defaultValue } from "./schema";
import { Priority } from "./types";
import type { JSONRequest, JSONResult, LLMBackend, LLMEvents, LoadResult } from "./types";

type Listener<K extends keyof LLMEvents> = (event: LLMEvents[K]) => void;

const EMPTY_METRICS = { attempts: 0, totalMs: 0, timeToFirstTokenMs: 0, tokensPerSecond: 0, tokens: 0 };

// Main-thread API for the LLM. Inference happens in the backend (a Web Worker for WebLLM).
export class LLMClient {
  private readonly listeners: { [K in keyof LLMEvents]: Set<Listener<K>> } = { "load-progress": new Set(), job: new Set() };
  private readonly queue: RequestQueue<JSONResult<unknown>>;
  private counter = 0;
  private loaded = false;

  constructor(private readonly backend: LLMBackend, options: { pauseWhenHidden?: boolean } = {}) {
    this.queue = new RequestQueue({
      maxQueuedPrefetch: LLM_CONFIG.maxQueuedPrefetch,
      prefetchPriority: Priority.Prefetch,
      onNotice: (id, priority, notice) => this.emit("job", { id, priority, state: notice }),
    });
    if (options.pauseWhenHidden !== false && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => this.queue.setPaused(document.hidden));
    }
  }

  get isLoaded(): boolean {
    return this.loaded;
  }

  on<K extends keyof LLMEvents>(event: K, listener: Listener<K>): () => void {
    this.listeners[event].add(listener);
    return () => this.listeners[event].delete(listener);
  }

  async load(modelId: string = LLM_CONFIG.modelId): Promise<LoadResult> {
    const result = await this.backend.load(modelId, (progress) => this.emit("load-progress", progress));
    this.loaded = true;
    return result;
  }

  // Always resolves. Check result.status; result.value is always safe to use.
  async generateJSON<T>(request: JSONRequest<T>): Promise<JSONResult<T>> {
    const id = request.id ?? `req-${++this.counter}`;
    const fallback = (status: "failed" | "cancelled", error?: string): JSONResult<T> => ({
      id,
      status,
      value: defaultValue(request.schema) as T,
      retries: 0,
      issues: [],
      rawText: "",
      metrics: { ...EMPTY_METRICS },
      error,
    });
    if (!this.loaded) return fallback("failed", "Model is not loaded.");
    if (request.signal?.aborted) return fallback("cancelled");

    const onAbort = () => this.cancel(id);
    request.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const outcome = await this.queue.enqueue(id, request.priority, (signal) =>
        runJsonRequest(this.backend, request, id, signal, () => this.emit("job", { id, priority: request.priority, state: "retrying" })),
      );
      if (outcome.status === "done") return outcome.value as JSONResult<T>;
      return fallback(outcome.status === "cancelled" ? "cancelled" : "failed", outcome.status === "error" ? outcome.error : undefined);
    } finally {
      request.signal?.removeEventListener("abort", onAbort);
    }
  }

  cancel(id: string): boolean {
    return this.queue.cancel(id);
  }

  cancelAll(maxPriority: Priority = Priority.Low): number {
    return this.queue.cancelWhere((job) => job.priority <= maxPriority);
  }

  setPaused(paused: boolean): void {
    this.queue.setPaused(paused);
  }

  async unload(): Promise<void> {
    this.cancelAll();
    this.loaded = false;
    await this.backend.unload();
  }

  private emit<K extends keyof LLMEvents>(event: K, payload: LLMEvents[K]): void {
    for (const listener of this.listeners[event]) listener(payload);
  }
}
