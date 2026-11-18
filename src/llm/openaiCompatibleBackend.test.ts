import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleBackend } from "./openaiCompatibleBackend";
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

const ok = (content: unknown = "{\"ok\":true}", usage?: unknown): Response =>
  new Response(JSON.stringify({ choices: [{ message: { content } }], usage }), { status: 200 });

const make = (fetchImpl: typeof fetch, baseUrl = "https://llm.example/v1"): OpenAICompatibleBackend =>
  new OpenAICompatibleBackend({ baseUrl, apiKey: "sk-secret", model: "m1" }, { fetchImpl });

const bodyOf = (mock: ReturnType<typeof vi.fn>, call: number): Record<string, unknown> =>
  JSON.parse((mock.mock.calls[call][1] as RequestInit).body as string) as Record<string, unknown>;

describe("OpenAICompatibleBackend", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends URL, headers and body including response_format", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok());
    await expect(make(fetchMock, "https://llm.example/v1/chat/completions/").generate(params)).resolves.toMatchObject({ text: "{\"ok\":true}" });
    expect(fetchMock).toHaveBeenCalledWith("https://llm.example/v1/chat/completions", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-secret" },
      signal: params.signal,
      credentials: "omit",
    }));
    expect(bodyOf(fetchMock, 0)).toEqual({
      model: "m1",
      messages: params.messages,
      temperature: 0.4,
      max_tokens: 200,
      stream: false,
      response_format: { type: "json_schema", json_schema: { name: "response", schema: { type: "object" }, strict: false } },
    });
  });

  it("omits response_format without a schema", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok());
    await make(fetchMock).generate({ ...params, jsonSchema: undefined });
    expect(bodyOf(fetchMock, 0)).not.toHaveProperty("response_format");
  });

  it("uses max_completion_tokens only for api.openai.com", async () => {
    const openai = vi.fn().mockResolvedValue(ok());
    await make(openai, "https://api.openai.com/v1").generate(params);
    expect(bodyOf(openai, 0)).toMatchObject({ max_completion_tokens: 200 });
    expect(bodyOf(openai, 0)).not.toHaveProperty("max_tokens");
    const other = vi.fn().mockResolvedValue(ok());
    await make(other).generate(params);
    expect(bodyOf(other, 0)).toMatchObject({ max_tokens: 200 });
    expect(bodyOf(other, 0)).not.toHaveProperty("max_completion_tokens");
  });

  it("parses content and usage, estimating tokens when usage is missing", async () => {
    await expect(make(vi.fn().mockResolvedValue(ok("abcd", { completion_tokens: 7 }))).generate(params))
      .resolves.toMatchObject({ text: "abcd", tokens: 7 });
    await expect(make(vi.fn().mockResolvedValue(ok("abcdefghi"))).generate(params))
      .resolves.toMatchObject({ text: "abcdefghi", tokens: 3 });
  });

  it("reports 401 with an API key hint and no response body", async () => {
    const backend = make(vi.fn().mockImplementation(async () => new Response("secret details", { status: 401 })));
    await expect(backend.generate(params)).rejects.toThrow("OpenAI-compatible request failed (HTTP 401). Check the API key.");
    await expect(backend.generate(params)).rejects.not.toThrow("secret details");
  });

  it("falls back from json_schema to json_object to plain on HTTP 400", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("no", { status: 400 }))
      .mockResolvedValueOnce(new Response("no", { status: 400 }))
      .mockResolvedValueOnce(ok());
    await expect(make(fetchMock).generate(params)).resolves.toMatchObject({ text: "{\"ok\":true}" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(bodyOf(fetchMock, 1)).toMatchObject({ response_format: { type: "json_object" } });
    expect(bodyOf(fetchMock, 1)).not.toHaveProperty("temperature");
    expect(bodyOf(fetchMock, 2)).not.toHaveProperty("response_format");
    expect(bodyOf(fetchMock, 2)).not.toHaveProperty("temperature");
  });

  it("retries once without temperature on 400 when no schema was requested", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response("no", { status: 400 }));
    await expect(make(fetchMock).generate({ ...params, jsonSchema: undefined })).rejects.toThrow("HTTP 400). Check the model name and endpoint.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed responses", async () => {
    await expect(make(vi.fn().mockResolvedValue(new Response("not json", { status: 200 }))).generate(params)).rejects.toThrow("invalid JSON");
    await expect(make(vi.fn().mockResolvedValue(ok(42))).generate(params)).rejects.toThrow("did not contain");
    await expect(make(vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))).generate(params)).rejects.toThrow("did not contain");
  });

  it("explains network failures with the CORS requirement", async () => {
    vi.stubGlobal("location", { origin: "https://game.example" });
    const backend = make(vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(backend.generate(params)).rejects.toThrow(
      "Could not reach the endpoint at llm.example. It must be reachable and allow browser requests from https://game.example (CORS).",
    );
  });

  it("rethrows aborts unchanged", async () => {
    const abort = new DOMException("aborted", "AbortError");
    await expect(make(vi.fn().mockRejectedValue(abort)).generate(params)).rejects.toBe(abort);
  });

  it("load() accepts valid settings without any network call", async () => {
    const fetchMock = vi.fn();
    const onProgress = vi.fn();
    await expect(make(fetchMock).load("m1", onProgress)).resolves.toMatchObject({ loadTimeMs: 0 });
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ progress: 1, text: "OpenAI-compatible endpoint ready" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("load() rejects a bad URL, blank key or blank model", async () => {
    const f = vi.fn();
    await expect(make(f, "http://remote.example/v1").load("", vi.fn())).rejects.toThrow("HTTPS");
    await expect(make(f, "https://a.example/v1?key=1").load("", vi.fn())).rejects.toThrow("query string");
    await expect(make(f, "nonsense").load("", vi.fn())).rejects.toThrow("valid HTTPS");
    await expect(new OpenAICompatibleBackend({ baseUrl: "https://a.example/v1", apiKey: " ", model: "m" }, { fetchImpl: f }).load("", vi.fn())).rejects.toThrow("API key");
    await expect(new OpenAICompatibleBackend({ baseUrl: "https://a.example/v1", apiKey: "k", model: " " }, { fetchImpl: f }).load("", vi.fn())).rejects.toThrow("model");
  });
});
