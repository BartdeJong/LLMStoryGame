import { activateGamepadFocus } from "../input/focus";
import type { SummationQuestion } from "../story/deduction";
import type { ChapterCard } from "../story/chapters";
import type { ProofChoice } from "../story/proof";
import type { AnswerOutcome } from "../story/state";
import type { EvidenceRef } from "../story/statements";
import { el } from "./dom";
import { createEvidencePicker } from "./evidencePicker";

export interface FinalCaseResult {
  question: string;
  answer: string;
  correctAnswer: string;
  correct: boolean; // the conclusion was right
  outcome: AnswerOutcome;
  shown: string[]; // labels of the evidence the player showed
  hadProof: boolean; // the question had an authored proof; without one a right answer is just right
}

// What the player can show with an answer, and how many pieces.
export interface CaseProofOptions {
  choices: readonly ProofChoice[];
  choicesFor?: (question: SummationQuestion) => readonly ProofChoice[]; // a shorter list for one question
  slots: number;
}

// The conclusions offered for one question.
export type CaseOptions = (question: SummationQuestion) => readonly { id: string; text: string }[];

export interface FinalCaseHandlers {
  startAt: number; // first unanswered question (answers survive a reload)
  onAnswer(question: SummationQuestion, answerTruthId: string, evidence: EvidenceRef[]): void; // records and saves the answer
  results(): FinalCaseResult[];
  onDone(): void;
}

export interface CaseOverlay {
  readonly elements: readonly HTMLElement[];
  readonly isOpen: boolean;
  showReveal(description: string, onClose: () => void): void;
  showChapter(card: ChapterCard, onClose: () => void): void;
  offerCase(onPresent: () => void): void;
  presentCase(
    questions: readonly SummationQuestion[],
    options: CaseOptions,
    proof: CaseProofOptions,
    judge: (question: SummationQuestion, answerTruthId: string, evidence: EvidenceRef[]) => AnswerOutcome,
    onSolved: () => void,
  ): void;
  // The finale with stakes: each question is answered once, with no feedback until all are answered.
  presentFinalCase(
    questions: readonly SummationQuestion[],
    options: CaseOptions,
    proof: CaseProofOptions,
    handlers: FinalCaseHandlers,
  ): void;
  setCaseButtonVisible(visible: boolean): void;
  close(): void;
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

