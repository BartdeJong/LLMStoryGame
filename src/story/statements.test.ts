import { beforeEach, describe, expect, it } from "vitest";
import fixture from "../../public/stories/example.json";
import { LLMClient } from "../llm/client";
import { MockBackend } from "../llm/mock";
import type { GenerationParams } from "../llm/types";
import { ConversationController } from "../dialogue/controller";
import { HOLD_STATEMENT_LINE } from "../dialogue/prompt";
import { setAssistedDeductions } from "./assist";
import { getLengthView } from "./loader";
import { solveLength } from "./solver";
import { addTruth, caseRecordOf, createStoryState, giveItem, markClueFound } from "./state";
import { challengeStatement, isStatementBroken, isStatementHeard, markStatementHeard } from "./statements";
import type { Statement, StoryPack } from "./types";
import { validateStoryPack } from "./validate";

const SECRET = "He borrowed the Moon Lantern to mend a crack and could not finish in time.";
const ADMISSION = "All right, I was up there. I took the lantern to mend its crack before anyone saw.";

const STATEMENT: Statement = {
  id: "st_hollis_night",
  topic: "That night",
  ask: "Where were you that night?",
  keywords: ["night", "where", "evening", "tower"],
  text: "I went to bed early that night and never climbed the tower stairs.",
  requires: { truths: ["t_taker"] },
  broken_by: { items: ["i_glass_shard"], clues: ["cl_library_log"] },
  admission: ADMISSION,
  clue_id: "cl_hollis_confess",
  rebuff: "That proves nothing about me, I'm afraid.",
};

// The example pack with Hollis hiding his confession behind a statement.
function statementPack(statement: Statement = STATEMENT): Record<string, unknown> {
  const data = structuredClone(fixture) as unknown as StoryPack;
  const hollis = data.cast.find((member) => member.id === "c_hollis")!;
  hollis.knowledge = hollis.knowledge.map((item) => (item.id === "k_hollis_confess"
    ? { id: "k_hollis_confess", topic: "His motive", ask: "Why did you take the lantern?", text: "I would rather not talk about the lantern just now.", keywords: ["why", "motive", "reason"] }
    : item));
  hollis.reactions = (hollis.reactions ?? []).map(({ clue_id: _clue, ...reaction }) => ({ ...reaction, text: "A shard of glass. Where did you find that?" }));
  hollis.statements = [statement];
  return data as unknown as Record<string, unknown>;
}

function loadPack(data = statementPack()): StoryPack {
  const report = validateStoryPack(data);
  if (!report.pack || !report.ok) throw new Error(`pack is invalid: ${report.errors.map((e) => `${e.code} ${e.message}`).join("; ")}`);
  return report.pack;
}

const LINES = [
  "Gears and springs keep me busy most evenings.",
  "Mind the third step, it creaks terribly.",
  "Pebblebrook looks lovely from up here.",
  "Quiet work suits a quiet keeper, I think.",
  "Brass needs polishing before every festival.",
  "Every clock tells the truth if you oil it.",
];

const context = { locationName: "Clock Tower", locationMood: "ticking", storySummary: "", inventory: [] };

async function recordingClient(options: { fail?: boolean; compact?: boolean } = {}) {
  const prompts: string[] = [];
  let count = 0;
  const client = new LLMClient(new MockBackend({
    respond: (params: GenerationParams) => {
      prompts.push(params.messages.map((message) => message.content).join("\n"));
      count += 1;
      return options.fail ? "not json" : JSON.stringify({ line: LINES[(count - 1) % LINES.length] });
    },
  }), { pauseWhenHidden: false });
  if (options.compact) Object.defineProperty(client, "dialoguePromptStyle", { value: "compact" });
  await client.load();
  return { client, prompts };
}

function setup(data?: Record<string, unknown>) {
  const pack = loadPack(data);
  const view = getLengthView(pack, "short");
  const state = createStoryState(view);
  const hollis = pack.cast.find((member) => member.id === "c_hollis")!;
  return { pack, view, state, hollis };
}

beforeEach(() => setAssistedDeductions(false));

