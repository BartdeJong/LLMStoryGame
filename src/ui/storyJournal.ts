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

export interface StoryJournal {
  readonly elements: readonly HTMLElement[];
  readonly isOpen: boolean;
  render(facts: readonly JournalFact[], evidence: readonly string[], requests: readonly JournalRequest[]): void;
  toggle(): void;
  close(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

export function createStoryJournal(container: HTMLElement): StoryJournal {
  const toggleButton = el("button", "journal-button");
  toggleButton.type = "button";
  toggleButton.textContent = "Journal · 0";
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
    ["facts", "Story facts"],
    ["evidence", "Evidence"],
    ["requests", "Character requests"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    filter.append(option);
  }
  const status = el("p", "journal-status");
  status.setAttribute("aria-live", "polite");

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
    factsHeading, factsList, factsEmpty,
    evidenceHeading, evidenceList, evidenceEmpty,
    requestsHeading, requestsList, requestsEmpty);

  const sections = [
    { key: "facts", heading: factsHeading, list: factsList, empty: factsEmpty },
    { key: "evidence", heading: evidenceHeading, list: evidenceList, empty: evidenceEmpty },
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
    render(facts, evidence, requests) {
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
      toggleButton.textContent = `Journal · ${facts.length + evidence.length + requests.length}`;
      toggleButton.setAttribute(
        "aria-label",
        `Story journal, ${facts.length + evidence.length + requests.length} entries`,
      );
      updateFilter();
    },
  };
}