  // The second card of a question that has a proof: the answer is chosen, now show what backs it.
  const showProofCard = (config: {
    step: string;
    question: string;
    said: string;
    choices?: readonly ProofChoice[];
    proof: CaseProofOptions;
    initial?: readonly EvidenceRef[];
    note?: string;
    confirmLabel: string;
    onConfirm: (evidence: EvidenceRef[]) => void;
    onBack: () => void;
    onGoOn?: () => void;
  }): void => {
    const content = card("Show your evidence");
    const picker = createEvidencePicker({ choices: config.choices ?? config.proof.choices, max: config.proof.slots, initial: config.initial });
    const actions = el("div", "case-actions");
    actions.append(button(config.confirmLabel, () => config.onConfirm(picker.selected())));
    if (config.onGoOn) actions.append(button("Go on", config.onGoOn));
    actions.append(button("Back", config.onBack));
    content.append(
      el("p", "case-step", config.step),
      el("h2", "case-title", config.question),
      el("p", "case-text", `You said: ${config.said}`),
      el("p", "case-text", `Show up to ${config.proof.slots} items or clues that prove it.`),
      picker.element,
    );
    if (config.note) {
      const note = el("p", "case-text journal-feedback", config.note);
      note.setAttribute("role", "status");
      content.append(note);
    }
    content.append(actions);
    content.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      config.onBack();
    });
    open(content);
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
    showChapter(chapter, onClose) {
      const content = card(`Chapter ${chapter.number} of ${chapter.total}`);
      content.classList.add("chapter-card");
      content.setAttribute("aria-modal", "true");
      const shownAt = performance.now();
      const onKey = (event: KeyboardEvent): void => {
        if (!["Enter", " ", "Escape"].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation(); // Escape must not also open the pause menu
        // Keys still held from walking must not skip the card.
        if (event.repeat || performance.now() - shownAt < 400) return;
        finish();
      };
      let finished = false;
      const finish = (): void => {
        if (finished) return;
        finished = true;
        window.removeEventListener("keydown", onKey, true);
        close();
        onClose();
      };
      const actions = el("div", "case-actions");
      actions.append(button("Continue", finish));
      content.append(
        el("p", "case-step", `Chapter ${chapter.number} of ${chapter.total}`),
        el("h2", "case-title", chapter.title),
        el("p", "case-text", chapter.text),
      );
      if (chapter.teaser) content.append(el("p", "case-text chapter-teaser", chapter.teaser));
      content.append(actions);
      open(content);
      // A click on the dimmed backdrop (outside the card) or any key closes the card.
      overlay?.addEventListener("click", (event) => {
        if (event.target === overlay) finish();
      });
      window.addEventListener("keydown", onKey, true);
      const previous = release;
      release = () => {
        window.removeEventListener("keydown", onKey, true);
        previous?.();
      };
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
    presentCase(questions, options, proof, judge, onSolved) {
      let index = 0;
      const advance = (): void => {
        index += 1;
        showQuestion();
      };
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
        for (const option of options(question)) {
          actions.append(button(option.text, () => {
            if (option.id !== question.truthId) {
              showQuestion("Not quite. Look through your casebook and try again.");
            } else if (!question.proof) {
              advance();
            } else {
              showEvidence(question, option, []);
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
      // Free retries: weak evidence never blocks the case, and Go on leaves it.
      const showEvidence = (question: SummationQuestion, option: { id: string; text: string }, initial: readonly EvidenceRef[], note = ""): void => {
        showProofCard({
          step: `Question ${index + 1} of ${questions.length}`,
          question: question.question,
          said: option.text,
          choices: proof.choicesFor?.(question),
          proof,
          initial,
          note,
          confirmLabel: "Present this",
          onConfirm: (evidence) => {
            if (judge(question, option.id, evidence) === "proven") advance();
            else showEvidence(question, option, evidence, "That does not prove it yet. Try other evidence, or go on.");
          },
          onBack: () => showQuestion(),
          onGoOn: note ? advance : undefined,
        });
      };
      showQuestion();
    },
    presentFinalCase(questions, options, proof, handlers) {
      let index = handlers.startAt;
      const record = (question: SummationQuestion, answerId: string, evidence: EvidenceRef[]): void => {
        handlers.onAnswer(question, answerId, evidence);
        index += 1;
        showQuestion();
      };
      const showResults = (): void => {
        const results = handlers.results();
        const right = results.filter((result) => result.correct).length;
        const proven = results.filter((result) => result.outcome === "proven").length;
        const content = card("Your case");
        content.append(
          el("h2", "case-title", proven === results.length ? "Everyone nods along" : "Your case is heard"),
          el("p", "case-text", `You answered ${right} of ${results.length} questions as it really happened.`),
        );
        const list = el("ol", "case-result-list");
        for (const result of results) {
          const item = el("li", result.outcome === "proven" ? "case-result-right"
            : result.outcome === "unproven" ? "case-result-unproven" : "case-result-wrong");
          item.append(el("strong", "", result.question), el("br", ""));
          if (result.outcome === "proven") item.append(result.hadProof ? `✓ Proven: ${result.answer}` : `✓ ${result.answer}`);
          else if (result.outcome === "unproven") item.append(`✓ Right, but unproven: ${result.answer}`);
          else {
            item.append(`${result.outcome === "misread" ? "✗ Misread: " : "✗ "}You said: ${result.answer}`, el("br", ""), `In truth: ${result.correctAnswer}`);
          }
          if (result.shown.length > 0) item.append(el("br", ""), `You showed: ${result.shown.join("; ")}`);
          list.append(item);
        }
        const actions = el("div", "case-actions");
        actions.append(button("Continue", () => {
          close();
          handlers.onDone();
        }));
        content.append(list, actions);
        open(content);
      };
      const showQuestion = (): void => {
        const question = questions[index];
        if (!question) {
          showResults();
          return;
        }
        const content = card("Present your case");
        content.append(
          el("p", "case-step", `Question ${index + 1} of ${questions.length}`),
          el("h2", "case-title", question.question),
          el("p", "case-text", "Choose once; you will hear how you did when every question is answered."),
        );
        const actions = el("div", "case-actions");
        for (const option of options(question)) {
          actions.append(button(option.text, () => {
            if (!question.proof) {
              record(question, option.id, []);
              return;
            }
            const showEvidence = (initial: readonly EvidenceRef[]): void => {
              showProofCard({
                step: `Question ${index + 1} of ${questions.length}`,
                question: question.question,
                said: option.text,
                choices: proof.choicesFor?.(question),
                proof,
                initial,
                confirmLabel: "Present this",
                onConfirm: (evidence) => record(question, option.id, evidence),
                onBack: showQuestion,
              });
            };
            showEvidence([]);
          }));
        }
        content.append(actions, button("Not yet", close));
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
