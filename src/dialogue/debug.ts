import { getLengthView, loadStoryIndex, loadStoryPack } from "../story/loader";
import type { LengthId, StoryPack, SubjectRef } from "../story/types";
import { LENGTH_IDS } from "../story/types";
import { addTruth, giveItem, markClueFound } from "../story/state";
import type { StoryState } from "../story/state";
import { subjectLabel } from "./askAbout";
import { StorySession } from "../story/storySession";
import { LLMClient } from "../llm/client";
import { LLM_CONFIG } from "../llm/config";
import { MockBackend } from "../llm/mock";
import { checkSupport } from "../llm/support";
import { WebLLMBackend } from "../llm/webllmBackend";
import { runModelSetup, mountUnsupportedScreen } from "../ui/modelScreens";
import { storyMockRespond } from "../story/mockResponder";
import { ConversationController } from "./controller";
import type { PlayerReply } from "./controller";
import { DIALOGUE_FEEDBACK_TAGS } from "./feedback";
import type { DialogueFeedbackMessage, DialogueFeedbackSession, DialogueFeedbackTag } from "./feedback";
import type { DialogueTurn } from "./controller";

const FEEDBACK_ENDPOINT = "/__dialogue-feedback";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = "",
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function id(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function timestamp(): string {
  return new Date().toISOString();
}

function option(select: HTMLSelectElement, value: string, label: string): void {
  select.add(new Option(label, value));
}

export async function mountDialogueDebugScreen(): Promise<void> {
  document.documentElement.classList.add("llm-debug-mode");
  document.body.classList.add("llm-debug-mode");
  const root = document.body;
  root.replaceChildren();

  const useMock = new URLSearchParams(window.location.search).get("mock") === "1";
  const shell = el("main", "llm-debug-shell dialogue-debug-shell");
  const header = el("header", "llm-debug-header");
  const title = el("h1", "", "Character dialogue lab");
  const subtitle = el(
    "p",
    "",
    useMock
      ? "Mock storyteller: use this to check the workbench, not real model quality."
      : "Talk to a character with the on-device model and record feedback after each reply.",
  );
  const back = el("a", "art-debug-back", "Back to LLM tools");
  back.href = "?debug=llm";
  header.append(back, title, subtitle);

  const setupPanel = el("section", "dialogue-debug-setup");
  setupPanel.append(el("h2", "", "Test setup"));
  const modelSelect = el("select", "dialogue-debug-select");
  for (const modelId of LLM_CONFIG.candidates) option(modelSelect, modelId, modelId);
  modelSelect.value = LLM_CONFIG.modelId;
  if (useMock) modelSelect.disabled = true;
  const loadButton = el("button", "llm-button", useMock ? "Start mock model" : "Load model");
  loadButton.type = "button";
  const modelControls = el("div", "dialogue-debug-controls");
  const modelLabel = el("label", "", "Model ");
  modelLabel.append(modelSelect);
  modelControls.append(modelLabel, loadButton);
  const modelSetup = el("div", "dialogue-debug-model-setup");
  const status = el("p", "dialogue-debug-status", "Load a model to begin.");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const selectionControls = el("div", "dialogue-debug-controls");
  const storySelect = el("select", "dialogue-debug-select");
  const lengthSelect = el("select", "dialogue-debug-select");
  const characterSelect = el("select", "dialogue-debug-select");
  for (const [labelText, select] of [
    ["Story ", storySelect],
    ["Length ", lengthSelect],
    ["Character ", characterSelect],
  ] as const) {
    const label = el("label", "", labelText);
    label.append(select);
    selectionControls.append(label);
  }
  const stateSetup = el("details", "dialogue-debug-state-setup");
  const stateSummary = el("summary", "", "Set up story context (optional)");
  const stateOptions = el("div", "dialogue-debug-state-options");
  stateSetup.append(stateSummary, stateOptions);
  const startButton = el("button", "llm-button", "Start conversation");
  startButton.type = "button";
  startButton.disabled = true;
  const endButton = el("button", "llm-button", "End conversation");
  endButton.type = "button";
  endButton.hidden = true;
  const sessionControls = el("div", "dialogue-debug-controls");
  sessionControls.append(startButton, endButton);
  setupPanel.append(modelControls, modelSetup, selectionControls, stateSetup, sessionControls, status);

  const chatPanel = el("section", "dialogue-debug-chat");
  chatPanel.hidden = true;
  chatPanel.append(el("h2", "", "Conversation"));
  const transcript = el("div", "dialogue-debug-transcript");
  transcript.setAttribute("role", "log");
  transcript.setAttribute("aria-live", "polite");
  const feedbackPanel = el("form", "dialogue-debug-feedback");
  feedbackPanel.hidden = true;
  feedbackPanel.append(el("h3", "", "Feedback on this character reply"));
  const feedbackInput = el("textarea", "dialogue-debug-feedback-input");
  feedbackInput.maxLength = 4000;
  feedbackInput.placeholder = "What worked or felt wrong? Be specific if you can.";
  const feedbackTags = el("div", "dialogue-debug-tags");
  const tagInputs: { checkbox: HTMLInputElement; tag: DialogueFeedbackTag }[] = [];
  for (const tag of DIALOGUE_FEEDBACK_TAGS) {
    const label = el("label", "dialogue-debug-tag", tag);
    const checkbox = el("input");
    checkbox.type = "checkbox";
    checkbox.value = tag;
    label.prepend(checkbox);
    feedbackTags.append(label);
    tagInputs.push({ checkbox, tag });
  }
  const feedbackActions = el("div", "dialogue-debug-controls");
  const saveFeedbackButton = el("button", "llm-button", "Save feedback");
  saveFeedbackButton.type = "submit";
  const skipFeedbackButton = el("button", "llm-button", "No feedback");
  skipFeedbackButton.type = "button";
  feedbackActions.append(saveFeedbackButton, skipFeedbackButton);
  feedbackPanel.append(feedbackInput, feedbackTags, feedbackActions);

  const askControls = el("div", "dialogue-debug-controls");
  const askSelect = el("select", "dialogue-debug-select");
  askSelect.setAttribute("aria-label", "Subject to ask about");
  const askButton = el("button", "llm-button", "Ask about subject");
  askButton.type = "button";
  askControls.append(askSelect, askButton);
  const quickReplies = el("div", "dialogue-debug-quick-replies");
  const playerForm = el("form", "dialogue-debug-player-form");
  const playerInput = el("input", "dialogue-debug-player-input");
  playerInput.maxLength = 120;
  playerInput.placeholder = "Write a message to the character...";
  playerInput.setAttribute("aria-label", "Your message");
  const sendButton = el("button", "llm-button", "Send");
  sendButton.type = "submit";
  playerForm.append(playerInput, sendButton);
  const retrySaveButton = el("button", "llm-button", "Retry saving");
  retrySaveButton.type = "button";
  retrySaveButton.hidden = true;
  chatPanel.append(transcript, feedbackPanel, askControls, quickReplies, playerForm, retrySaveButton);
  shell.append(header, setupPanel, chatPanel);
  root.append(shell);

  let pack: StoryPack | null = null;
  let client: LLMClient | null = null;
  let controller: ConversationController | null = null;
  let labState: StoryState | null = null;
  let session: DialogueFeedbackSession | null = null;
  let pendingFeedbackId: string | null = null;
  let pendingReply: PlayerReply | null = null;
  let pendingOpening = false;
  let busy = false;
  let unsaved = false;
  let truthChecks: HTMLInputElement[] = [];
  let itemChecks: HTMLInputElement[] = [];

  function setStatus(text: string, isError = false): void {
    status.textContent = text;
    status.classList.toggle("dialogue-debug-error", isError);
  }

  function chosenView() {
    if (!pack) throw new Error("Choose a story before starting a conversation.");
    return getLengthView(pack, lengthSelect.value as LengthId);
  }

  function selectedCharacter() {
    const view = chosenView();
    const character = view.cast.find((candidate) => candidate.id === characterSelect.value);
    if (!character) throw new Error("Choose a character in the selected story length.");
    return character;
  }

  function selectedState(): { truthsFound: string[]; itemsHeld: string[] } {
    return {
      truthsFound: truthChecks.filter((input) => input.checked).map((input) => input.value),
      itemsHeld: itemChecks.filter((input) => input.checked).map((input) => input.value),
    };
  }

  function makeCheck(text: string, value: string, list: HTMLElement, target: HTMLInputElement[]): void {
    const label = el("label", "dialogue-debug-state-option", text);
    const checkbox = el("input");
    checkbox.type = "checkbox";
    checkbox.value = value;
    label.prepend(checkbox);
    list.append(label);
    target.push(checkbox);
  }

  function renderPackOptions(): void {
    if (!pack) return;
    const availableLengths = LENGTH_IDS.filter((length) => pack?.lengths[length]);
    lengthSelect.replaceChildren();
    for (const length of availableLengths) option(lengthSelect, length, length);
    if (availableLengths.length === 0) throw new Error(`Story "${pack.identity.title}" has no playable lengths.`);
    renderLengthOptions();
  }

  function renderLengthOptions(): void {
    if (!pack) return;
    const view = getLengthView(pack, lengthSelect.value as LengthId);
    characterSelect.replaceChildren();
    for (const character of view.cast) option(characterSelect, character.id, character.name);
    askSelect.replaceChildren();
    for (const member of pack.cast) option(askSelect, `cast:${member.id}`, `Person: ${member.name}`);
    for (const item of pack.items) option(askSelect, `item:${item.id}`, `Item: ${item.name}`);
    for (const clue of pack.clues) option(askSelect, `clue:${clue.id}`, `Evidence: ${clue.text.slice(0, 60)}`);
    stateOptions.replaceChildren();
    truthChecks = [];
    itemChecks = [];
    const truths = el("details", "dialogue-debug-state-group");
    truths.append(el("summary", "", "Player-known truths"));
    for (const truth of [...view.coreTruths, ...view.sideTruths]) makeCheck(truth.text, truth.id, truths, truthChecks);
    const items = el("details", "dialogue-debug-state-group");
    items.append(el("summary", "", "Player inventory"));
    for (const item of pack.items) makeCheck(item.name, item.id, items, itemChecks);
    stateOptions.append(truths, items);
  }

  async function loadSelectedPack(): Promise<void> {
    const selectedId = storySelect.value;
    if (!selectedId) return;
    try {
      setStatus("Loading and validating story...");
      pack = await loadStoryPack(selectedId);
      renderPackOptions();
      setStatus(`Loaded ${pack.identity.title}. Load a model to start.`);
      startButton.disabled = !client;
    } catch (error) {
      pack = null;
      startButton.disabled = true;
      setStatus(`Could not load the story: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  }

  function renderTranscript(): void {
    transcript.replaceChildren();
    if (!session) return;
    for (const turn of session.turns) {
      const bubble = el("article", `dialogue-debug-bubble dialogue-debug-bubble-${turn.speaker}`);
      const speaker = turn.speaker === "character" ? session.character.name : turn.kind === "intent" ? "You chose" : "You";
      bubble.append(el("strong", "dialogue-debug-speaker", speaker), el("p", "", turn.text));
      if (turn.feedback) {
        const note = el(
          "div",
          "dialogue-debug-saved-feedback",
          turn.feedback.skipped ? "Feedback skipped" : turn.feedback.text || "Feedback submitted",
        );
        if (turn.feedback.tags.length > 0) note.append(el("span", "", ` (${turn.feedback.tags.join(", ")})`));
        bubble.append(note);
      }
      transcript.append(bubble);
    }
    transcript.scrollTop = transcript.scrollHeight;
  }

  function setBusy(value: boolean): void {
    busy = value;
    playerInput.disabled = value || !controller || Boolean(pendingFeedbackId) || unsaved;
    sendButton.disabled = playerInput.disabled;
    for (const button of quickReplies.querySelectorAll<HTMLButtonElement>("button")) button.disabled = value || Boolean(pendingFeedbackId) || unsaved;
    askSelect.disabled = value || !controller || Boolean(pendingFeedbackId) || unsaved;
    askButton.disabled = askSelect.disabled;
    startButton.disabled = value || !client || !pack || Boolean(session);
    endButton.disabled = value || unsaved || Boolean(pendingFeedbackId);
    retrySaveButton.disabled = value;
    loadButton.disabled = value || Boolean(session);
    modelSelect.disabled = value || Boolean(session) || useMock;
    storySelect.disabled = value || Boolean(session);
    lengthSelect.disabled = value || Boolean(session);
    characterSelect.disabled = value || Boolean(session);
    for (const checkbox of [...truthChecks, ...itemChecks]) checkbox.disabled = value || Boolean(session);
    for (const control of feedbackPanel.querySelectorAll<HTMLTextAreaElement | HTMLInputElement | HTMLButtonElement>("textarea, input, button")) {
      control.disabled = value;
    }
  }

  async function persistSession(): Promise<boolean> {
    if (!session) return false;
    session.updatedAt = timestamp();
    unsaved = true;
    retrySaveButton.hidden = false;
    try {
      const response = await fetch(FEEDBACK_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(session),
      });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message ?? `HTTP ${response.status}`);
      unsaved = false;
      retrySaveButton.hidden = true;
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Could not save this session (${message}). Retry before continuing.`, true);
      retrySaveButton.hidden = false;
      return false;
    }
  }

  function setCurrentFeedback(turnId: string): void {
    pendingFeedbackId = turnId;
    feedbackInput.value = "";
    for (const { checkbox } of tagInputs) checkbox.checked = false;
    feedbackPanel.hidden = false;
    playerInput.disabled = true;
    sendButton.disabled = true;
    for (const button of quickReplies.querySelectorAll<HTMLButtonElement>("button")) button.disabled = true;
    feedbackInput.focus();
  }

  async function recordCharacterTurn(turn: DialogueTurn): Promise<void> {
    if (!session) return;
    const message: DialogueFeedbackMessage = {
      id: id(),
      speaker: "character",
      text: turn.line,
      quality: turn.quality,
      ...(turn.notice ? { notice: turn.notice } : {}),
      createdAt: timestamp(),
    };
    session.turns.push(message);
    pendingFeedbackId = message.id;
    renderTranscript();
    setCurrentFeedback(message.id);
    const saved = await persistSession();
    setStatus(
      saved
        ? turn.notice ?? "Reply saved. Add feedback or choose “No feedback” to continue."
        : status.textContent ?? "Save failed.",
      !saved,
    );
  }

  async function generateCharacterTurn(pending: Promise<DialogueTurn>): Promise<void> {
    if (!session) return;
    setBusy(true);
    setStatus("Character is thinking...");
    quickReplies.replaceChildren();
    try {
      const turn = await pending;
      await recordCharacterTurn(turn);
      for (const give of turn.gives) {
        const button = el("button", "dialogue-choice", give.label);
        button.type = "button";
        button.addEventListener("click", () => void submitGive(give.itemId, give.label));
        quickReplies.append(button);
      }
      if (turn.mode === "choices" && turn.choices.length >= 2) {
        for (const intent of turn.choices) {
          const button = el("button", "dialogue-choice", intent);
          button.type = "button";
          button.addEventListener("click", () => void submitPlayerTurn({ text: intent }));
          quickReplies.append(button);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`The character reply failed: ${message}`, true);
    } finally {
      setBusy(false);
      if (pendingFeedbackId) {
        playerInput.disabled = true;
        sendButton.disabled = true;
        feedbackInput.focus();
      }
    }
  }

  async function submitGive(itemId: string, label: string): Promise<void> {
    if (!session || !controller || busy || pendingFeedbackId || unsaved) return;
    session.turns.push({ id: id(), speaker: "player", text: label, createdAt: timestamp() });
    renderTranscript();
    quickReplies.replaceChildren();
    setBusy(true);
    if (await persistSession()) await generateCharacterTurn(controller.give(itemId));
    else setBusy(false);
  }

  async function submitAsk(): Promise<void> {
    if (!session || !controller || !pack || !labState || busy || pendingFeedbackId || unsaved) return;
    const separator = askSelect.value.indexOf(":");
    const subject = { type: askSelect.value.slice(0, separator), id: askSelect.value.slice(separator + 1) } as SubjectRef;
    // The lab is a sandbox: picking an item or clue makes the player hold or have found it.
    if (subject.type === "item") giveItem(labState, subject.id);
    if (subject.type === "clue") markClueFound(labState, subject.id);
    const label = subjectLabel(pack, subject) ?? subject.id;
    session.turns.push({ id: id(), speaker: "player", text: `What can you tell me about ${label}?`, createdAt: timestamp() });
    renderTranscript();
    quickReplies.replaceChildren();
    setBusy(true);
    if (await persistSession()) await generateCharacterTurn(controller.askAbout(subject));
    else setBusy(false);
  }

  askButton.addEventListener("click", () => void submitAsk());

  async function submitPlayerTurn(reply: PlayerReply): Promise<void> {
    if (!session || !controller || busy || pendingFeedbackId || unsaved || !reply.text.trim()) return;
    const text = reply.text.trim();
    const input: PlayerReply = { text, ...(reply.kind === "intent" ? { kind: "intent" } : {}) };
    const message: DialogueFeedbackMessage = {
      id: id(),
      speaker: "player",
      text,
      ...(input.kind === "intent" ? { kind: "intent" as const } : {}),
      createdAt: timestamp(),
    };
    session.turns.push(message);
    renderTranscript();
    playerInput.value = "";
    quickReplies.replaceChildren();
    pendingReply = input;
    setBusy(true);
    if (await persistSession()) {
      pendingReply = null;
      await generateCharacterTurn(controller.reply(input));
    } else {
      setBusy(false);
    }
  }

  async function startConversation(): Promise<void> {
    if (!client || !pack || session) return;
    try {
      const selectedPack = pack;
      const view = getLengthView(selectedPack, lengthSelect.value as LengthId);
      const character = selectedCharacter();
      const setup = selectedState();
      const story = new StorySession(selectedPack, view, client, 0);
      for (const truthId of setup.truthsFound) addTruth(story.state, truthId);
      for (const itemId of setup.itemsHeld) giveItem(story.state, itemId);
      const location = selectedPack.locations.find((entry) => entry.id === character.home_location);
      const context = {
        locationName: location?.name ?? selectedPack.identity.title,
        locationMood: location?.mood ?? selectedPack.identity.tone,
        storySummary: "",
        knownFacts: setup.truthsFound.flatMap((truthId) => {
          if (!character.knows_truths.includes(truthId)) return [];
          const truth = selectedPack.truths.find((candidate) => candidate.id === truthId);
          return truth ? [{ id: truth.id, text: truth.text }] : [];
        }),
        inventory: setup.itemsHeld.map((itemId) => {
          const item = selectedPack.items.find((candidate) => candidate.id === itemId);
          return { id: itemId, name: item?.name ?? itemId };
        }),
        getInventory: () => story.state.itemsHeld.flatMap((itemId) => {
          const item = selectedPack.items.find((candidate) => candidate.id === itemId);
          return item ? [{ id: item.id, name: item.name }] : [];
        }),
      };
      labState = story.state;
      controller = new ConversationController(client, selectedPack, story.state, character, context, { speculate: false });
      const started = timestamp();
      session = {
        schemaVersion: 1,
        sessionId: id(),
        startedAt: started,
        updatedAt: started,
        backend: useMock ? "mock" : "webllm",
        modelId: modelSelect.value,
        story: { id: selectedPack.identity.id, title: selectedPack.identity.title, version: selectedPack.identity.version, length: view.length },
        character: { id: character.id, name: character.name },
        setup,
        turns: [],
      };
      chatPanel.hidden = false;
      endButton.hidden = false;
      startButton.disabled = true;
      setBusy(true);
      pendingOpening = true;
      if (await persistSession()) {
        pendingOpening = false;
        await generateCharacterTurn(controller.start());
      } else {
        setBusy(false);
      }
    } catch (error) {
      setStatus(`Could not start the conversation: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  }

  async function saveFeedback(skipped: boolean): Promise<void> {
    if (!session || !pendingFeedbackId || busy) return;
    const message = session.turns.find((turn) => turn.id === pendingFeedbackId);
    if (!message) {
      setStatus("The reply awaiting feedback is missing from this session.", true);
      return;
    }
    message.feedback = {
      text: skipped ? "" : feedbackInput.value.trim(),
      tags: skipped ? [] : tagInputs.filter(({ checkbox }) => checkbox.checked).map(({ tag }) => tag),
      skipped,
      createdAt: timestamp(),
    };
    renderTranscript();
    setBusy(true);
    const saved = await persistSession();
    if (saved) {
      pendingFeedbackId = null;
      feedbackPanel.hidden = true;
      setStatus("Feedback saved. Continue the conversation when ready.");
    }
    setBusy(false);
    if (!pendingFeedbackId) {
      playerInput.disabled = false;
      sendButton.disabled = false;
      quickReplies.querySelectorAll<HTMLButtonElement>("button").forEach((button) => { button.disabled = false; });
      playerInput.focus();
    } else {
      feedbackInput.disabled = false;
      saveFeedbackButton.disabled = false;
      skipFeedbackButton.disabled = false;
    }
  }

  async function retrySaving(): Promise<void> {
    if (busy || !session) return;
    setBusy(true);
    if (await persistSession()) {
      if (pendingOpening && controller) {
        pendingOpening = false;
        await generateCharacterTurn(controller.start());
        return;
      }
      if (pendingReply && controller) {
        const reply = pendingReply;
        pendingReply = null;
        await generateCharacterTurn(controller.reply(reply));
        return;
      }
      const message = pendingFeedbackId ? session.turns.find((turn) => turn.id === pendingFeedbackId) : undefined;
      if (message?.feedback) {
        pendingFeedbackId = null;
        feedbackPanel.hidden = true;
        setStatus("Feedback saved. Continue the conversation when ready.");
      }
    }
    setBusy(false);
    if (!pendingFeedbackId && !pendingReply && !pendingOpening) {
      playerInput.disabled = !controller;
      sendButton.disabled = !controller;
      quickReplies.querySelectorAll<HTMLButtonElement>("button").forEach((button) => { button.disabled = false; });
    } else if (pendingFeedbackId) {
      feedbackInput.disabled = false;
      saveFeedbackButton.disabled = false;
      skipFeedbackButton.disabled = false;
    }
  }

  function endConversation(): void {
    session = null;
    controller = null;
    labState = null;
    pendingFeedbackId = null;
    pendingReply = null;
    pendingOpening = false;
    unsaved = false;
    chatPanel.hidden = true;
    transcript.replaceChildren();
    quickReplies.replaceChildren();
    feedbackPanel.hidden = true;
    retrySaveButton.hidden = true;
    endButton.hidden = true;
    startButton.disabled = !client || !pack;
    setStatus("Session saved locally. Start another conversation whenever you like.");
    setBusy(false);
  }

  loadButton.addEventListener("click", async () => {
    const modelId = modelSelect.value;
    loadButton.disabled = true;
    try {
    await client?.unload();
    client = null;
    const nextClient = new LLMClient(
        useMock ? new MockBackend({ delayMs: 120, respond: storyMockRespond }) : new WebLLMBackend(),
        { pauseWhenHidden: false },
      );
      if (useMock) await nextClient.load(modelId);
      else {
        const support = await checkSupport();
        if (!support.supported) {
          mountUnsupportedScreen(modelSetup, support);
          setStatus(support.reason ?? "This device cannot run WebGPU models.", true);
          return;
        }
        await runModelSetup(modelSetup, nextClient, modelId);
      }
      client = nextClient;
      localStorage.setItem(LLM_CONFIG.loadedModelStorageKey, modelId);
      startButton.disabled = !pack;
      loadButton.textContent = useMock ? "Reload mock model" : "Reload selected model";
      setStatus(useMock ? "Mock model ready." : `Model ${modelId} is ready on this device.`);
    } catch (error) {
      loadButton.textContent = useMock ? "Start mock model" : "Load model";
      setStatus(`Could not load the model: ${error instanceof Error ? error.message : String(error)}`, true);
    } finally {
      loadButton.disabled = false;
    }
  });

  storySelect.addEventListener("change", () => void loadSelectedPack());
  lengthSelect.addEventListener("change", renderLengthOptions);
  startButton.addEventListener("click", () => void startConversation());
  endButton.addEventListener("click", endConversation);
  playerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitPlayerTurn({ text: playerInput.value });
  });
  feedbackPanel.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveFeedback(false);
  });
  skipFeedbackButton.addEventListener("click", () => void saveFeedback(true));
  retrySaveButton.addEventListener("click", () => void retrySaving());

  try {
    const index = await loadStoryIndex();
    for (const story of index.stories) option(storySelect, story.id, story.title);
    if (index.stories.length === 0) throw new Error("No stories are available.");
    await loadSelectedPack();
  } catch (error) {
    setStatus(`Could not load the story list: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}
