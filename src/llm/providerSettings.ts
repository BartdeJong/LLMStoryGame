export type LLMProvider = "local" | "bedrock";

export interface LLMProviderSettings {
  provider: LLMProvider;
  bedrockEndpoint: string;
  bedrockToken: string;
}

const STORAGE_KEY = "cozy-mystery.llm-provider";

const DEFAULT_SETTINGS: LLMProviderSettings = {
  provider: "local",
  bedrockEndpoint: "",
  bedrockToken: "",
};

export function getLLMProviderSettings(): LLMProviderSettings {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return { ...DEFAULT_SETTINGS };
  const value: unknown = JSON.parse(saved);
  if (!value || typeof value !== "object") throw new Error("Saved AI settings are invalid.");
  const settings = value as Partial<LLMProviderSettings>;
  if (settings.provider !== "local" && settings.provider !== "bedrock") {
    throw new Error("Saved AI provider is invalid.");
  }
  if (typeof settings.bedrockEndpoint !== "string" || typeof settings.bedrockToken !== "string") {
    throw new Error("Saved Bedrock connection settings are invalid.");
  }
  return {
    provider: settings.provider,
    bedrockEndpoint: settings.bedrockEndpoint,
    bedrockToken: settings.bedrockToken,
  };
}

export function saveLLMProviderSettings(settings: LLMProviderSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function validateBedrockEndpoint(endpoint: string): string | undefined {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return "Enter a valid HTTPS gateway URL.";
  }
  const localHost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if ((url.protocol !== "https:" && !(localHost && url.protocol === "http:"))
    || url.username || url.password || url.hash) {
    return "Use an HTTPS gateway URL without embedded credentials or a fragment.";
  }
  return undefined;
}
