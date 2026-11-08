// All model choices live here. Ids come from WebLLM's prebuilt list
// (@mlc-ai/web-llm 0.2.87). q4f16 needs the WebGPU "shader-f16" feature;
// q4f32 is the safer variant for devices without it.
export const LLM_CONFIG = {
  // Provisional default until the benchmark picks a winner.
  modelId: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
  candidates: [
    "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    "Llama-3.2-1B-Instruct-q4f32_1-MLC",
    "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    "Qwen2.5-0.5B-Instruct-q4f32_1-MLC",
    "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    "Qwen2.5-1.5B-Instruct-q4f32_1-MLC",
    "Qwen3.5-9B-q4f16_1-MLC",
    "Qwen3.5-9B-q4f32_1-MLC",
    "Llama-3.1-8B-Instruct-q4f16_1-MLC-1k",
    "Llama-3.1-8B-Instruct-q4f32_1-MLC-1k",
    "SmolLM2-1.7B-Instruct-q4f16_1-MLC",
    "SmolLM2-1.7B-Instruct-q4f32_1-MLC",
    "gemma-2-2b-it-q4f16_1-MLC-1k",
    "gemma-2-2b-it-q4f32_1-MLC-1k",
  ],
  approxDownloadMB: { min: 1000, max: 2000 },
  maxRetries: 2,
  maxQueuedPrefetch: 4,
  loadedModelStorageKey: "llm.loadedModelId",
} as const;
