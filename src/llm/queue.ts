import type { Priority } from "./types";

export type QueueOutcome<T> = { status: "done"; value: T } | { status: "cancelled" } | { status: "error"; error: string };

export type QueueNotice = "queued" | "running" | "requeued" | "done" | "cancelled";

interface Job<T> {
  id: string;
  priority: Priority;
  seq: number;
  task: (signal: AbortSignal) => Promise<T>;
  resolve: (outcome: QueueOutcome<T>) => void;
  controller: AbortController | null;
  cancelled: boolean;
  requeue: boolean;
}

export interface RequestQueueOptions {
  maxQueuedPrefetch?: number;
  prefetchPriority?: Priority;
  maxQueuedSpeculative?: number;
  speculativePriority?: Priority;
  // A running job at speculativePriority is aborted when a request at this priority or more urgent is queued.
  preemptSpeculativeAt?: Priority;
  onNotice?: (id: string, priority: Priority, notice: QueueNotice) => void;
}

// One job at a time. Lower priority number runs first; ties run in arrival order.
export class RequestQueue<T = unknown> {
  private waiting: Job<T>[] = [];
  private running: Job<T> | null = null;
  private paused = false;
  private seq = 0;

  constructor(private readonly options: RequestQueueOptions = {}) {}

  get size(): number {
    return this.waiting.length + (this.running ? 1 : 0);
  }

  get isPaused(): boolean {
    return this.paused;
  }

  enqueue(id: string, priority: Priority, task: (signal: AbortSignal) => Promise<T>): Promise<QueueOutcome<T>> {
    return new Promise((resolve) => {
      const job: Job<T> = { id, priority, seq: this.seq++, task, resolve, controller: null, cancelled: false, requeue: false };
      this.waiting.push(job);
      this.notice(job, "queued");
      this.trimLevel(this.options.prefetchPriority, this.options.maxQueuedPrefetch);
      this.trimLevel(this.options.speculativePriority, this.options.maxQueuedSpeculative);
      this.preemptSpeculative(priority);
      void this.pump();
    });
  }

  // Lets a speculative job that the player now needs jump the queue.
  setPriority(id: string, priority: Priority): boolean {
    const job = this.waiting.find((candidate) => candidate.id === id) ?? (this.running?.id === id ? this.running : undefined);
    if (!job) return false;
    job.priority = priority;
    return true;
  }

  cancel(id: string): boolean {
    return this.cancelWhere((job) => job.id === id) > 0;
  }

  cancelWhere(predicate: (job: { id: string; priority: Priority }) => boolean): number {
    let count = 0;
    for (const job of [...this.waiting]) {
      if (predicate(job)) {
        this.waiting.splice(this.waiting.indexOf(job), 1);
        this.notice(job, "cancelled");
        job.resolve({ status: "cancelled" });
        count += 1;
      }
    }
    if (this.running && predicate(this.running)) {
      this.running.cancelled = true;
      this.running.controller?.abort();
      count += 1;
    }
    return count;
  }

  // While paused nothing new starts, and a running job is aborted and put back.
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused && this.running) {
      this.running.requeue = true;
      this.running.controller?.abort();
    }
    if (!paused) void this.pump();
  }

  private preemptSpeculative(incoming: Priority): void {
    const level = this.options.speculativePriority;
    const threshold = this.options.preemptSpeculativeAt;
    const running = this.running;
    if (level === undefined || threshold === undefined || !running) return;
    if (running.priority === level && incoming <= threshold) {
      running.cancelled = true;
      running.controller?.abort();
    }
  }

  private trimLevel(level: Priority | undefined, limit: number | undefined): void {
    if (limit === undefined || level === undefined) return;
    const extras = this.waiting.filter((job) => job.priority === level);
    // Drop the oldest extras so background work cannot grow without bound.
    for (const job of extras.slice(0, Math.max(0, extras.length - limit))) this.cancel(job.id);
  }

  private takeNext(): Job<T> | undefined {
    if (this.waiting.length === 0) return undefined;
    let best = 0;
    for (let index = 1; index < this.waiting.length; index += 1) {
      const a = this.waiting[index]!;
      const b = this.waiting[best]!;
      if (a.priority < b.priority || (a.priority === b.priority && a.seq < b.seq)) best = index;
    }
    return this.waiting.splice(best, 1)[0];
  }

  private async pump(): Promise<void> {
    if (this.running || this.paused) return;
    const job = this.takeNext();
    if (!job) return;
    job.controller = new AbortController();
    this.running = job;
    this.notice(job, "running");

    let outcome: QueueOutcome<T>;
    try {
      outcome = { status: "done", value: await job.task(job.controller.signal) };
    } catch (error) {
      outcome = { status: "error", error: error instanceof Error ? error.message : String(error) };
    }
    this.running = null;

    if (job.requeue && !job.cancelled) {
      job.requeue = false;
      this.waiting.push(job);
      this.notice(job, "requeued");
    } else if (job.cancelled) {
      this.notice(job, "cancelled");
      job.resolve({ status: "cancelled" });
    } else {
      this.notice(job, "done");
      job.resolve(outcome);
    }
    void this.pump();
  }

  private notice(job: Job<T>, notice: QueueNotice): void {
    this.options.onNotice?.(job.id, job.priority, notice);
  }
}
