// Dialogue box UI: sized and spaced for an iPhone (large tap targets, safe-area aware).
// Pure DOM; no framework. Mounted once and reused for every conversation.

import { activateGamepadFocus } from "../input/focus";
import { inputMode } from "../input/mode";
import { isReducedMotion } from "../ui/preferences";
import type { SubjectRef } from "../story/types";
import type { AskEntry, AskOptions } from "./askAbout";

const REVEAL_CHARS_PER_SECOND = 40;

export interface DialogueHandlers {
  onReply(text: string, kind?: "intent"): void;
  onLeave(): void;
  // Called as characters of a character line appear, so voice blips follow the typewriter.
  onReveal?(from: number, to: number, text: string): void;
  onGive?(itemId: string): void;
  onAsk?(subject: SubjectRef): void;
  getAskOptions?(): AskOptions;
}

export interface DialogueBox {
  readonly element: HTMLElement;
  open(characterName: string, handlers?: DialogueHandlers): void;
  close(): void;
  showPlayerReply(text: string, kind?: "intent"): void;
  showThinking(): void;
  showTurn(turn: { line: string; mode: "choices" | "free"; choices: string[]; gives?: { itemId: string; label: string }[] }, handlers: DialogueHandlers): void;
  showNotice(text: string): void;
  setBusy(busy: boolean): void;
  readonly isOpen: boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

export function createDialogueBox(container: HTMLElement): DialogueBox {
  const box = el("section", "dialogue-box");
  box.hidden = true;

  const speaker = el("p", "dialogue-speaker");
  const thinking = el("p", "dialogue-thinking");
  thinking.hidden = true;
  thinking.setAttribute("aria-live", "polite");
  const dots = el("span", "dialogue-thinking-dots");
  dots.setAttribute("aria-hidden", "true");
  dots.textContent = "...";
  thinking.append(dots);
  const log = el("div", "dialogue-log");
  log.setAttribute("role", "log");
  log.setAttribute("aria-live", "polite");
  const notice = el("p", "dialogue-notice");
  notice.hidden = true;
  const skipButton = el("button", "dialogue-skip");
  skipButton.type = "button";
  skipButton.textContent = "Show all";
  skipButton.dataset.padHint = "A";
  skipButton.hidden = true;
  const replySection = el("section", "dialogue-reply");
  replySection.hidden = true;
  const replyHeading = el("p", "dialogue-reply-heading");
  const choices = el("div", "dialogue-choices");
  const freeForm = el("form", "dialogue-free");
  const freeInput = el("input", "dialogue-free-input");
  freeInput.type = "text";
  freeInput.maxLength = 120;
  freeInput.placeholder = "Say something...";
  const sendButton = el("button", "llm-button dialogue-send");
  sendButton.type = "submit";
  sendButton.textContent = "Send";
  freeForm.append(freeInput, sendButton);
  freeForm.hidden = true;
  replySection.append(replyHeading, choices, freeForm);

  const controls = el("div", "dialogue-controls");
  const switchButton = el("button", "dialogue-switch");
  switchButton.type = "button";
  const askButton = el("button", "dialogue-ask");
  askButton.type = "button";
  askButton.textContent = "Ask about…";
  askButton.hidden = true;
  const leaveButton = el("button", "dialogue-leave");
  leaveButton.type = "button";
  leaveButton.textContent = "Leave";
  controls.append(askButton, switchButton, leaveButton);

  box.append(speaker, thinking, log, skipButton, notice, replySection, controls);
  container.append(box);

  const picker = el("section", "dialogue-ask-picker");
  picker.hidden = true;
  picker.setAttribute("role", "dialog");
  picker.setAttribute("aria-label", "Ask about");
  const pickerTabs = el("div", "dialogue-ask-tabs");
  pickerTabs.setAttribute("role", "tablist");
  const pickerList = el("div", "dialogue-ask-list");
  pickerList.setAttribute("role", "tabpanel");
  const pickerBack = el("button", "dialogue-ask-back");
  pickerBack.type = "button";
  pickerBack.textContent = "Back";
  pickerBack.dataset.padHint = "B";
  picker.append(pickerTabs, pickerList, pickerBack);
  container.append(picker);

  const ASK_TABS: { key: keyof AskOptions; label: string; empty: string }[] = [
    { key: "people", label: "People", empty: "You have not met anyone yet." },
    { key: "items", label: "Items", empty: "You are not carrying anything." },
    { key: "evidence", label: "Evidence", empty: "You have not found any clues yet." },
  ];
  let askTab = 0;
  let askOptions: AskOptions = { people: [], items: [], evidence: [] };
  const tabButtons = ASK_TABS.map((_tab, index) => {
    const button = el("button", "dialogue-ask-tab");
    button.type = "button";
    button.setAttribute("role", "tab");
    button.addEventListener("click", () => {
      askTab = index;
      renderPicker();
      button.focus();
    });
    pickerTabs.append(button);
    return button;
  });

  let revealTimer: ReturnType<typeof setInterval> | null = null;
  let finishReveal: (() => void) | null = null;

  function stopReveal(): void {
    if (revealTimer !== null) clearInterval(revealTimer);
    revealTimer = null;
    finishReveal = null;
    skipButton.hidden = true;
    log.setAttribute("aria-busy", "false");
  }

  // Shows the whole line at once; used by tap, the A button, and when reduced motion is on.
  function skipReveal(): void {
    finishReveal?.();
  }

  skipButton.addEventListener("click", skipReveal);
  log.addEventListener("click", skipReveal);
  window.addEventListener("keydown", (event) => {
    if (!finishReveal || event.key.toLowerCase() !== "a" || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select")) return;
    event.preventDefault();
    skipReveal();
  });

  let currentMode: "choices" | "free" = "choices";
  let currentChoices: string[] = [];
  let currentGives: { itemId: string; label: string }[] = [];
  let activeCharacterName = "";
  let turns: { speaker: "player" | "character"; text: string; kind?: "intent" }[] = [];
  let showAllTurns = false;
  let open = false;
  let currentHandlers: DialogueHandlers | null = null;
  activateGamepadFocus(box, {
    isActive: () => open,
    onBack: () => {
      if (document.activeElement === freeInput) {
        freeInput.blur();
        switchButton.focus();
        return switchButton;
      }
      currentHandlers?.onLeave();
    },
    onX: () => switchButton.click(),
    onY: () => { if (!askButton.hidden && !askButton.disabled) askButton.click(); },
  });

  let pickerOpen = false;
  activateGamepadFocus(picker, {
    isActive: () => pickerOpen,
    onBack: () => {
      closePicker();
    },
    onX: () => {
      askTab = (askTab + 1) % ASK_TABS.length;
      renderPicker();
    },
  });

  function renderPicker(): void {
    ASK_TABS.forEach((tab, index) => {
      const button = tabButtons[index] as HTMLButtonElement;
      button.textContent = `${tab.label} (${askOptions[tab.key].length})`;
      button.setAttribute("aria-selected", String(index === askTab));
      button.tabIndex = index === askTab ? 0 : -1;
      button.classList.toggle("dialogue-ask-tab-active", index === askTab);
    });
    const tab = ASK_TABS[askTab] as (typeof ASK_TABS)[number];
    const entries: AskEntry[] = askOptions[tab.key];
    pickerList.replaceChildren();
    if (entries.length === 0) {
      const empty = el("p", "dialogue-ask-empty");
      empty.textContent = tab.empty;
      pickerList.append(empty);
    }
    for (const entry of entries) {
      const button = el("button", "dialogue-choice dialogue-ask-entry");
      button.type = "button";
      button.dataset.padHint = "A";
      button.textContent = entry.label;
      if (entry.fresh) {
        const badge = el("span", "dialogue-ask-new");
        badge.textContent = "New";
        button.append(badge);
        button.setAttribute("aria-label", `${entry.label} (not asked about yet)`);
      }
      button.addEventListener("click", () => {
        closePicker(false);
        currentHandlers?.onAsk?.(entry.subject);
      });
      pickerList.append(button);
    }
  }

  function openPicker(): void {
    if (!open || !currentHandlers?.getAskOptions) return;
    askOptions = currentHandlers.getAskOptions();
    pickerOpen = true;
    picker.hidden = false;
    renderPicker();
    (pickerList.querySelector<HTMLButtonElement>("button") ?? tabButtons[askTab])?.focus();
  }

  function closePicker(restoreFocus = true): void {
    if (!pickerOpen) return;
    pickerOpen = false;
    picker.hidden = true;
    if (restoreFocus && !askButton.hidden) askButton.focus();
  }

  askButton.addEventListener("click", openPicker);
  pickerBack.addEventListener("click", () => closePicker());
  picker.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closePicker();
    } else if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && event.target instanceof HTMLElement && event.target.classList.contains("dialogue-ask-tab")) {
      event.preventDefault();
      askTab = (askTab + (event.key === "ArrowRight" ? 1 : ASK_TABS.length - 1)) % ASK_TABS.length;
      renderPicker();
      tabButtons[askTab]?.focus();
    }
  });

  function renderChoices(handlers: DialogueHandlers): void {
    choices.replaceChildren();
    freeForm.hidden = true;
    choices.hidden = false;
    replyHeading.textContent = "Choose what to say";
    switchButton.textContent = "Type instead";
    for (const give of currentGives) {
      const button = el("button", "dialogue-choice dialogue-give");
      button.type = "button";
      button.textContent = `★ ${give.label}`;
      button.dataset.padHint = "A";
      button.addEventListener("click", () => handlers.onGive?.(give.itemId));
      choices.append(button);
    }
    for (const text of currentChoices) {
      const button = el("button", "dialogue-choice");
      button.type = "button";
      button.textContent = `▸ ${text}`;
      button.dataset.padHint = "A";
      button.addEventListener("click", () => handlers.onReply(text));
      choices.append(button);
    }
    if (inputMode === "gamepad") choices.querySelector<HTMLButtonElement>("button")?.focus();
  }

  function renderFree(): void {
    choices.hidden = true;
    freeForm.hidden = false;
    replyHeading.textContent = "Your reply";
    switchButton.textContent = "Show quick replies";
    freeInput.value = "";
    freeInput.focus();
  }

  function renderLog(scrollToLatest = true): void {
    log.replaceChildren();
    const visibleTurns = showAllTurns ? turns : turns.slice(-4);
    if (!showAllTurns && turns.length > visibleTurns.length) {
      const earlier = el("button", "dialogue-history-button");
      earlier.type = "button";
      earlier.textContent = `Show ${turns.length - visibleTurns.length} earlier messages`;
      earlier.addEventListener("click", () => {
        showAllTurns = true;
        renderLog(false);
      });
      log.append(earlier);
    }
    let newestCharacter = -1;
    visibleTurns.forEach((turn, index) => {
      if (turn.speaker === "character") newestCharacter = index;
    });
    visibleTurns.forEach((turn, index) => {
      const bubble = el("article", `dialogue-bubble dialogue-bubble-${turn.speaker}`);
      if (turn.speaker === "character" && index === newestCharacter) bubble.classList.add("dialogue-bubble-newest");
      const label = el("span", "dialogue-bubble-label");
      label.textContent = turn.speaker === "player"
        ? turn.kind === "intent" ? "You chose" : "You"
        : activeCharacterName;
      const text = el("p", "dialogue-bubble-text");
      text.textContent = turn.text;
      bubble.append(label, text);
      log.append(bubble);
    });
    log.scrollTop = scrollToLatest ? log.scrollHeight : 0;
  }

  return {
    element: box,
    get isOpen() {
      return open;
    },
    open(name: string, handlers?: DialogueHandlers) {
      open = true;
      activeCharacterName = name;
      currentHandlers = handlers ?? null;
      box.hidden = false;
      speaker.textContent = name;
      log.replaceChildren();
      turns = [];
      showAllTurns = false;
      notice.hidden = true;
      this.showThinking();
      freeForm.hidden = true;
    },
    close() {
      closePicker(false);
      askButton.hidden = true;
      stopReveal();
      open = false;
      box.hidden = true;
      freeForm.onsubmit = null;
      freeInput.blur();
      turns = [];
      showAllTurns = false;
      log.replaceChildren();
      notice.hidden = true;
      currentHandlers = null;
    },
    showPlayerReply(text: string, kind?: "intent") {
      stopReveal();
      turns.push({ speaker: "player", text, ...(kind === "intent" ? { kind } : {}) });
      renderLog();
      this.showThinking();
    },
    showThinking() {
      thinking.textContent = `${activeCharacterName} is thinking`;
      thinking.append(dots);
      thinking.hidden = false;
      replySection.hidden = true;
      switchButton.hidden = true;
      askButton.hidden = true;
      closePicker(false);
    },
    showTurn(turn, handlers) {
      stopReveal();
      turns.push({ speaker: "character", text: turn.line });
      renderLog();
      thinking.hidden = true;
      currentChoices = turn.mode === "choices" ? turn.choices : [];
      currentGives = turn.gives ?? [];
      currentMode = currentChoices.length >= 2 ? "choices" : "free";
      switchButton.hidden = currentChoices.length < 2;

      switchButton.onclick = () => {
        currentMode = currentMode === "choices" ? "free" : "choices";
        if (currentMode === "choices") renderChoices(handlers);
        else renderFree();
      };
      switchButton.dataset.padHint = "X";
      leaveButton.dataset.padHint = "B";
      freeForm.onsubmit = (event) => {
        event.preventDefault();
        const text = freeInput.value.trim();
        if (text) handlers.onReply(text);
      };
      leaveButton.onclick = () => handlers.onLeave();
      currentHandlers = handlers;

      const showReplies = (): void => {
        stopReveal();
        if (!open) return;
        replySection.hidden = false;
        askButton.hidden = !handlers.getAskOptions;
        switchButton.hidden = currentChoices.length < 2;
        if (currentMode === "choices") renderChoices(handlers);
        else renderFree();
      };

      const textNode = log.querySelector<HTMLElement>(".dialogue-bubble-newest .dialogue-bubble-text");
      const full = turn.line;
      if (!textNode || full.length === 0 || isReducedMotion()) {
        if (textNode && full.length > 0) handlers.onReveal?.(0, Math.min(full.length, 24), full);
        showReplies();
        return;
      }
      // The reply controls wait for the end of the line so a tap on a choice cannot skip text unseen.
      replySection.hidden = true;
      switchButton.hidden = true;
      textNode.textContent = "";
      log.setAttribute("aria-busy", "true");
      skipButton.hidden = false;
      const startedAt = performance.now();
      const showCount = (count: number): void => {
        textNode.textContent = full.slice(0, count);
      };
      finishReveal = () => {
        showCount(full.length);
        showReplies();
      };
      let revealed = 0;
      revealTimer = setInterval(() => {
        const count = Math.floor(((performance.now() - startedAt) / 1000) * REVEAL_CHARS_PER_SECOND);
        if (count >= full.length) finishReveal?.();
        else {
          showCount(count);
          if (count > revealed) handlers.onReveal?.(revealed, count, full);
          revealed = Math.max(revealed, count);
        }
      }, 25);
      if (inputMode === "gamepad") skipButton.focus();
    },
    showNotice(text: string) {
      notice.textContent = text;
      notice.hidden = false;
    },
    setBusy(busy: boolean) {
      box.classList.toggle("dialogue-busy", busy);
      for (const control of box.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input")) control.disabled = busy;
    },
  };
}
