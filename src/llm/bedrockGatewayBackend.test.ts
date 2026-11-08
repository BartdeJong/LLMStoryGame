import { afterEach, describe, expect, it, vi } from "vitest";
import { BedrockGatewayBackend } from "./bedrockGatewayBackend";
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

describe("BedrockGatewayBackend", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends an authorized request using the documented gateway contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: "{\"ok\":true}" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const backend = new BedrockGatewayBackend({ endpoint: "https://gateway.example/invoke", token: "secret" });

    await expect(backend.generate(params)).resolves.toMatchObject({ text: "{\"ok\":true}" });
    expect(fetchMock).toHaveBeenCalledWith("https://gateway.example/invoke", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer secret" },
      body: JSON.stringify({
        messages: params.messages,
        maxTokens: params.maxTokens,
        temperature: params.temperature,
        jsonSchema: params.jsonSchema,
      }),
      signal: params.signal,
    }));
  });

  it("reports HTTP errors without exposing response content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("secret details", { status: 403 })));
    const backend = new BedrockGatewayBackend({ endpoint: "https://gateway.example/invoke", token: "secret" });

    await expect(backend.generate(params)).rejects.toThrow("HTTP 403");
    await expect(backend.generate(params)).rejects.not.toThrow("secret details");
  });

  it("rejects malformed gateway responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: "wrong shape" }), { status: 200 })));
    const backend = new BedrockGatewayBackend({ endpoint: "https://gateway.example/invoke", token: "secret" });

    await expect(backend.generate(params)).rejects.toThrow("must contain a text field");
  });
});
