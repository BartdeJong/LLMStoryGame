// Dialogue box UI: sized and spaced for an iPhone (large tap targets, safe-area aware).
// Pure DOM; no framework. Mounted once and reused for every conversation.

import { activateGamepadFocus } from "../input/focus";
import { inputMode } from "../input/mode";

export interface DialogueHandlers {
  onReply(text: string, kind?: "intent"): void;
  onLeave(): void;
  onGive?(itemId: string): void;
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
  const leaveButton = el("button", "dialogue-leave");
  leaveButton.type = "button";
  leaveButton.textContent = "Leave";
  controls.append(switchButton, leaveButton);

  box.append(speaker, thinking, log, notice, replySection, controls);
  container.append(box);

  let currentMode: "choices" | "free" = "choices";
  let currentChoices: string[] = [];
  let currentGives: { itemId: string; label: string }[] = [];
  let activeCharacterName = "";
  let turns: { speaker: "player" | "character"; text: string; kind?: "intent" }[] = [];
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

  function renderLog(): void {
    log.replaceChildren();
    const visibleTurns = turns.slice(-4);
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
    log.scrollTop = log.scrollHeight;
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
      notice.hidden = true;
      this.showThinking();
      freeForm.hidden = true;
    },
    close() {
      open = false;
      box.hidden = true;
      freeForm.onsubmit = null;
      freeInput.blur();
        turns = [];
        log.replaceChildren();
        notice.hidden = true;
        currentHandlers = null;
    },
    showPlayerReply(text: string, kind?: "intent") {
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
    },
    showTurn(turn, handlers) {
      turns.push({ speaker: "character", text: turn.line });
      renderLog();
      thinking.hidden = true;
      currentChoices = turn.mode === "choices" ? turn.choices : [];
      currentGives = turn.gives ?? [];
      currentMode = currentChoices.length >= 2 ? "choices" : "free";
      replySection.hidden = false;
      switchButton.hidden = currentChoices.length < 2;
      if (currentMode === "choices") renderChoices(handlers);
      else renderFree();

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
