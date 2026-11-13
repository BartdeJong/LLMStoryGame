import { afterEach, describe, expect, it } from "vitest";
import fixture from "../../public/stories/example.json";
import { LLMClient } from "../llm/client";
import { MockBackend } from "../llm/mock";
import { setAssistedDeductions } from "./assist";
import { answerDeduction, collectTwistReveals, deductionOptions, openDeductions, pickSummation } from "./deduction";
import { getLengthView } from "./loader";
import { storyMockRespond } from "./mockResponder";
import { caseRecordOf, createStoryState, grantTruthsFromFoundClues, markClueFound } from "./state";
import { StorySession } from "./storySession";
import type { StoryPack } from "./types";
import { validateStoryPack } from "./validate";

const fresh = (): StoryPack => structuredClone(fixture) as unknown as StoryPack;
const codes = (data: unknown): string[] => validateStoryPack(data).errors.map((e) => e.code);

function setup(pack = fresh()) {
  const view = getLengthView(pack, "short");
  const state = createStoryState(view);
  const find = (...clueIds: string[]): void => {
    for (const id of clueIds) markClueFound(state, id);
    grantTruthsFromFoundClues(pack, state);
  };
  return { pack, view, state, find };
}

afterEach(() => setAssistedDeductions(false));

describe("deductions", () => {
  it("confirms a truth without a deduction as soon as its clue is found", () => {
    const { state, find } = setup();
    find("cl_mira_talk");
    expect(state.truthsFound).toEqual(["t_missing"]);
    expect(state.truthsReady).toEqual([]);
  });

  it("makes a deduction truth ready, not found, until it is answered", () => {
    const { pack, state, find } = setup();
    find("cl_mira_talk", "cl_pip_saw");
    expect(state.truthsFound).toEqual(["t_missing"]);
    expect(state.truthsReady).toEqual(["t_night"]);
    expect(openDeductions(pack, state).map((truth) => truth.id)).toEqual(["t_night"]);

    const right = answerDeduction(pack, state, "t_night", pack.truths[1].deduction!.answer);
    expect(right.correct).toBe(true);
    expect(state.truthsFound).toContain("t_night");
    expect(state.truthsReady).toEqual([]);
    // t_night has a proof, and no evidence was shown: right, but not proven
    expect(right.outcome).toBe("unproven");
    expect(caseRecordOf(state).deductions).toEqual([{ truthId: "t_night", answer: pack.truths[1].deduction!.answer, correct: true, outcome: "unproven", evidence: [] }]);
  });

  it("takes one final answer: a wrong one still confirms the truth and is recorded", () => {
    const { pack, state, find } = setup();
    find("cl_mira_talk", "cl_pip_saw");
    const wrongAnswer = pack.truths[1].deduction!.wrong_answers[0]!;
    const wrong = answerDeduction(pack, state, "t_night", wrongAnswer);
    expect(wrong.accepted).toBe(true);
    expect(wrong.correct).toBe(false);
    expect(wrong.truth?.id).toBe("t_night");
    expect(state.truthsFound).toContain("t_night"); // the story goes on
    expect(openDeductions(pack, state)).toEqual([]);
    expect(wrong.outcome).toBe("wrong");
    expect(caseRecordOf(state).deductions).toEqual([{ truthId: "t_night", answer: wrongAnswer, correct: false, outcome: "wrong", evidence: [] }]);

    // No second try.
    const again = answerDeduction(pack, state, "t_night", pack.truths[1].deduction!.answer);
    expect(again.accepted).toBe(false);
    expect(caseRecordOf(state).deductions).toHaveLength(1);
  });

  describe("evidence-backed answers", () => {
    // t_night's proof: cl_pip_saw and cl_library_log, both required
    const clue = (id: string) => ({ type: "clue" as const, id });
    const ready = () => {
      const context = setup();
      context.find("cl_mira_talk", "cl_pip_saw", "cl_library_log");
      return context;
    };

    it("is proven with the right answer and enough relevant evidence", () => {
      const { pack, state } = ready();
      const result = answerDeduction(pack, state, "t_night", pack.truths[1].deduction!.answer, [clue("cl_pip_saw"), clue("cl_library_log")]);
      expect(result.outcome).toBe("proven");
      expect(caseRecordOf(state).deductions[0]).toEqual({
        truthId: "t_night", answer: pack.truths[1].deduction!.answer, correct: true, outcome: "proven",
        evidence: [clue("cl_pip_saw"), clue("cl_library_log")],
      });
    });

    it("is unproven with the right answer and too little evidence", () => {
      const { pack, state } = ready();
      const result = answerDeduction(pack, state, "t_night", pack.truths[1].deduction!.answer, [clue("cl_pip_saw")]);
      expect(result.correct).toBe(true);
      expect(result.outcome).toBe("unproven");
      expect(state.truthsFound).toContain("t_night"); // the story still goes on
    });

    it("is misread when the answer is wrong but the evidence was relevant", () => {
      const { pack, state } = ready();
      const result = answerDeduction(pack, state, "t_night", pack.truths[1].deduction!.wrong_answers[0]!, [clue("cl_pip_saw")]);
      expect(result.correct).toBe(false);
      expect(result.outcome).toBe("misread");
    });

    it("is wrong when the answer is wrong and the evidence is irrelevant or missing", () => {
      const { pack, state } = ready();
      const wrongAnswer = pack.truths[1].deduction!.wrong_answers[0]!;
      expect(answerDeduction(pack, state, "t_night", wrongAnswer, [clue("cl_mira_talk")]).outcome).toBe("wrong");
    });

    it("drops evidence the player does not hold", () => {
      const { pack, state } = setup();
      state.truthsReady.push("t_night");
      markClueFound(state, "cl_pip_saw");
      const result = answerDeduction(pack, state, "t_night", pack.truths[1].deduction!.answer, [clue("cl_pip_saw"), clue("cl_library_log")]);
      expect(result.outcome).toBe("unproven");
      expect(caseRecordOf(state).deductions[0]!.evidence).toEqual([clue("cl_pip_saw")]);
    });

    it("keeps one-click behaviour for a question without a proof", () => {
      const { pack, state } = ready();
      delete pack.truths[1].deduction!.proof;
      expect(answerDeduction(pack, state, "t_night", pack.truths[1].deduction!.answer).outcome).toBe("proven");
    });
  });

  it("never offers fewer options after a miss", () => {
    const { pack } = setup();
    const truth = pack.truths[1];
    expect(deductionOptions(truth)).toHaveLength(1 + truth.deduction!.wrong_answers.length);
  });

  it("waits for depends_on truths to be confirmed before a truth becomes ready", () => {
    const { pack, state, find } = setup();
    find("cl_mira_talk", "cl_pip_saw", "cl_library_log", "cl_shard_match");
    expect(state.truthsReady).toEqual(["t_night"]);

    answerDeduction(pack, state, "t_night", pack.truths[1].deduction!.answer);
    expect(state.truthsReady).toEqual(["t_taker"]);
  });

  it("ignores answers for truths that are not ready", () => {
    const { pack, state, find } = setup();
    find("cl_mira_talk");
    expect(answerDeduction(pack, state, "t_taker", pack.truths[2].deduction!.answer).correct).toBe(false);
    expect(state.truthsFound).toEqual(["t_missing"]);
  });

  it("rules out red herrings when the right answer is given", () => {
    const { pack, state, find } = setup();
    find("cl_mira_talk", "cl_pip_saw", "cl_shard_match");
    answerDeduction(pack, state, "t_night", pack.truths[1].deduction!.answer);
    expect(state.herringsRuledOut).toEqual([]);

    const result = answerDeduction(pack, state, "t_taker", pack.truths[2].deduction!.answer);
    expect(result.ruledOut.map((herring) => herring.id)).toEqual(["rh_flour_prints"]);
    expect(state.herringsRuledOut).toEqual(["rh_flour_prints"]);
  });

  it("shuffles the answer options but keeps all of them", () => {
    const truth = fresh().truths[2];
    const options = deductionOptions(truth);
    expect(options).toEqual(deductionOptions(truth));
    expect([...options].sort()).toEqual([truth.deduction!.answer, ...truth.deduction!.wrong_answers].sort());
  });

  it("confirms everything automatically in assisted mode", () => {
    setAssistedDeductions(true);
    const { state, find } = setup();
    find("cl_mira_talk", "cl_pip_saw", "cl_shard_match");
    expect(state.truthsFound).toEqual(["t_missing", "t_night", "t_taker"]);
    expect(state.truthsReady).toEqual([]);
    expect(state.herringsRuledOut).toEqual(["rh_flour_prints"]);
  });

  it("reveals a twist once, when its payoff first becomes true", () => {
    const { pack, view, state, find } = setup();
    expect(collectTwistReveals(pack, view, state)).toEqual([]);
    find("cl_mira_talk", "cl_pip_saw", "cl_shard_match", "cl_workbench");
    for (const id of ["t_night", "t_taker"]) {
      answerDeduction(pack, state, id, pack.truths.find((truth) => truth.id === id)!.deduction!.answer);
    }
    expect(collectTwistReveals(pack, view, state)).toEqual([]);

    answerDeduction(pack, state, "t_motive", pack.truths[3].deduction!.answer);
    expect(collectTwistReveals(pack, view, state).map((twist) => twist.id)).toEqual(["tw_gentle_taker"]);
    expect(state.twistsSeen).toEqual(["tw_gentle_taker"]);
    expect(collectTwistReveals(pack, view, state)).toEqual([]);
  });
});

