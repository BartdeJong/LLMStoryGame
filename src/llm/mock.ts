import { createSeededRandom } from "../art/random";
import type { GenerationParams, LLMBackend, LoadProgress, LoadResult, RawResult } from "./types";

const CANNED: Record<string, unknown> = {
  area: {
    name: "Lantern Garden",
    biome: "shore",
    mood: "misty and hushed",
    palette: "mist",
    description: "Wet roses lean over a crooked fence. The lighthouse hums softly in the fog.",
    characters: [
      {
        name: "Pim",
        species: "gull",
        sprite_recipe: { body: "small", bodyColor: "cream", accentColor: "accent", skinColor: "skin", feature: "none" },
        personality: "nosy and polite",
        goal: "to guard the garden gate",
        secret: "saw who took the lantern",
      },
    ],
    objects: [
      {
        kind: "chest",
        name: "Salt-Crusted Chest",
        description: "The lid is stiff with old sea salt.",
        icon_recipe: { shape: "key", primaryColor: "accent", secondaryColor: "cream" },
        contents: ["a brass key"],
      },
    ],
    clue: { truth_id: "lantern-trail", where: "by the fence", text: "Fresh candle wax drips along the path." },
    doors: [{ label: "Lighthouse door", hint: "A warm glow leaks from under it." }],
  },
  character: {
    name: "Moss",
    species: "tortoise",
    sprite_recipe: { body: "quadruped", bodyColor: "leaf", accentColor: "accent", skinColor: "skin", feature: "hat" },
    personality: "slow, wise and fond of tea",
    goal: "to finish his book before winter",
    secret: "he once wrote the village's oldest riddle",
  },
  dialogue: {
    line: "Oh, good morning! Come closer; I did smell something odd by the pier.",
    mode: "choices",
    choices: ["What kind of smell?", "Show me the pier.", "Never mind."],
    effects: { give_item: null, reveal_clue: null, goal_progress: 0.1 },
  },
  item: {
    name: "Brass Key",
    description: "Small, warm and slightly bent.",
    icon_recipe: { shape: "key", primaryColor: "accent", secondaryColor: "cream" },
    story_use: "opens a salt-crusted chest",
  },
};

export interface MockOptions {
  delayMs?: number;
  // Chance (0..1) that a reply is malformed JSON.
  failureRate?: number;
  seed?: number | string;
  // Override canned output per call, e.g. to script specific failures. Return undefined for the canned reply.
  respond?: (params: GenerationParams, call: number) => string | undefined;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

export class MockBackend implements LLMBackend {
  readonly name = "mock";
  calls = 0;
  private readonly random;

  constructor(private readonly options: MockOptions = {}) {
    this.random = createSeededRandom(options.seed ?? 1);
  }

  async load(_modelId: string, onProgress: (progress: LoadProgress) => void): Promise<LoadResult> {
    onProgress({ progress: 1, text: "Mock model ready", timeMs: 0 });
    return { loadTimeMs: 0, fromCache: true };
  }

  async generate(params: GenerationParams): Promise<RawResult> {
    const call = this.calls++;
    const delay = this.options.delayMs ?? 0;
    if (delay > 0) await sleep(delay, params.signal);
    else if (params.signal.aborted) throw Object.assign(new Error("Aborted"), { name: "AbortError" });

    let text: string | undefined = this.options.respond?.(params, call);
    if (text === undefined) {
      text = JSON.stringify(CANNED[params.tag ?? ""] ?? {});
      if (this.random() < (this.options.failureRate ?? 0)) text = text.slice(0, Math.floor(text.length / 2));
    }
    const tokens = Math.ceil(text.length / 4);
    return { text, tokens, timeToFirstTokenMs: delay / 4, tokensPerSecond: delay > 0 ? tokens / (delay / 1000) : 0 };
  }

  async unload(): Promise<void> {}
}
