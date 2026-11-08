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
  render(facts: readonly JournalFact[], evidence: readonly string[], requests: readonly JournalRequest[]): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

export function createStoryJournal(container: HTMLElement): StoryJournal {
  const toggleButton = el("button", "journal-button");
  toggleButton.type = "button";
  toggleButton.textContent = "Journal";
  toggleButton.setAttribute("aria-label", "Story journal");
  toggleButton.dataset.padHint = "J";

  const panel = el("section", "journal-panel");
  panel.hidden = true;
  panel.setAttribute("aria-label", "Story journal");
  const title = el("p", "inventory-title");
  title.textContent = "Story journal";

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
  panel.append(
    title,
    factsHeading, factsList, factsEmpty,
    evidenceHeading, evidenceList, evidenceEmpty,
    requestsHeading, requestsList, requestsEmpty,
  );

  const togglePanel = (): void => {
    panel.hidden = !panel.hidden;
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
        factsList.append(row);
      }

      evidenceList.replaceChildren();
      evidenceEmpty.hidden = evidence.length > 0;
      for (const text of evidence) {
        const row = el("article", "journal-entry");
        const content = el("p", "journal-entry-text");
        content.textContent = text;
        row.append(content);
        evidenceList.append(row);
      }

      requestsList.replaceChildren();
      requestsEmpty.hidden = requests.length > 0;
      for (const request of requests) {
        const row = el("article", "journal-entry");
        const text = el("p", "journal-entry-text");
        text.textContent = `${request.character} needs the ${request.item}.`;
        row.append(text);
        if (request.location) {
          const location = el("p", "journal-entry-location");
          location.textContent = `Find it: ${request.location}`;
          row.append(location);
        }
        requestsList.append(row);
      }
    },
  };
}