describe("story session deduction rules", () => {
  const session = (pack: StoryPack): StorySession => new StorySession(
    pack,
    getLengthView(pack, "short"),
    new LLMClient(new MockBackend({ respond: storyMockRespond })),
  );

  it("says the beat waits on a deduction only when an open question blocks it", () => {
    const pack = fresh();
    pack.truths[0].deduction = { question: "What happened?", answer: "It vanished.", wrong_answers: ["Nothing.", "A joke."] };
    const story = session(pack);
    expect(story.currentBeatWaitsOnDeduction()).toBe(false);

    markClueFound(story.state, "cl_mira_talk");
    grantTruthsFromFoundClues(pack, story.state);
    expect(story.state.truthsReady).toEqual(["t_missing"]);
    expect(story.currentBeatWaitsOnDeduction()).toBe(true);

    answerDeduction(pack, story.state, "t_missing", "It vanished.");
    expect(story.currentBeatWaitsOnDeduction()).toBe(false);
    expect(story.currentBeat.id).toBe("b_tower");
  });

  it("offers a summation at the finale only once the ending facts are met", () => {
    const pack = fresh();
    const story = session(pack);
    story.state.visitedAreas.push("l_clocktower");
    expect(story.getSummation("l_clocktower")).toBeNull();

    story.state.truthsFound.push("t_missing", "t_night", "t_taker", "t_motive");
    story.state.resolvedGoalStates.push("gs_hollis_forgiven");
    expect(story.getSummation("l_clocktower")?.map((entry) => entry.truthId)).toEqual(["t_night", "t_taker", "t_motive"]);
  });

  it("has no summation for endings that define none", () => {
    const pack = fresh();
    delete pack.endings[0].summation;
    expect(pickSummation(pack.endings)).toBeNull();
  });
});

