import type { ProofChoice } from "../story/proof";
import type { EvidenceRef } from "../story/statements";
import { el } from "./dom";

export interface EvidencePickerOptions {
  choices: readonly ProofChoice[];
  max: number;
  initial?: readonly EvidenceRef[];
  onChange?: (selected: EvidenceRef[]) => void;
}

export interface EvidencePicker {
  readonly element: HTMLElement;
  selected(): EvidenceRef[];
}

const keyOf = (ref: EvidenceRef): string => `${ref.type}:${ref.id}`;

// The items and clues a player can show with an answer. Choosing is a toggle; a full picker explains itself
// instead of disabling buttons, so keyboard and gamepad focus can still reach every entry.
export function createEvidencePicker(options: EvidencePickerOptions): EvidencePicker {
  const { choices, max } = options;
  const chosen = new Set<string>((options.initial ?? []).map(keyOf).filter((key) => choices.some((choice) => keyOf(choice.ref) === key)));
  const element = el("div", "evidence-picker");
  const count = el("p", "evidence-count");
  const note = el("p", "evidence-note");
  note.setAttribute("role", "status");
  const buttons = new Map<string, HTMLButtonElement>();

  const selected = (): EvidenceRef[] => choices.filter((choice) => chosen.has(keyOf(choice.ref))).map((choice) => choice.ref);
  const update = (): void => {
    count.textContent = `Chosen ${chosen.size} of ${max}`;
    for (const [key, button] of buttons) button.setAttribute("aria-pressed", String(chosen.has(key)));
  };

  if (choices.length === 0) {
    element.append(el("p", "dialogue-ask-empty", "You have no items or clues to show. You can still give your answer."));
    return { element, selected };
  }

  element.append(count, note);
  for (const [group, heading] of [["item", "Items"], ["clue", "Evidence"]] as const) {
    const entries = choices.filter((choice) => choice.group === group);
    if (entries.length === 0) continue;
    const list = el("div", "dialogue-ask-list");
    for (const choice of entries) {
      const key = keyOf(choice.ref);
      const button = el("button", "dialogue-choice evidence-option", `${group === "item" ? "◆" : "?"} ${choice.label}`);
      button.type = "button";
      button.dataset.padHint = "A";
      button.dataset.evidenceKey = key;
      button.addEventListener("click", () => {
        if (chosen.has(key)) {
          chosen.delete(key);
          note.textContent = "";
        } else if (chosen.size >= max) {
          note.textContent = `You can show up to ${max}. Remove one first.`;
          return;
        } else {
          chosen.add(key);
          note.textContent = "";
        }
        update();
        options.onChange?.(selected());
      });
      buttons.set(key, button);
      list.append(button);
    }
    element.append(el("p", "evidence-heading", heading), list);
  }
  update();
  return { element, selected };
}
