import type { LengthView } from "./loader";
import { derivedUnlockLine } from "./locks";
import type { StoryPack } from "./types";

// The card shown when a new chapter (beat) of the story opens. Pure: authored texts win, the rest is derived.
export interface ChapterCard {
  number: number; // 1-based
  total: number;
  title: string;
  text: string; // what opened the way
  teaser: string; // what the chapter is about; empty when the beat has no objective
}

export function chapterCard(pack: StoryPack, view: LengthView, index: number): ChapterCard {
  const beat = view.beats[index];
  if (!beat) throw new Error(`The story has no chapter ${index + 1}.`);
  const names = beat.locations.map((id) => pack.locations.find((location) => location.id === id)?.name ?? id);
  return {
    number: index + 1,
    total: view.beats.length,
    title: beat.title,
    text: beat.unlock_text ?? derivedUnlockLine(pack, view.beats[index - 1]?.must_find, names.join(", ")),
    teaser: beat.objective ?? "",
  };
}
