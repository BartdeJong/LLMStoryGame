import { activateGamepadFocus } from "../input/focus";
import type { StorySession } from "../story/storySession";

export function mountStoryOpeningScreen(root: HTMLElement, story: StorySession, onBegin: () => void): void {
  const opening = story.view.definition.opening;
  if (!opening) throw new Error(`Story "${story.pack.identity.id}" has no authored opening.`);

  const screen = document.createElement("section");
  screen.className = "llm-screen story-opening";
  screen.setAttribute("aria-labelledby", "story-opening-title");

  const eyebrow = document.createElement("p");
  eyebrow.className = "llm-screen-note";
  eyebrow.textContent = story.pack.identity.title;
  const title = document.createElement("h1");
  title.className = "llm-screen-title";
  title.id = "story-opening-title";
  title.textContent = "A new story begins";
  const context = document.createElement("p");
  context.className = "story-opening-context";
  context.textContent = opening.context;

  const leadLabel = document.createElement("h2");
  leadLabel.className = "story-opening-lead-label";
  leadLabel.textContent = "Your first lead";
  const lead = document.createElement("p");
  lead.className = "story-opening-lead";
  lead.textContent = story.currentBeat.objective ?? story.currentBeat.title;
  const guidance = document.createElement("p");
  guidance.className = "story-opening-guidance";
  guidance.textContent = story.currentBeat.guidance ?? "";

  const begin = document.createElement("button");
  begin.className = "llm-button";
  begin.type = "button";
  begin.textContent = "Start exploring";
  const deactivateFocus = activateGamepadFocus(screen);
  begin.addEventListener("click", () => {
    deactivateFocus();
    onBegin();
  }, { once: true });

  screen.append(eyebrow, title, context, leadLabel, lead, guidance, begin);
  root.replaceChildren(screen);
  begin.focus();
}
