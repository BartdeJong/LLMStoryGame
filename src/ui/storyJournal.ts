import { activateGamepadFocus } from "../input/focus";

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
}

export interface JournalRuledOut {
  readonly description: string;
  readonly resolution: string;
}

export interface JournalExtras {
  readonly questions: readonly JournalQuestion[];
  readonly ruledOut: readonly JournalRuledOut[];
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

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

export function createStoryJournal(
  container: HTMLElement,
  onAnswer: (questionId: string, answer: string) => void = () => undefined,
): StoryJournal {
  const feedback = new Map<string, string>();
  let focusQuestion: string | null = null;
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
    ["facts", "Story facts"],
    ["evidence", "Evidence"],
    ["ruled", "Ruled out"],
    ["requests", "Character requests"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    filter.append(option);
  }
  const status = el("p", "journal-status");
  status.setAttribute("aria-live", "polite");

  const questionsHeading = el("p", "journal-heading");
  questionsHeading.textContent = "Open questions";
  const questionsList = el("div", "journal-list");
  const questionsEmpty = el("p", "inventory-empty");
  questionsEmpty.textContent = "No open questions right now.";

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

  const requestsHeading = el("p", "journal-heading");
  requestsHeading.textContent = "Character requests";
  const requestsList = el("div", "journal-list");
  const requestsEmpty = el("p", "inventory-empty");
  requestsEmpty.textContent = "No one has asked you to find anything yet.";
  panel.append(title, search, filter, status,
    questionsHeading, questionsList, questionsEmpty,
    factsHeading, factsList, factsEmpty,
    evidenceHeading, evidenceList, evidenceEmpty,
    ruledHeading, ruledList, ruledEmpty,
    requestsHeading, requestsList, requestsEmpty);

  const sections = [
    { key: "questions", heading: questionsHeading, list: questionsList, empty: questionsEmpty },
    { key: "facts", heading: factsHeading, list: factsList, empty: factsEmpty },
    { key: "evidence", heading: evidenceHeading, list: evidenceList, empty: evidenceEmpty },
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
    render(facts, evidence, requests, extras = { questions: [], ruledOut: [] }) {
      questionsList.replaceChildren();
      questionsEmpty.hidden = extras.questions.length > 0;
      for (const question of extras.questions) {
        const row = el("article", "journal-entry journal-question");
        const prompt = el("p", "journal-entry-text");
        prompt.textContent = question.question;
        row.append(prompt);
        if (question.evidence.length > 0) {
          const label = el("p", "journal-entry-label");
          label.textContent = "Evidence so far";
          row.append(label);
          for (const text of question.evidence) {
            const line = el("p", "journal-entry-location");
            line.textContent = text;
            row.append(line);
          }
        }
        const answers = el("div", "journal-answers");
        for (const option of question.options) {
          const button = el("button", "dialogue-choice journal-answer");
          button.type = "button";
          button.textContent = option;
          button.dataset.questionId = question.id;
          button.addEventListener("click", () => {
            focusQuestion = question.id;
            onAnswer(question.id, option);
          });
          answers.append(button);
        }
        row.append(answers);
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
        label.textContent = `${fact.importance} truth`;
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
        const target = questionsList.querySelector<HTMLElement>(`button[data-question-id="${focusQuestion}"]`);
        focusQuestion = null;
        target?.focus();
      }
    },
  };
}
