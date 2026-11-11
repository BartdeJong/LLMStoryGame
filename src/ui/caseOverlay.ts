import { activateGamepadFocus } from "../input/focus";
import type { SummationQuestion } from "../story/deduction";

export interface CaseOverlay {
  readonly elements: readonly HTMLElement[];
  readonly isOpen: boolean;
  showReveal(description: string, onClose: () => void): void;
  offerCase(onPresent: () => void): void;
  presentCase(
    questions: readonly SummationQuestion[],
    options: readonly { id: string; text: string }[],
    onSolved: () => void,
  ): void;
  setCaseButtonVisible(visible: boolean): void;
  close(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

export function createCaseOverlay(container: HTMLElement, onCaseButton: () => void): CaseOverlay {
  const caseButton = el("button", "present-case-button", "Present your case");
  caseButton.type = "button";
  caseButton.hidden = true;
  caseButton.addEventListener("click", onCaseButton);
  container.append(caseButton);

  let overlay: HTMLElement | null = null;
  let release: (() => void) | null = null;
  const close = (): void => {
    release?.();
    release = null;
    overlay?.remove();
    overlay = null;
  };
  const open = (card: HTMLElement): void => {
    close();
    const next = el("div", "case-overlay");
    next.append(card);
    container.append(next);
    overlay = next;
    release = activateGamepadFocus(card, { isActive: () => overlay === next });
    card.querySelector<HTMLElement>("button")?.focus();
  };
  const button = (label: string, onClick: () => void): HTMLButtonElement => {
    const node = el("button", "dialogue-choice", label);
    node.type = "button";
    node.addEventListener("click", onClick);
    return node;
  };
  const card = (label: string): HTMLElement => {
    const node = el("section", "case-card");
    node.setAttribute("role", "dialog");
    node.setAttribute("aria-label", label);
    return node;
  };

  return {
    elements: [caseButton],
    get isOpen() {
      return overlay !== null;
    },
    showReveal(description, onClose) {
      const content = card("A twist in the case");
      const actions = el("div", "case-actions");
      actions.append(button("Continue", () => {
        close();
        onClose();
      }));
      content.append(el("h2", "case-title", "A twist!"), el("p", "case-text", description), actions);
      open(content);
    },
    offerCase(onPresent) {
      const content = card("Present your case");
      const actions = el("div", "case-actions");
      actions.append(
        button("Present your case", () => {
          close();
          onPresent();
        }),
        button("Not yet", close),
      );
      content.append(
        el("h2", "case-title", "Everyone is listening"),
        el("p", "case-text", "You have gathered enough to explain what happened. Ready to present your case?"),
        actions,
      );
      open(content);
    },
    presentCase(questions, options, onSolved) {
      let index = 0;
      const showQuestion = (message = ""): void => {
        const question = questions[index];
        if (!question) {
          close();
          onSolved();
          return;
        }
        const content = card("Present your case");
        content.append(
          el("p", "case-step", `Question ${index + 1} of ${questions.length}`),
          el("h2", "case-title", question.question),
        );
        const actions = el("div", "case-actions");
        for (const option of options) {
          actions.append(button(option.text, () => {
            if (option.id === question.truthId) {
              index += 1;
              showQuestion();
            } else {
              showQuestion("Not quite. Look through your casebook and try again.");
            }
          }));
        }
        content.append(actions);
        if (message) {
          const note = el("p", "case-text journal-feedback", message);
          note.setAttribute("role", "status");
          content.append(note);
        }
        content.append(button("Not yet", close));
        open(content);
      };
      showQuestion();
    },
    setCaseButtonVisible(visible) {
      caseButton.hidden = !visible;
    },
    close,
  };
}
