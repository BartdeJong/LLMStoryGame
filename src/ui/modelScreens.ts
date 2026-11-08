import { LLM_CONFIG } from "../llm/config";
import type { LLMClient } from "../llm/client";
import type { SupportReport } from "../llm/support";
import type { LoadResult } from "../llm/types";
import { isModelCached } from "../llm/webllmBackend";
import { activateGamepadFocus } from "../input/focus";

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
  activateGamepadFocus(box);
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
export function runModelSetup(root: HTMLElement, client: LLMClient, modelId?: string): Promise<LoadResult>;
export function runModelSetup(root: HTMLElement, client: LLMClient, modelId: string, allowCancel: true): Promise<LoadResult | undefined>;
export async function runModelSetup(
  root: HTMLElement,
  client: LLMClient,
  modelId: string = LLM_CONFIG.modelId,
  allowCancel = false,
): Promise<LoadResult | undefined> {
  const cached = await isModelCached(modelId);

  const box = screen(root, cached ? "Waking up the storyteller" : "One-time download");
  const status = el("p", "", "");
  const bar = el("progress", "llm-progress");
  bar.max = 1;
  bar.value = 0;
  const detail = el("p", "llm-screen-note", "");
  const action = el("button", "llm-button", "Download and continue");
  action.type = "button";
  const cancel = allowCancel ? el("button", "llm-button", "Cancel and return to game") : null;
  if (cancel) cancel.type = "button";

  if (!cached) {
    const downloadEstimate = /(?:8B|9B)/.test(modelId)
      ? "several GB"
      : `about ${LLM_CONFIG.approxDownloadMB.min / 1000} to ${LLM_CONFIG.approxDownloadMB.max / 1000} GB`;
    box.append(
      el("p", "", `The story model (${modelId}) must be downloaded once: ${downloadEstimate}. Wi-Fi is recommended.`),
      el("p", "llm-screen-note", "It is stored on this device, so the game works offline afterwards and will not download it again unless the model changes. If the download is interrupted, start again and it continues where it stopped."),
    );
  }
  box.append(status, bar, detail);

  const off = client.on("load-progress", (p) => {
    bar.value = p.progress;
    detail.textContent = p.text;
  });

  let loadResult: LoadResult = { loadTimeMs: 0, fromCache: cached };
  let cancelRequested = false;
  cancel?.addEventListener("click", () => {
    cancelRequested = true;
    cancel.disabled = true;
    status.textContent = "Finishing model setup before returning to the game...";
  });
  if (cancel) box.append(cancel);

  const start = async (): Promise<boolean> => {
    action.remove();
    status.textContent = cached ? "Loading the model from this device..." : "Downloading and preparing the model...";
    try {
      await navigator.storage?.persist?.();
      loadResult = await client.load(modelId);
      if (cancelRequested) return false;
      localStorage.setItem(LLM_CONFIG.loadedModelStorageKey, modelId);
      return true;
    } catch (error) {
      if (cancelRequested) return false;
      status.textContent = `Could not load the model: ${error instanceof Error ? error.message : String(error)}`;
      return false;
    }
  };

  try {
    if (!cached) {
      box.append(action);
      if (!await waitForAction(action, cancel)) return undefined;
    }
    if (!await retryLoop(box, action, start, cancel, () => cancelRequested)) {
      await client.unload();
      return undefined;
    }
    return loadResult;
  } finally {
    off();
  }
}

function waitForAction(action: HTMLButtonElement, cancel: HTMLButtonElement | null): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (continueSetup: boolean): void => {
      action.removeEventListener("click", onAction);
      cancel?.removeEventListener("click", onCancel);
      resolve(continueSetup);
    };
    const onAction = (): void => finish(true);
    const onCancel = (): void => finish(false);
    action.addEventListener("click", onAction, { once: true });
    cancel?.addEventListener("click", onCancel, { once: true });
  });
}

async function retryLoop(
  box: HTMLElement,
  action: HTMLButtonElement,
  start: () => Promise<boolean>,
  cancel: HTMLButtonElement | null,
  isCancelled: () => boolean,
): Promise<boolean> {
  while (true) {
    if (await start()) return true;
    if (isCancelled()) return false;
    action.textContent = "Try again (resumes the download)";
    box.append(action);
    if (!await waitForAction(action, cancel)) return false;
  }
}
