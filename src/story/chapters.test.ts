import { describe, expect, it } from "vitest";
import fixture from "../../public/stories/example.json";
import { chapterCard } from "./chapters";
import { stripLockText } from "./fixtures/stripLockText";
import { getLengthView } from "./loader";
import { derivedUnlockLine } from "./locks";
import type { StoryPack } from "./types";

const pack = (): StoryPack => structuredClone(fixture) as unknown as StoryPack;

describe("chapter cards", () => {
  it("uses the authored unlock text and numbers the chapter", () => {
    const p = pack();
    const view = getLengthView(p);
    view.beats[1]!.unlock_text = "The tower door swings open.";
    const card = chapterCard(p, view, 1);
    expect(card.text).toBe("The tower door swings open.");
    expect(card.number).toBe(2);
    expect(card.total).toBe(view.beats.length);
    expect(card.title).toBe(view.beats[1]!.title);
  });

  it("falls back to the derived unlock line without authored text", () => {
    const p = stripLockText(pack());
    const view = getLengthView(p);
    const names = view.beats[1]!.locations.map((id) => p.locations.find((location) => location.id === id)!.name).join(", ");
    expect(chapterCard(p, view, 1).text).toBe(derivedUnlockLine(p, view.beats[0]!.must_find, names));
  });

  it("teases with the objective", () => {
    const p = pack();
    const view = getLengthView(p);
    expect(chapterCard(p, view, 1).teaser).toBe(view.beats[1]!.objective);
    delete view.beats[1]!.objective;
    expect(chapterCard(p, view, 1).teaser).toBe("");
  });
});
