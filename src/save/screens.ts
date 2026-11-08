import type { GameSave } from "./types";
import { normalizeSave, SaveRepository } from "./repository";
import { activateGamepadFocus } from "../input/focus";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function formatPlayTime(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

function createSlotId(): string {
  return `slot-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function backButton(onBack: () => void): HTMLButtonElement {
  const button = el("button", "llm-button", "Back");
  button.type = "button";
  button.dataset.padHint = "B";
  button.addEventListener("click", onBack);
  return button;
}

export async function mountSaveSlotPicker(
  root: HTMLElement,
  repository: SaveRepository,
  onChoose: (slotId: string) => void,
  onBack: () => void,
): Promise<void> {
  root.replaceChildren();
  const screen = el("section", "llm-screen save-screen");
  screen.append(el("h1", "llm-screen-title", "Choose a save slot"));
  const status = el("p", "llm-screen-note", "");
  const slots = el("div", "story-list");
  screen.append(slots, status, backButton(onBack));
  root.append(screen);
  activateGamepadFocus(screen, { onBack });

  try {
    const saves = await repository.list();
    const fresh = el("button", "llm-button", "Start in a new slot");
    fresh.type = "button";
    fresh.addEventListener("click", () => onChoose(createSlotId()));
    slots.append(fresh);
    for (const save of saves) {
      const button = el(
        "button",
        "llm-button",
        `Overwrite ${save.metadata.storyTitle} (${save.metadata.length}) · last saved ${new Date(save.metadata.lastSaved).toLocaleString()}`,
      );
      button.type = "button";
      button.addEventListener("click", () => {
        if (window.confirm("Starting a new game will replace this save slot. Continue?")) onChoose(save.slotId);
      });
      slots.append(button);
    }
  } catch (error) {
    status.textContent = `Could not read save slots: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function mountLoadGameScreen(
  root: HTMLElement,
  repository: SaveRepository,
  onLoad: (save: GameSave) => Promise<void>,
  onBack: () => void,
): Promise<void> {
  root.replaceChildren();
  const screen = el("section", "llm-screen save-screen");
  screen.append(el("h1", "llm-screen-title", "Load a game"));
  const status = el("p", "llm-screen-note", "");
  const slots = el("div", "story-list");
  const file = document.createElement("input");
  file.type = "file";
  file.accept = "application/json,.json";
  file.hidden = true;
  const importButton = el("button", "llm-button", "Import save file");
  importButton.type = "button";
  importButton.addEventListener("click", () => file.click());
  file.addEventListener("change", () => {
    const selected = file.files?.[0];
    if (!selected) return;
    void (async () => {
      try {
        const raw = JSON.parse(await selected.text()) as unknown;
        const imported = normalizeSave(raw);
        const existing = await repository.get(imported.slotId);
        if (existing && !window.confirm("Importing this save will replace the existing slot. Continue?")) return;
        await repository.save(imported);
        status.textContent = `Imported ${imported.metadata.storyTitle} into a save slot.`;
        await refreshSlots();
      } catch (error) {
        status.textContent = `Could not import save: ${error instanceof Error ? error.message : String(error)}`;
      } finally {
        file.value = "";
      }
    })();
  });
  screen.append(slots, importButton, file, status, backButton(onBack));
  root.append(screen);
  activateGamepadFocus(screen, { onBack });

  const refreshSlots = async (): Promise<void> => {
    slots.replaceChildren();
    const saves = await repository.list();
    if (saves.length === 0) slots.append(el("p", "llm-screen-note", "No saved games yet."));
    for (const save of saves) {
      const card = el("article", "story-card");
      card.append(
        el("h2", "story-card-title", save.metadata.storyTitle),
        el("p", "", `${save.metadata.length} · ${formatPlayTime(save.metadata.timePlayedMs)} · saved ${new Date(save.metadata.lastSaved).toLocaleString()}`),
      );
      const load = el("button", "llm-button", "Load");
      load.type = "button";
      load.addEventListener("click", () => {
        load.disabled = true;
        status.textContent = "Loading saved game...";
        void onLoad(save).catch((error: unknown) => {
          status.textContent = error instanceof Error ? error.message : String(error);
          load.disabled = false;
        });
      });
      const exportButton = el("button", "llm-button", "Export JSON");
      exportButton.type = "button";
      exportButton.addEventListener("click", () => {
        void repository.exportJson(save.slotId).then((json) => {
          const blob = new Blob([json], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = `cozy-mystery-${save.slotId}.json`;
          anchor.click();
          URL.revokeObjectURL(url);
        }).catch((error: unknown) => {
          status.textContent = `Could not export save: ${error instanceof Error ? error.message : String(error)}`;
        });
      });
      card.append(load, exportButton);
      slots.append(card);
    }
  };

  try {
    await refreshSlots();
  } catch (error) {
    status.textContent = `Could not read save slots: ${error instanceof Error ? error.message : String(error)}`;
  }
}
