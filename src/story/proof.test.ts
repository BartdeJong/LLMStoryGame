import { afterEach, describe, expect, it } from "vitest";
import fixture from "../../public/stories/example.json";
import holmesFixture from "../../public/stories/holmesashenvelope.json";
import { setAssistedDeductions } from "./assist";
import { EVIDENCE_OPTIONS, PROOF_SLOTS } from "./config";
import { getLengthView } from "./loader";
import { judgeAnswer, pickEvidenceOptions, proofChoices, proofPieces, requiredCount, sanitizeShown } from "./proof";
import { solveLength } from "./solver";
import { summationOptions } from "./deduction";
import { createStoryState, giveItem, markClueFound } from "./state";
import { challengeStatement } from "./statements";
import type { StoryPack } from "./types";

const fresh = (): StoryPack => structuredClone(fixture) as unknown as StoryPack;
const holmes = (): StoryPack => structuredClone(holmesFixture) as unknown as StoryPack;
const clue = (id: string) => ({ type: "clue" as const, id });
const item = (id: string) => ({ type: "item" as const, id });

afterEach(() => setAssistedDeductions(false));

describe("proof pieces and required count", () => {
  it("lists items, then clues", () => {
    expect(proofPieces({ clues: ["c1", "c2"], items: ["i1"] })).toEqual([item("i1"), clue("c1"), clue("c2")]);
    expect(proofPieces(undefined)).toEqual([]);
  });

  it("requires one piece by default, clamps to the pieces listed and needs none without a proof", () => {
    expect(requiredCount(undefined)).toBe(0);
    expect(requiredCount({ clues: ["c1", "c2"] })).toBe(1);
    expect(requiredCount({ clues: ["c1", "c2"], required: 2 })).toBe(2);
    expect(requiredCount({ clues: ["c1"], required: 3 })).toBe(1);
  });
});

describe("judging an answer", () => {
  const proof = { clues: ["c1", "c2", "c3"], required: 2 };

  it("is proven with the right conclusion and enough relevant pieces", () => {
    expect(judgeAnswer(true, proof, [clue("c1"), clue("c3")])).toBe("proven");
  });

  it("is unproven with the right conclusion and too few relevant pieces", () => {
    expect(judgeAnswer(true, proof, [clue("c1")])).toBe("unproven");
    expect(judgeAnswer(true, proof, [])).toBe("unproven");
  });

  it("is misread with a wrong conclusion and at least one relevant piece", () => {
    expect(judgeAnswer(false, proof, [clue("c2")])).toBe("misread");
  });

  it("is wrong with a wrong conclusion and no relevant piece", () => {
    expect(judgeAnswer(false, proof, [])).toBe("wrong");
    expect(judgeAnswer(false, proof, [clue("other")])).toBe("wrong");
  });

  it("ignores irrelevant pieces without penalty and counts duplicates once", () => {
    expect(judgeAnswer(true, proof, [clue("c1"), clue("c2"), clue("junk"), item("c1")])).toBe("proven");
    expect(judgeAnswer(true, proof, [clue("c1"), clue("c1")])).toBe("unproven");
  });

  it("tells an item from a clue with the same id", () => {
    expect(judgeAnswer(true, { items: ["x"] }, [clue("x")])).toBe("unproven");
    expect(judgeAnswer(true, { items: ["x"] }, [item("x")])).toBe("proven");
  });

  it("judges the answer alone when there is no proof", () => {
    expect(judgeAnswer(true, undefined, [])).toBe("proven");
    expect(judgeAnswer(false, undefined, [clue("c1")])).toBe("wrong");
  });
});

describe("sanitizing what was shown", () => {
  it("keeps only held pieces, once each", () => {
    const pack = fresh();
    const state = createStoryState(getLengthView(pack, "short"));
    markClueFound(state, "cl_pip_saw");
    giveItem(state, pack.items[0]!.id);
    const shown = sanitizeShown(state, [clue("cl_pip_saw"), clue("cl_library_log"), clue("cl_pip_saw"), item(pack.items[0]!.id), item("i_nope")]);
    expect(shown).toEqual([clue("cl_pip_saw"), item(pack.items[0]!.id)]);
  });

  it("caps the pieces at the number of slots", () => {
    const pack = fresh();
    const state = createStoryState(getLengthView(pack, "short"));
    const ids = pack.clues.slice(0, PROOF_SLOTS + 2).map((entry) => entry.id);
    for (const id of ids) markClueFound(state, id);
    expect(sanitizeShown(state, ids.map(clue))).toEqual(ids.slice(0, PROOF_SLOTS).map(clue));
  });
});

describe("what the player can show", () => {
  it("lists items held, then clues found, labelled with the item name or clue text", () => {
    const pack = fresh();
    const state = createStoryState(getLengthView(pack, "short"));
    expect(proofChoices(pack, state)).toEqual([]);
    markClueFound(state, "cl_pip_saw");
    const held = pack.items[0]!;
    giveItem(state, held.id);
    expect(proofChoices(pack, state)).toEqual([
      { ref: item(held.id), label: held.name, group: "item" },
      { ref: clue("cl_pip_saw"), label: pack.clues.find((entry) => entry.id === "cl_pip_saw")!.text, group: "clue" },
    ]);
  });

  it("includes the clue a broken statement reveals", () => {
    const pack = holmes();
    const state = createStoryState(getLengthView(pack, "long"));
    const hudson = pack.cast.find((member) => member.id === "c_hudson")!;
    giveItem(state, "i_wren_docket");
    state.statementsHeard = ["st_hudson_appeal"];
    expect(proofChoices(pack, state).some((choice) => choice.ref.id === "cl_ward_appeal")).toBe(false);
    expect(challengeStatement(pack, state, hudson, "st_hudson_appeal", item("i_wren_docket")).fits).toBe(true);
    const revealed = proofChoices(pack, state).find((choice) => choice.ref.id === "cl_ward_appeal");
    expect(revealed).toEqual({
      ref: clue("cl_ward_appeal"),
      label: pack.clues.find((entry) => entry.id === "cl_ward_appeal")!.text,
      group: "clue",
    });
  });
});

