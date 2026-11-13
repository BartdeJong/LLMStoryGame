import { activateGamepadFocus } from "../input/focus";
import { PROOF_SLOTS } from "../story/config";
import type { ProofChoice } from "../story/proof";
import type { AnswerOutcome } from "../story/state";
import type { EvidenceRef } from "../story/statements";
import type { JournalLead } from "../story/storySession";
import { createEvidencePicker } from "./evidencePicker";
import { fillPips, progressLabel, type HudProgress } from "./objectiveHud";
import { el } from "./dom";

export interface JournalFact {
  readonly importance: "Core" | "Side";
  readonly text: string;
}

export interface JournalRequest {
  readonly character: string;
  readonly item: string;
  readonly location?: string;
}

export interface JournalQuestion {
  readonly id: string;
  readonly question: string;
  readonly evidence: readonly string[];
  readonly options: readonly string[];
  readonly proofSlots: number; // how many pieces of evidence can be shown with the answer; 0 = answered in one click
}

// How a confirmed truth's question was answered, keyed by the fact text.
export interface JournalJudged {
  readonly text: string;
  readonly outcome: AnswerOutcome;
  readonly hadProof: boolean; // the question had an authored proof; without one a right answer is just right
}

export interface JournalRuledOut {
  readonly description: string;
  readonly resolution: string;
}

// Something a character said: a claim, not a fact, until evidence breaks it.
export interface JournalStatement {
  readonly character: string;
  readonly topic: string;
  readonly text: string;
  readonly admission?: string; // set once the statement is broken
}

export interface JournalExtras {
  readonly questions: readonly JournalQuestion[];
  readonly statements?: readonly JournalStatement[];
  readonly evidenceChoices: readonly ProofChoice[]; // items held and clues found, for showing with an answer
  readonly judged?: readonly JournalJudged[];
  readonly ruledOut: readonly JournalRuledOut[];
  readonly progress?: Pick<HudProgress, "truthsFound" | "truthsTotal">;
  readonly leads?: readonly JournalLead[];
}

export interface StoryJournal {
  readonly elements: readonly HTMLElement[];
  readonly isOpen: boolean;
  render(
    facts: readonly JournalFact[],
    evidence: readonly string[],
    requests: readonly JournalRequest[],
    extras?: JournalExtras,
  ): void;
  // Shows a short message under one open question (for example a gentle nudge after a wrong answer).
  setQuestionFeedback(questionId: string, message: string): void;
  announce(message: string): void;
  toggle(): void;
  close(): void;
}

