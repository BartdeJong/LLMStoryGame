import { afterEach, describe, expect, it, vi } from "vitest";
import { LLMClient } from "./client";
import {
  DEFAULT_OLLAMA_MODEL,
  OllamaBackend,
  listOllamaModels,
  ollamaUnreachableMessage,
  pickOllamaModel,
} from "./ollamaBackend";
import { dialogueTurnRequest } from "./prompts";
import type { GenerationParams } from "./types";

const params: GenerationParams = {
  messages: [
    { role: "system", content: "Return JSON." },
    { role: "user", content: "Continue the story." },
  ],
  jsonSchema: { type: "object" },
  maxTokens: 200,
  temperature: 0.4,
  signal: new AbortController().signal,
};

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });
const tags = (...names: string[]): Response => json({ models: names.map((name) => ({ name })) });

describe("Ollama helpers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists installed model names", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(tags("a:1", "b:2"));
    await expect(listOllamaModels(fetchImpl)).resolves.toEqual(["a:1", "b:2"]);
    expect(fetchImpl).toHaveBeenCalledWith("http://localhost:11434/api/tags", expect.anything());
  });

  it("explains that Ollama is not running when the request cannot be made", async () => {
    vi.stubGlobal("location", { hostname: "localhost", origin: "http://localhost:5173" });
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(listOllamaModels(fetchImpl)).rejects.toThrow("Ollama is not running on this PC. Start Ollama on this PC and try again.");
  });

  it("mentions OLLAMA_ORIGINS with the real origin away from localhost", () => {
    const message = ollamaUnreachableMessage("https://someone.github.io", "someone.github.io");
    expect(message).toContain("OLLAMA_ORIGINS");
    expect(message).toContain("https://someone.github.io");
    expect(ollamaUnreachableMessage("http://localhost:5173", "localhost")).not.toContain("OLLAMA_ORIGINS");
  });

  it("rejects a models response that is not JSON or has the wrong shape", async () => {
    const unexpected = "Unexpected response from Ollama at http://localhost:11434.";
    await expect(listOllamaModels(vi.fn().mockResolvedValue(new Response("<html>", { status: 200 })))).rejects.toThrow(unexpected);
    await expect(listOllamaModels(vi.fn().mockResolvedValue(json({ models: "nope" })))).rejects.toThrow(unexpected);
    await expect(listOllamaModels(vi.fn().mockResolvedValue(json(null)))).rejects.toThrow(unexpected);
  });

  it("tells non-localhost users about Safari and the local network permission", () => {
    const message = ollamaUnreachableMessage("https://someone.github.io", "someone.github.io");
    expect(message).toContain("Safari blocks this");
    expect(message).toContain("local network");
  });

  it("reports HTTP errors when listing models", async () => {
    await expect(listOllamaModels(vi.fn().mockResolvedValue(new Response("", { status: 500 })))).rejects.toThrow("HTTP 500");
  });

  it("picks the saved model, then the default, then the first", () => {
    expect(pickOllamaModel(["x", "y", DEFAULT_OLLAMA_MODEL], "y")).toBe("y");
    expect(pickOllamaModel(["x", DEFAULT_OLLAMA_MODEL], "gone")).toBe(DEFAULT_OLLAMA_MODEL);
    expect(pickOllamaModel(["x", `${DEFAULT_OLLAMA_MODEL}:latest`], "")).toBe(`${DEFAULT_OLLAMA_MODEL}:latest`);
    expect(pickOllamaModel(["x", "y"], "gone")).toBe("x");
    expect(pickOllamaModel([], "gone")).toBeUndefined();
  });
});

describe("OllamaBackend", () => {
  afterEach(() => vi.unstubAllGlobals());

  const loaded = async (fetchImpl: typeof fetch): Promise<OllamaBackend> => {
    const backend = new OllamaBackend({ fetchImpl });
    await backend.load("m:1", () => {});
    return backend;
  };

  it("rejects a model that is not installed", async () => {
    const backend = new OllamaBackend({ fetchImpl: vi.fn().mockResolvedValue(tags("other")) });
    await expect(backend.load("m:1", () => {})).rejects.toThrow("not installed");
  });

  it("sends the chat request with the schema, no thinking and no streaming", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(tags("m:1"))
      .mockResolvedValueOnce(json({ message: { content: "{\"ok\":true}" }, eval_count: 10, eval_duration: 2e9 }));
    const backend = await loaded(fetchImpl);

    const result = await backend.generate(params);

    expect(result).toMatchObject({ text: "{\"ok\":true}", tokens: 10, tokensPerSecond: 5 });
    const [url, init] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("http://localhost:11434/api/chat");
    expect(init.method).toBe("POST");
    expect(init.signal).toBe(params.signal);
    expect(JSON.parse(init.body as string)).toEqual({
      model: "m:1",
      messages: params.messages,
      stream: false,
      think: false,
      format: params.jsonSchema,
      options: { temperature: 0.4, num_predict: 200 },
    });
  });

  it("reports HTTP errors with part of the response text", async () => {
    const backend = await loaded(vi.fn().mockResolvedValueOnce(tags("m:1")).mockResolvedValueOnce(new Response("boom", { status: 500 })));
    await expect(backend.generate(params)).rejects.toThrow("Ollama request failed (HTTP 500): boom");
  });

  it("rejects a response without message content", async () => {
    const backend = await loaded(vi.fn().mockResolvedValueOnce(tags("m:1")).mockResolvedValueOnce(json({})));
    await expect(backend.generate(params)).rejects.toThrow("message");
  });

  it("rethrows aborts unchanged and maps other network failures", async () => {
    vi.stubGlobal("location", { hostname: "localhost", origin: "http://localhost:5173" });
    const abort = new DOMException("aborted", "AbortError");
    const aborted = await loaded(vi.fn().mockResolvedValueOnce(tags("m:1")).mockRejectedValueOnce(abort));
    await expect(aborted.generate(params)).rejects.toBe(abort);
    const down = await loaded(vi.fn().mockResolvedValueOnce(tags("m:1")).mockRejectedValueOnce(new TypeError("Failed to fetch")));
    await expect(down.generate(params)).rejects.toThrow("Start Ollama on this PC");
  });

  it("works end to end through LLMClient.generateJSON", async () => {
    const turn = JSON.stringify({
      line: "Hello there.",
      mode: "choices",
      choices: ["Hi", "Bye"],
      effects: { give_item: null, reveal_clue: null, goal_progress: 0.5 },
    });
    const fetchImpl = vi.fn().mockResolvedValueOnce(tags("m:1")).mockResolvedValue(json({ message: { content: turn } }));
    const client = new LLMClient(new OllamaBackend({ fetchImpl }), { pauseWhenHidden: false });
    await client.load("m:1");
    const result = await client.generateJSON(dialogueTurnRequest());
    expect(result.status).toBe("ok");
  });
});
