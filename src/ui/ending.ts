import type { EndingChoice, EndingScene } from "../story/ending";
import { activateGamepadFocus } from "../input/focus";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

export function mountEndingChoiceScreen(
  root: HTMLElement,
  storyTitle: string,
  choices: EndingChoice[],
  onChoose: (choiceIds: string[]) => Promise<void>,
  onBack?: () => void,
): void {
  enableScreenScrolling();
  root.replaceChildren();
  const screen = el("section", "llm-screen ending-screen");
  screen.append(el("p", "ending-kicker", storyTitle), el("h1", "llm-screen-title", "A lantern-lit moment"));
  screen.append(el("p", "llm-screen-note", "The path ahead is ready. What feels right to you?"));
  const actions = el("div", "ending-actions");
  const status = el("p", "llm-screen-note", "");
  for (const choice of choices) {
    const button = el("button", "llm-button", choice.label);
    button.type = "button";
    button.addEventListener("click", () => {
      actions.querySelectorAll("button").forEach((candidate) => { candidate.disabled = true; });
      status.textContent = "The final scene is taking shape...";
      void onChoose(choice.choices).catch((error: unknown) => {
        status.textContent = `The ending could not be completed: ${error instanceof Error ? error.message : String(error)}`;
        actions.querySelectorAll("button").forEach((candidate) => { candidate.disabled = false; });
      });
    });
    actions.append(button);
  }
  screen.append(actions, status);
  root.append(screen);
  activateGamepadFocus(screen, { onBack });
}

export function mountEndingScreen(
  root: HTMLElement,
  storyTitle: string,
  ending: EndingScene,
  onNewStory: () => void,
  onBackToTitle: () => void,
): void {
  enableScreenScrolling();
  root.replaceChildren();
  const screen = el("section", "llm-screen ending-screen");
  screen.append(
    el("p", "ending-kicker", storyTitle),
    el("h1", "llm-screen-title", ending.endingTitle),
    el("p", "ending-scene", ending.scene),
    el("h2", "ending-subtitle", "Epilogue"),
    el("p", "ending-epilogue", ending.epilogue),
  );
  const actions = el("div", "ending-actions");
  const newStory = el("button", "llm-button", "New story");
  newStory.type = "button";
  newStory.addEventListener("click", onNewStory);
  const title = el("button", "llm-button ending-secondary", "Back to title");
  title.type = "button";
  title.addEventListener("click", onBackToTitle);
  actions.append(newStory, title);
  screen.append(actions);
  root.append(screen);
  title.dataset.padHint = "B";
  activateGamepadFocus(screen, { onBack: onBackToTitle });
}

function enableScreenScrolling(): void {
  document.documentElement.classList.add("llm-debug-mode");
  document.body.classList.add("llm-debug-mode");
}