export function createStoryJournal(
  container: HTMLElement,
  onAnswer: (questionId: string, answer: string, evidence: EvidenceRef[]) => void = () => undefined,
): StoryJournal {
  const feedback = new Map<string, string>();
  // The answer a player has picked but not yet given, with the evidence chosen so far. Not saved.
  const pending = new Map<string, { answer: string; evidence: EvidenceRef[] }>();
  let focusQuestion: { id: string; role: "option" | "evidence" | "give" } | null = null;
  let lastRender: Parameters<StoryJournal["render"]> | null = null;
  const toggleButton = el("button", "journal-button");
  toggleButton.type = "button";
  toggleButton.textContent = "Journal · 0";
  const badge = el("span", "journal-badge");
  badge.hidden = true;
  badge.setAttribute("aria-hidden", "true");
  toggleButton.append(badge);
  toggleButton.setAttribute("aria-label", "Story journal");
  toggleButton.dataset.padHint = "J";

  const panel = el("section", "journal-panel");
  panel.id = "story-journal-panel";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Story journal");
  toggleButton.setAttribute("aria-controls", panel.id);
  toggleButton.setAttribute("aria-expanded", "false");
  const title = el("p", "inventory-title");
  title.textContent = "Story journal";
  const search = el("input", "journal-search");
  search.type = "search";
  search.placeholder = "Search your notes";
  search.setAttribute("aria-label", "Search story journal");
  const filter = el("select", "journal-filter");
  filter.setAttribute("aria-label", "Filter journal entries");
  for (const [value, label] of [
    ["all", "All notes"],
    ["questions", "Open questions"],
    ["leads", "Leads"],
    ["facts", "Story facts"],
    ["evidence", "Evidence"],
    ["statements", "What people said"],
    ["ruled", "Ruled out"],
    ["requests", "Character requests"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    filter.append(option);
  }
  const progressLine = el("div", "journal-progress");
  const progressText = el("p", "journal-progress-text");
  const progressPips = el("span", "hud-pips");
  progressPips.setAttribute("aria-hidden", "true");
  progressLine.append(progressText, progressPips);
  progressLine.hidden = true;
  const status = el("p", "journal-status");
  status.setAttribute("aria-live", "polite");

  const questionsHeading = el("p", "journal-heading");
  questionsHeading.textContent = "Open questions";
  const questionsList = el("div", "journal-list");
  const questionsEmpty = el("p", "inventory-empty");
  questionsEmpty.textContent = "No open questions right now.";

  const leadsHeading = el("p", "journal-heading");
  leadsHeading.textContent = "Leads";
  const leadsList = el("div", "journal-list");
  const leadsEmpty = el("p", "inventory-empty");
  leadsEmpty.textContent = "No locked doors or puzzles noted yet.";

  const ruledHeading = el("p", "journal-heading");
  ruledHeading.textContent = "Ruled out";
  const ruledList = el("div", "journal-list");
  const ruledEmpty = el("p", "inventory-empty");
  ruledEmpty.textContent = "Nothing ruled out yet.";

  const factsHeading = el("p", "journal-heading");
  factsHeading.textContent = "Story facts";
  const factsList = el("div", "journal-list");
  const factsEmpty = el("p", "inventory-empty");
  factsEmpty.textContent = "No story facts uncovered yet.";

  const evidenceHeading = el("p", "journal-heading");
  evidenceHeading.textContent = "Evidence";
  const evidenceList = el("div", "journal-list");
  const evidenceEmpty = el("p", "inventory-empty");
  evidenceEmpty.textContent = "No evidence recorded yet.";

  const statementsHeading = el("p", "journal-heading");
  statementsHeading.textContent = "What people said";
  const statementsList = el("div", "journal-list");
  const statementsEmpty = el("p", "inventory-empty");
  statementsEmpty.textContent = "No one has told you anything worth checking yet.";

  const requestsHeading = el("p", "journal-heading");
  requestsHeading.textContent = "Character requests";
  const requestsList = el("div", "journal-list");
  const requestsEmpty = el("p", "inventory-empty");
  requestsEmpty.textContent = "No one has asked you to find anything yet.";
  panel.append(title, progressLine, search, filter, status,
    questionsHeading, questionsList, questionsEmpty,
    leadsHeading, leadsList, leadsEmpty,
    factsHeading, factsList, factsEmpty,
    evidenceHeading, evidenceList, evidenceEmpty,
    statementsHeading, statementsList, statementsEmpty,
    ruledHeading, ruledList, ruledEmpty,
    requestsHeading, requestsList, requestsEmpty);

  const sections = [
    { key: "questions", heading: questionsHeading, list: questionsList, empty: questionsEmpty },
    { key: "leads", heading: leadsHeading, list: leadsList, empty: leadsEmpty },
    { key: "facts", heading: factsHeading, list: factsList, empty: factsEmpty },
    { key: "evidence", heading: evidenceHeading, list: evidenceList, empty: evidenceEmpty },
    { key: "statements", heading: statementsHeading, list: statementsList, empty: statementsEmpty },
    { key: "ruled", heading: ruledHeading, list: ruledList, empty: ruledEmpty },
    { key: "requests", heading: requestsHeading, list: requestsList, empty: requestsEmpty },
  ] as const;
  const updateFilter = (): void => {
    const query = search.value.trim().toLocaleLowerCase();
    let visibleCount = 0;
    for (const section of sections) {
      const matchesCategory = filter.value === "all" || filter.value === section.key;
      let sectionCount = 0;
      for (const entry of section.list.children) {
        const row = entry as HTMLElement;
        const visible = matchesCategory && (row.dataset.search ?? "").includes(query);
        row.hidden = !visible;
        if (visible) sectionCount += 1;
      }
      const showSection = matchesCategory && (sectionCount > 0 || !query);
      section.heading.hidden = !showSection;
      section.list.hidden = !showSection || sectionCount === 0;
      section.empty.hidden = !showSection || sectionCount > 0;
      if (sectionCount > 0) visibleCount += sectionCount;
    }
    status.textContent = query || filter.value !== "all"
      ? `${visibleCount} matching ${visibleCount === 1 ? "entry" : "entries"}`
      : `${visibleCount} ${visibleCount === 1 ? "entry" : "entries"} saved`;
  };
  search.addEventListener("input", updateFilter);
  filter.addEventListener("change", updateFilter);

  const togglePanel = (): void => {
    panel.hidden = !panel.hidden;
    toggleButton.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) search.focus();
    else toggleButton.focus();
  };
  toggleButton.addEventListener("click", togglePanel);
  activateGamepadFocus(panel, {
    isActive: () => !panel.hidden,
    onBack: togglePanel,
    onY: togglePanel,
  });
  container.append(toggleButton, panel);

  return {
    elements: [toggleButton, panel],
    get isOpen() {
      return !panel.hidden;
    },
    toggle: togglePanel,
    close() {
      if (!panel.hidden) togglePanel();
    },
    setQuestionFeedback(questionId, message) {
      feedback.set(questionId, message);
    },
    announce(message) {
      status.textContent = message;
    },
    render(...args) {
      lastRender = args;
      draw();
    },
  };

  // Draws the journal from the last render arguments, so a pending answer can change without the game.
  function draw(): void {
    if (!lastRender) return;
    const [facts, evidence, requests, extras = { questions: [], ruledOut: [], evidenceChoices: [] }] = lastRender;
    {
      const progress = extras.progress;
      progressLine.hidden = !progress || progress.truthsTotal === 0;
      if (progress && progress.truthsTotal > 0) {
        progressText.textContent = progressLabel({ ...progress, leadNumber: 0, leadTotal: 0 });
        fillPips(progressPips, progress.truthsFound, progress.truthsTotal);
      }
      questionsList.replaceChildren();
      questionsEmpty.hidden = extras.questions.length > 0;
      for (const id of [...pending.keys()]) {
        if (!extras.questions.some((question) => question.id === id)) pending.delete(id);
      }
      for (const question of extras.questions) {
        const row = el("article", "journal-entry journal-question");
        const prompt = el("p", "journal-entry-text");
        prompt.textContent = question.question;
        const final = el("p", "journal-entry-location journal-final-note");
        final.textContent = question.proofSlots > 0
          ? `Pick an answer, then show up to ${question.proofSlots} items or clues that prove it. Your answer is final.`
          : "Your answer is final. You can keep looking for evidence before you choose.";
        row.append(prompt, final);
        // Questions with a proof do not list the clues found for them: that would hand over the answer.
        if (question.proofSlots === 0 && question.evidence.length > 0) {
          const label = el("p", "journal-entry-label");
          label.textContent = "Evidence so far";
          row.append(label);
          for (const text of question.evidence) {
            const line = el("p", "journal-entry-location");
            line.textContent = text;
            row.append(line);
          }
        }
        const chosen = pending.get(question.id);
        if (question.proofSlots > 0 && chosen) {
          const said = el("p", "journal-entry-text journal-your-answer", `Your answer: ${chosen.answer}`);
          const change = el("button", "dialogue-choice journal-change", "Change");
          change.type = "button";
          change.dataset.questionId = question.id;
          change.dataset.role = "option";
          change.addEventListener("click", () => {
            pending.delete(question.id);
            focusQuestion = { id: question.id, role: "option" };
            draw();
          });
          const picker = createEvidencePicker({
            choices: extras.evidenceChoices,
            max: Math.min(question.proofSlots, PROOF_SLOTS),
            initial: chosen.evidence,
            onChange: (selected) => { chosen.evidence = selected; },
          });
          const give = el("button", "dialogue-choice journal-give", "Give this answer");
          give.type = "button";
          give.dataset.questionId = question.id;
          give.dataset.role = "give";
          give.addEventListener("click", () => {
            const shown = picker.selected();
            pending.delete(question.id);
            focusQuestion = { id: question.id, role: "give" };
            onAnswer(question.id, chosen.answer, shown);
          });
          row.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            pending.delete(question.id);
            focusQuestion = { id: question.id, role: "option" };
            draw();
          });
          const actions = el("div", "journal-answers");
          actions.append(change, give);
          row.append(said, picker.element, actions);
          const firstPiece = picker.element.querySelector<HTMLButtonElement>("button");
          if (firstPiece) {
            firstPiece.dataset.questionId = question.id;
            firstPiece.dataset.role = "evidence";
          } else if (focusQuestion?.id === question.id && focusQuestion.role === "evidence") {
            // Nothing to pick: land on "Give this answer", not "Change", so a second press does not undo the pick.
            focusQuestion = { id: question.id, role: "give" };
          }
        } else {
          const answers = el("div", "journal-answers");
          for (const option of question.options) {
            const button = el("button", "dialogue-choice journal-answer");
            button.type = "button";
            button.textContent = option;
            button.dataset.questionId = question.id;
            button.dataset.role = "option";
            button.addEventListener("click", () => {
              if (question.proofSlots > 0) {
                pending.set(question.id, { answer: option, evidence: [] });
                focusQuestion = { id: question.id, role: "evidence" };
                draw();
              } else {
                focusQuestion = { id: question.id, role: "option" };
                onAnswer(question.id, option, []);
              }
            });
            answers.append(button);
          }
          row.append(answers);
        }
        const note = feedback.get(question.id);
        if (note) {
          const message = el("p", "journal-entry-location journal-feedback");
          message.setAttribute("role", "status");
          message.textContent = note;
          row.append(message);
        }
        row.dataset.search = `${question.question} ${question.evidence.join(" ")}`.toLocaleLowerCase();
        questionsList.append(row);
      }

      leadsList.replaceChildren();
      const leads = extras.leads ?? [];
      leadsEmpty.hidden = leads.length > 0;
      for (const lead of leads) {
        const row = el("article", `journal-entry${lead.resolved !== undefined ? " journal-entry-resolved" : ""}`);
        const label = el("p", "journal-entry-label");
        label.textContent = lead.title;
        const reason = el("p", "journal-entry-text");
        reason.textContent = lead.reason;
        row.append(label, reason);
        let searchable = `${lead.title} ${lead.reason}`;
        if (lead.resolved !== undefined) {
          const opened = el("p", "journal-entry-location");
          opened.textContent = `Opened: ${lead.resolved}`;
          row.append(opened);
          searchable += ` ${opened.textContent}`;
        } else if (lead.lead) {
          const hint = el("p", "journal-entry-location");
          hint.textContent = `Lead: ${lead.lead}`;
          row.append(hint);
          searchable += ` ${hint.textContent}`;
        }
        row.dataset.search = searchable.toLocaleLowerCase();
        leadsList.append(row);
      }

      ruledList.replaceChildren();
      ruledEmpty.hidden = extras.ruledOut.length > 0;
      for (const herring of extras.ruledOut) {
        const row = el("article", "journal-entry");
        const label = el("p", "journal-entry-label");
        label.textContent = herring.description;
        const text = el("p", "journal-entry-text");
        text.textContent = herring.resolution;
        row.append(label, text);
        row.dataset.search = `${herring.description} ${herring.resolution}`.toLocaleLowerCase();
        ruledList.append(row);
      }

      factsList.replaceChildren();
      factsEmpty.hidden = facts.length > 0;
      for (const fact of facts) {
        const row = el("article", "journal-entry");
        const label = el("p", "journal-entry-label");
        const judged = extras.judged?.find((entry) => entry.text === fact.text);
        const outcome = judged?.outcome;
        const verdict = outcome === "proven" ? (judged?.hadProof ? " · proven" : "")
          : outcome === "unproven" ? " · right, but unproven"
          : outcome ? " · your answer was wrong" : "";
        label.textContent = `${fact.importance} truth${verdict}`;
        if (outcome === "unproven") row.classList.add("journal-entry-unproven");
        else if (outcome === "wrong" || outcome === "misread") row.classList.add("journal-entry-missed");
        const text = el("p", "journal-entry-text");
        text.textContent = fact.text;
        row.append(label, text);
        row.dataset.search = `${fact.importance} ${fact.text}`.toLocaleLowerCase();
        factsList.append(row);
      }

      evidenceList.replaceChildren();
      evidenceEmpty.hidden = evidence.length > 0;
      for (const text of evidence) {
        const row = el("article", "journal-entry");
        const content = el("p", "journal-entry-text");
        content.textContent = text;
        row.append(content);
        row.dataset.search = text.toLocaleLowerCase();
        evidenceList.append(row);
      }

      statementsList.replaceChildren();
      const statements = extras.statements ?? [];
      statementsEmpty.hidden = statements.length > 0;
      for (const statement of statements) {
        const row = el("article", `journal-entry journal-statement${statement.admission ? " journal-statement-broken" : ""}`);
        const label = el("p", "journal-entry-label");
        label.textContent = statement.admission
          ? `${statement.character} · ${statement.topic} · broken`
          : `${statement.character} · ${statement.topic} · they said (not a fact)`;
        const text = el("p", "journal-entry-text");
        text.textContent = `“${statement.text}”`;
        row.append(label, text);
        if (statement.admission) {
          const admitted = el("p", "journal-entry-location");
          admitted.textContent = `Admitted: ${statement.admission}`;
          row.append(admitted);
        }
        row.dataset.search = `${statement.character} ${statement.topic} ${statement.text} ${statement.admission ?? ""}`.toLocaleLowerCase();
        statementsList.append(row);
      }

      requestsList.replaceChildren();
      requestsEmpty.hidden = requests.length > 0;
      for (const request of requests) {
        const row = el("article", "journal-entry");
        const text = el("p", "journal-entry-text");
        text.textContent = `${request.character} needs the ${request.item}.`;
        row.append(text);
        let searchable = text.textContent;
        if (request.location) {
          const location = el("p", "journal-entry-location");
          location.textContent = `Find it: ${request.location}`;
          searchable += ` ${location.textContent}`;
          row.append(location);
        }
        row.dataset.search = searchable.toLocaleLowerCase();
        requestsList.append(row);
      }
      const entryCount = facts.length + evidence.length + requests.length;
      toggleButton.replaceChildren(`Journal · ${entryCount}`, badge);
      badge.hidden = extras.questions.length === 0;
      badge.textContent = String(extras.questions.length);
      toggleButton.setAttribute(
        "aria-label",
        `Story journal, ${entryCount} entries${extras.questions.length > 0
          ? `, ${extras.questions.length} open ${extras.questions.length === 1 ? "question" : "questions"}`
          : ""}`,
      );
      updateFilter();
      if (focusQuestion !== null) {
        const { id, role } = focusQuestion;
        const target = questionsList.querySelector<HTMLElement>(`button[data-question-id="${id}"][data-role="${role}"]`)
          ?? questionsList.querySelector<HTMLElement>(`button[data-question-id="${id}"]`);
        focusQuestion = null;
        target?.focus();
      }
    }
  }
}
