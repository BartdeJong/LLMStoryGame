import { getLengthView, loadStoryIndex, loadStoryPack, StoryLoadError, type LengthView } from "../story/loader";
import type { LengthId, StoryIndexEntry, StoryPack } from "../story/types";

const LENGTH_LABELS: Record<LengthId, string> = { short: "Short", medium: "Medium", long: "Long" };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

// Lists the stories from index.json. Choosing a length loads and validates the pack,
// then hands the pack and length view to onChosen, which starts the game.
export async function mountStorySelectScreen(root: HTMLElement, onChosen: (view: LengthView, pack: StoryPack) => void): Promise<void> {
  root.replaceChildren();
  const box = el("section", "llm-screen");
  box.append(el("h1", "llm-screen-title", "Choose a story"));
  const status = el("p", "llm-screen-note", "Loading stories...");
  status.setAttribute("aria-live", "polite");
  const list = el("div", "story-list");
  box.append(list, status);
  root.append(box);

  const showError = (error: unknown): void => {
    const lines = error instanceof StoryLoadError ? error.message.split("\n") : [String(error)];
    status.replaceChildren(...lines.map((line) => el("div", "", line)));
  };

  const choose = async (entry: StoryIndexEntry, length: LengthId, buttons: HTMLButtonElement[]): Promise<void> => {
    buttons.forEach((b) => { b.disabled = true; });
    status.textContent = `Loading "${entry.title}"...`;
    try {
      const pack = await loadStoryPack(entry.id);
      const view = getLengthView(pack, length);
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
      for (const length of entry.lengths) {
        const minutes = entry.estimated_minutes[length];
        const button = el("button", "llm-button", `${LENGTH_LABELS[length]}${minutes ? ` (~${minutes} min)` : ""}`);
        button.type = "button";
        button.addEventListener("click", () => void choose(entry, length, buttons));
        buttons.push(button);
        row.append(button);
      }
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
