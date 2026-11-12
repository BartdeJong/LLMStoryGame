import { describe, expect, it } from "vitest";
import fixture from "../../public/stories/example.json";
import { LLMClient } from "../llm/client";
import { MockBackend } from "../llm/mock";
import type { GenerationParams } from "../llm/types";
import { storyMockRespond } from "../story/mockResponder";
import { getLengthView } from "../story/loader";
import { createStoryState, giveItem } from "../story/state";
import type { StoryState } from "../story/state";
import type { StoryPack } from "../story/types";
import { validateStoryPack } from "../story/validate";
import { ConversationController } from "./controller";
import { giveOptions } from "./effects";
import { availableKnowledge, buildQuickReplies, QUICK_GOODBYE, QUICK_NEED, retrieveKnowledge, stem } from "./knowledge";
import { cleanCharacterLine, rejectionReason } from "./lineCleanup";
import { buildDialoguePrompt } from "./prompt";
import { isUsableCharacterLine, pickDeflection } from "./quality";

function loadPack(): StoryPack {
  const report = validateStoryPack(fixture);
  if (!report.pack) throw new Error(`fixture pack is invalid: ${report.errors.map((e) => e.message).join("; ")}`);
  return report.pack;
}

function freshState(pack: StoryPack): StoryState {
  return createStoryState(getLengthView(pack, "short"));
}

async function makeClient(respond: (params: GenerationParams) => string | undefined = storyMockRespond): Promise<LLMClient> {
  const client = new LLMClient(new MockBackend({ respond }), { pauseWhenHidden: false });
  await client.load();
  return client;
}

const context = { locationName: "Owl Library", locationMood: "hushed", storySummary: "", inventory: [] };

function setup(characterId: string) {
  const pack = loadPack();
  const character = pack.cast.find((c) => c.id === characterId)!;
  return { pack, character, state: freshState(pack) };
}

const lineReply = (line: string): string => JSON.stringify({ line });

describe("line cleaning", () => {
  it("keeps only quoted speech after narration", () => {
    expect(cleanCharacterLine("Bramwell mumbles, 'Aye. Bart. You're in the oil.'", "Bramwell Press"))
      .toBe("Aye. Bart. You're in the oil.");
  });

  it("removes a leading name prefix, asterisks, parentheses and doubled punctuation", () => {
    expect(cleanCharacterLine("Bramwell: It's just Bramwell, Bart.", "Bramwell Press")).toBe("It's just Bramwell, Bart.");
    expect(cleanCharacterLine("Bramwell Press: Hello *waves* there (softly)!!", "Bramwell Press")).toBe("Hello there!");
    expect(cleanCharacterLine("Well,, then.. yes?!  ", "Bramwell Press")).toBe("Well, then. yes?!");
    expect(cleanCharacterLine("Hmm... maybe.", "Bramwell Press")).toBe("Hmm... maybe.");
  });

  it("does not treat apostrophes or a quoted word as speech", () => {
    expect(cleanCharacterLine("I can't say, but it's 'odd'", "Oswin")).toBe("I can't say, but it's 'odd'");
  });
});

describe("line rejection", () => {
  const name = "Bramwell Press";
  const reject = (raw: string): string | null => rejectionReason(cleanCharacterLine(raw, name), name);

  it("rejects the real bad lines", () => {
    expect(reject("Bramwell is Bramwell. A strange name for a humble presser.")).not.toBeNull();
    expect(reject("Hello. Welcome to Bramwell Press.")).not.toBeNull();
    expect(reject("The air is warm, the humming of machines nearby reminds me to keep my eyes open.")).not.toBeNull();
    expect(reject("Bramwell nods slowly and says nothing more.")).not.toBeNull();
    expect(reject("Yes.")).not.toBeNull();
    expect(reject("*sighs*")).not.toBeNull();
  });

  it("accepts good lines", () => {
    expect(reject("Hello, Bart. I'm Bramwell Press.")).toBeNull();
    expect(reject("Bramwell? That's me, Bart.")).toBeNull();
    expect(reject("Bramwell mumbles, 'Aye. Bart. You're in the oil.'")).toBeNull();
    expect(reject("Bramwell: It's just Bramwell, Bart.")).toBeNull();
  });

  it("uses a configurable verb and scene-phrase list", () => {
    const config = { nameVerbs: ["grumbles"], scenePhrases: ["Outside"], minWords: 1 };
    expect(rejectionReason("Oswin grumbles again.", "Oswin", config)).not.toBeNull();
    expect(rejectionReason("Oswin is here.", "Oswin", config)).toBeNull();
    expect(rejectionReason("Outside it rains.", "Oswin", config)).not.toBeNull();
  });
});