describe("solving without a truth", () => {
  it("withholdTruth keeps that truth, and what depends on it, out of reach", () => {
    const pack = fresh();
    const view = getLengthView(pack, "short");
    const normal = solveLength(pack, view.definition);
    expect(normal.truths.has("t_taker")).toBe(true);
    expect(normal.clues.has("cl_hollis_confess")).toBe(true);
    const withheld = solveLength(pack, view.definition, { withholdTruth: "t_taker" });
    expect(withheld.truths.has("t_taker")).toBe(false);
    expect(withheld.clues.has("cl_hollis_confess")).toBe(false);
    expect(withheld.clues.has("cl_oswin_ledger")).toBe(true); // found, but never turned into the truth
  });
});

describe("picking evidence options", () => {
  const holding = (ids: string[], items: string[] = []) => {
    const pack = fresh();
    const view = getLengthView(pack);
    const state = createStoryState(view);
    for (const id of ids) markClueFound(state, id);
    for (const id of items) giveItem(state, id);
    const held = proofChoices(pack, state).map((choice) => choice.ref);
    return { pack, view, state, held };
  };
  const allClues = ["cl_pip_saw", "cl_library_log", "cl_mira_talk", "cl_notice_board", "cl_flour_prints", "cl_oswin_ledger"];
  const correct = [clue("cl_pip_saw"), clue("cl_library_log")];
  const keyOf = (piece: { type: string; id: string }): string => `${piece.type}:${piece.id}`;

  it("includes the held correct pieces and only held pieces", () => {
    const { pack, view, state, held } = holding(allClues, ["i_overdue_book"]);
    const picked = pickEvidenceOptions(pack, view, state, held, correct, "t_night", 2);
    expect(picked).toContainEqual(clue("cl_pip_saw"));
    expect(picked).toContainEqual(clue("cl_library_log"));
    for (const piece of picked) expect(held.map(keyOf)).toContain(keyOf(piece));
    expect(picked.map(keyOf)).not.toContain("clue:cl_hollis_confess");
  });

  it("stays small, with distractors, and is deterministic", () => {
    const { pack, view, state, held } = holding(allClues, ["i_overdue_book"]);
    const picked = pickEvidenceOptions(pack, view, state, held, correct, "t_night", 2);
    expect(picked.length).toBeLessThanOrEqual(Math.max(EVIDENCE_OPTIONS.size, 2 + EVIDENCE_OPTIONS.minDistractors));
    expect(picked.length - 2).toBeGreaterThanOrEqual(EVIDENCE_OPTIONS.minDistractors);
    expect(pickEvidenceOptions(pack, view, state, held, correct, "t_night", 2)).toEqual(picked);
  });

  it("varies with the seed", () => {
    const { pack, view, state, held } = holding(allClues, ["i_overdue_book"]);
    const sets = new Set(["a", "b", "c", "d", "e", "f"].map((seed) =>
      pickEvidenceOptions(pack, view, state, held, correct, seed, 2).map(keyOf).sort().join(",")));
    expect(sets.size).toBeGreaterThan(1);
  });

  it("prefers related distractors (herring setup, same or earlier truth) over unrelated ones", () => {
    const { pack, view, state, held } = holding(["cl_oswin_ledger", "cl_pip_saw", "cl_library_log", "cl_flour_prints", "cl_mira_talk"], ["i_overdue_book"]);
    for (const seed of ["a", "b", "c", "d"]) {
      const picked = pickEvidenceOptions(pack, view, state, held, [clue("cl_oswin_ledger"), clue("cl_shard_match")], seed);
      expect(picked).toContainEqual(clue("cl_oswin_ledger"));
      expect(picked).toContainEqual(clue("cl_flour_prints"));
      expect(picked).not.toContainEqual(clue("cl_mira_talk"));
      expect(picked).not.toContainEqual(item("i_overdue_book"));
    }
  });

  it("offers only distractors when no correct piece is held", () => {
    const { pack, view, state, held } = holding(["cl_mira_talk", "cl_notice_board", "cl_flour_prints"]);
    const picked = pickEvidenceOptions(pack, view, state, held, correct, "t_night", 2);
    expect(picked.length).toBe(3);
    expect(picked.every((piece) => !correct.some((entry) => entry.id === piece.id))).toBe(true);
    expect(pickEvidenceOptions(pack, view, state, [], correct, "t_night", 2)).toEqual([]);
  });
});

describe("summation options per question", () => {
  it("returns the right truth and three confirmed distractors", () => {
    const pack = fresh();
    const state = createStoryState(getLengthView(pack));
    state.truthsFound.push(...pack.truths.map((truth) => truth.id));
    const options = summationOptions(pack, state, { truthId: "t_taker" });
    expect(options).toHaveLength(Math.min(4, pack.truths.length));
    expect(options.map((option) => option.id)).toContain("t_taker");
    expect(summationOptions(pack, state, { truthId: "t_taker" })).toEqual(options);
    expect(summationOptions(pack, state).length).toBe(pack.truths.length);
  });
});
