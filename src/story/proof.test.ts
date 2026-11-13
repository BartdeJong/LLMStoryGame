import { afterEach, describe, expect, it } from "vitest";
import fixture from "../../public/stories/example.json";
import holmesFixture from "../../public/stories/holmesashenvelope.json";
import { setAssistedDeductions } from "./assist";
import { PROOF_SLOTS } from "./config";
import { getLengthView } from "./loader";
import { judgeAnswer, proofChoices, proofPieces, requiredCount, sanitizeShown } from "./proof";
import { solveLength } from "./solver";
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
