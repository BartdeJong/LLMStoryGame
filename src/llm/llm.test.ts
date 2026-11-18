import { describe, expect, it } from "vitest";
import { LLMClient } from "./client";
import { MockBackend } from "./mock";
import { dialogueTurnRequest } from "./prompts";
import { defaultValue, s, toJsonSchema, validate } from "./schema";
import { dialogueTurnSchema } from "./shapes";
import { Priority } from "./types";
import type { JSONRequest } from "./types";

const GOOD_TURN = JSON.stringify({
  line: "Hello there.",
  mode: "choices",
  choices: ["Hi", "Bye"],
  effects: { give_item: null, reveal_clue: null, goal_progress: 0.5 },
});

async function makeClient(options: ConstructorParameters<typeof MockBackend>[0]) {
  const backend = new MockBackend(options);
  const client = new LLMClient(backend, { pauseWhenHidden: false });
  await client.load();
  return { backend, client };
}

const request = (over: Partial<JSONRequest<unknown>> = {}): JSONRequest<unknown> => ({ ...dialogueTurnRequest(), ...over });

describe("validation", () => {
  const schema = s.object({
    name: s.string("anon"),
    kind: s.string("a", { oneOf: ["a", "b"] }),
    score: s.number(0, { min: 0, max: 1 }),
    tags: s.array(s.string("x"), { maxItems: 2 }),
    extra: s.nullable(s.string("n")),
  });

  it("accepts valid input and drops unknown keys", () => {
    const result = validate(schema, { name: " Bo ", kind: "b", score: 1, tags: ["p"], extra: null, junk: 1 });
    expect(result.issues).toEqual([]);
    expect(result.value).toEqual({ name: "Bo", kind: "b", score: 1, tags: ["p"], extra: null });
  });

  it("replaces only the invalid fields with their defaults", () => {
    const result = validate(schema, { name: "Bo", kind: "zzz", score: 5, tags: ["p", 3, "q", "r"], extra: "hi" });
    expect(result.value).toEqual({ name: "Bo", kind: "a", score: 0, tags: ["p", "q"], extra: "hi" });
    expect(result.issues.length).toBe(3);
  });

  it("falls back for wrong top-level types and exports a JSON schema", () => {
    expect(validate(schema, "nope").value).toEqual(defaultValue(schema));
    expect(toJsonSchema(schema)).toMatchObject({ type: "object", required: ["name", "kind", "score", "tags", "extra"] });
  });
});