describe("statements: hearing and breaking", () => {
  for (const compact of [false, true]) {
    it(`a statement is heard through dialogue and never leaks its admission or secret (${compact ? "compact" : "standard"} prompts)`, async () => {
      const { pack, state, hollis } = setup();
      addTruth(state, "t_taker");
      const { client, prompts } = await recordingClient({ compact });
      const controller = new ConversationController(client, pack, state, hollis, context, { random: () => 0 });
      await controller.start();
      const turn = await controller.reply("Where were you that night?");
      expect(isStatementHeard(state, STATEMENT.id)).toBe(true);
      expect(turn.effects.heardStatement).toBe(STATEMENT.id);
      expect(prompts.at(-1)).toContain(STATEMENT.text);
      expect(prompts.at(-1)).toContain(HOLD_STATEMENT_LINE);

      await controller.reply("You're lying. Confess, you took the lantern!");
      expect(state.cluesFound).not.toContain("cl_hollis_confess");
      for (const prompt of prompts) {
        expect(prompt).not.toContain(ADMISSION);
        expect(prompt).not.toContain(SECRET);
      }
      expect(controller.challengeOptions().statements.map((entry) => entry.id)).toEqual([STATEMENT.id]);
    });
  }

  it("a statement cannot be heard before its requirements hold", async () => {
    const { pack, state, hollis } = setup();
    const { client } = await recordingClient();
    const controller = new ConversationController(client, pack, state, hollis, context, { random: () => 0 });
    await controller.start();
    await controller.reply("Where were you that night?");
    expect(isStatementHeard(state, STATEMENT.id)).toBe(false);
  });

  it("fitting evidence breaks the statement, finds the clue and the model phrases the admission", async () => {
    const { pack, state, hollis } = setup();
    addTruth(state, "t_taker");
    markStatementHeard(state, STATEMENT.id);
    giveItem(state, "i_glass_shard");
    const { client, prompts } = await recordingClient();
    const controller = new ConversationController(client, pack, state, hollis, context, { random: () => 0 });
    await controller.start();
    const turn = await controller.challenge(STATEMENT.id, { type: "item", id: "i_glass_shard" });
    expect(turn.effects.challenge).toEqual({ statementId: STATEMENT.id, fits: true });
    expect(turn.effects.revealedClue).toBe("cl_hollis_confess");
    expect(isStatementBroken(state, STATEMENT.id)).toBe(true);
    expect(state.cluesFound).toContain("cl_hollis_confess");
    expect(prompts.at(-1)).toContain(ADMISSION);
    expect(prompts.at(-1)).not.toContain(HOLD_STATEMENT_LINE);
    expect(caseRecordOf(state).challenges).toEqual([{ statementId: STATEMENT.id, evidence: { type: "item", id: "i_glass_shard" }, fits: true }]);
    expect(controller.challengeOptions().statements).toEqual([]);
  });

  it("unusable model output falls back to the authored admission", async () => {
    const { pack, state, hollis } = setup();
    addTruth(state, "t_taker");
    markStatementHeard(state, STATEMENT.id);
    markClueFound(state, "cl_library_log");
    const { client } = await recordingClient({ fail: true });
    const controller = new ConversationController(client, pack, state, hollis, context, { random: () => 0 });
    await controller.start();
    const turn = await controller.challenge(STATEMENT.id, { type: "clue", id: "cl_library_log" });
    expect(turn.line).toBe(ADMISSION);
    expect(state.cluesFound).toContain("cl_hollis_confess");
  });

  it("evidence that does not fit is brushed off, recorded and locks challenges for this conversation", async () => {
    const { pack, state, hollis } = setup();
    addTruth(state, "t_taker");
    markStatementHeard(state, STATEMENT.id);
    giveItem(state, "i_overdue_book");
    giveItem(state, "i_glass_shard");
    const { client, prompts } = await recordingClient();
    const controller = new ConversationController(client, pack, state, hollis, context, { random: () => 0 });
    await controller.start();
    const before = prompts.length;
    const turn = await controller.challenge(STATEMENT.id, { type: "item", id: "i_overdue_book" });
    expect(prompts.length).toBe(before); // code answers; the model is not asked
    expect(turn.line).toBe(STATEMENT.rebuff);
    expect(turn.effects.challenge).toEqual({ statementId: STATEMENT.id, fits: false });
    expect(state.cluesFound).not.toContain("cl_hollis_confess");
    expect(caseRecordOf(state).challenges).toEqual([{ statementId: STATEMENT.id, evidence: { type: "item", id: "i_overdue_book" }, fits: false }]);
    expect(controller.canChallenge()).toBe(false);
    expect(controller.challengeOptions().locked).toBe(true);
    expect(() => controller.challenge(STATEMENT.id, { type: "item", id: "i_glass_shard" })).toThrow();

    // A new conversation may try again: a miss never blocks progress for good.
    const again = new ConversationController(client, pack, state, hollis, context, { random: () => 0 });
    await again.start();
    expect(again.canChallenge()).toBe(true);
    await again.challenge(STATEMENT.id, { type: "item", id: "i_glass_shard" });
    expect(isStatementBroken(state, STATEMENT.id)).toBe(true);
  });

  it("assisted deductions record no missed challenge", () => {
    const { pack, state, hollis } = setup();
    addTruth(state, "t_taker");
    markStatementHeard(state, STATEMENT.id);
    giveItem(state, "i_overdue_book");
    setAssistedDeductions(true);
    expect(challengeStatement(pack, state, hollis, STATEMENT.id, { type: "item", id: "i_overdue_book" }).fits).toBe(false);
    expect(caseRecordOf(state).challenges).toEqual([]);
  });

  it("a statement must be heard and the evidence held before a challenge", () => {
    const { pack, state, hollis } = setup();
    giveItem(state, "i_glass_shard");
    expect(() => challengeStatement(pack, state, hollis, STATEMENT.id, { type: "item", id: "i_glass_shard" })).toThrow(/not heard/);
    markStatementHeard(state, STATEMENT.id);
    expect(() => challengeStatement(pack, state, hollis, STATEMENT.id, { type: "clue", id: "cl_library_log" })).toThrow(/evidence/);
  });
});

