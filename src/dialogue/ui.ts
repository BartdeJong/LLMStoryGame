// Dialogue box UI: sized and spaced for an iPhone (large tap targets, safe-area aware).
// Pure DOM; no framework. Mounted once and reused for every conversation.

export interface DialogueHandlers {
  onReply(text: string): void;
  onLeave(): void;
}

export interface DialogueBox {
  readonly element: HTMLElement;
  open(characterName: string): void;
  close(): void;
  // Renders one turn: a line plus either choice buttons or a free-text box, with a switch button either way.
  showTurn(turn: { line: string; mode: "choices" | "free"; choices: string[] }, handlers: DialogueHandlers): void;
  showNotice(text: string): void;
  setBusy(busy: boolean): void;
  readonly isOpen: boolean;
}

const FALLBACK_CHOICES = ["Tell me more.", "Let's talk about something else.", "Goodbye for now."];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

export function createDialogueBox(container: HTMLElement): DialogueBox {
  const box = el("section", "dialogue-box");
  box.hidden = true;

  const speaker = el("p", "dialogue-speaker");
  const line = el("p", "dialogue-line");
  const notice = el("p", "dialogue-notice");
  notice.hidden = true;
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

  const controls = el("div", "dialogue-controls");
  const switchButton = el("button", "dialogue-switch");
  switchButton.type = "button";
  const leaveButton = el("button", "dialogue-leave");
  leaveButton.type = "button";
  leaveButton.textContent = "Leave";
  controls.append(switchButton, leaveButton);

  box.append(speaker, line, notice, choices, freeForm, controls);
  container.append(box);

  let currentMode: "choices" | "free" = "choices";
  let currentChoices: string[] = [];
  let open = false;

  function renderChoices(handlers: DialogueHandlers): void {
    choices.replaceChildren();
    freeForm.hidden = true;
    choices.hidden = false;
    switchButton.textContent = "Type instead";
    for (const text of currentChoices) {
      const button = el("button", "llm-button dialogue-choice");
      button.type = "button";
      button.textContent = text;
      button.addEventListener("click", () => handlers.onReply(text));
      choices.append(button);
    }
  }

  function renderFree(): void {
    choices.hidden = true;
    freeForm.hidden = false;
    switchButton.textContent = "Show quick replies";
    freeInput.value = "";
    freeInput.focus();
  }

  return {
    element: box,
    get isOpen() {
      return open;
    },
    open(characterName: string) {
      open = true;
      box.hidden = false;
      speaker.textContent = characterName;
      line.textContent = "...";
      notice.hidden = true;
      choices.replaceChildren();
      freeForm.hidden = true;
    },
    close() {
      open = false;
      box.hidden = true;
      freeForm.onsubmit = null;
    },
    showTurn(turn, handlers) {
      line.textContent = turn.line;
      currentMode = turn.mode;
      currentChoices = turn.mode === "choices" && turn.choices.length > 0 ? turn.choices : FALLBACK_CHOICES;
      if (currentMode === "choices") renderChoices(handlers);
      else renderFree();

      switchButton.onclick = () => {
        currentMode = currentMode === "choices" ? "free" : "choices";
        if (currentMode === "choices") renderChoices(handlers);
        else renderFree();
      };
      freeForm.onsubmit = (event) => {
        event.preventDefault();
        const text = freeInput.value.trim();
        if (text) handlers.onReply(text);
      };
      leaveButton.onclick = () => handlers.onLeave();
    },
    showNotice(text: string) {
      notice.textContent = text;
      notice.hidden = false;
    },
    setBusy(busy: boolean) {
      box.classList.toggle("dialogue-busy", busy);
      for (const control of box.querySelectorAll("button, input")) (control as HTMLButtonElement).disabled = busy;
    },
  };
}
