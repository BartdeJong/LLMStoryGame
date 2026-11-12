import type { JSONResult } from "./types";

export type PromptKind = "character" | "dialogue";

export interface Sample {
  kind: PromptKind;
  status: JSONResult<unknown>["status"];
  retries: number;
  ttftMs: number;
  tokensPerSecond: number;
  tokens: number;
  totalMs: number;
  text: string;
}

export interface KindSummary {
  runs: number;
  ttftMs: number;
  tokensPerSecond: number;
  validFirstTryRate: number; // valid with no retry
  validRate: number; // valid after at most 2 retries
  retryRate: number;
  defaultedCount: number;
}

const average = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

export function toSample(kind: PromptKind, result: JSONResult<unknown>): Sample {
  return {
    kind,
    status: result.status,
    retries: result.retries,
    ttftMs: result.metrics.timeToFirstTokenMs,
    tokensPerSecond: result.metrics.tokensPerSecond,
    tokens: result.metrics.tokens,
    totalMs: result.metrics.totalMs,
    text: result.rawText || (result.error ?? ""),
  };
}

export function summarize(samples: Sample[]): KindSummary {
  const runs = samples.length;
  const rate = (count: number) => (runs ? count / runs : 0);
  return {
    runs,
    ttftMs: average(samples.map((sample) => sample.ttftMs)),
    tokensPerSecond: average(samples.map((sample) => sample.tokensPerSecond)),
    validFirstTryRate: rate(samples.filter((sample) => sample.status === "ok" && sample.retries === 0).length),
    validRate: rate(samples.filter((sample) => sample.status === "ok").length),
    retryRate: rate(samples.filter((sample) => sample.retries > 0).length),
    defaultedCount: samples.filter((sample) => sample.status === "defaulted" || sample.status === "failed").length,
  };
}

const pct = (value: number) => `${(value * 100).toFixed(0)}%`;

export function formatReport(options: { modelId: string; backend: string; loadTimeMs: number; fromCache: boolean; samples: Sample[]; userAgent: string }): string {
  const lines = [
    `Model: ${options.modelId}`,
    `Backend: ${options.backend}`,
    `Load time: ${(options.loadTimeMs / 1000).toFixed(1)} s (${options.fromCache ? "from cache" : "downloaded"})`,
    `Device: ${options.userAgent}`,
  ];
  for (const kind of ["character", "dialogue"] as const) {
    const summary = summarize(options.samples.filter((sample) => sample.kind === kind));
    lines.push(
      "",
      `[${kind}] runs=${summary.runs}`,
      `  time to first token: ${summary.ttftMs.toFixed(0)} ms`,
      `  tokens/s: ${summary.tokensPerSecond.toFixed(1)}`,
      `  JSON valid first try: ${pct(summary.validFirstTryRate)}`,
      `  JSON valid after repair: ${pct(summary.validRate)}`,
      `  retry rate: ${pct(summary.retryRate)}`,
      `  fell back to defaults: ${summary.defaultedCount}`,
    );
  }
  return lines.join("\n");
}
