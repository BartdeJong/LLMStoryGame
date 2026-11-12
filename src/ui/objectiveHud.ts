import type { Beat } from "../story/types";

export interface HudProgress {
  truthsFound: number;
  truthsTotal: number;
  leadNumber: number;
  leadTotal: number;
}

export interface ObjectiveHud {
  readonly element: HTMLElement;
  update(beat: Beat, openQuestion?: boolean, progress?: HudProgress): void;
  // Shows the area description as a short arrival card that goes away after a while or when the player moves.
  showArrival(description: string): void;
  dismissArrival(): void;
  destroy(): void;
}

const MAX_PIPS = 14;
const MIN_CAPTION_MS = 4500;
const MAX_CAPTION_MS = 9000;

export function progressLabel(progress: HudProgress): string {
  const truths = `Case: ${progress.truthsFound} of ${progress.truthsTotal} ${progress.truthsTotal === 1 ? "truth" : "truths"}`;
  return progress.leadTotal > 1 ? `${truths} · Lead ${progress.leadNumber} of ${progress.leadTotal}` : truths;
}

// Fills a container with one pip per core truth, the confirmed ones lit. Too many truths get no pips, only the text.
export function fillPips(container: HTMLElement, found: number, total: number): void {
  container.replaceChildren();
  if (total <= 0 || total > MAX_PIPS) return;
  for (let index = 0; index < total; index += 1) {
    const pip = document.createElement("span");
    pip.className = index < found ? "hud-pip is-on" : "hud-pip";
    container.append(pip);
  }
}

function required<T extends HTMLElement>(parent: ParentNode, selector: string): T {
  const node = parent.querySelector<T>(selector);
  if (!node) throw new Error(`The game page is missing ${selector}.`);
  return node;
}

export function createObjectiveHud(hud: HTMLElement, message: HTMLElement): ObjectiveHud {
  const leadButton = required<HTMLButtonElement>(hud, ".hud-lead");
  const leadTitle = required<HTMLElement>(hud, ".hud-lead-title");
  const pips = required<HTMLElement>(hud, ".hud-pips");
  const count = required<HTMLElement>(hud, ".hud-count");
  const details = required<HTMLElement>(hud, ".hud-details");
  const progressLine = required<HTMLElement>(hud, ".hud-progress");
  const body = required<HTMLElement>(hud, ".hud-lead-body");

  const heading = document.createElement("p");
  heading.className = "objective-hud-heading";
  heading.textContent = "CURRENT LEAD";
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
  const announcer = document.createElement("p");
  announcer.className = "sr-only";
  announcer.setAttribute("role", "status");
  announcer.setAttribute("aria-live", "polite");
  body.replaceChildren(heading, objective, guidanceToggle, guidance);
  hud.append(announcer);

  let hideCaption = (): void => undefined;
  const setExpanded = (expanded: boolean): void => {
    if (expanded) hideCaption();
    details.hidden = !expanded;
    leadButton.setAttribute("aria-expanded", String(expanded));
    hud.classList.toggle("is-expanded", expanded);
  };
  setExpanded(false);
  leadButton.onclick = () => setExpanded(details.hidden);
  guidanceToggle.onclick = () => {
    guidance.hidden = !guidance.hidden;
    guidanceToggle.textContent = guidance.hidden ? "Show hint" : "Hide hint";
    guidanceToggle.setAttribute("aria-expanded", String(!guidance.hidden));
  };

  // The message element becomes a caption: it appears when its text changes and fades after a few seconds.
  let captionTimer = 0;
  let nextIsArrival = false;
  let leaveTimer = 0;
  hideCaption = (): void => {
    window.clearTimeout(captionTimer);
    if (!message.classList.contains("is-visible")) return;
    message.classList.remove("is-visible");
    message.classList.add("is-leaving");
    leaveTimer = window.setTimeout(() => message.classList.remove("is-leaving"), 400);
  };
  const observer = new MutationObserver(() => {
    const text = message.textContent ?? "";
    message.dataset.kind = nextIsArrival ? "arrival" : "note";
    nextIsArrival = false;
    window.clearTimeout(captionTimer);
    window.clearTimeout(leaveTimer);
    message.classList.remove("is-leaving");
    if (!text.trim()) {
      message.classList.remove("is-visible");
      return;
    }
    message.classList.add("is-visible");
    captionTimer = window.setTimeout(hideCaption, Math.min(MAX_CAPTION_MS, Math.max(MIN_CAPTION_MS, text.length * 55)));
  });
  observer.observe(message, { childList: true, characterData: true, subtree: true });
  message.onclick = hideCaption;

  let lastTitle: string | null = null;
  return {
    element: hud,
    update(beat, openQuestion = false, progress) {
      leadTitle.textContent = beat.title;
      objective.textContent = openQuestion
        ? "Your casebook has an open question. Open the journal to answer it."
        : beat.objective ?? beat.title;
      guidance.textContent = beat.guidance ?? "";
      guidanceToggle.hidden = !beat.guidance;
      if (!beat.guidance) {
        guidance.hidden = true;
        guidanceToggle.textContent = "Show hint";
        guidanceToggle.setAttribute("aria-expanded", "false");
      }
      fillPips(pips, progress?.truthsFound ?? 0, progress?.truthsTotal ?? 0);
      count.textContent = progress && progress.truthsTotal > 0 ? `${progress.truthsFound}/${progress.truthsTotal}` : "";
      if (progress && progress.truthsTotal > 0) {
        progressLine.textContent = progressLabel(progress);
        progressLine.hidden = false;
        leadButton.setAttribute("aria-label", `${beat.title}. ${progressLabel(progress)}. Show current lead`);
      } else {
        progressLine.hidden = true;
        leadButton.setAttribute("aria-label", `${beat.title}. Show current lead`);
      }
      if (lastTitle !== null && lastTitle !== beat.title) announcer.textContent = `New lead: ${beat.title}. ${objective.textContent}`;
      lastTitle = beat.title;
    },
    showArrival(description) {
      nextIsArrival = true;
      message.textContent = description;
      // An unchanged observer callback would leave the flag set, so clear it when nothing was recorded.
      window.setTimeout(() => { nextIsArrival = false; }, 0);
    },
    dismissArrival() {
      if (message.dataset.kind === "arrival") hideCaption();
    },
    destroy() {
      observer.disconnect();
      window.clearTimeout(captionTimer);
      window.clearTimeout(leaveTimer);
      leadButton.onclick = null;
      message.onclick = null;
      announcer.remove();
    },
  };
}
