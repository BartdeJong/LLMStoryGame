import type { EndingChoice, EndingScene } from "../story/ending";
import { activateGamepadFocus } from "../input/focus";
import { formatPlayTime, type CaseRecap } from "../story/progress";
import { el } from "./dom";

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
  recap?: CaseRecap & { timePlayedMs?: number },
  epilogue?: { label: string; onJoin: () => Promise<void> },
): void {
  enableScreenScrolling();
  root.replaceChildren();
  const screen = el("section", "llm-screen ending-screen");
  screen.append(
    el("p", "ending-kicker", storyTitle),
    el("h1", "llm-screen-title", ending.endingTitle),
    ...(ending.flawed ? [el("p", "ending-flawed-note", "The case is closed, but not everything was set right.")] : []),
    el("p", "ending-scene", ending.scene),
    el("h2", "ending-subtitle", "Epilogue"),
    el("p", "ending-epilogue", ending.epilogue),
  );
  if (recap) screen.append(recapSection(recap));
  const actions = el("div", "ending-actions");
  const status = el("p", "llm-screen-note", "");
  if (epilogue) {
    const join = el("button", "llm-button", epilogue.label);
    join.type = "button";
    join.addEventListener("click", () => {
      join.disabled = true;
      status.textContent = "";
      void epilogue.onJoin().catch((error: unknown) => {
        status.textContent = `Could not continue: ${error instanceof Error ? error.message : String(error)}`;
        join.disabled = false;
      });
    });
    actions.append(join);
  }
  const newStory = el("button", epilogue ? "llm-button ending-secondary" : "llm-button", "New story");
  newStory.type = "button";
  newStory.addEventListener("click", onNewStory);
  const title = el("button", "llm-button ending-secondary", "Back to title");
  title.type = "button";
  title.addEventListener("click", onBackToTitle);
  actions.append(newStory, title);
  screen.append(actions, status);
  root.append(screen);
  title.dataset.padHint = "B";
  activateGamepadFocus(screen, { onBack: onBackToTitle });
}

function recapSection(recap: CaseRecap & { timePlayedMs?: number }): HTMLElement {
  const section = el("section", "ending-recap");
  section.setAttribute("aria-label", "How you solved it");
  section.append(el("h2", "ending-subtitle", "How you solved it"));
  section.append(el("p", `ending-recap-result ending-recap-result-${recap.result.kind}`, recap.result.kind === "assisted"
    ? `${recap.result.label}: deductions were confirmed for you, so nothing counted as a mistake.`
    : recap.result.label));
  if (recap.answers.length > 0) {
    section.append(el("h3", "ending-recap-heading", "Your answers"));
    const answers = el("ol", "ending-recap-answers");
    for (const answer of recap.answers) {
      const item = el("li", answer.outcome === "proven" ? "ending-recap-right"
        : answer.outcome === "unproven" ? "ending-recap-unproven" : "ending-recap-wrong");
      item.append(el("span", "ending-recap-text", `${answer.kind === "summation" ? "Finale: " : ""}${answer.question}`));
      item.append(el("span", "ending-recap-clue", answer.outcome === "proven"
        ? (answer.hadProof ? `✓ Proven: ${answer.answer}` : `✓ ${answer.answer}`)
        : answer.outcome === "unproven"
          ? `✓ Right, but unproven: ${answer.answer}`
          : `${answer.outcome === "misread" ? "✗ Misread: " : "✗ "}You answered: ${answer.answer} · In truth: ${answer.correctAnswer}`));
      if (answer.shown.length > 0) item.append(el("span", "ending-recap-clue", `You showed: ${answer.shown.join("; ")}`));
      answers.append(item);
    }
    section.append(answers);
  }
  if (recap.truths.length > 0) {
    section.append(el("h3", "ending-recap-heading", "What you uncovered"));
    const list = el("ol", "ending-recap-truths");
    for (const truth of recap.truths) {
      const item = el("li", "ending-recap-truth");
      item.append(el("span", "ending-recap-text", truth.text));
      if (truth.clue) item.append(el("span", "ending-recap-clue", `Revealed by: ${truth.clue}`));
      list.append(item);
    }
    section.append(list);
  }
  const facts = el("ul", "ending-recap-facts");
  const fact = (label: string, value: string): void => {
    const row = el("li", "ending-recap-fact");
    row.append(el("strong", "", `${label}: `), value);
    facts.append(row);
  };
  fact("People met", recap.people.length > 0 ? recap.people.join(", ") : "none");
  fact("Items found", recap.items.length > 0 ? recap.items.join(", ") : "none");
  const statements = recap.statements;
  if (statements.broken + statements.standing > 0) {
    const standing = statements.standing > 0
      ? `, ${statements.standing} left standing${statements.heardStanding > 0 ? ` (${statements.heardStanding} heard but never challenged successfully)` : ""}`
      : "";
    fact("Statements broken", `${statements.broken} of ${statements.broken + statements.standing}${standing}`);
  }
  if (statements.missedChallenges > 0) fact("Challenges that missed", String(statements.missedChallenges));
  if (recap.optionalCluesTotal > 0) fact("Optional clues", `${recap.optionalCluesFound} of ${recap.optionalCluesTotal}`);
  if (recap.timePlayedMs !== undefined) fact("Time played", formatPlayTime(recap.timePlayedMs));
  section.append(facts);
  return section;
}

function enableScreenScrolling(): void {
  document.documentElement.classList.add("llm-debug-mode");
  document.body.classList.add("llm-debug-mode");
}
