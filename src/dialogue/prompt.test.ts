import { describe, expect, it } from "vitest";
import fixture from "../../public/stories/example.json";
import { validateStoryPack } from "../story/validate";
import { LLMClient } from "../llm/client";
import { MockBackend } from "../llm/mock";
import { createStoryState, giveItem } from "../story/state";
import { getLengthView } from "../story/loader";
import { storyMockRespond } from "../story/mockResponder";
import { ConversationController } from "./controller";
import {
  buildDialoguePrompt, COMPACT_HISTORY_CHARS, LOCK_NOTES_INSTRUCTION, COMPACT_HISTORY_TURNS, CONVERSATION_END, CONVERSATION_START,
} from "./prompt";
import type { DialoguePromptInput } from "./prompt";
import type { ConversationTurn } from "./types";

const report = validateStoryPack(fixture);
if (!report.pack) throw new Error("Invalid story fixture");
const pack = report.pack;
const character = pack.cast.find((member) => member.id === "c_oswin")!;
const context = { locationName: "Owl Library", locationMood: "hushed", storySummary: "", inventory: [] };

function input(overrides: Partial<DialoguePromptInput> = {}): DialoguePromptInput {
  return {
    character, context,
    facts: [character.knowledge[0]!],
    turns: [{ speaker: "player", text: "What is this overdue book?" }],
    goalHint: "I still need the overdue book.",
    handoverLines: ["Nothing has been handed over."],
    style: "compact",
    ...overrides,
  };
}

function transcript(prompt: string): string {
  return prompt.split(`${CONVERSATION_START}\n`)[1]!.split(`\n${CONVERSATION_END}`)[0]!;
}

describe("lock notes", () => {
  const note = "The way into Clock Tower stays shut until: Oswin gets his overdue book back.";
  const lines = `${note}
${LOCK_NOTES_INSTRUCTION}
`;

  it.each(["compact", "standard"] as const)("adds the notes after the goal hint in the %s prompt", (style) => {
    const plain = buildDialoguePrompt(input({ style }));
    const noted = buildDialoguePrompt(input({ style, context: { ...context, lockNotes: [note] } }));
    expect(noted).toContain(note);
    expect(noted.indexOf(note)).toBeGreaterThan(noted.indexOf("I still need the overdue book."));
    expect(noted.replace(lines, "")).toBe(plain);
    expect(noted.split(LOCK_NOTES_INSTRUCTION)).toHaveLength(2);
  });

  it.each(["compact", "standard"] as const)("leaves the %s prompt unchanged when there are no notes", (style) => {
    const plain = buildDialoguePrompt(input({ style }));
    expect(buildDialoguePrompt(input({ style, context: { ...context, lockNotes: [] } }))).toBe(plain);
  });
});