describe("resample and fallback", () => {
  it("resamples twice with rising temperature, then uses an authored deflection", async () => {
    const { pack, character, state } = setup("c_oswin");
    const temperatures: number[] = [];
    const client = await makeClient((params) => {
      temperatures.push(params.temperature);
      return lineReply("Oswin is Oswin. A strange name for a librarian.");
    });
    const controller = new ConversationController(client, pack, state, character, context, { random: () => 0 });
    await controller.start();
    temperatures.length = 0;
    const turn = await controller.reply("Hello there.");

    expect(temperatures).toHaveLength(3);
    expect(temperatures[1]! - temperatures[0]!).toBeCloseTo(0.1);
    expect(temperatures[2]! - temperatures[1]!).toBeCloseTo(0.1);
    expect(turn.quality).toBe("fallback");
    expect(character.deflections).toContain(turn.line);
    expect(turn.line).not.toContain(character.goal);
  });

  it("accepts a line from the second attempt and marks it repaired", async () => {
    const { pack, character, state } = setup("c_oswin");
    let calls = 0;
    const client = await makeClient(() => {
      calls += 1;
      return lineReply(calls === 3 ? "Oswin mumbles, 'Mind the shelves, please.'" : "(sigh)");
    });
    const controller = new ConversationController(client, pack, state, character, context, { random: () => 0 });
    await controller.start();
    const turn = await controller.reply("Hello there.");
    expect(turn.quality).toBe("repaired");
    expect(turn.line).toBe("Mind the shelves, please.");
  });

  it("never repeats the same deflection twice in a row", async () => {
    const { pack, character, state } = setup("c_oswin");
    const client = await makeClient(() => lineReply("(sigh)"));
    const controller = new ConversationController(client, pack, state, character, context, { random: () => 0 });
    await controller.start();
    const lines: string[] = [];
    for (let i = 0; i < 6; i += 1) lines.push((await controller.reply("Hmm?")).line);
    lines.slice(1).forEach((line, i) => expect(line).not.toBe(lines[i]));
    expect(pickDeflection(character, character.deflections[0], () => 0)).not.toBe(character.deflections[0]);
  });

  it("surfaces model failures and still shows an authored line", async () => {
    const { pack, character, state } = setup("c_oswin");
    const client = await makeClient(() => {
      throw new Error("mock backend failed");
    });
    const controller = new ConversationController(client, pack, state, character, context, { random: () => 0 });
    const opening = await controller.start();
    expect(opening.line).toBe(character.greetings[0]);
    expect(opening.notice).toContain("mock backend failed");
    const turn = await controller.reply("Hello?");
    expect(turn.quality).toBe("fallback");
    expect(character.deflections).toContain(turn.line);
  });
});

describe("opening line", () => {
  it("starts from an authored greeting and never describes the surroundings", async () => {
    const { pack, character, state } = setup("c_pip");
    const controller = new ConversationController(await makeClient(), pack, state, character, context, { random: () => 0 });
    const opening = await controller.start();
    expect(character.greetings).toContain(opening.line);
    expect(isUsableCharacterLine(opening.line, character.name)).toBe(true);
  });

  it("shows the greeting as is when the rephrase fails cleaning", async () => {
    const { pack, character, state } = setup("c_oswin");
    const client = await makeClient(() => lineReply("Hello. Welcome to Oswin."));
    const controller = new ConversationController(client, pack, state, character, context, { random: () => 1 / 3 });
    const opening = await controller.start();
    expect(opening.line).toBe(character.greetings[1]);
  });

  it("uses a clean rephrase when the model gives one", async () => {
    const { pack, character, state } = setup("c_oswin");
    const client = await makeClient(() => lineReply("Oswin: Good day, quietly now."));
    const controller = new ConversationController(client, pack, state, character, context, { random: () => 0 });
    const opening = await controller.start();
    expect(opening.line).toBe("Good day, quietly now.");
    expect(opening.quality).toBe("generated");
  });
});

