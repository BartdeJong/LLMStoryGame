import type { StoryState } from "../../src/story/state";

// A copy of the story state, taken before a turn so a rejected turn can be undone completely: what the
// character said, what was marked as told or heard, clues revealed and the visit that was counted.
export function snapshotState(state: StoryState): StoryState {
  return structuredClone(state);
}

// Puts the state back in place (the same object, because the dialogue context and controller hold it).
export function restoreState(state: StoryState, snapshot: StoryState): void {
  for (const key of Object.keys(state)) delete (state as unknown as Record<string, unknown>)[key];
  Object.assign(state, structuredClone(snapshot));
}

export type AttemptVerdict = "ok" | "rejected" | "abort";

export interface AttemptResult<T> {
  status: "ok" | "exhausted" | "abort";
  result: T | null;
  attempts: number;
}

// Plays a turn, and when it is rejected rolls it back and plays it again, up to `maxResamples` more times.
// A turn that is not accepted never stays in the history. "abort" (an outage, a missing verdict) stops at once.
export async function attemptWithResamples<T>(input: {
  maxResamples: number;
  run: () => Promise<T>;
  judge: (result: T, attempt: number) => Promise<AttemptVerdict>;
  rollback: () => void;
}): Promise<AttemptResult<T>> {
  for (let attempt = 0; attempt <= input.maxResamples; attempt += 1) {
    const result = await input.run();
    const verdict = await input.judge(result, attempt);
    if (verdict === "ok") return { status: "ok", result, attempts: attempt + 1 };
    input.rollback();
    if (verdict === "abort") return { status: "abort", result: null, attempts: attempt + 1 };
  }
  return { status: "exhausted", result: null, attempts: input.maxResamples + 1 };
}

// What follows a turn that found no clean reply: it was rolled back, so the player message is skipped and the
// session goes on with the next one. It ends after two skipped turns in a row, or at once on an abort.
export function afterSkippedTurn(skippedBefore: number, status: "exhausted" | "abort"): { skippedInARow: number; endSession: boolean } {
  const skippedInARow = skippedBefore + 1;
  return { skippedInARow, endSession: status === "abort" || skippedInARow >= 2 };
}
