export type LLMProvider = "bedrock" | "ollama" | "openai";

export interface LLMProviderSettings {
  provider: LLMProvider;
  bedrockEndpoint: string;
  bedrockToken: string;
  ollamaModel: string;
  openaiBaseUrl: string;
  openaiApiKey: string;
  openaiModel: string;
}

const STORAGE_KEY = "cozy-mystery.llm-provider";

const DEFAULT_SETTINGS: LLMProviderSettings = {
  provider: "bedrock",
  bedrockEndpoint: "",
  bedrockToken: "",
  ollamaModel: "",
  openaiBaseUrl: "",
  openaiApiKey: "",
  openaiModel: "",
};

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const MOBILE_USER_AGENT = /iPhone|iPad|iPod|Android/i;

export interface DeviceInfo {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
}

function isPhoneOrTablet(device: DeviceInfo): boolean {
  if (MOBILE_USER_AGENT.test(device.userAgent ?? "")) return true;
  // iPadOS Safari reports a desktop Mac user agent.
  return device.platform === "MacIntel" && (device.maxTouchPoints ?? 0) > 1;
}

// Ollama runs on this PC at localhost, so it only makes sense when the page is open on that PC:
// served from localhost, or from GitHub Pages in a desktop browser.
export function isOllamaAvailableHere(
  hostname: string = location.hostname,
  device: DeviceInfo = typeof navigator === "undefined" ? {} : navigator,
): boolean {
  const host = hostname.toLowerCase();
  if (LOCAL_HOSTNAMES.has(host)) return true;
  return host.endsWith(".github.io") && !isPhoneOrTablet(device);
}

// Never throws: every field falls back on its own, so one bad value cannot block the game.
export function getLLMProviderSettings(): LLMProviderSettings {
  let value: unknown;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    value = saved ? JSON.parse(saved) : undefined;
  } catch {
    value = undefined;
  }
  const settings = (value && typeof value === "object" ? value : {}) as Partial<Record<keyof LLMProviderSettings, unknown>>;
  const provider: LLMProvider = settings.provider === "openai"
    ? "openai"
    : settings.provider === "ollama" && isOllamaAvailableHere() ? "ollama" : "bedrock";
  return {
    provider,
    openaiBaseUrl: typeof settings.openaiBaseUrl === "string" ? settings.openaiBaseUrl : DEFAULT_SETTINGS.openaiBaseUrl,
    openaiApiKey: typeof settings.openaiApiKey === "string" ? settings.openaiApiKey : DEFAULT_SETTINGS.openaiApiKey,
    openaiModel: typeof settings.openaiModel === "string" ? settings.openaiModel : DEFAULT_SETTINGS.openaiModel,
    bedrockEndpoint: typeof settings.bedrockEndpoint === "string" ? settings.bedrockEndpoint : DEFAULT_SETTINGS.bedrockEndpoint,
    bedrockToken: typeof settings.bedrockToken === "string" ? settings.bedrockToken : DEFAULT_SETTINGS.bedrockToken,
    ollamaModel: typeof settings.ollamaModel === "string" ? settings.ollamaModel : DEFAULT_SETTINGS.ollamaModel,
  };
}

const OBSOLETE_STORAGE_KEYS = [
  "llm.selectedModelId",
  "llm.loadedModelId",
  "llm.selectedImportedModelId",
  "llm.importedModels",
  "llm.importInProgress",
];
const OBSOLETE_CACHES = ["webllm/config", "webllm/wasm", "webllm/model"];

// Removes what the old on-device models left behind. Best effort; safe to call on every start.
export async function clearObsoleteModelStorage(): Promise<void> {
  for (const key of OBSOLETE_STORAGE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage may be unavailable; nothing to clean up then.
    }
  }
  if (typeof caches === "undefined") return;
  for (const name of OBSOLETE_CACHES) {
    try {
      await caches.delete(name);
    } catch {
      // Best effort.
    }
  }
}

export function saveLLMProviderSettings(settings: LLMProviderSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function validateHttpsUrl(value: string, label: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `Enter a valid HTTPS ${label} URL.`;
  }
  const localHost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if ((url.protocol !== "https:" && !(localHost && url.protocol === "http:"))
    || url.username || url.password || url.hash) {
    return `Use an HTTPS ${label} URL without embedded credentials or a fragment.`;
  }
  return undefined;
}

export function validateBedrockEndpoint(endpoint: string): string | undefined {
  return validateHttpsUrl(endpoint, "gateway");
}

// Validates a normalized OpenAI-compatible base URL; a query string would break the appended path.
export function validateOpenAIBaseUrl(baseUrl: string): string | undefined {
  const error = validateHttpsUrl(baseUrl, "base");
  if (error) return error;
  if (new URL(baseUrl).search) return "Remove the query string (everything after ?) from the base URL.";
  return undefined;
}

export function normalizeOpenAIBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").replace(/\/chat\/completions$/, "").replace(/\/+$/, "");
}
