import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSelectedLocalModelId, LLM_CONFIG, saveSelectedLocalModelId } from "./config";

describe("selected on-device model", () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("uses the configured default when no model has been selected", () => {
    expect(getSelectedLocalModelId()).toBe(LLM_CONFIG.modelId);
  });

  it("persists a supported model choice", () => {
    const modelId = LLM_CONFIG.candidates[0];
    saveSelectedLocalModelId(modelId);
    expect(getSelectedLocalModelId()).toBe(modelId);
  });

  it("rejects model ids outside the supported list", () => {
    expect(() => saveSelectedLocalModelId("unknown-model")).toThrow("selected on-device model is invalid");
  });
});