describe("knowledge retrieval", () => {
  it("picks the top two facts with at least one keyword, using simple stemming", () => {
    const { character } = setup("c_pip");
    const hits = retrieveKnowledge(character.knowledge, "Did you see a glowing figure on the stairs?");
    expect(hits[0]!.item.id).toBe("k_pip_figure");
    expect(hits.length).toBeLessThanOrEqual(2);
    expect(hits[0]!.explicit).toBe(true);
    expect(stem("lanterns")).toBe(stem("lantern"));
    expect(stem("tides")).toBe(stem("tide"));
    expect(retrieveKnowledge(character.knowledge, "Nice weather today")).toEqual([]);
  });

  it("treats an exact quick-reply text as an explicit request", () => {
    const { character } = setup("c_mira");
    const ask = character.knowledge[1]!.ask;
    const hits = retrieveKnowledge(character.knowledge, ask);
    expect(hits[0]!.item.id).toBe(character.knowledge[1]!.id);
    expect(hits[0]!.explicit).toBe(true);
  });

  it("marks a weak match as not explicit", () => {
    const { character } = setup("c_pip");
    const hits = retrieveKnowledge(character.knowledge, "tell me about the stairs");
    expect(hits.every((hit) => !hit.explicit)).toBe(true);
  });
});

describe("quick replies", () => {
  it("come from undiscussed topics, use ask text and end with the fixed buttons", async () => {
    const { pack, character, state } = setup("c_mira");
    const controller = new ConversationController(await makeClient(), pack, state, character, context, { random: () => 0 });
    const opening = await controller.start();
    const asks = character.knowledge.map((item) => item.ask);
    expect(opening.choices.slice(-2)).toEqual([QUICK_NEED, QUICK_GOODBYE]);
    expect(opening.choices.slice(0, -2).every((choice) => asks.includes(choice))).toBe(true);
    expect(opening.choices.some((choice) => /^Ask about/i.test(choice))).toBe(false);

    const topic = opening.choices.find((choice) => choice !== QUICK_NEED && choice !== QUICK_GOODBYE);
    if (topic) {
      const next = await controller.reply(topic);
      expect(next.choices).not.toContain(topic);
      expect(next.choices.slice(-2)).toEqual([QUICK_NEED, QUICK_GOODBYE]);
    }
  });

  it("shows fewer topic buttons once everything has been discussed", () => {
    const { pack, character, state } = setup("c_mira");
    const all = new Set(character.knowledge.map((item) => item.id));
    expect(buildQuickReplies(availableKnowledge(pack, state, character), all, state)).toEqual([QUICK_NEED, QUICK_GOODBYE]);
  });

  it("only suggests questions whose topic words are already known", () => {
    const { character, state } = setup("c_mira");
    const items = [
      { ...character.knowledge[0]!, ask: "What happened at the moon lantern?" },
      { ...character.knowledge[1]!, ask: "What is inside the sealed envelope?" },
    ];

    expect(buildQuickReplies(items, new Set(), state, "The moon lantern hangs above the village."))
      .toEqual(["What happened at the moon lantern?", QUICK_NEED, QUICK_GOODBYE]);
  });
});

