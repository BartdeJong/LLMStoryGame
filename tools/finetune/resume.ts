import { PhraseBudget } from "./playerTurns";
import { Deduper, TASKS, TextDeduper, emptyCounts, lastPlayerLine, normalizeLine } from "./records";
import type { Task, TaskCounts } from "./records";

export interface ResumeState {
  counts: TaskCounts;
  lineDeduper: Deduper;
  greetingDeduper: Deduper;
  summaryDeduper: TextDeduper;
  endingDeduper: TextDeduper;
  phrases: PhraseBudget;
  // The dialogue and greeting lines already recorded per session id, so a session that is run again can recognise them.
  sessionLines: Map<string, Set<string>>;
}

function assistantValue(row: Record<string, unknown>): Record<string, unknown> {
  const messages = row.messages as { role: string; content: string }[] | undefined;
  try {
    return JSON.parse(messages?.[2]?.content ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

// Rebuilds what a run knows from the records earlier runs wrote (train and holdout rows): the count per task,
// the duplicate checks and the stock-phrase budget. Summaries and endings are keyed by story id.
export function rebuildResumeState(rows: readonly Record<string, unknown>[]): ResumeState {
  const state: ResumeState = {
    counts: emptyCounts(),
    lineDeduper: new Deduper(),
    greetingDeduper: new Deduper(true),
    summaryDeduper: new TextDeduper(),
    endingDeduper: new TextDeduper(),
    phrases: new PhraseBudget(),
    sessionLines: new Map(),
  };
  for (const row of rows) {
    const task = row.task as Task;
    if (!TASKS.includes(task)) continue;
    state.counts[task] += 1;
    const character = String(row.character ?? "");
    const story = String(row.story);
    const value = assistantValue(row);
    if (task === "dialogue" && typeof value.line === "string") {
      state.lineDeduper.add(character, value.line);
      // The player message each dialogue record answers counts against the stock-phrase budget.
      const messages = row.messages as { role: string; content: string }[] | undefined;
      const said = lastPlayerLine(messages?.find((message) => message.role === "user")?.content ?? "");
      if (said) state.phrases.use(said);
    }
    if (task === "greeting" && typeof value.line === "string") state.greetingDeduper.add(character, value.line);
    if ((task === "dialogue" || task === "greeting") && typeof value.line === "string" && typeof row.id === "string") {
      const session = row.id.split("/")[0]!;
      const lines = state.sessionLines.get(session) ?? new Set<string>();
      lines.add(normalizeLine(value.line));
      state.sessionLines.set(session, lines);
    }
    if (task === "summary" && typeof value.summary === "string") state.summaryDeduper.add(story, value.summary);
    if (task === "ending" && typeof value.scene === "string") state.endingDeduper.add(story, value.scene);
  }
  return state;
}

// What to do with the next session index. The train and holdout quotas are separate: `--count` counts train
// records and `--holdout-count` holdout records. A session whose own quota is full is skipped (not marked done, so
// a later run with a higher count can still use it); the run stops when both quotas are full.
export function sessionDecision(input: {
  isHoldoutStory: boolean;
  hasHoldout: boolean;
  trainTotal: number;
  trainCount: number;
  holdoutTotal: number;
  holdoutCount: number;
}): "run" | "skip" | "stop" {
  const trainFull = input.trainTotal >= input.trainCount;
  const holdoutFull = !input.hasHoldout || input.holdoutTotal >= input.holdoutCount;
  if (trainFull && holdoutFull) return "stop";
  return (input.isHoldoutStory ? holdoutFull : trainFull) ? "skip" : "run";
}

// A session is done only if no HTTP or connection failure touched it and the judge always gave a verdict.
export function canMarkSessionDone(input: { outagesDuringSession: number; incomplete: boolean }): boolean {
  return input.outagesDuringSession === 0 && !input.incomplete;
}
