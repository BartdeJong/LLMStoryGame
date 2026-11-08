import { createPreferenceControls } from "./preferences";
import { activateGamepadFocus } from "../input/focus";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

export function mountTitleScreen(
  root: HTMLElement,
  onNewGame: () => void,
  onLoadGame: () => void,
  storageNote = "",
): void {
  document.documentElement.classList.add("llm-debug-mode");
  document.body.classList.add("llm-debug-mode");
  root.replaceChildren();
  const screen = el("section", "llm-screen title-screen");
  screen.append(
    el("p", "ending-kicker", "A cozy mystery"),
    el("h1", "llm-screen-title", "A Cozy Mystery"),
    el("p", "llm-screen-note", "Take a quiet walk, meet the neighbors, and see where the story leads."),
  );
  if (storageNote) screen.append(el("p", "llm-screen-note", storageNote));
  const start = el("button", "llm-button", "New game");
  start.type = "button";
  start.addEventListener("click", onNewGame);
  const load = el("button", "llm-button", "Load game");
  load.type = "button";
  load.addEventListener("click", onLoadGame);
  screen.append(start, load, createPreferenceControls());
  root.append(screen);
  activateGamepadFocus(screen);
}