describe("repair and retries", () => {
  it("returns canned JSON that passes the real schemas", async () => {
    const { client } = await makeClient({});
    const result = await client.generateJSON(request({ tag: "dialogue" }));
    expect(result.status).toBe("ok");
    expect(result.retries).toBe(0);
  });

  it("repairs after malformed output and sends a short repair prompt", async () => {
    const prompts: string[] = [];
    const { client } = await makeClient({
      respond: (params, call) => {
        prompts.push(params.messages.at(-1)!.content);
        return call === 0 ? "{not json" : call === 1 ? '{"line": "ok"}' : GOOD_TURN;
      },
    });
    const result = await client.generateJSON(request());
    expect(result.status).toBe("ok");
    expect(result.retries).toBe(2);
    expect(prompts[1]).toContain("problems");
    expect(result.value).toMatchObject({ line: "Hello there.", mode: "choices" });
  });

  it("stops after 2 retries and returns per-field defaults without throwing", async () => {
    const { backend, client } = await makeClient({ respond: () => '{"line": "Only a line", "mode": "weird"}' });
    const result = await client.generateJSON(request());
    expect(backend.calls).toBe(3);
    expect(result.status).toBe("defaulted");
    expect(result.value).toMatchObject({ line: "Only a line", mode: "free", choices: [] });
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("turns backend errors into a safe default result", async () => {
    const { client } = await makeClient({
      respond: () => {
        throw new Error("gpu lost");
      },
    });
    const result = await client.generateJSON(request());
    expect(result.status).toBe("failed");
    expect(result.error).toBe("gpu lost");
    expect(result.value).toEqual(defaultValue(dialogueTurnSchema));
  });

  it("is deterministic for a given seed and failure rate", async () => {
    const run = async () => {
      const { client } = await makeClient({ failureRate: 0.5, seed: 7 });
      const statuses: string[] = [];
      for (let i = 0; i < 6; i += 1) statuses.push(`${(await client.generateJSON(request())).retries}`);
      return statuses.join(",");
    };
    expect(await run()).toBe(await run());
  });
});

describe("queue priority", () => {
  it("runs dialogue, then area, then prefetch, then low, one at a time", async () => {
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;
    const { client } = await makeClient({
      delayMs: 2,
      respond: (params) => {
        order.push(params.messages[1]!.content);
        active += 1;
        maxActive = Math.max(maxActive, active);
        queueMicrotask(() => (active -= 1));
        return GOOD_TURN;
      },
    });
    client.setPaused(true);
    const jobs = [
      client.generateJSON(request({ priority: Priority.Low, prompt: "low" })),
      client.generateJSON(request({ priority: Priority.Prefetch, prompt: "prefetch" })),
      client.generateJSON(request({ priority: Priority.Area, prompt: "area" })),
      client.generateJSON(request({ priority: Priority.Dialogue, prompt: "dialogue" })),
      client.generateJSON(request({ priority: Priority.Area, prompt: "area2" })),
    ];
    client.setPaused(false);
    await Promise.all(jobs);
    expect(order).toEqual(["dialogue", "area", "area2", "prefetch", "low"]);
    expect(maxActive).toBe(1);
  });

  it("caps queued prefetch jobs", async () => {
    const { client } = await makeClient({});
    client.setPaused(true);
    const jobs = Array.from({ length: 6 }, (_, i) => client.generateJSON(request({ id: `p${i}`, priority: Priority.Prefetch })));
    client.setPaused(false);
    const results = await Promise.all(jobs);
    expect(results.filter((r) => r.status === "cancelled").map((r) => r.id)).toEqual(["p0", "p1"]);
  });

  it("puts a running job back when paused and finishes it after resume", async () => {
    const { client } = await makeClient({ delayMs: 20 });
    const job = client.generateJSON(request({ id: "a", tag: "dialogue" }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    client.setPaused(true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    client.setPaused(false);
    expect((await job).status).toBe("ok");
  });
});

describe("cancellation", () => {
  it("cancels a queued request", async () => {
    const { client } = await makeClient({ delayMs: 10 });
    client.setPaused(true);
    const job = client.generateJSON(request({ id: "q" }));
    expect(client.cancel("q")).toBe(true);
    const result = await job;
    expect(result.status).toBe("cancelled");
    expect(result.value).toEqual(defaultValue(dialogueTurnSchema));
  });

  it("aborts a running request and moves on to the next one", async () => {
    const { client } = await makeClient({ delayMs: 200 });
    const first = client.generateJSON(request({ id: "first", tag: "dialogue" }));
    const second = client.generateJSON(request({ id: "second", tag: "dialogue", priority: Priority.Low }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const startedAt = performance.now();
    client.cancel("first");
    expect((await first).status).toBe("cancelled");
    expect(performance.now() - startedAt).toBeLessThan(150);
    expect((await second).status).toBe("ok");
  });

  it("honours an AbortSignal on the request", async () => {
    const { client } = await makeClient({ delayMs: 100 });
    const controller = new AbortController();
    const job = client.generateJSON(request({ signal: controller.signal }));
    setTimeout(() => controller.abort(), 10);
    expect((await job).status).toBe("cancelled");
  });

  it("returns a safe default when the model is not loaded", async () => {
    const client = new LLMClient(new MockBackend(), { pauseWhenHidden: false });
    expect((await client.generateJSON(request())).status).toBe("failed");
  });
});