describe("handovers", () => {
  it("records items the character asks for when the player asks what they need", async () => {
    const { pack, character, state } = setup("c_oswin");
    const controller = new ConversationController(await makeClient(), pack, state, character, context, { random: () => 0 });
    await controller.start();

    await controller.reply(QUICK_NEED);

    expect(state.needsRecorded).toEqual([{ characterId: "c_oswin", itemId: "i_overdue_book" }]);
  });

  it("shows the Give button only when the required item is held", async () => {
    const { pack, character, state } = setup("c_oswin");
    const controller = new ConversationController(await makeClient(), pack, state, character, context, { random: () => 0 });
    expect((await controller.start()).gives).toEqual([]);
    expect(() => controller.give("i_overdue_book")).toThrow();

    giveItem(state, "i_overdue_book");
    expect(giveOptions(pack, state, character)).toEqual([{ itemId: "i_overdue_book", label: "Give Overdue book" }]);
    expect((await controller.reply("Hello again.")).gives).toHaveLength(1);
  });

  it("gives the reward in code and tells the next prompt what just happened", async () => {
    const { pack, character, state } = setup("c_oswin");
    const prompts: string[] = [];
    const client = await makeClient((params) => {
      prompts.push(params.messages.map((m) => m.content).join("\n"));
      return storyMockRespond(params);
    });
    const controller = new ConversationController(client, pack, state, character, context, { random: () => 0 });
    await controller.start();
    await controller.reply("Do you have something for me?");
    expect(prompts.at(-1)).toContain("Nothing has been handed over");
    expect(prompts.at(-1)).toContain("Overdue book");
    expect(state.itemsHeld).not.toContain("i_tower_key");

    giveItem(state, "i_overdue_book");
    const turn = await controller.give("i_overdue_book");
    expect(turn.effects).toMatchObject({ resolvedGoal: "gs_oswin_book", givenItem: "i_tower_key" });
    expect(state.itemsHeld).toContain("i_tower_key");
    expect(prompts.at(-1)).toContain("Just happened: the player gave you the Overdue book. Thank them.");
    expect(prompts.at(-1)).toContain("Just happened: you gave the player the Tower key.");
    expect(turn.gives).toEqual([]);
  });

  it("hands over items with no item requirement when the pack conditions are met", async () => {
    const { pack, character, state } = setup("c_hollis");
    const controller = new ConversationController(await makeClient(), pack, state, character, context, { random: () => 0 });
    state.truthsFound.push("t_motive");
    const turn = await controller.start();
    expect(turn.effects.resolvedGoal).toBe("gs_hollis_forgiven");
  });
});

describe("clue marking", () => {
  it("marks a clue found only when its fact was asked for explicitly", async () => {
    const { pack, character, state } = setup("c_pip");
    const controller = new ConversationController(await makeClient(), pack, state, character, context, { random: () => 0 });
    await controller.start();
    const weak = await controller.reply("tell me about the stairs");
    expect(weak.effects.revealedClue).toBeNull();
    expect(state.cluesFound).not.toContain("cl_pip_saw");

    const strong = await controller.reply("What did you see last night?");
    expect(strong.effects.revealedClue).toBe("cl_pip_saw");
    expect(state.cluesFound).toContain("cl_pip_saw");
  });

  it("does not reveal a gated clue before its requirement is met", async () => {
    const { pack, character, state } = setup("c_oswin");
    const controller = new ConversationController(await makeClient(), pack, state, character, context, { random: () => 0 });
    await controller.start();
    const turn = await controller.reply("Who took the tower key?");
    expect(turn.effects.revealedClue).toBeNull();
    expect(state.cluesFound).not.toContain("cl_oswin_ledger");
    expect(turn.line).not.toContain("Hollis");
  });

  it("does not mark a clue when the line fell back to a deflection", async () => {
    const { pack, character, state } = setup("c_pip");
    const client = await makeClient(() => lineReply("(sigh)"));
    const controller = new ConversationController(client, pack, state, character, context, { random: () => 0 });
    await controller.start();
    await controller.reply("What did you see last night?");
    expect(state.cluesFound).toEqual([]);
  });
});