describe("statements: solver gating", () => {
  it("a clue behind a statement needs the character and one piece of breaking evidence", () => {
    const { pack } = setup();
    const short = pack.lengths.short!;
    const solved = solveLength(pack, short);
    expect(solved.statements.has(STATEMENT.id)).toBe(true);
    expect(solved.clues.has("cl_hollis_confess")).toBe(true);
    const breakStep = solved.steps.findIndex((step) => step.startsWith(`Break statement ${STATEMENT.id}`));
    const clueStep = solved.steps.findIndex((step) => step.startsWith("Find clue cl_hollis_confess"));
    expect(breakStep).toBeGreaterThanOrEqual(0);
    expect(clueStep).toBeGreaterThan(breakStep);

    // Evidence that cannot be obtained keeps the clue locked.
    const locked = loadPackUnchecked({ ...STATEMENT, broken_by: { items: ["i_never_found"] } });
    const solvedLocked = solveLength(locked, locked.lengths.short!);
    expect(solvedLocked.statements.has(STATEMENT.id)).toBe(false);
    expect(solvedLocked.clues.has("cl_hollis_confess")).toBe(false);
  });
});

function loadPackUnchecked(statement: Statement): StoryPack {
  return statementPack(statement) as unknown as StoryPack;
}

function errorCodes(statement: Statement, edit?: (pack: StoryPack) => void): string[] {
  const data = statementPack(statement) as unknown as StoryPack;
  edit?.(data);
  return validateStoryPack(data).errors.map((error) => error.code);
}

describe("statements: validator", () => {
  it("accepts the fixture with a statement", () => {
    expect(errorCodes(STATEMENT)).toEqual([]);
  });

  it("reports unknown references", () => {
    expect(errorCodes({ ...STATEMENT, broken_by: { items: ["i_nothing"] } })).toContain("REF_UNKNOWN");
    expect(errorCodes({ ...STATEMENT, clue_id: "cl_nothing" })).toContain("REF_UNKNOWN");
  });

  it("reports a statement that can be heard but never broken in a length", () => {
    expect(errorCodes({ ...STATEMENT, broken_by: { items: ["i_ghost_a"] } }, (pack) => {
      // Two items that each need the other first, so neither can ever be obtained.
      const ghost = (id: string, other: string) => ({
        id, name: "Ghost note", description: "A note nobody can reach.", icon_recipe: "paper", key: false,
        found_at: { type: "character" as const, id: "c_mira" }, found_requires: { items: [other] }, purpose: "Test only.",
      });
      pack.items.push(ghost("i_ghost_a", "i_ghost_b"), ghost("i_ghost_b", "i_ghost_a"));
    })).toContain("STATEMENT_UNBREAKABLE");
  });

  it("reports a hidden clue that the same character also gives freely", () => {
    expect(errorCodes(STATEMENT, (pack) => {
      const hollis = pack.cast.find((member) => member.id === "c_hollis")!;
      hollis.knowledge[2] = { ...hollis.knowledge[2]!, clue_id: "cl_hollis_confess" };
    })).toContain("STATEMENT_CLUE_GIVEN_FREELY");
    expect(errorCodes(STATEMENT, (pack) => {
      const hollis = pack.cast.find((member) => member.id === "c_hollis")!;
      hollis.reactions = [{ id: "r_x", about: { type: "item", id: "i_glass_shard" }, text: "Oh, that.", clue_id: "cl_hollis_confess" }];
    })).toContain("STATEMENT_CLUE_GIVEN_FREELY");
  });

  it("applies the dialogue rules to statement text", () => {
    expect(errorCodes({ ...STATEMENT, admission: "x".repeat(150) + " " + "y".repeat(80) })).toContain("SCHEMA");
    expect(errorCodes({ ...STATEMENT, text: "Hollis looks away and says nothing at all about the tower." })).toContain("DIALOGUE_NARRATION");
    expect(errorCodes({ ...STATEMENT, topic: "What he did that night" })).toContain("KNOWLEDGE_TOPIC");
  });

  it("requires evidence, a clue told by the character and covered clue requirements", () => {
    expect(errorCodes({ ...STATEMENT, broken_by: {} })).toContain("STATEMENT_NO_EVIDENCE");
    expect(errorCodes({ ...STATEMENT, clue_id: "cl_pip_saw" })).toContain("STATEMENT_CLUE_ELSEWHERE");
    expect(errorCodes({ ...STATEMENT, requires: {} })).toContain("STATEMENT_CLUE_REQUIREMENTS");
  });
});
