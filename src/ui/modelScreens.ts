import { LLM_CONFIG } from "../llm/config";
import type { LLMClient } from "../llm/client";
import type { SupportReport } from "../llm/support";
import type { LoadResult } from "../llm/types";
import { isModelCached } from "../llm/webllmBackend";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function screen(root: HTMLElement, title: string): HTMLElement {
  root.replaceChildren();
  const box = el("section", "llm-screen");
  box.append(el("h1", "llm-screen-title", title));
  root.append(box);
  return box;
}

export function mountUnsupportedScreen(root: HTMLElement, report: SupportReport): void {
  const box = screen(root, "This device is not supported");
  box.append(
    el("p", "", report.reason ?? "The on-device story model cannot run here."),
    el("p", "llm-screen-note", "This game writes its story with an AI model that runs fully on your device. It needs WebGPU, which is available in recent Chrome, Edge and Safari (iOS/iPadOS 26 and newer)."),
  );
}

// Resolves with load timing once the model is loaded. Load errors offer a retry, which resumes from the cache.
export async function runModelSetup(root: HTMLElement, client: LLMClient, modelId: string = LLM_CONFIG.modelId): Promise<LoadResult> {
  const cached = await isModelCached(modelId);

  const box = screen(root, cached ? "Waking up the storyteller" : "One-time download");
  const status = el("p", "", "");
  const bar = el("progress", "llm-progress");
  bar.max = 1;
  bar.value = 0;
  const detail = el("p", "llm-screen-note", "");
  const action = el("button", "llm-button", "Download and continue");
  action.type = "button";

  if (!cached) {
    box.append(
      el("p", "", `The story model (${modelId}) must be downloaded once: about ${LLM_CONFIG.approxDownloadMB.min / 1000} to ${LLM_CONFIG.approxDownloadMB.max / 1000} GB. Wi-Fi is recommended.`),
      el("p", "llm-screen-note", "It is stored on this device, so the game works offline afterwards and will not download it again unless the model changes. If the download is interrupted, start again and it continues where it stopped."),
    );
  }
  box.append(status, bar, detail);

  const off = client.on("load-progress", (p) => {
    bar.value = p.progress;
    detail.textContent = p.text;
  });

  let loadResult: LoadResult = { loadTimeMs: 0, fromCache: cached };
  const start = async (): Promise<boolean> => {
    action.remove();
    status.textContent = cached ? "Loading the model from this device..." : "Downloading and preparing the model...";
    try {
      await navigator.storage?.persist?.();
      loadResult = await client.load(modelId);
      localStorage.setItem(LLM_CONFIG.loadedModelStorageKey, modelId);
      return true;
    } catch (error) {
      status.textContent = `Could not load the model: ${error instanceof Error ? error.message : String(error)}`;
      return false;
    }
  };

  try {
    if (!cached) {
      box.append(action);
      await clicked(action);
    }
    await retryLoop(box, action, start);
    return loadResult;
  } finally {
    off();
  }
}

function clicked(button: HTMLButtonElement): Promise<void> {
  return new Promise((resolve) => button.addEventListener("click", () => resolve(), { once: true }));
}

async function retryLoop(box: HTMLElement, action: HTMLButtonElement, start: () => Promise<boolean>): Promise<void> {
  while (!(await start())) {
    action.textContent = "Try again (resumes the download)";
    box.append(action);
    await clicked(action);
  }
}
