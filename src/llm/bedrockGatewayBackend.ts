import type { GenerationParams, LLMBackend, LoadProgress, LoadResult, RawResult } from "./types";
import { validateBedrockEndpoint } from "./providerSettings";

export interface BedrockGatewaySettings {
  endpoint: string;
  token: string;
}

interface GatewayResponse {
  text?: unknown;
}

export class BedrockGatewayBackend implements LLMBackend {
  readonly name = "bedrock-gateway";
  readonly supportsSpeculation = false;

  constructor(private readonly settings: BedrockGatewaySettings) {}

  async load(_modelId: string, onProgress: (progress: LoadProgress) => void): Promise<LoadResult> {
    const endpointError = validateBedrockEndpoint(this.settings.endpoint);
    if (endpointError) throw new Error(endpointError);
    if (!this.settings.token.trim()) throw new Error("Enter the Bedrock gateway authorization secret.");
    onProgress({ progress: 1, text: "Bedrock gateway ready", timeMs: 0 });
    return { loadTimeMs: 0, fromCache: false };
  }

  async generate(params: GenerationParams): Promise<RawResult> {
    const startedAt = performance.now();
    const response = await fetch(this.settings.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.settings.token}`,
      },
      body: JSON.stringify({
        messages: params.messages,
        maxTokens: params.maxTokens,
        temperature: params.temperature,
        jsonSchema: params.jsonSchema,
      }),
      signal: params.signal,
    });
    if (!response.ok) throw new Error(`Bedrock gateway request failed (HTTP ${response.status}).`);

    let result: GatewayResponse;
    try {
      result = await response.json() as GatewayResponse;
    } catch {
      throw new Error("Bedrock gateway returned invalid JSON.");
    }
    if (!result || typeof result !== "object" || typeof result.text !== "string") {
      throw new Error("Bedrock gateway response must contain a text field.");
    }

    const elapsedMs = performance.now() - startedAt;
    const tokens = Math.ceil(result.text.length / 4);
    return {
      text: result.text,
      tokens,
      timeToFirstTokenMs: elapsedMs,
      tokensPerSecond: tokens / Math.max(elapsedMs / 1000, 0.001),
    };
  }

  async unload(): Promise<void> {}
}
