import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasModelInCache } from "@mlc-ai/web-llm";
import type { ChatCompletionChunk, ChatCompletionRequest } from "@mlc-ai/web-llm";
import { LLMClient } from "./client";
import { parseJsonLoose } from "./json";
import { WebLLMBackend } from "./webllmBackend";
import type { GenerationParams } from "./types";

const engine = vi.hoisted(() => ({
  create: vi.fn<(request: ChatCompletionRequest) => Promise<AsyncIterable<ChatCompletionChunk>>>(),
  reload: vi.fn<(modelId: string) => Promise<void>>(),
  unload: vi.fn<() => Promise<void>>(),
  interruptGenerate: vi.fn(),
}));

vi.mock("@mlc-ai/web-llm", () => ({
  hasModelInCache: vi.fn().mockResolvedValue(true),
  WebWorkerMLCEngine: class {
    chat = { completions: { create: engine.create } };
    reload = engine.reload;
    unload = engine.unload;
    interruptGenerate = engine.interruptGenerate;
  },
}));

const QWEN = "Qwen3.5-9B-q4f16_1-MLC";
const OTHER = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";

function params(overrides: Partial<GenerationParams> = {}): GenerationParams {
  return {
    messages: [{ role: "user", content: 'Return JSON: {"line": "Hello."}' }],
    jsonSchema: { type: "object", properties: { line: { type: "string" } }, required: ["line"] },
    maxTokens: 160,
    temperature: 0.8,
    signal: new AbortController().signal,
    tag: "dialogue",
    ...overrides,
  };
}

async function* chunks(text = '{"line":"Good morning, friend."}'): AsyncGenerator<ChatCompletionChunk> {
  yield {
    id: "test",
    object: "chat.completion.chunk",
    created: 0,
    model: QWEN,
    choices: [{ index: 0, delta: { content: text }, finish_reason: null, logprobs: null }],
  };
}

async function load(modelId = QWEN): Promise<WebLLMBackend> {
  const backend = new WebLLMBackend();
  await backend.load(modelId, () => {});
  return backend;
}

describe("WebLLM Qwen3.5 dialogue profile", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("Worker", class {});
    vi.mocked(hasModelInCache).mockResolvedValue(true);
    engine.reload.mockResolvedValue();
    engine.unload.mockResolvedValue();
    engine.create.mockImplementation(async () => chunks());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([QWEN, "Qwen3.5-9B-q4f32_1-MLC"])("uses direct answers and stable dialogue sampling for %s", async (modelId) => {
    const backend = await load(modelId);
    const client = new LLMClient(backend, { pauseWhenHidden: false });
    expect(client.dialoguePromptStyle).toBe("compact");
    const request = params();
    const result = await backend.generate(request);
    await backend.generate(params({ temperature: 1.0 }));

    expect(result.text).toBe('{"line":"Good morning, friend."}');
    for (const [sent] of engine.create.mock.calls) {
      expect(sent).toMatchObject({
        messages: request.messages,
        stream: true,
        stream_options: { include_usage: true },
        temperature: 0.7,
        top_p: 0.8,
        repetition_penalty: 1,
        presence_penalty: 0,
        frequency_penalty: 0,
        max_tokens: 256,
        extra_body: { enable_thinking: false },
        response_format: { type: "json_object", schema: JSON.stringify(request.jsonSchema) },
      });
    }
  });

  it("preserves other models' sampling and prompt style, including after a switch", async () => {
    const backend = await load();
    await backend.load(OTHER, () => {});
    expect(new LLMClient(backend).dialoguePromptStyle).toBe("standard");
    await backend.generate(params({ temperature: 0.9 }));
    const sent = engine.create.mock.calls[0]![0];
    expect(sent).toMatchObject({ temperature: 0.9, max_tokens: 160 });
    expect(sent).not.toHaveProperty("extra_body");
    expect(sent).not.toHaveProperty("top_p");
    expect(sent).not.toHaveProperty("presence_penalty");
  });

  it("disables Qwen thinking for other JSON tasks without changing their budgets or sampling", async () => {
    const backend = await load();
    await backend.generate(params({ tag: "area", maxTokens: 900, temperature: 0.4 }));
    const sent = engine.create.mock.calls[0]![0];
    expect(sent).toMatchObject({ max_tokens: 900, temperature: 0.4, extra_body: { enable_thinking: false } });
    expect(sent).not.toHaveProperty("top_p");
  });

  it("does not reduce a larger dialogue budget", async () => {
    const backend = await load();
    await backend.generate(params({ maxTokens: 400 }));
    expect(engine.create.mock.calls[0]![0].max_tokens).toBe(400);
  });

  it("accepts WebLLM's empty thinking prefix through the existing JSON parser", async () => {
    const backend = await load();
    engine.create.mockImplementationOnce(async () => chunks('<think>\n\n</think>\n\n{"line":"Good morning, friend."}'));
    const result = await backend.generate(params());
    expect(parseJsonLoose(result.text)).toEqual({ ok: true, value: { line: "Good morning, friend." } });
  });

  it.each([
    new Error("Failed to initialize the grammar matcher for response format `json_object`: unsupported"),
    "GrammarMatcherInitError: Failed to initialize the grammar matcher for response format `json_object`: unsupported",
  ])("logs grammar fallback, retains non-thinking settings, and retries schema after reload", async (error) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const backend = await load();
    engine.create.mockRejectedValueOnce(error);
    await backend.generate(params());
    await backend.generate(params());
    expect(warn).toHaveBeenCalledOnce();
    expect(engine.create.mock.calls[0]![0]).toHaveProperty("response_format");
    for (const [sent] of engine.create.mock.calls.slice(1)) {
      expect(sent).not.toHaveProperty("response_format");
      expect(sent).toMatchObject({ extra_body: { enable_thinking: false }, temperature: 0.7 });
    }
    await backend.load(QWEN, () => {});
    await backend.generate(params());
    expect(engine.create.mock.calls.at(-1)![0]).toHaveProperty("response_format");
  });

  it("surfaces non-grammar errors without retrying or disabling schema guidance", async () => {
    const backend = await load();
    engine.create.mockRejectedValueOnce(new Error("GPU device lost"));
    await expect(backend.generate(params())).rejects.toThrow("GPU device lost");
    expect(engine.create).toHaveBeenCalledOnce();
    await backend.generate(params());
    expect(engine.create.mock.calls.at(-1)![0]).toHaveProperty("response_format");
  });

  it("does not retry cancelled generation or disable schema guidance", async () => {
    const backend = await load();
    const abort = new AbortController();
    engine.create.mockImplementationOnce(async () => {
      abort.abort();
      throw new Error("Failed to initialize the grammar matcher");
    });
    await expect(backend.generate(params({ signal: abort.signal }))).rejects.toMatchObject({ name: "AbortError" });
    expect(engine.interruptGenerate).toHaveBeenCalledOnce();
    expect(engine.create).toHaveBeenCalledOnce();
    await backend.generate(params());
    expect(engine.create.mock.calls.at(-1)![0]).toHaveProperty("response_format");
  });

  it("clears the profile and rejects generation after unloading or a failed load", async () => {
    const backend = await load();
    await backend.unload();
    expect(backend.dialoguePromptStyle).toBe("standard");
    await expect(backend.generate(params())).rejects.toThrow("Model is not loaded");
    engine.reload.mockRejectedValueOnce(new Error("Loading failed"));
    await expect(backend.load(QWEN, () => {})).rejects.toThrow("Loading failed");
    expect(backend.dialoguePromptStyle).toBe("standard");
    await expect(backend.generate(params())).rejects.toThrow("Model is not loaded");
  });
});
