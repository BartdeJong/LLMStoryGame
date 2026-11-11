import { hasModelInCache, WebWorkerMLCEngine } from "@mlc-ai/web-llm";
import type { ChatCompletionChunk } from "@mlc-ai/web-llm";
import type { DialoguePromptStyle, GenerationParams, LLMBackend, LoadProgress, LoadResult, RawResult } from "./types";

function abortError(): Error {
  return Object.assign(new Error("Aborted"), { name: "AbortError" });
}

// WebLLM engine proxy. The engine itself lives in ./worker.ts, so the main thread only posts messages.
export class WebLLMBackend implements LLMBackend {
  readonly name = "webllm";
  readonly supportsSpeculation = true;
  private worker: Worker | null = null;
  private engine: WebWorkerMLCEngine | null = null;
  private modelId: string | null = null;
  private onProgress: (progress: LoadProgress) => void = () => {};
  // Set when the runtime rejects schema-guided output; later calls rely on the prompt alone.
  private guidedOutputBroken = false;

  get dialoguePromptStyle(): DialoguePromptStyle {
    return this.modelId ? "compact" : "standard";
  }

  async load(modelId: string, onProgress: (progress: LoadProgress) => void): Promise<LoadResult> {
    this.modelId = null;
    this.guidedOutputBroken = false;
    const fromCache = await hasModelInCache(modelId).catch(() => false);
    this.onProgress = onProgress;
    if (!this.engine) {
      this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      this.engine = new WebWorkerMLCEngine(this.worker, {
        initProgressCallback: (report) =>
          this.onProgress({ progress: report.progress, text: report.text, timeMs: report.timeElapsed * 1000 }),
      });
    }
    const startedAt = performance.now();
    // Files already in the cache are skipped, so an interrupted download resumes where it stopped.
    await this.engine.reload(modelId);
    this.modelId = modelId;
    return { loadTimeMs: performance.now() - startedAt, fromCache };
  }

  async generate(params: GenerationParams): Promise<RawResult> {
    if (!this.engine || !this.modelId) throw new Error("Model is not loaded.");
    if (params.signal.aborted) throw abortError();
    const useSchema = params.jsonSchema !== undefined && !this.guidedOutputBroken;
    try {
      return await this.stream(params, useSchema);
    } catch (error) {
      if (params.signal.aborted) throw abortError();
      // Worker errors arrive as strings, not necessarily Error instances.
      const message = error instanceof Error ? error.message : String(error);
      if (!useSchema || !message.includes("Failed to initialize the grammar matcher")) throw error;
      this.guidedOutputBroken = true;
      console.warn("WebLLM schema-guided output is unavailable; retrying with prompt-only JSON.", error);
      return this.stream(params, false);
    }
  }

  private async stream(params: GenerationParams, useSchema: boolean): Promise<RawResult> {
    const engine = this.engine!;
    const onAbort = () => engine.interruptGenerate();
    params.signal.addEventListener("abort", onAbort, { once: true });
    const startedAt = performance.now();
    let firstTokenAt = 0;
    let text = "";
    let chunkCount = 0;
    let usage: ChatCompletionChunk["usage"];
    const isQwen35 = this.modelId === "Qwen3.5-9B-q4f16_1-MLC" || this.modelId === "Qwen3.5-9B-q4f32_1-MLC";
    const isDialogue = params.tag === "dialogue";
    try {
      const stream = await engine.chat.completions.create({
        messages: params.messages,
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: isDialogue ? Math.max(params.maxTokens, 256) : params.maxTokens,
        temperature: isDialogue ? 0.7 : params.temperature,
        ...(isQwen35 ? { extra_body: { enable_thinking: false } } : {}),
        ...(isDialogue ? { top_p: 0.8, repetition_penalty: 1.0, presence_penalty: 0, frequency_penalty: 0 } : {}),
        ...(useSchema ? { response_format: { type: "json_object" as const, schema: JSON.stringify(params.jsonSchema) } } : {}),
      });
      for await (const chunk of stream) {
        const piece = chunk.choices[0]?.delta?.content;
        if (piece) {
          if (firstTokenAt === 0) firstTokenAt = performance.now();
          text += piece;
          chunkCount += 1;
        }
        if (chunk.usage) usage = chunk.usage;
      }
    } finally {
      params.signal.removeEventListener("abort", onAbort);
    }
    if (params.signal.aborted) throw abortError();

    const endedAt = performance.now();
    const tokens = usage?.completion_tokens ?? chunkCount;
    const decodeSeconds = Math.max((endedAt - (firstTokenAt || startedAt)) / 1000, 0.001);
    return {
      text,
      tokens,
      timeToFirstTokenMs: usage?.extra?.time_to_first_token_s !== undefined ? usage.extra.time_to_first_token_s * 1000 : (firstTokenAt || endedAt) - startedAt,
      tokensPerSecond: usage?.extra?.decode_tokens_per_s ?? tokens / decodeSeconds,
    };
  }

  async unload(): Promise<void> {
    this.modelId = null;
    this.guidedOutputBroken = false;
    await this.engine?.unload();
  }
}

export async function isModelCached(modelId: string): Promise<boolean> {
  return hasModelInCache(modelId).catch(() => false);
}
