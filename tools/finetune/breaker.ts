// The run stops: Ollama keeps failing, or the settings cannot work.
export class CircuitOpen extends Error {}

// Ollama rejected a request as invalid (HTTP 400), for example a think level the model does not support.
// Retrying cannot help, so the run stops with a clear message instead of counting an outage.
export class FatalRequest extends Error {}

// The think-level hint only makes sense when the judge was asked for "low".
export function fatalRequestMessage(detail: string, hintThinkLow = false): string {
  return `Ollama rejected a request as invalid. ${detail}${hintThinkLow ? " With --judge-think low the judge model must support think levels; use on or off for other models." : ""}`;
}

// Called before anything is written: once a breaker has tripped, no worker may add another record.
export function throwIfTripped(reason: string | null): void {
  if (reason) throw new CircuitOpen(reason);
}