describe("dialogue prompt", () => {
  it("contains the selected facts, the goal hint, the added rules and only this conversation", () => {
    const { character } = setup("c_oswin");
    const facts = [character.knowledge[0]!];
    const prompt = buildDialoguePrompt({
      character,
      context,
      turns: [{ speaker: "player", text: "What is this book?" }, { speaker: "character", text: "A tidy question." }],
      facts,
      goalHint: character.goal_hints.unmet[0]!,
      handoverLines: ["Nothing has been handed over."],
    });
    expect(prompt).toContain("Your name is Oswin. It is a person's name, not a place or a shop.");
    expect(prompt).toContain("never refer to yourself by name in the third person");
    expect(prompt).toContain("Only two things can happen in this world: talking, and handing over items.");
    expect(prompt).toContain("Only say you hand over an item when the prompt tells you it just happened.");
    expect(prompt).toContain("Do not invent facts about the world.");
    expect(prompt).toContain(`- ${facts[0]!.text}`);
    expect(prompt).not.toContain(character.knowledge[1]!.text);
    expect(prompt).toContain(`What you need right now: ${character.goal_hints.unmet[0]}`);
    expect(prompt).toContain("Player: What is this book?");
    expect(prompt).toContain("You: A tidy question.");
    expect(prompt).not.toContain("Oswin: A tidy question.");
    expect(prompt).not.toContain(character.secret);
    expect(prompt).not.toContain("Mira");
  });

  it("starts a new conversation with no earlier turns", async () => {
    const { pack, character, state } = setup("c_oswin");
    const client = await makeClient();
    const first = new ConversationController(client, pack, state, character, context);
    await first.start();
    await first.reply("Have you seen anything strange?");
    expect(new ConversationController(client, pack, state, character, context).getTurns()).toEqual([]);
    expect(buildDialoguePrompt({ character, context, turns: [], facts: [], goalHint: "", handoverLines: [] }))
      .toContain("the conversation is just starting");
  });
});

describe("enriched pack validation", () => {
  const clone = (): any => structuredClone(fixture);

  it("accepts the enriched example pack", () => {
    expect(validateStoryPack(fixture).errors).toEqual([]);
  });

  it.each([
    ["greetings", (c: any) => delete c.greetings],
    ["knowledge", (c: any) => delete c.knowledge],
    ["goal_hints", (c: any) => delete c.goal_hints],
    ["deflections", (c: any) => delete c.deflections],
    ["too few greetings", (c: any) => { c.greetings = c.greetings.slice(0, 2); }],
    ["too few knowledge items", (c: any) => { c.knowledge = c.knowledge.slice(0, 4); }],
    ["too many knowledge items", (c: any) => { c.knowledge = [...c.knowledge, ...c.knowledge, ...c.knowledge].slice(0, 9); }],
    ["a missing hint state", (c: any) => delete c.goal_hints.in_progress],
    ["a single resolved hint", (c: any) => { c.goal_hints.resolved = ["Only one line here."]; }],
    ["too few deflections", (c: any) => { c.deflections = c.deflections.slice(0, 4); }],
    ["a long fact", (c: any) => { c.knowledge[0].text = "x".repeat(141); }],
    ["a long topic", (c: any) => { c.knowledge[0].topic = "one two three four"; }],
    ["too few keywords", (c: any) => { c.knowledge[0].keywords = ["a", "b"]; }],
    ["a duplicate knowledge id", (c: any) => { c.knowledge[1].id = c.knowledge[0].id; }],
    ["an unknown clue_id", (c: any) => { c.knowledge[0].clue_id = "cl_nope"; }],
    ["an unknown truth_id", (c: any) => { c.knowledge[1].truth_id = "t_nope"; }],
    ["narration in a greeting", (c: any) => { c.greetings[0] = "The air is warm and the shelves hum quietly."; }],
    ["a name-led greeting", (c: any) => { c.greetings[0] = "Oswin smiles and nods at the visitor."; }],
    ["narration in a deflection", (c: any) => { c.deflections[0] = "*shrugs* I could not say."; }],
    ["narration in a hint", (c: any) => { c.goal_hints.unmet[0] = "Welcome to Oswin, says the owl."; }],
    ["a clue nobody can tell", (c: any) => { c.knowledge = c.knowledge.map((k: any) => ({ ...k, clue_id: undefined })); }],
  ])("rejects a character with %s", (_label, mutate) => {
    const pack = clone();
    mutate(pack.cast.find((c: any) => c.id === "c_oswin"));
    const report = validateStoryPack(pack);
    expect(report.ok).toBe(false);
    expect(report.errors[0]!.message.length).toBeGreaterThan(5);
  });

  it("rejects the old schema version", () => {
    const pack = clone();
    pack.schema_version = 1;
    expect(validateStoryPack(pack).ok).toBe(false);
  });
});
