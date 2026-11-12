import { getLengthView, loadStoryIndex, loadStoryPack, StoryLoadError, type LengthView } from "../story/loader";
import type { StoryIndexEntry, StoryPack } from "../story/types";
import { activateGamepadFocus } from "../input/focus";
import { el } from "./dom";

// Lists the stories from index.json. Choosing a story loads and validates the pack,
// then hands the pack and its view to onChosen, which starts the game. Every story has one length.
export async function mountStorySelectScreen(
  root: HTMLElement,
  onChosen: (view: LengthView, pack: StoryPack) => void,
  onBack?: () => void,
): Promise<void> {
  root.replaceChildren();
  const box = el("section", "llm-screen");
  box.append(el("h1", "llm-screen-title", "Choose a story"));
  const status = el("p", "llm-screen-note", "Loading stories...");
  status.setAttribute("aria-live", "polite");
  const list = el("div", "story-list");
  box.append(list, status);
  root.append(box);
  activateGamepadFocus(box, { onBack });

  const showError = (error: unknown): void => {
    const lines = error instanceof StoryLoadError ? error.message.split("\n") : [String(error)];
    status.replaceChildren(...lines.map((line) => el("div", "", line)));
  };

  const choose = async (entry: StoryIndexEntry, buttons: HTMLButtonElement[]): Promise<void> => {
    buttons.forEach((b) => { b.disabled = true; });
    status.textContent = `Loading "${entry.title}"...`;
    try {
      const pack = await loadStoryPack(entry.id);
      const view = getLengthView(pack);
      status.textContent = "";
      onChosen(view, pack);
    } catch (error) {
      showError(error);
    } finally {
      buttons.forEach((b) => { b.disabled = false; });
    }
  };

  try {
    const index = await loadStoryIndex();
    status.textContent = index.stories.length === 0 ? "No stories are available yet." : "";
    for (const entry of index.stories) {
      const card = el("article", "story-card");
      card.append(el("h2", "story-card-title", entry.title), el("p", "", entry.logline));
      const row = el("div", "story-lengths");
      const buttons: HTMLButtonElement[] = [];
      const minutes = entry.estimated_minutes;
      const button = el("button", "llm-button", `Play${minutes ? ` (~${minutes} min)` : ""}`);
      button.type = "button";
      button.setAttribute("aria-label", `Play ${entry.title}${minutes ? `, about ${minutes} minutes` : ""}`);
      button.addEventListener("click", () => void choose(entry, buttons));
      buttons.push(button);
      row.append(button);
      card.append(row);
      list.append(card);
    }
  } catch (error) {
    showError(error);
  }
}

export function describeLengthView(view: LengthView): string {
  return `${view.storyId} (${view.length}): ${view.locations.length} locations, ${view.cast.length} characters, ${view.coreTruths.length} core truths, ${view.beats.length} beats, ${view.endings.length} ending(s).`;
}
