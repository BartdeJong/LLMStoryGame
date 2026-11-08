import { soundEffects } from "../audio/soundEffects";
import { normalizeSave, type SaveRepository } from "../save/repository";
import type { GameSave } from "../save/types";
import { createPreferenceControls } from "./preferences";
import { activateGamepadFocus } from "../input/focus";

function button(text: string, onClick: () => void): HTMLButtonElement {
  const node = document.createElement("button");
  node.className = "llm-button pause-action";
  node.type = "button";
  node.textContent = text;
  node.addEventListener("click", onClick);
  return node;
}

function download(json: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface PauseMenuActions {
  onResume(): void;
  onSave(): Promise<void>;
  onChangeAISettings?(): Promise<void>;
  onTitle(): void;
  onImport(save: GameSave): void;
}

export function mountPauseMenu(
  root: HTMLElement,
  repository: SaveRepository,
  slotId: string,
  actions: PauseMenuActions,
): HTMLElement {
  const overlay = document.createElement("section");
  overlay.className = "pause-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "pause-title");
  const panel = document.createElement("div");
  panel.className = "pause-panel";
  const title = document.createElement("h1");
  title.id = "pause-title";
  title.className = "llm-screen-title";
  title.textContent = "Paused";
  const status = document.createElement("p");
  status.className = "llm-screen-note pause-status";
  status.setAttribute("aria-live", "polite");
  const resume = button("Resume", actions.onResume);
  resume.dataset.padHint = "B";
  const save = button("Save now", () => {
    save.disabled = true;
    status.textContent = "Saving...";
    void actions.onSave().then(() => {
      status.textContent = "Game saved.";
    }).catch((error: unknown) => {
      status.textContent = `Could not save your game: ${error instanceof Error ? error.message : String(error)}`;
    }).finally(() => { save.disabled = false; });
  });
  const onChangeAISettings = actions.onChangeAISettings;
  const changeAISettings = onChangeAISettings
    ? button("Change AI provider or model", () => {
      const currentButton = changeAISettings;
      if (!currentButton) return;
      currentButton.disabled = true;
      status.textContent = "Saving and opening AI settings...";
      void onChangeAISettings().catch((error: unknown) => {
        status.textContent = `Could not change AI settings: ${error instanceof Error ? error.message : String(error)}`;
        currentButton.disabled = false;
      });
    })
    : null;
  const exportSave = button("Export current save", () => {
    exportSave.disabled = true;
    void actions.onSave().then(() => repository.exportJson(slotId)).then((json) => {
      download(json, `cozy-mystery-${slotId}.json`);
      status.textContent = "Save exported.";
    }).catch((error: unknown) => {
      status.textContent = `Could not export your save: ${error instanceof Error ? error.message : String(error)}`;
    }).finally(() => { exportSave.disabled = false; });
  });
  const file = document.createElement("input");
  file.type = "file";
  file.accept = "application/json,.json";
  file.hidden = true;
  const importSave = button("Import and load save", () => file.click());
  file.addEventListener("change", () => {
    const selected = file.files?.[0];
    if (!selected) return;
    importSave.disabled = true;
    void (async () => {
      const imported = normalizeSave(JSON.parse(await selected.text()) as unknown);
      if (await repository.get(imported.slotId)
        && !window.confirm("Importing this save will replace the existing slot. Continue?")) return;
      await repository.save(imported);
      status.textContent = `Imported ${imported.metadata.storyTitle}. Loading save...`;
      actions.onImport(imported);
    })().catch((error: unknown) => {
      status.textContent = `Could not import save: ${error instanceof Error ? error.message : String(error)}`;
      importSave.disabled = false;
    }).finally(() => { file.value = ""; });
  });
  const titleButton = button("Save and return to title", () => {
    titleButton.disabled = true;
    void actions.onSave().then(actions.onTitle).catch((error: unknown) => {
      status.textContent = `Could not save your game: ${error instanceof Error ? error.message : String(error)}`;
      titleButton.disabled = false;
    });
  });
  const preferences = createPreferenceControls();
  const mute = preferences.querySelector<HTMLButtonElement>(".preference-mute");
  if (mute) {
    mute.addEventListener("click", () => {
      if (!soundEffects.muted) soundEffects.play("dialogue");
    });
  }
  panel.append(title, resume, save);
  if (changeAISettings) panel.append(changeAISettings);
  panel.append(exportSave, importSave, file, titleButton, preferences, status);
  overlay.append(panel);
  root.append(overlay);
  activateGamepadFocus(overlay, { onBack: actions.onResume });
  resume.focus();
  return overlay;
}
