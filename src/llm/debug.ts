import { mountUnsupportedScreen, runModelSetup } from "../ui/modelScreens";
import { formatReport, summarize, toSample } from "./benchmark";
import type { PromptKind, Sample } from "./benchmark";
import { LLMClient } from "./client";
import { LLM_CONFIG } from "./config";
import { MockBackend } from "./mock";
import { characterRequest, dialogueTurnRequest } from "./prompts";
import { checkSupport } from "./support";
import { Priority } from "./types";
import type { LoadResult } from "./types";
import { WebLLMBackend } from "./webllmBackend";
import { el } from "../ui/dom";

export async function mountLLMDebugScreen(): Promise<void> {
  document.documentElement.classList.add("llm-debug-mode");
  document.body.classList.add("llm-debug-mode");
  const root = document.body;
  root.replaceChildren();
  const useMock = new URLSearchParams(window.location.search).get("mock") === "1";

  if (!useMock) {
    const report = await checkSupport();
    if (!report.supported) {
      const holder = el("main", "llm-debug-shell");
      mountUnsupportedScreen(holder, report);
      const link = el("a", "llm-button", "Open benchmark with the mock model");
      link.href = "?debug=llm&mock=1";
      holder.append(link);
      root.append(holder);
      return;
    }
  }

  const shell = el("main", "llm-debug-shell");
  const header = el("header", "llm-debug-header");
  header.append(el("h1", "", "LLM benchmark"), el("p", "", useMock ? "Mock backend (no model is loaded)." : "WebLLM in a Web Worker. Results below are from this device only."));

  const modelSelect = el("select");
  for (const id of LLM_CONFIG.candidates) modelSelect.add(new Option(id, id));
  modelSelect.value = LLM_CONFIG.candidates.includes(LLM_CONFIG.modelId as never) ? LLM_CONFIG.modelId : LLM_CONFIG.candidates[0];
  const runsInput = el("input");
  runsInput.type = "number";
  runsInput.min = "1";
  runsInput.value = "20";
  const startButton = el("button", "llm-button", "Start benchmark");
  const stopButton = el("button", "llm-button", "Stop");
  const copyButton = el("button", "llm-button", "Copy results");
  stopButton.disabled = true;
  const controls = el("div", "llm-debug-controls");
  const label = (text: string, input: HTMLElement) => {
    const wrap = el("label", "", text);
    wrap.append(input);
    return wrap;
  };
  controls.append(label("Model ", modelSelect), label("Runs ", runsInput), startButton, stopButton, copyButton);

  const setup = el("div", "llm-debug-setup");
  const status = el("p", "llm-debug-status", "Pick a model and press Start.");
  const results = el("pre", "llm-debug-results");
  const samplesBox = el("div", "llm-debug-samples");
  shell.append(header, controls, setup, status, results, samplesBox);
  root.append(shell);

  const client = new LLMClient(useMock ? new MockBackend({ delayMs: 150, failureRate: 0.1 }) : new WebLLMBackend(), { pauseWhenHidden: false });
  let samples: Sample[] = [];
  let loadResult: LoadResult = { loadTimeMs: 0, fromCache: false };
  let stopRequested = false;
  let reportText = "";

  const render = (modelId: string) => {
    reportText = formatReport({ modelId, backend: useMock ? "mock" : "webllm", loadTimeMs: loadResult.loadTimeMs, fromCache: loadResult.fromCache, samples, userAgent: navigator.userAgent });
    results.textContent = reportText;
    samplesBox.replaceChildren();
    for (const kind of ["character", "dialogue"] as const) {
      const last = samples.filter((sample) => sample.kind === kind).slice(-2);
      if (last.length === 0) continue;
      const details = el("details");
      details.append(el("summary", "", `Sample outputs: ${kind}`));
      for (const sample of last) details.append(el("pre", "", `status=${sample.status} retries=${sample.retries}\n${sample.text}`));
      samplesBox.append(details);
    }
  };

  startButton.addEventListener("click", async () => {
    const modelId = modelSelect.value;
    const runs = Math.max(1, Number.parseInt(runsInput.value, 10) || 20);
    startButton.disabled = true;
    stopButton.disabled = false;
    stopRequested = false;
    samples = [];
    try {
      status.textContent = "Loading model...";
      loadResult = useMock ? await client.load(modelId) : await runModelSetup(setup, client, modelId);
      setup.replaceChildren();
      const prompts: [PromptKind, () => ReturnType<typeof characterRequest> | ReturnType<typeof dialogueTurnRequest>][] = [
        ["character", () => characterRequest(Priority.Low)],
        ["dialogue", () => dialogueTurnRequest(Priority.Low)],
      ];
      for (let run = 1; run <= runs && !stopRequested; run += 1) {
        for (const [kind, build] of prompts) {
          if (stopRequested) break;
          status.textContent = `Run ${run}/${runs}: ${kind}`;
          const result = await client.generateJSON(build() as Parameters<typeof client.generateJSON>[0]);
          if (result.status !== "cancelled") samples.push(toSample(kind, result));
          render(modelId);
        }
      }
      const overall = summarize(samples);
      status.textContent = `${stopRequested ? "Stopped" : "Done"}: ${samples.length} generations, ${(overall.validRate * 100).toFixed(0)}% valid.`;
    } finally {
      startButton.disabled = false;
      stopButton.disabled = true;
    }
  });

  stopButton.addEventListener("click", () => {
    stopRequested = true;
    client.cancelAll();
  });

  copyButton.addEventListener("click", async () => {
    const text = reportText || "No results yet.";
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = "Results copied.";
    } catch {
      // Clipboard can be blocked (e.g. non-HTTPS); let the user copy by hand.
      const range = document.createRange();
      range.selectNodeContents(results);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
      status.textContent = "Copy blocked by the browser: the results text is selected, copy it manually.";
    }
  });
}
