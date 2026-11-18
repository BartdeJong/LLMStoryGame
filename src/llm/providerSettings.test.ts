import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearObsoleteModelStorage,
  getLLMProviderSettings,
  isOllamaAvailableHere,
  normalizeOpenAIBaseUrl,
  saveLLMProviderSettings,
  validateBedrockEndpoint,
  validateHttpsUrl,
  validateOpenAIBaseUrl,
} from "./providerSettings";
import type { LLMProviderSettings } from "./providerSettings";

const SETTINGS_KEY = "cozy-mystery.llm-provider";

describe("provider settings", () => {
  const values = new Map<string, string>();

  const useHostname = (hostname: string): void => {
    vi.stubGlobal("location", { hostname, origin: `http://${hostname}` });
  };

  beforeEach(() => {
    values.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", platform: "Win32", maxTouchPoints: 0 });
    useHostname("localhost");
  });

  afterEach(() => vi.unstubAllGlobals());

  const blank: LLMProviderSettings = {
    provider: "bedrock",
    bedrockEndpoint: "",
    bedrockToken: "",
    ollamaModel: "",
    openaiBaseUrl: "",
    openaiApiKey: "",
    openaiModel: "",
  };

  it("defaults to Bedrock", () => {
    expect(getLLMProviderSettings()).toEqual(blank);
  });

  it("round-trips the bedrock and ollama providers on localhost", () => {
    const bedrock = { ...blank, bedrockEndpoint: "https://g.example/x", bedrockToken: "t", ollamaModel: "m" };
    saveLLMProviderSettings(bedrock);
    expect(getLLMProviderSettings()).toEqual(bedrock);
    saveLLMProviderSettings({ ...blank, provider: "ollama", ollamaModel: "qwen3.8:27b" });
    expect(getLLMProviderSettings().provider).toBe("ollama");
    expect(getLLMProviderSettings().ollamaModel).toBe("qwen3.8:27b");
  });

  it("round-trips the openai provider on any host", () => {
    const openai = { ...blank, provider: "openai" as const, openaiBaseUrl: "https://api.openai.com/v1", openaiApiKey: "sk", openaiModel: "gpt-4o-mini" };
    saveLLMProviderSettings(openai);
    useHostname("192.168.1.5");
    expect(getLLMProviderSettings()).toEqual(openai);
  });

  it.each(["local", "imported", "other", 5])("falls back to bedrock for the provider %s", (provider) => {
    values.set(SETTINGS_KEY, JSON.stringify({ provider, bedrockEndpoint: "https://g.example/x", bedrockToken: "t" }));
    expect(getLLMProviderSettings()).toEqual({ ...blank, bedrockEndpoint: "https://g.example/x", bedrockToken: "t" });
  });

  it("falls back field by field and never throws on broken data", () => {
    values.set(SETTINGS_KEY, JSON.stringify({ provider: "ollama", bedrockEndpoint: 3, bedrockToken: "t", openaiApiKey: 9, openaiModel: "x" }));
    expect(getLLMProviderSettings()).toEqual({ ...blank, provider: "ollama", bedrockToken: "t", openaiModel: "x" });
    values.set(SETTINGS_KEY, "{not json");
    expect(getLLMProviderSettings().provider).toBe("bedrock");
    values.set(SETTINGS_KEY, "null");
    expect(getLLMProviderSettings().provider).toBe("bedrock");
  });

  it("falls back to bedrock when ollama is saved but unavailable on this host", () => {
    saveLLMProviderSettings({ ...blank, provider: "ollama", ollamaModel: "m" });
    useHostname("192.168.1.5");
    expect(getLLMProviderSettings().provider).toBe("bedrock");
  });
});

describe("normalizeOpenAIBaseUrl", () => {
  it("trims and strips trailing slashes and /chat/completions", () => {
    expect(normalizeOpenAIBaseUrl("  https://a.example/v1/  ")).toBe("https://a.example/v1");
    expect(normalizeOpenAIBaseUrl("https://a.example/v1/chat/completions")).toBe("https://a.example/v1");
    expect(normalizeOpenAIBaseUrl("https://a.example/v1/chat/completions/")).toBe("https://a.example/v1");
  });
});

