import type { LLMClient } from "../llm/client";
import { LLM_CONFIG } from "../llm/config";
import { Priority } from "../llm/types";
import { buildGuard, fallbackBrief, generateAreaBrief } from "./briefs";
import type { BriefGuard, StoryAreaBrief } from "./briefs";
import type { LengthView } from "./loader";
import { buildLocationSlice } from "./slice";
import type { StoryState } from "./state";
import type { StoryPack } from "./types";

interface Pending {
  promise: Promise<StoryAreaBrief | null>;
  controller: AbortController;
  prefetch: boolean;
  requestId: string;
}

// Generates and caches one brief per location. Prefetch is capped so it never floods the model queue.
export class BriefService {
  private readonly ready = new Map<string, StoryAreaBrief>();
  private readonly pending = new Map<string, Pending>();
  private readonly running = new Set<string>();
  private readonly guard: BriefGuard;
  private counter = 0;

  constructor(
    private readonly client: LLMClient,
    private readonly pack: StoryPack,
    private readonly view: LengthView,
    private readonly state: StoryState,
    private readonly maxPrefetch: number = LLM_CONFIG.maxQueuedPrefetch,
  ) {
    this.guard = buildGuard(pack);
    client.on("job", (event) => {
      if (event.state === "running") this.running.add(event.id);
      else if (event.state === "done" || event.state === "cancelled" || event.state === "requeued") this.running.delete(event.id);
    });
  }

  isReady(locationId: string): boolean {
    return this.ready.has(locationId);
  }

  get pendingPrefetchCount(): number {
    return [...this.pending.values()].filter((entry) => entry.prefetch).length;
  }

  // Queue briefs in the background. Extra requests beyond the cap are skipped; they are queued again on a later call.
  prefetch(locationIds: readonly string[]): void {
    for (const id of locationIds) {
      if (this.ready.has(id) || this.pending.has(id)) continue;
      if (this.pendingPrefetchCount >= this.maxPrefetch) return;
      void this.start(id, Priority.Prefetch, true);
    }
  }

  // Resolves with the brief; always succeeds (fallback on failure). Used when the player is about to enter.
  async request(locationId: string): Promise<StoryAreaBrief> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const cached = this.ready.get(locationId);
      if (cached) return cached;
      let entry = this.pending.get(locationId);
      // A prefetch that has not started yet is replaced by a higher-priority request.
      if (entry?.prefetch && !this.isRunning(locationId)) {
        entry.controller.abort();
        this.pending.delete(locationId);
        entry = undefined;
      }
      const brief = await (entry?.promise ?? this.start(locationId, Priority.Area, false));
      if (brief) return brief;
    }
    return this.store(locationId, fallbackBrief(this.slice(locationId), this.guard));
  }

  private isRunning(locationId: string): boolean {
    return [...this.running].some((id) => id.startsWith(`brief:${locationId}:`));
  }

  private slice(locationId: string) {
    return buildLocationSlice(this.pack, this.view, locationId, this.state.resolvedGoalStates);
  }

  private store(locationId: string, brief: StoryAreaBrief): StoryAreaBrief {
    this.ready.set(locationId, brief);
    return brief;
  }

  private start(locationId: string, priority: Priority, prefetch: boolean): Promise<StoryAreaBrief | null> {
    const controller = new AbortController();
    const requestId = `brief:${locationId}:${++this.counter}`;
    const promise = generateAreaBrief(this.client, this.slice(locationId), this.guard, {
      priority,
      signal: controller.signal,
      requestId,
    }).then((outcome) => {
      if (this.pending.get(locationId)?.requestId === requestId) this.pending.delete(locationId);
      // A cancelled request stores nothing, so the location can be requested again.
      return outcome.status === "ready" ? this.store(locationId, outcome.brief) : null;
    });
    this.pending.set(locationId, { promise, controller, prefetch, requestId });
    return promise;
  }
}