describe("validator rejects bad deduction data", () => {
  it("answer repeated among the wrong answers", () => {
    const pack = fresh();
    pack.truths[2].deduction!.wrong_answers[0] = pack.truths[2].deduction!.answer.toUpperCase();
    expect(codes(pack)).toContain("DEDUCTION_DUPLICATE_ANSWER");
  });

  it("too few or too many wrong answers", () => {
    const few = fresh();
    few.truths[2].deduction!.wrong_answers = ["Only one."];
    expect(codes(few)).toContain("SCHEMA");
    const many = fresh();
    many.truths[2].deduction!.wrong_answers = ["a1", "a2", "a3", "a4"];
    expect(codes(many)).toContain("SCHEMA");
  });

  it("rules_out naming an unknown red herring", () => {
    const pack = fresh();
    pack.truths[2].deduction!.rules_out = ["rh_nope"];
    const report = validateStoryPack(pack);
    expect(report.errors.some((e) => e.code === "REF_UNKNOWN" && e.message.includes("rh_nope"))).toBe(true);
  });

  it("summation truth that is not in the ending conditions", () => {
    const pack = fresh();
    pack.endings[0].summation![0].truth_id = "t_missing";
    expect(codes(pack)).toContain("SUMMATION_TRUTH_NOT_IN_ENDING");
  });

  it("proof naming an unknown clue or item", () => {
    const clueData = fresh();
    clueData.truths[1].deduction!.proof = { clues: ["cl_nope"] };
    const clueReport = validateStoryPack(clueData);
    expect(clueReport.errors.some((e) => e.code === "REF_UNKNOWN" && e.message.includes("cl_nope"))).toBe(true);
    const itemData = fresh();
    itemData.truths[1].deduction!.proof = { items: ["i_nope"], clues: ["cl_pip_saw"] };
    expect(validateStoryPack(itemData).errors.some((e) => e.code === "REF_UNKNOWN" && e.message.includes("i_nope"))).toBe(true);
  });

  it("proof requiring more pieces than it lists, or than there are slots", () => {
    const pack = fresh();
    pack.truths[1].deduction!.proof = { clues: ["cl_pip_saw", "cl_library_log"], required: 3 };
    expect(codes(pack)).toContain("PROOF_REQUIRED_TOO_HIGH");
    const slots = fresh();
    slots.truths[1].deduction!.proof = { clues: ["cl_pip_saw", "cl_library_log", "cl_mira_talk", "cl_shard_match"], required: 4 };
    expect(codes(slots)).toContain("PROOF_REQUIRED_TOO_HIGH");
  });

  it("proof whose required count is below 1 or not a whole number", () => {
    for (const required of [0, -1, 1.5]) {
      const pack = fresh();
      pack.truths[1].deduction!.proof = { clues: ["cl_pip_saw", "cl_library_log"], required };
      // The JSON schema (integer, minimum 1) already rejects these before the semantic checks run.
      const errors = validateStoryPack(pack).errors;
      expect(errors.some((e) => e.code === "SCHEMA" && e.path.endsWith("proof.required"))).toBe(true);
    }
    expect(validateStoryPack(fresh()).errors).toEqual([]);
  });

  it("empty proof, and a piece listed twice", () => {
    const empty = fresh();
    empty.truths[1].deduction!.proof = {};
    expect(codes(empty)).toContain("PROOF_EMPTY");
    const duplicate = fresh();
    duplicate.truths[1].deduction!.proof = { clues: ["cl_pip_saw", "cl_pip_saw"] };
    expect(codes(duplicate)).toContain("PROOF_DUPLICATE");
  });

  it("proof that cannot be gathered without the question's own truth", () => {
    const pack = fresh();
    pack.truths[2].deduction!.proof = { clues: ["cl_hollis_confess"] };
    const report = validateStoryPack(pack);
    const found = report.errors.find((e) => e.code === "PROOF_UNOBTAINABLE");
    expect(found?.path).toBe("truths[2].deduction.proof");
    expect(codes(fresh())).not.toContain("PROOF_UNOBTAINABLE");
  });

  it("summation proof naming an unknown clue, or one that cannot be gathered", () => {
    const unknown = fresh();
    unknown.endings[0].summation![0].proof = { clues: ["cl_nope"] };
    expect(validateStoryPack(unknown).errors.some((e) => e.code === "REF_UNKNOWN" && e.message.includes("cl_nope"))).toBe(true);
    const empty = fresh();
    empty.endings[0].summation![0].proof = {};
    expect(codes(empty)).toContain("PROOF_EMPTY");
  });

  it("warns when a deduction has no proof", () => {
    const pack = fresh();
    delete pack.truths[1].deduction!.proof;
    const report = validateStoryPack(pack);
    expect(report.warnings.some((w) => w.code === "DEDUCTION_NO_PROOF" && w.path === "truths[1].deduction")).toBe(true);
    expect(report.errors.map((e) => e.code)).not.toContain("DEDUCTION_NO_PROOF");
    expect(validateStoryPack(fresh()).warnings.map((w) => w.code)).not.toContain("DEDUCTION_NO_PROOF");
  });

  it("summation with the same truth twice, or too few entries", () => {
    const duplicate = fresh();
    duplicate.endings[0].summation![1].truth_id = "t_night";
    expect(codes(duplicate)).toContain("SUMMATION_DUPLICATE_TRUTH");
    const short = fresh();
    short.endings[0].summation = [short.endings[0].summation![0]];
    expect(codes(short)).toContain("SCHEMA");
  });
});
