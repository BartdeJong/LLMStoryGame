import type { Beat } from "../story/types";

export interface ObjectiveHud {
  readonly element: HTMLElement;
  update(beat: Beat): void;
}

export function createObjectiveHud(parent: HTMLElement): ObjectiveHud {
  const element = document.createElement("section");
  element.className = "objective-hud";
  element.setAttribute("aria-label", "Current story objective");
  element.setAttribute("aria-live", "polite");
  element.setAttribute("aria-atomic", "true");

  const heading = document.createElement("p");
  heading.className = "objective-hud-heading";
  heading.textContent = "CURRENT LEAD";
  const title = document.createElement("p");
  title.className = "objective-hud-title";
  const objective = document.createElement("p");
  objective.className = "objective-hud-text";
  const guidance = document.createElement("p");
  guidance.className = "objective-hud-guidance";
  element.append(heading, title, objective, guidance);
  parent.append(element);

  return {
    element,
    update(beat) {
      title.textContent = beat.title;
      objective.textContent = beat.objective ?? beat.title;
      guidance.textContent = beat.guidance ?? "";
      guidance.hidden = !beat.guidance;
    },
  };
}