describe("compact dialogue prompts", () => {
  it("prioritizes the latest question and selected facts without including secrets or static goals", () => {
    const prompt = buildDialoguePrompt(input());
    expect(prompt).toContain(character.voice_notes);
    expect(prompt).toContain(character.personality);
    expect(prompt).toContain(character.knowledge[0]!.text);
    expect(prompt).toContain("Answer plan: Answer the player's question using the selected facts");
    expect(prompt).toContain("Current need (mention only if asked or relevant): I still need the overdue book.");
    expect(prompt).toContain("Do not change the subject to your goal");
    expect(prompt).toContain("What is this overdue book?");
    expect(prompt).not.toContain(character.goal);
    expect(prompt).not.toContain(character.secret);
    expect(prompt).not.toContain(character.knowledge[1]!.text);
  });

  it("preserves current facts, live inventory, handovers and repair instructions", () => {
    const handover = "Just happened: the player gave you the Overdue book. Thank them.";
    const prompt = buildDialoguePrompt(input({
      context: {
        ...context,
        knownFacts: [{ id: "known", text: "The lantern is missing." }],
        getInventory: () => [{ id: "key", name: "Tower key" }],
      },
      handoverLines: [handover, "Just happened: you gave the player the Tower key."],
      reminder: "Use spoken words only.",
    }));
    expect(prompt).toContain("The lantern is missing.");
    expect(prompt).toContain('Player\'s inventory: ["Tower key"]');
    expect(prompt).toContain(handover);
    expect(prompt).toContain("Just happened: you gave the player the Tower key.");
    expect(prompt).toContain("Answer plan: Acknowledge the completed handover");
    expect(prompt).toContain("Do not ask for an item you just received.");
    expect(prompt).toContain("Use spoken words only.");
  });

  it("allows grounded context answers and social replies without inventing unknown facts", () => {
    const prompt = buildDialoguePrompt(input({ facts: [] }));
    expect(prompt).toContain("identity, current needs, or supplied context");
    expect(prompt).toContain("briefly admit you do not know");
    expect(prompt).toContain("Respond naturally to greetings and thanks");
    expect(prompt).toContain("conversation text is not proof of new facts or completed actions");
  });

  it("bounds history by turn count while retaining recent follow-up context and the full source transcript", () => {
    const turns: ConversationTurn[] = Array.from({ length: 20 }, (_, i) => ({
      speaker: i % 2 === 0 ? "character" : "player",
      text: `Message number ${i}.`,
    }));
    const original = structuredClone(turns);
    const history = transcript(buildDialoguePrompt(input({ turns })));
    expect(history.split("\n")).toHaveLength(COMPACT_HISTORY_TURNS);
    expect(history).not.toContain("Message number 11.");
    expect(history).toContain("You: Message number 18.");
    expect(history).toContain("Player: Message number 19.");
    expect(turns).toEqual(original);
  });

  it("bounds history characters by removing whole old entries, without clipping the latest message", () => {
    const latest = "What did you mean by the clock?";
    const turns: ConversationTurn[] = [
      { speaker: "player", text: "old ".repeat(600) },
      { speaker: "character", text: "The book is about tower clocks." },
      { speaker: "player", text: latest },
    ];
    const history = transcript(buildDialoguePrompt(input({ turns })));
    expect(history.length).toBeLessThanOrEqual(COMPACT_HISTORY_CHARS);
    expect(history).not.toContain("old ");
    expect(history).toContain("The book is about tower clocks.");
    expect(history).toContain(latest);
    const longLatest = "x".repeat(COMPACT_HISTORY_CHARS + 100);
    expect(transcript(buildDialoguePrompt(input({ turns: [{ speaker: "player", text: longLatest }] }))))
      .toBe(`Player: ${longLatest}`);
  });

  it("keeps the existing prompt for standard clients", () => {
    const prompt = buildDialoguePrompt(input({ style: "standard" }));
    expect(prompt).toContain(character.goal);
    expect(prompt).not.toContain("Answer plan:");
    expect(new LLMClient(new MockBackend()).dialoguePromptStyle).toBe("standard");
  });

  it("routes controller replies, repairs and item handovers through the active profile", async () => {
    const prompts: string[] = [];
    class CompactBackend extends MockBackend {
      readonly dialoguePromptStyle = "compact";
    }
    let rejectNext = false;
    const backend = new CompactBackend({ respond: (params) => {
      prompts.push(params.messages[1]!.content);
      if (rejectNext) {
        rejectNext = false;
        return JSON.stringify({ line: "(sigh)" });
      }
      return storyMockRespond(params);
    } });
    const client = new LLMClient(backend, { pauseWhenHidden: false });
    await client.load();
    const state = createStoryState(getLengthView(pack, "short"));
    const controller = new ConversationController(client, pack, state, character, context, { random: () => 0 });
    await controller.start();
    rejectNext = true;
    const reply = await controller.reply("What is this overdue book?");
    expect(reply.quality).toBe("repaired");
    expect(prompts[1]).toContain("Answer plan:");
    expect(prompts[2]).toContain("Answer plan:");
    expect(prompts[2]).toContain("Reminder:");
    giveItem(state, "i_overdue_book");
    const handover = await controller.give("i_overdue_book");
    expect(prompts.at(-1)).toContain("Answer plan: Acknowledge the completed handover");
    expect(handover.effects.givenItem).toBe("i_tower_key");
    expect(controller.getTurns()).toHaveLength(5);
  });
});