describe("URL validators", () => {
  it("accepts https and local http", () => {
    expect(validateHttpsUrl("https://a.example/v1", "base")).toBeUndefined();
    expect(validateHttpsUrl("http://localhost:1234/v1", "base")).toBeUndefined();
    expect(validateHttpsUrl("http://127.0.0.1:8000", "base")).toBeUndefined();
    expect(validateHttpsUrl("http://[::1]:8000/v1", "base")).toBeUndefined();
  });

  it("rejects bad, insecure, credentialed or fragment URLs", () => {
    expect(validateHttpsUrl("nope", "base")).toBe("Enter a valid HTTPS base URL.");
    for (const bad of ["http://a.example/v1", "https://u:p@a.example", "https://a.example/#x"]) {
      expect(validateHttpsUrl(bad, "base")).toBe("Use an HTTPS base URL without embedded credentials or a fragment.");
    }
  });

  it("rejects a query string on the OpenAI base URL", () => {
    expect(validateOpenAIBaseUrl("https://a.example/v1?x=1")).toMatch("query string");
    expect(validateOpenAIBaseUrl("https://a.example/v1")).toBeUndefined();
  });

  it("keeps the Bedrock wording", () => {
    expect(validateBedrockEndpoint("x")).toBe("Enter a valid HTTPS gateway URL.");
    expect(validateBedrockEndpoint("http://a.example")).toBe("Use an HTTPS gateway URL without embedded credentials or a fragment.");
    expect(validateBedrockEndpoint("https://g.example/invoke")).toBeUndefined();
  });
});

describe("isOllamaAvailableHere", () => {
  const desktop = { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", platform: "Win32", maxTouchPoints: 0 };

  it("is available on localhost addresses", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]", "::1"]) expect(isOllamaAvailableHere(host, desktop)).toBe(true);
  });

  it("is available on GitHub Pages in a desktop browser", () => {
    expect(isOllamaAvailableHere("someone.github.io", desktop)).toBe(true);
  });

  it("is not available on GitHub Pages on a phone or tablet", () => {
    expect(isOllamaAvailableHere("someone.github.io", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" })).toBe(false);
    expect(isOllamaAvailableHere("someone.github.io", { userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)" })).toBe(false);
    expect(isOllamaAvailableHere("someone.github.io", { userAgent: "Mozilla/5.0 (Linux; Android 14)" })).toBe(false);
    expect(isOllamaAvailableHere("someone.github.io", { userAgent: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", maxTouchPoints: 5 })).toBe(false);
  });

  it("is not available on a LAN address or another domain", () => {
    expect(isOllamaAvailableHere("192.168.1.5", desktop)).toBe(false);
    expect(isOllamaAvailableHere("example.com", desktop)).toBe(false);
    expect(isOllamaAvailableHere("github.io.evil.com", desktop)).toBe(false);
  });
});

describe("clearObsoleteModelStorage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("removes old model keys and caches, ignoring cache failures", async () => {
    const values = new Map<string, string>([
      ["llm.selectedModelId", "a"],
      ["llm.loadedModelId", "b"],
      ["llm.selectedImportedModelId", "c"],
      ["llm.importedModels", "[]"],
      ["llm.importInProgress", "x"],
      [SETTINGS_KEY, "keep"],
    ]);
    vi.stubGlobal("localStorage", { removeItem: (key: string) => values.delete(key) });
    const deleted: string[] = [];
    vi.stubGlobal("caches", {
      delete: async (name: string) => {
        deleted.push(name);
        if (name === "webllm/wasm") throw new Error("denied");
        return true;
      },
    });

    await expect(clearObsoleteModelStorage()).resolves.toBeUndefined();

    expect([...values.keys()]).toEqual([SETTINGS_KEY]);
    expect(deleted).toEqual(["webllm/config", "webllm/wasm", "webllm/model"]);
  });
});
