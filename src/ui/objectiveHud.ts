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
  const guidanceToggle = document.createElement("button");
  guidanceToggle.className = "objective-hud-toggle";
  guidanceToggle.type = "button";
  guidanceToggle.textContent = "Show hint";
  guidanceToggle.setAttribute("aria-expanded", "false");
  const guidance = document.createElement("p");
  guidance.className = "objective-hud-guidance";
  guidance.hidden = true;
  guidanceToggle.addEventListener("click", () => {
    guidance.hidden = !guidance.hidden;
    guidanceToggle.textContent = guidance.hidden ? "Show hint" : "Hide hint";
    guidanceToggle.setAttribute("aria-expanded", String(!guidance.hidden));
  });
  element.append(heading, title, objective, guidanceToggle, guidance);
  parent.append(element);

  return {
    element,
    update(beat) {
      title.textContent = beat.title;
      objective.textContent = beat.objective ?? beat.title;
      guidance.textContent = beat.guidance ?? "";
      guidanceToggle.hidden = !beat.guidance;
      if (!beat.guidance) {
        guidance.hidden = true;
        guidanceToggle.textContent = "Show hint";
        guidanceToggle.setAttribute("aria-expanded", "false");
      }
    },
  };
}
