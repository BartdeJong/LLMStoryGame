import { followCamera, type Position } from "./camera";
import { soundEffects } from "./audio/soundEffects";
import { ambienceRecipe } from "./audio/ambienceRecipes";
import type { BodyShape } from "./art/sprites";
import type { Tile } from "./world/types";
import type { DialogueTurn } from "./dialogue/controller";
import { challengeLine, ConversationController } from "./dialogue/controller";
import type { AppliedEffects } from "./dialogue/effects";
import { returnVisitFor, subjectLabel } from "./dialogue/askAbout";
import type { DialogueContext } from "./dialogue/prompt";
import { giveOptions } from "./dialogue/effects";
import { GreetingPrefetcher } from "./dialogue/speculation";
import { QUICK_GOODBYE } from "./dialogue/knowledge";
import type { DialogueHandlers } from "./dialogue/ui";
import { createDialogueBox, type DialogueBox } from "./dialogue/ui";
import { InputController } from "./input";
import { gamepadInput } from "./input/gamepad";
import { createSeededRandom, type Direction } from "./art";
import { getStoryVisualTheme } from "./art";
import { listInventory } from "./items/inventory";
import { createInventoryUI, type InventoryUI } from "./items/inventoryUi";
import { Renderer } from "./renderer";
import type { CharacterRenderState, DoorSign } from "./renderer";
import { inputMode, type InputMode } from "./input/mode";
import { mountEndingChoiceScreen, mountEndingScreen } from "./ui/ending";
import { mountPauseMenu } from "./ui/pause";
import { createObjectiveHud, type ObjectiveHud } from "./ui/objectiveHud";
import { createProgressToasts, shorten, type ProgressToasts } from "./ui/progressToast";
import { buildRecap, caseProgress } from "./story/progress";
import { caseRecordOf, progressLogOf } from "./story/state";
import { PROOF_SLOTS } from "./story/config";
import { proofChoices } from "./story/proof";
import { answerSummation, finaleHasStakes, judgeSummation, markAssisted, nextSummationIndex, summationComplete } from "./story/caseRecord";
import { findStatement, isStatementBroken, isStatementHeard, type EvidenceRef } from "./story/statements";
import { createStoryJournal, type JournalFact, type JournalStatement, type JournalQuestion, type JournalRequest, type StoryJournal } from "./ui/storyJournal";
import { createCaseOverlay, type CaseOverlay } from "./ui/caseOverlay";
import {
  answerDeduction,
  collectTwistReveals,
  deductionOptions,
  evidenceFor,
  openDeductions,
  ruledOutHerrings,
  summationOptions,
} from "./story/deduction";
import { createWorldMap, type WorldMap } from "./ui/worldMap";
import { getMovementSpeed, getPrepareRepliesInAdvance } from "./ui/preferences";
import type { EndingChoice, EndingScene } from "./story/ending";
import type { StorySession } from "./story/storySession";
import type { Beat, CastMember, SubjectRef } from "./story/types";
import type { SpriteSpec } from "./art/spriteSpec";
import type { SaveRepository } from "./save/repository";
import { SAVE_FORMAT_VERSION } from "./save/types";
import type { GameSave, PlayerSave } from "./save/types";
import {
  TILE_SIZE,
  entitySolidityIsSafe,
  findPath,
  isEntityInNarrowCorridor,
  isSolidAt,
  isWalkable,
  selectSolidEntityIds,
  tilesWithinRange,
  type Area,
  type AreaDoor,
  type AreaEntity,
  type GridPoint,
} from "./world";

const PLAYER_SPEED = 58;
const PLAYER_HALF_SIZE = 5;
const INTERACT_RANGE = TILE_SIZE * 1.5;
// A tap picks the nearest character, object, item or door within this reach of the finger, whichever is larger.
const TAP_REACH_WORLD = TILE_SIZE;
const TAP_REACH_CSS = 28;
// Walking that makes no headway for this long means something got in the way.
const WALK_STUCK_SECONDS = 0.4;
const WALK_MAX_REPLANS = 3;

type WalkTarget =
  | { readonly kind: "ground"; readonly tile: GridPoint }
  | { readonly kind: "entity"; readonly id: string }
  | { readonly kind: "door"; readonly id: string };

interface WalkPlan {
  readonly target: WalkTarget;
  readonly path: readonly GridPoint[];
  index: number;
  stuckFor: number;
  replans: number;
}

function exploreHint(mode: InputMode): string {
  if (mode === "touch") return "Tap the world to walk there, or drag on the left to steer.";
  if (mode === "gamepad") return "Explore with the left stick.";
  return "Explore with WASD or the arrow keys.";
}

function actionPrompt(mode: InputMode, text: string): string {
  if (mode === "touch") return `Tap A · ${text}`;
  if (mode === "gamepad") return `A · ${text}`;
  return `E · ${text}`;
}
const CHARACTER_STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const SPECULATION_DELAY_MS = 3000;

interface CharacterMotionState extends CharacterRenderState {
  homeX: number;
  homeY: number;
  target: GridPoint | null;
  nextStepAt: number;
  random: () => number;
}

export interface GamePersistence {
  repository: SaveRepository;
  slotId: string;
  timePlayedMs: number;
  player?: PlayerSave;
}

export class Game {
  private areaId: string;
  private readonly renderer: Renderer;
  private readonly input: InputController;
  private readonly stopGamepadListener: () => void;
  private readonly player: { x: number; y: number };
  private readonly locationLabel: HTMLElement | null;
  private readonly saveStatus: HTMLElement;
  private readonly interactionPrompt: HTMLElement;
  private readonly dialogueBox: DialogueBox;
  private readonly inventoryUI: InventoryUI;
  private readonly storyJournal: StoryJournal;
  private readonly caseOverlay: CaseOverlay;
  private frameCount = 0;
  private greetingTimer = 0;
  private caseOffered = false;
  private casePresented = false;
  private readonly objectiveHud: ObjectiveHud;
  private readonly toasts: ProgressToasts;
  private seenProgress: number;
  private readonly worldMap: WorldMap;
  private transitioning = false;
  private running = false;
  private ending = false;
  private transitionOpacity = 0;
  private previousFrame = 0;
  private readonly solidEntities = new Map<string, ReadonlySet<string>>();
  private readonly characterMotion = new Map<string, CharacterMotionState>();
  private animationFrame: number | null = null;
  private paused = false;
  private pauseOverlay: HTMLElement | null = null;
  private lastFootstepAt = 0;
  private ambienceAreaId: string | null = null;
  private speaker: { castId: string; body: BodyShape | undefined } | null = null;
  private playerDirection: Direction = "down";
  private playerMoving = false;
  private readonly startedAt = Date.now();
  private saveQueue: Promise<void> = Promise.resolve();
  private autosaveTimer: number | null = null;
  private camera: Position = { x: 0, y: 0 };
  private walk: WalkPlan | null = null;
  private conversation: ConversationController | null = null;
  private readonly greetings: GreetingPrefetcher;
  private get inDialogue(): boolean {
    return this.dialogueBox.isOpen || this.caseOverlay.isOpen;
  }

  constructor(
    private readonly canvas: HTMLCanvasElement,
    joystick: HTMLButtonElement,
    actionButton: HTMLButtonElement,
    private readonly mapButton: HTMLButtonElement,
    private readonly pauseButton: HTMLButtonElement,
    private readonly message: HTMLElement,
    private readonly story: StorySession,
    startArea: Area,
    private readonly appRoot: HTMLElement,
    private readonly onNewStory: () => void,
    private readonly onBackToTitle: () => void,
    private readonly onChangeAISettings: ((slotId: string) => Promise<void>) | undefined,
    private readonly persistence: GamePersistence,
    private readonly onLoadSave: (save: GameSave) => Promise<void>,
  ) {
    this.areaId = startArea.id;
    this.greetings = new GreetingPrefetcher(this.story.client);
    this.player = {
      x: persistence.player?.x ?? startArea.entry.x * TILE_SIZE + TILE_SIZE / 2,
      y: persistence.player?.y ?? startArea.entry.y * TILE_SIZE + TILE_SIZE / 2,
    };
    this.ensureAreaSolidity(startArea, [{
      x: Math.floor(this.player.x / TILE_SIZE),
      y: Math.floor(this.player.y / TILE_SIZE),
    }]);
    this.locationLabel = document.querySelector<HTMLElement>(".location-label");
    if (this.locationLabel) this.locationLabel.textContent = startArea.name.toLocaleUpperCase();
    this.message.textContent = this.story.getBrief(startArea.id)?.description ?? "";
    const saveStatus = document.querySelector<HTMLElement>("#save-status");
    if (!saveStatus) throw new Error("The game page is missing its save status.");
    this.saveStatus = saveStatus;
    const shell = canvas.parentElement ?? document.body;
    const visualTheme = getStoryVisualTheme(this.story.pack.identity.id);
    shell.style.setProperty("--story-frame", visualTheme.frame);
    shell.style.setProperty("--story-panel", visualTheme.panel);
    shell.style.setProperty("--story-accent", visualTheme.accent);
    shell.style.setProperty("--story-text", visualTheme.text);
    shell.style.setProperty("--story-muted", visualTheme.muted);
    shell.style.setProperty("--story-control", visualTheme.control);
    shell.style.setProperty("--story-active-control", visualTheme.activeControl);
    const interactionPrompt = shell.querySelector<HTMLElement>("#interaction-prompt");
    if (!interactionPrompt) throw new Error("The game page is missing its interaction prompt.");
    this.interactionPrompt = interactionPrompt;
    const hud = canvas.parentElement?.querySelector<HTMLElement>(".game-hud");
    if (!hud) throw new Error("The game page is missing its HUD.");
    this.objectiveHud = createObjectiveHud(hud, this.message);
    const toastBox = shell.querySelector<HTMLElement>("#progress-toasts");
    if (!toastBox) throw new Error("The game page is missing its progress toasts.");
    this.toasts = createProgressToasts(toastBox);
    this.seenProgress = progressLogOf(this.story.state).length;
    this.refreshObjective();
    const arrival = this.story.getBrief(startArea.id)?.description ?? "";
    this.objectiveHud.showArrival(persistence.player ? arrival : `${arrival} ${exploreHint(inputMode)}`.trim());
    if (this.locationLabel) this.locationLabel.onclick = () => this.objectiveHud.showArrival(this.story.getBrief(this.areaId)?.description ?? "");
    this.renderer = new Renderer(canvas, this.story.pack.identity.id);
    const floatingStick = shell.querySelector<HTMLElement>("#floating-stick");
    this.input = new InputController(joystick, actionButton, () => {
      this.interact();
    }, floatingStick ? { canvas, stick: floatingStick, onTap: this.handleTap } : undefined);
    this.dialogueBox = createDialogueBox(shell);
    this.inventoryUI = createInventoryUI(shell);
    this.storyJournal = createStoryJournal(shell, (id, answer, evidence) => this.answerQuestion(id, answer, evidence));
    this.caseOverlay = createCaseOverlay(shell, () => this.presentCaseFromButton());
    this.worldMap = createWorldMap(
      shell,
      () => this.story.getAreas(),
      () => this.areaId,
      {
        getCell: (areaId) => this.story.getMapCell(areaId),
        getExitLock: (areaId, doorId) => this.story.describeDoorLockBriefly(areaId, doorId),
        getPeopleMet: (areaId) => this.story.getPeopleMet(areaId),
        isLead: (areaId) => this.story.isLeadLocation(areaId),
      },
    );
    this.refreshInventory();
    this.refreshJournal();
    this.stopGamepadListener = gamepadInput.onFrame((frame) => {
      if (!this.running || frame.uiConsumed) return;
      if (frame.pressed.menu) {
        this.openPauseMenu();
        return;
      }
      if (this.worldMap.isOpen) return;
      if (frame.pressed.y) {
        this.storyJournal.close();
        this.inventoryUI.toggle();
        return;
      }
      if (frame.pressed.x && this.isInteractive) {
        this.inventoryUI.close();
        this.toggleJournal();
        return;
      }
      if (frame.pressed.a) this.interact();
    });
    window.addEventListener("keydown", this.handlePauseKeyDown);
    window.addEventListener("keydown", this.handleMapKeyDown);
    window.addEventListener("keydown", this.handleUtilityKeyDown);
    this.mapButton.addEventListener("click", this.handleMapButtonClick);
    this.pauseButton.addEventListener("click", this.openPauseMenu);
  }

  start(): void {
    this.running = true;
    void this.saveProgress();
    this.autosaveTimer = window.setInterval(() => { void this.saveProgress(); }, 60_000);
    document.addEventListener("visibilitychange", this.saveWhenHidden);
    window.addEventListener("pagehide", this.saveOnPageHide);
    this.animationFrame = requestAnimationFrame(this.frame);
    this.prefetchGreetings();
    // A save loaded at the finale (or halfway through presenting the case) offers the case again at once.
    void this.maybeFinish();
  }

  private readonly handlePauseKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !this.running) return;
    event.preventDefault();
    if (this.worldMap.isOpen) {
      this.worldMap.close();
      return;
    }
    if (this.storyJournal.isOpen) {
      this.storyJournal.close();
      return;
    }
    if (this.inventoryUI.isOpen) {
      this.inventoryUI.close();
      return;
    }
    if (this.paused) this.resume();
    else this.openPauseMenu();
  };

  private readonly handleUtilityKeyDown = (event: KeyboardEvent): void => {
    if (!this.isInteractive || event.repeat
      || (event.target instanceof HTMLElement
        && event.target.closest("input, textarea, select, button, a[href], [contenteditable='true']"))) return;
    const key = event.key.toLocaleLowerCase();
    if (key === "i") {
      event.preventDefault();
      this.storyJournal.close();
      this.inventoryUI.toggle();
    } else if (key === "j") {
      event.preventDefault();
      this.inventoryUI.close();
      this.toggleJournal();
    }
  };

  private readonly handleMapKeyDown = (event: KeyboardEvent): void => {
    if (event.key.toLowerCase() !== "m" || !this.running || this.paused
      || this.transitioning || this.inDialogue) return;
    if (!this.worldMap.isOpen && event.target instanceof HTMLElement
      && event.target.closest("input, textarea, select, button, a[href], [contenteditable='true']")) return;
    event.preventDefault();
    this.inventoryUI.close();
    this.storyJournal.close();
    this.toggleMap();
  };

  private readonly handleMapButtonClick = (): void => {
    if (!this.running || this.paused || this.transitioning || this.inDialogue) return;
    this.inventoryUI.close();
    this.storyJournal.close();
    this.toggleMap();
  };

  private readonly openPauseMenu = (): void => {
    if (this.paused || !this.running) return;
    this.worldMap.close();
    this.inventoryUI.close();
    this.storyJournal.close();
    this.paused = true;
    this.input.clear();
    const changeAISettings = this.onChangeAISettings;
    this.pauseOverlay = mountPauseMenu(this.appRoot, this.persistence.repository, this.persistence.slotId, {
      onResume: () => this.resume(),
      onSave: async () => {
        if (!await this.saveProgress()) throw new Error("The save could not be written. Check available storage.");
      },
      onChangeAISettings: changeAISettings ? async () => {
        if (!await this.saveProgress()) throw new Error("The save could not be written. Check available storage.");
        this.stop();
        await changeAISettings(this.persistence.slotId);
      } : undefined,
      onTitle: () => {
        this.stop();
        this.onBackToTitle();
      },
      onShowEnding: this.story.inEpilogue && this.story.state.endingReached ? () => {
        const ending = this.story.state.endingReached;
        if (!ending) return;
        void this.saveProgress();
        this.leaveWorldForEnding();
        this.showEndingScreen(ending);
      } : undefined,
      onImport: (save) => {
        this.stop();
        const status = document.createElement("section");
        status.className = "llm-screen";
        status.textContent = `Loading ${save.metadata.storyTitle}...`;
        this.appRoot.replaceChildren(status);
        void this.onLoadSave(save).catch((error: unknown) => {
          status.textContent = `Could not load imported save: ${error instanceof Error ? error.message : String(error)}`;
          const back = document.createElement("button");
          back.className = "llm-button";
          back.type = "button";
          back.textContent = "Back to title";
          back.addEventListener("click", this.onBackToTitle);
          status.append(back);
        });
      },
    });
  }

  private resume(): void {
    this.pauseOverlay?.remove();
    this.pauseOverlay = null;
    this.paused = false;
    this.input.clear();
    this.previousFrame = 0;
  }

  private stop(): void {
    this.running = false;
    soundEffects.setAmbience(null);
    soundEffects.setDucked(false);
    soundEffects.setPaused(false);
    this.conversation?.close();
    this.greetings.cancelAll();
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.stopAutosave();
    window.removeEventListener("keydown", this.handlePauseKeyDown);
    window.removeEventListener("keydown", this.handleMapKeyDown);
    window.removeEventListener("keydown", this.handleUtilityKeyDown);
    this.stopGamepadListener();
    this.mapButton.removeEventListener("click", this.handleMapButtonClick);
    this.pauseButton.removeEventListener("click", this.openPauseMenu);
    this.input.destroy();
    this.worldMap.remove();
    this.renderer.removeLabels();
    this.dialogueBox.element.remove();
    for (const element of this.inventoryUI.elements) element.remove();
    for (const element of this.storyJournal.elements) element.remove();
    this.caseOverlay.close();
    for (const element of this.caseOverlay.elements) element.remove();
    this.objectiveHud.destroy();
    this.toasts.clear();
    this.pauseOverlay?.remove();
    this.pauseOverlay = null;
  }

  private readonly saveWhenHidden = (): void => {
    if (document.hidden) void this.saveProgress();
  };

  private readonly saveOnPageHide = (): void => {
    void this.saveProgress();
  };

  private stopAutosave(): void {
    if (this.autosaveTimer !== null) window.clearInterval(this.autosaveTimer);
    window.clearTimeout(this.greetingTimer);
    this.autosaveTimer = null;
    document.removeEventListener("visibilitychange", this.saveWhenHidden);
    window.removeEventListener("pagehide", this.saveOnPageHide);
  }

  private saveProgress(): Promise<boolean> {
    const save = this.buildSave();
    let succeeded = false;
    this.setSaveStatus("saving", "Saving…");
    const write = (): Promise<void> => this.persistence.repository.save(save).then(() => {
      succeeded = true;
      this.setSaveStatus("saved", "Saved just now");
    });
    this.saveQueue = this.saveQueue.then(write, write).catch((error: unknown) => {
      this.setSaveStatus("failed", "Save failed");
      this.message.textContent = `Could not save your game: ${error instanceof Error ? error.message : String(error)}`;
    });
    return this.saveQueue.then(() => succeeded);
  }

  private buildSave(): GameSave {
    return {
      formatVersion: SAVE_FORMAT_VERSION,
      slotId: this.persistence.slotId,
      metadata: {
        storyTitle: this.story.pack.identity.title,
        length: this.story.view.length,
        timePlayedMs: this.persistence.timePlayedMs + Math.max(0, Date.now() - this.startedAt),
        lastSaved: new Date().toISOString(),
      },
      worldSeed: this.story.worldSeed,
      packId: this.story.pack.identity.id,
      packVersion: this.story.pack.identity.version,
      length: this.story.view.length,
      storyState: structuredClone(this.story.state),
      areaIds: this.story.getAreaIds(),
      player: { areaId: this.areaId, x: this.player.x, y: this.player.y },
    };
  }

  // The player's look: after the ending an epilogue may change it (Paddington has his hat back).
  private get playerSprite(): SpriteSpec | undefined {
    const epilogueSprite = this.story.inEpilogue ? this.story.epilogue?.player_sprite : undefined;
    return epilogueSprite ?? this.story.pack.identity.player?.sprite;
  }

  private saveStatusTimer = 0;

  // A tiny icon in the HUD bar; the words are only for screen readers.
  private setSaveStatus(state: "saving" | "saved" | "failed", text: string): void {
    window.clearTimeout(this.saveStatusTimer);
    this.saveStatus.dataset.state = state;
    this.saveStatus.textContent = text;
    if (state === "saved") {
      this.saveStatusTimer = window.setTimeout(() => {
        this.saveStatus.textContent = "";
        delete this.saveStatus.dataset.state;
      }, 2500);
    }
  }

  // Announces what the player just found. It reads the progress log, so every way of finding something is covered.
  private celebrateProgress(solvedTruthId?: string): void {
    const log = progressLogOf(this.story.state);
    if (log.length <= this.seenProgress) {
      this.seenProgress = log.length;
      return;
    }
    const fresh = log.slice(this.seenProgress);
    this.seenProgress = log.length;
    const pack = this.story.pack;
    let sound: "clue" | "item" | "truth" | "deduction" = "clue";
    const rank = { clue: 0, item: 1, truth: 2, deduction: 3 } as const;
    for (const entry of fresh) {
      let kind: "clue" | "item" | "truth" | "deduction" = entry.kind;
      let label = "";
      let text = "";
      if (entry.kind === "clue") {
        label = "New clue";
        text = pack.clues.find((clue) => clue.id === entry.id)?.text ?? "";
      } else if (entry.kind === "item") {
        const item = pack.items.find((candidate) => candidate.id === entry.id);
        label = item?.key ? "Key item" : "Item found";
        text = item?.name ?? entry.id;
      } else {
        const truth = pack.truths.find((candidate) => candidate.id === entry.id);
        kind = entry.id === solvedTruthId ? "deduction" : "truth";
        label = kind === "deduction" ? "Deduction solved" : "Truth confirmed";
        text = truth?.text ?? "";
      }
      if (rank[kind] > rank[sound]) sound = kind;
      this.toasts.show(kind, label, shorten(text));
    }
    soundEffects.play(sound);
    this.refreshObjective();
    this.refreshJournal();
  }

  private syncAudio(): void {
    soundEffects.setPaused(this.paused);
    soundEffects.setDucked(this.inDialogue);
    if (this.ambienceAreaId === this.areaId) return;
    this.ambienceAreaId = this.areaId;
    const area = this.story.getArea(this.areaId);
    const atmosphere = getStoryVisualTheme(this.story.pack.identity.id).atmosphere;
    soundEffects.setAmbience(ambienceRecipe(area.biome, this.story.getBrief(this.areaId)?.mood ?? area.mood, atmosphere));
  }

  private toggleJournal(): void {
    soundEffects.play("journal");
    this.storyJournal.toggle();
  }

  private toggleMap(): void {
    soundEffects.play("map");
    if (!this.worldMap.isOpen) this.story.recordMapLeads();
    this.worldMap.toggle();
  }

  private readonly frame = (timestamp: number): void => {
    if (!this.running) return;
    const delta = this.previousFrame === 0 ? 0 : Math.min((timestamp - this.previousFrame) / 1000, 0.05);
    this.previousFrame = timestamp;

    this.playerMoving = false;
    this.syncAudio();
    this.celebrateProgress();
    this.frameCount += 1;
    if (this.frameCount % 20 === 0) this.announceUnlocks();
    if (!this.isInteractive) this.walk = null;
    if (!this.paused) this.update(delta);
    const world = this.story.getArea(this.areaId);
    this.camera = followCamera(this.player, world, this.renderer.viewWidth, this.renderer.viewHeight);
    const nearbyEntity = this.isInteractive ? this.findNearbyEntity(world) : undefined;
    const nearbyDoor = this.isInteractive ? this.findNearbyDoor(world) : undefined;
    const interactionTarget = this.updateInteractionPrompt(nearbyEntity, nearbyDoor);
    const reducedMotion = document.documentElement.dataset.reducedMotion === "true";
    this.renderer.draw(
      world,
      this.player,
      this.camera,
      this.transitionOpacity,
      interactionTarget,
      this.playerDirection,
      this.playerMoving,
      {
        characters: this.characterRenderStates(world),
        talkMarkerIds: this.talkMarkerIds(world),
        checkedEntityIds: this.checkedClueEntityIds(world),
        animateCharacters: !reducedMotion && !this.paused && !this.transitioning && !this.inDialogue && !this.worldMap.isOpen,
        doorSigns: this.doorSigns(world),
        playerSprite: this.playerSprite,
      },
    );
    this.animationFrame = requestAnimationFrame(this.frame);
  };

  // Tells the player, in the story's words, when something they did opened a lock.
  // `before` is what the screen already says (a message, or a dialogue notice that is not shown yet); the
  // announcement follows it instead of replacing it. Only the unlock text goes to the journal's live region.
  private announceUnlocks(before = ""): void {
    if (this.transitioning) return;
    const unlocks = this.story.takeUnlocks();
    if (unlocks.length === 0) {
      if (before && this.dialogueBox.isOpen) this.dialogueBox.showNotice(before);
      return;
    }
    soundEffects.play("door");
    const unlockText = unlocks.map((unlock) => unlock.text).join(" ");
    const text = [before, unlockText].filter(Boolean).join(" ");
    if (this.dialogueBox.isOpen) this.dialogueBox.showNotice(text);
    else this.message.textContent = text;
    this.storyJournal.announce(unlockText);
    this.refreshJournal();
  }

  private doorSigns(area: Area): DoorSign[] {
    return area.doors.flatMap((door) => {
      const text = this.story.describeDoorDestination(area.id, door.id);
      return text === null ? [] : [{ x: door.x, y: door.y, text, locked: this.story.isDoorLocked(area.id, door.id) }];
    });
  }

  private update(delta: number): void {
    if (this.transitioning || this.inDialogue || this.worldMap.isOpen) return;
    const world = this.story.getArea(this.areaId);
    this.updateCharacterMotion(world, delta);
    const manual = this.input.getMovement();
    const steering = manual.x !== 0 || manual.y !== 0;
    if (steering) this.walk = null;
    const speed = PLAYER_SPEED * getMovementSpeed();
    const movement = this.walk ? this.walkMovement(world, speed * delta) : manual;
    const deltaX = movement.x * speed * delta;
    const deltaY = movement.y * speed * delta;
    const previousX = this.player.x;
    const previousY = this.player.y;

    if (!this.collides(this.player.x + deltaX, this.player.y)) {
      this.player.x += deltaX;
    }
    if (!this.collides(this.player.x, this.player.y + deltaY)) {
      this.player.y += deltaY;
    }

    if (movement.x !== 0 || movement.y !== 0) {
      this.playerMoving = this.player.x !== previousX || this.player.y !== previousY;
      if (this.playerMoving) {
        this.playerDirection = Math.abs(movement.x) > Math.abs(movement.y)
          ? movement.x < 0 ? "left" : "right"
          : movement.y < 0 ? "up" : "down";
      }
      if ((this.player.x !== previousX || this.player.y !== previousY)
        && performance.now() - this.lastFootstepAt >= 300) {
        soundEffects.playFootstep(this.groundUnderPlayer());
        this.lastFootstepAt = performance.now();
      }
      if (steering) this.objectiveHud.dismissArrival();
    }
    if (this.walk) this.watchWalkProgress(delta, movement.x !== 0 || movement.y !== 0 ? this.playerMoving : true);
  }

  // Steers along the planned route one tile centre at a time, so the player's box never has to cut a corner.
  private walkMovement(world: Area, stepLength: number): { x: number; y: number } {
    const plan = this.walk;
    if (!plan) return { x: 0, y: 0 };
    while (plan.index < plan.path.length) {
      const tile = plan.path[plan.index]!;
      const distance = Math.hypot(
        tile.x * TILE_SIZE + TILE_SIZE / 2 - this.player.x,
        tile.y * TILE_SIZE + TILE_SIZE / 2 - this.player.y,
      );
      if (distance > 0.5) break;
      plan.index += 1;
    }
    if (plan.index >= plan.path.length) {
      this.walk = null;
      this.arrive(world, plan.target, plan.replans);
      return { x: 0, y: 0 };
    }
    if (stepLength <= 0) return { x: 0, y: 0 };
    const next = plan.path[plan.index]!;
    const dx = next.x * TILE_SIZE + TILE_SIZE / 2 - this.player.x;
    const dy = next.y * TILE_SIZE + TILE_SIZE / 2 - this.player.y;
    const distance = Math.hypot(dx, dy);
    const share = Math.min(1, distance / stepLength);
    return { x: (dx / distance) * share, y: (dy / distance) * share };
  }

  private watchWalkProgress(delta: number, madeHeadway: boolean): void {
    const plan = this.walk;
    if (!plan) return;
    plan.stuckFor = madeHeadway ? 0 : plan.stuckFor + delta;
    if (plan.stuckFor < WALK_STUCK_SECONDS) return;
    this.walk = null;
    if (plan.replans >= WALK_MAX_REPLANS) {
      this.message.textContent = "Something is in the way.";
      return;
    }
    this.startWalk(plan.target, plan.replans + 1);
  }

  private groundUnderPlayer(): Tile | undefined {
    const area = this.story.getArea(this.areaId);
    return area.layers.ground[Math.floor(this.player.y / TILE_SIZE)]?.[Math.floor(this.player.x / TILE_SIZE)];
  }

  private ensureAreaSolidity(area: Area, protectedPoints: readonly GridPoint[] = []): ReadonlySet<string> {
    let solidIds = this.solidEntities.get(area.id);
    if (!solidIds) {
      solidIds = selectSolidEntityIds(area, protectedPoints);
      this.solidEntities.set(area.id, solidIds);
    }
    return solidIds;
  }

  private characterState(area: Area, entity: AreaEntity): CharacterMotionState {
    const key = `${area.id}\u0000${entity.id}`;
    let state = this.characterMotion.get(key);
    if (!state) {
      const random = createSeededRandom(`${this.story.worldSeed}:${area.id}:${entity.id}:motion`);
      state = {
        x: entity.x,
        y: entity.y,
        homeX: entity.x,
        homeY: entity.y,
        direction: "down",
        moving: false,
        target: null,
        nextStepAt: performance.now() + 1800 + random() * 4200,
        random,
      };
      this.characterMotion.set(key, state);
    }
    return state;
  }

  private entityPosition(area: Area, entity: AreaEntity): GridPoint {
    return entity.character ? this.characterState(area, entity) : { x: entity.x, y: entity.y };
  }

  private characterRenderStates(area: Area): Map<string, CharacterRenderState> {
    const states = new Map<string, CharacterRenderState>();
    for (const entity of area.entities ?? []) {
      if (entity.character) states.set(entity.id, this.characterState(area, entity));
    }
    return states;
  }

  // Objects whose clues have all been found; they read as done instead of pulsing.
  private checkedClueEntityIds(area: Area): Set<string> {
    const checked = new Set<string>();
    for (const entity of area.entities ?? []) {
      if (this.story.allCluesFound(entity)) checked.add(entity.id);
    }
    return checked;
  }

  private talkMarkerIds(area: Area): Set<string> {
    const markers = new Set<string>();
    if (this.story.inEpilogue) return markers;
    for (const entity of area.entities ?? []) {
      if (entity.kind !== "character" || !entity.packId) continue;
      const character = this.story.pack.cast.find((candidate) => candidate.id === entity.packId);
      if (!character) continue;
      if (this.story.getAvailableCharacterClues(entity.packId).length > 0
        || giveOptions(this.story.pack, this.story.state, character).length > 0) {
        markers.add(entity.id);
      }
    }
    return markers;
  }

  private runtimeEntityPositions(
    area: Area,
    movingEntityId?: string,
    destination?: GridPoint,
  ): Map<string, GridPoint> {
    const positions = new Map<string, GridPoint>();
    for (const entity of area.entities ?? []) {
      if (entity.id === movingEntityId && destination) {
        positions.set(entity.id, destination);
        continue;
      }
      const position = this.entityPosition(area, entity);
      positions.set(entity.id, { x: Math.floor(position.x), y: Math.floor(position.y) });
    }
    return positions;
  }

  private playerOccupiesTile(point: GridPoint): boolean {
    return Math.floor(this.player.x / TILE_SIZE) === point.x && Math.floor(this.player.y / TILE_SIZE) === point.y;
  }

  private nearDoor(area: Area, point: GridPoint): boolean {
    return area.doors.some((door) => Math.max(Math.abs(door.x - point.x), Math.abs(door.y - point.y)) <= 1);
  }

  private entityOccupiesTile(area: Area, point: GridPoint, exceptId: string): boolean {
    return (area.entities ?? []).some((entity) => {
      if (entity.id === exceptId) return false;
      const position = this.entityPosition(area, entity);
      if (Math.floor(position.x) === point.x && Math.floor(position.y) === point.y) return true;
      const target = entity.character ? this.characterState(area, entity).target : null;
      return target?.x === point.x && target.y === point.y;
    });
  }

  private updateCharacterMotion(area: Area, delta: number): void {
    const characters = (area.entities ?? []).filter((entity) => entity.character);
    const states = characters.map((entity) => ({ entity, state: this.characterState(area, entity) }));
    for (const { state } of states) {
      const dx = this.player.x - (state.x * TILE_SIZE + TILE_SIZE / 2);
      const dy = this.player.y - (state.y * TILE_SIZE + TILE_SIZE / 2);
      if (Math.hypot(dx, dy) <= TILE_SIZE * 3) {
        state.direction = Math.abs(dx) >= Math.abs(dy)
          ? dx < 0 ? "left" : "right"
          : dy < 0 ? "up" : "down";
      }
    }
    if (document.documentElement.dataset.reducedMotion === "true") return;

    const now = performance.now();
    const solidIds = this.ensureAreaSolidity(area);
    for (const { entity, state } of states) {
      if (state.target) {
        if (this.playerOccupiesTile(state.target) || this.entityOccupiesTile(area, state.target, entity.id)) {
          state.target = null;
          state.moving = false;
          state.nextStepAt = now + 1200 + state.random() * 1800;
          continue;
        }
        const dx = state.target.x - state.x;
        const dy = state.target.y - state.y;
        const distance = Math.hypot(dx, dy);
        const step = 2.8 * delta;
        if (distance <= step) {
          state.x = state.target.x;
          state.y = state.target.y;
          state.target = null;
          state.moving = false;
          state.nextStepAt = now + 2500 + state.random() * 4500;
        } else {
          state.x += (dx / distance) * step;
          state.y += (dy / distance) * step;
        }
        continue;
      }
      if (now < state.nextStepAt) continue;
      state.nextStepAt = now + 2500 + state.random() * 4500;

      const directions = [...CHARACTER_STEPS];
      for (let index = directions.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(state.random() * (index + 1));
        [directions[index], directions[swap]] = [directions[swap]!, directions[index]!];
      }
      for (const [dx, dy] of directions) {
        const point = { x: Math.round(state.x) + dx, y: Math.round(state.y) + dy };
        if (Math.hypot(point.x - state.homeX, point.y - state.homeY) > 2
          || !isWalkable(area, point.x, point.y)
          || isEntityInNarrowCorridor(area, point.x, point.y)
          || this.nearDoor(area, point)
          || this.playerOccupiesTile(point)
          || this.entityOccupiesTile(area, point, entity.id)) continue;
        const positions = this.runtimeEntityPositions(area, entity.id, point);
        if (!entitySolidityIsSafe(area, solidIds, positions)) continue;
        state.target = point;
        state.moving = true;
        break;
      }
    }
  }

  private interact(): void {
    if (!this.running || this.paused || this.transitioning || this.inDialogue || this.worldMap.isOpen) return;
    const world = this.story.getArea(this.areaId);
    const entity = this.findNearbyEntity(world);
    const distance = (point: GridPoint): number => Math.hypot(
      this.player.x - (point.x * TILE_SIZE + TILE_SIZE / 2),
      this.player.y - (point.y * TILE_SIZE + TILE_SIZE / 2),
    );
    const nearby = this.findNearbyDoor(world);
    if (entity && (!nearby || distance(this.entityPosition(world, entity)) < distance(nearby))) {
      this.examine(entity);
      this.refreshObjective();
    } else if (nearby) {
      this.enterDoorIfUnlocked(nearby);
    } else {
      this.message.textContent = "There is nothing to interact with nearby.";
    }
  }

  private get isInteractive(): boolean {
    return this.running && !this.paused && !this.transitioning && !this.inDialogue && !this.worldMap.isOpen;
  }

  private findNearbyEntity(world: Area): AreaEntity | undefined {
    const distance = (entity: AreaEntity): number => {
      const point = this.entityPosition(world, entity);
      return Math.hypot(
        this.player.x - (point.x * TILE_SIZE + TILE_SIZE / 2),
        this.player.y - (point.y * TILE_SIZE + TILE_SIZE / 2),
      );
    };
    return (world.entities ?? [])
      .filter((entity) => distance(entity) <= INTERACT_RANGE)
      .sort((a, b) => distance(a) - distance(b))[0];
  }

  private findNearbyDoor(world: Area): AreaDoor | undefined {
    const distance = (door: AreaDoor): number => Math.hypot(
      this.player.x - (door.x * TILE_SIZE + TILE_SIZE / 2),
      this.player.y - (door.y * TILE_SIZE + TILE_SIZE / 2),
    );
    return world.doors
      .filter((door) => distance(door) <= INTERACT_RANGE)
      .sort((a, b) => distance(a) - distance(b))[0];
  }

  private updateInteractionPrompt(entity?: AreaEntity, door?: AreaDoor): AreaEntity | undefined {
    const distance = (point: { x: number; y: number }): number => Math.hypot(
      this.player.x - (point.x * TILE_SIZE + TILE_SIZE / 2),
      this.player.y - (point.y * TILE_SIZE + TILE_SIZE / 2),
    );
    const useEntity = entity !== undefined && (!door || distance(entity) < distance(door));
    const action = entity?.kind === "character"
      ? `Talk to ${entity.name}`
      : entity?.kind === "key"
        ? `Pick up ${entity.name}`
        : entity ? `Examine ${entity.name}` : "";
    const lockMessage = door ? this.story.describeDoorLock(this.areaId, door.id) : null;
    const prompt = useEntity
      ? actionPrompt(inputMode, action)
      : door
        ? actionPrompt(inputMode, lockMessage ? `${door.label} (locked)` : `Enter ${door.label}`)
        : "";
    if (this.interactionPrompt.textContent !== prompt) this.interactionPrompt.textContent = prompt;
    this.interactionPrompt.hidden = !entity && !door;
    return useEntity ? entity : undefined;
  }

  // A tap on a character, clue, item or door walks there and then does what A would do; a tap on open ground just walks.
  private readonly handleTap = (clientX: number, clientY: number): void => {
    if (!this.isInteractive) return;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const scale = rect.width / this.renderer.viewWidth;
    const worldX = (clientX - rect.left) / scale + this.camera.x;
    const worldY = (clientY - rect.top) / scale + this.camera.y;
    const world = this.story.getArea(this.areaId);

    const reach = Math.max(TAP_REACH_WORLD, TAP_REACH_CSS / scale);
    const candidates: { target: WalkTarget; distance: number }[] = [];
    const consider = (target: WalkTarget, point: { x: number; y: number }): void => {
      const distance = Math.hypot(worldX - (point.x * TILE_SIZE + TILE_SIZE / 2), worldY - (point.y * TILE_SIZE + TILE_SIZE / 2));
      if (distance <= reach) candidates.push({ target, distance });
    };
    for (const entity of world.entities ?? []) consider({ kind: "entity", id: entity.id }, this.entityPosition(world, entity));
    for (const door of world.doors) consider({ kind: "door", id: door.id }, door);
    // The sort is stable, so a character standing in a doorway wins over the door.
    candidates.sort((a, b) => a.distance - b.distance);

    this.startWalk(candidates[0]?.target ?? { kind: "ground", tile: { x: Math.floor(worldX / TILE_SIZE), y: Math.floor(worldY / TILE_SIZE) } });
  };

  private targetPoint(world: Area, target: WalkTarget): { point: { x: number; y: number }; name: string } | null {
    if (target.kind === "ground") return { point: target.tile, name: "there" };
    if (target.kind === "entity") {
      const entity = (world.entities ?? []).find((candidate) => candidate.id === target.id);
      return entity ? { point: this.entityPosition(world, entity), name: entity.name } : null;
    }
    const door = world.doors.find((candidate) => candidate.id === target.id);
    return door ? { point: door, name: door.label } : null;
  }

  private startWalk(target: WalkTarget, replans = 0): void {
    this.walk = null;
    const world = this.story.getArea(this.areaId);
    const located = this.targetPoint(world, target);
    if (!located) return;
    const tile = { x: Math.floor(located.point.x), y: Math.floor(located.point.y) };
    const playerTile = {
      x: Math.floor(this.player.x / TILE_SIZE),
      y: Math.floor(this.player.y / TILE_SIZE),
    };
    if (target.kind !== "ground" && this.withinReach(located.point)) {
      this.arrive(world, target, replans);
      return;
    }
    if (target.kind === "ground" && tile.x === playerTile.x && tile.y === playerTile.y) return;

    const blocked = this.blockedTiles(world);
    const isPassable = (x: number, y: number): boolean => isWalkable(world, x, y) && !blocked.has(`${x},${y}`);
    const goals = (target.kind === "ground" ? [tile] : tilesWithinRange(tile, INTERACT_RANGE / TILE_SIZE, world.width, world.height))
      .filter((goal) => isPassable(goal.x, goal.y));
    const path = findPath({ width: world.width, height: world.height, start: playerTile, goals, isPassable });
    if (!path) {
      this.message.textContent = target.kind === "ground"
        ? "There is no way to walk there."
        : `There is no way to reach ${located.name}.`;
      return;
    }
    this.walk = { target, path, index: 0, stuckFor: 0, replans };
  }

  // Tiles the player's box cannot enter because a solid entity stands there or is stepping onto them.
  private blockedTiles(world: Area): Set<string> {
    const solidIds = this.ensureAreaSolidity(world);
    const blocked = new Set<string>();
    for (const entity of world.entities ?? []) {
      if (!solidIds.has(entity.id)) continue;
      const position = this.entityPosition(world, entity);
      blocked.add(`${Math.floor(position.x)},${Math.floor(position.y)}`);
      if (entity.character) {
        const target = this.characterState(world, entity).target;
        if (target) blocked.add(`${target.x},${target.y}`);
      }
    }
    return blocked;
  }

  private withinReach(point: { x: number; y: number }): boolean {
    return Math.hypot(
      this.player.x - (point.x * TILE_SIZE + TILE_SIZE / 2),
      this.player.y - (point.y * TILE_SIZE + TILE_SIZE / 2),
    ) <= INTERACT_RANGE;
  }

  // The same thing pressing A would do, aimed at what was tapped.
  private arrive(world: Area, target: WalkTarget, replans: number): void {
    if (target.kind === "ground") return;
    const located = this.targetPoint(world, target);
    if (!located) return;
    // A character may have wandered off while the player walked over.
    if (!this.withinReach(located.point)) {
      if (replans < WALK_MAX_REPLANS) this.startWalk(target, replans + 1);
      else this.message.textContent = `${located.name} moved out of reach.`;
      return;
    }
    if (target.kind === "door") {
      const door = world.doors.find((candidate) => candidate.id === target.id);
      if (door) this.enterDoorIfUnlocked(door);
      return;
    }
    const entity = (world.entities ?? []).find((candidate) => candidate.id === target.id);
    if (!entity) return;
    this.examine(entity);
    this.refreshObjective();
  }

  private enterDoorIfUnlocked(door: AreaDoor): void {
    const lockMessage = this.story.describeDoorLock(this.areaId, door.id);
    if (lockMessage) {
      soundEffects.play("locked");
      this.message.textContent = lockMessage;
      this.story.recordDoorLead(this.areaId, door.id);
      this.refreshJournal();
      return;
    }
    soundEffects.play("door");
    void this.travel(door);
  }

  private examine(entity: AreaEntity): void {
    const clue = this.story.examineClues(entity);
    if (clue !== null) {
      if (clue.kind === "glimpse") {
        this.message.textContent = clue.text;
        this.refreshJournal();
        void this.saveProgress();
        return;
      }
      this.message.textContent = `Clue: ${clue.text}`;
      this.celebrateProgress();
      this.announceUnlocks(this.message.textContent ?? "");
      this.refreshJournal();
      void this.saveProgress();
      void this.maybeFinish();
      return;
    }
    if (entity.kind === "character") {
      const character = this.story.getCharacter(entity);
      if (character) {
        void this.openConversation(entity.name, character, entity.character?.body);
      } else {
        // A minor LLM-invented extra has no pack core, so it has no dialogue, only flavor text.
        this.message.textContent = `${entity.name}: ${entity.description}`;
      }
      return;
    }
    if (entity.kind === "key") {
      const result = this.story.collectItem(entity);
      if (!result) {
        this.message.textContent = `${entity.name}. ${entity.description}`;
      } else if (result.given) {
        this.message.textContent = `You take the ${result.item.name}. ${entity.description}`;
        this.celebrateProgress();
        this.announceUnlocks(this.message.textContent ?? "");
        this.refreshInventory();
        void this.saveProgress();
        void this.maybeFinish();
      } else if (result.blocked) {
        this.message.textContent = this.story.describeItemBlock(result.item);
      } else {
        this.message.textContent = `You already have the ${result.item.name}.`;
      }
      return;
    }
    this.message.textContent = `${entity.name}. ${entity.description}`;
  }

  private refreshInventory(): void {
    this.inventoryUI.render(listInventory(this.story.pack, this.story.state), this.story.getArea(this.areaId).palette);
  }

  private refreshJournal(): void {
    const truths = this.story.pack.truths.filter((truth) => this.story.state.truthsFound.includes(truth.id));
    const facts: JournalFact[] = truths.map((truth) => ({
      importance: truth.importance === "core" ? "Core" : "Side",
      text: truth.text,
    }));
    const evidence = this.story.pack.clues
      .filter((clue) => this.story.state.cluesFound.includes(clue.id))
      .map((clue) => clue.text);
    const knownStatements = [
      ...this.story.pack.cast.flatMap((character) =>
        character.knowledge
          .filter((item) => this.story.state.knowledgeTold.includes(`${character.id}:${item.id}`))
          .map((item) => item.text),
      ),
      ...evidence,
      ...truths.map((truth) => truth.text),
    ];
    const containsPhrase = (text: string, phrase: string): boolean => {
      const normalizedText = ` ${text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `;
      const normalizedPhrase = ` ${phrase.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
      return normalizedPhrase.length > 2 && normalizedText.includes(normalizedPhrase);
    };
    const requests: JournalRequest[] = this.story.state.needsRecorded.flatMap((need) => {
      const character = this.story.pack.cast.find((candidate) => candidate.id === need.characterId);
      const item = this.story.pack.items.find((candidate) => candidate.id === need.itemId);
      if (!character || !item) return [];
      const source = item.found_at;
      if (!source) return [{ character: character.name, item: item.name }];
      const sourceName = source.type === "location"
        ? this.story.pack.locations.find((location) => location.id === source.id)?.name
        : this.story.pack.cast.find((candidate) => candidate.id === source.id)?.name;
      if (!sourceName || !knownStatements.some((statement) =>
        containsPhrase(statement, item.name) && containsPhrase(statement, sourceName))) {
        return [{ character: character.name, item: item.name }];
      }
      const sourceLocation = source.type === "character"
        ? this.story.pack.locations.find((location) => location.id === character.home_location)?.name
        : undefined;
      return [{
        character: character.name,
        item: item.name,
        location: source.type === "character" && sourceLocation
          ? `${sourceName} (${sourceLocation})`
          : sourceName,
      }];
    });
    const pack = this.story.pack;
    const questions: JournalQuestion[] = openDeductions(pack, this.story.state).flatMap((truth) => {
      const deduction = truth.deduction;
      if (!deduction) return [];
      const options = deductionOptions(truth);
      return [{
        id: truth.id,
        question: deduction.question,
        evidence: evidenceFor(pack, this.story.state, truth.id),
        options,
        proofSlots: deduction.proof ? PROOF_SLOTS : 0,
      }];
    });
    const statements: JournalStatement[] = pack.cast.flatMap((character) => (character.statements ?? [])
      .filter((statement) => isStatementHeard(this.story.state, statement.id) || isStatementBroken(this.story.state, statement.id))
      .map((statement) => ({
        character: character.name,
        topic: statement.topic,
        text: statement.text,
        ...(isStatementBroken(this.story.state, statement.id) ? { admission: statement.admission } : {}),
      })));
    const judged = caseRecordOf(this.story.state).deductions.flatMap((entry) => {
      const truth = pack.truths.find((candidate) => candidate.id === entry.truthId);
      return truth ? [{ text: truth.text, outcome: entry.outcome, hadProof: truth.deduction?.proof !== undefined }] : [];
    });
    const ruledOut = ruledOutHerrings(pack, this.story.state)
      .map((herring) => ({ description: herring.description, resolution: herring.resolution }));
    const progress = caseProgress(this.story.view, this.story.state);
    this.storyJournal.render(facts, evidence, requests, { questions, ruledOut, progress, statements, judged, evidenceChoices: proofChoices(pack, this.story.state), leads: this.story.leads() });
  }

  private refreshObjective(): void {
    const progress = caseProgress(this.story.view, this.story.state);
    const epilogue = this.story.inEpilogue ? this.story.epilogue : undefined;
    if (epilogue) {
      const beat: Beat = {
        id: "epilogue",
        title: this.story.state.endingReached?.endingTitle ?? "Epilogue",
        objective: epilogue.objective,
        locations: [epilogue.location],
        must_find: {},
      };
      this.objectiveHud.update(beat, false, { ...progress, leadNumber: this.story.view.beats.length, leadTotal: this.story.view.beats.length });
      return;
    }
    this.objectiveHud.update(this.story.currentBeat, this.story.currentBeatWaitsOnDeduction(), {
      ...progress,
      leadNumber: this.story.view.beats.indexOf(this.story.currentBeat) + 1,
      leadTotal: this.story.view.beats.length,
    });
  }

  // One answer per question. A wrong answer is final too: the game shows what really happened and confirms the
  // truth so the story can go on, and the case record keeps the mistake (or the missing proof) for the ending.
  private answerQuestion(truthId: string, answer: string, evidence: EvidenceRef[] = []): void {
    const result = answerDeduction(this.story.pack, this.story.state, truthId, answer, evidence);
    if (!result.accepted) return;
    const ruled = result.ruledOut.map((herring) => `Ruled out: ${herring.resolution}`).join(" ");
    const truth = result.truth?.text ?? "";
    const chosen = answer.replace(/[.!?]+$/, "");
    let note: string;
    if (result.outcome === "proven") {
      this.celebrateProgress(truthId);
      const hadProof = result.truth?.deduction?.proof !== undefined;
      note = `${hadProof ? "Proven" : "Confirmed"}: ${truth || "your deduction was right."}${ruled ? ` ${ruled}` : ""}`;
    } else if (result.outcome === "unproven") {
      this.celebrateProgress();
      note = `Right, but not proven: what you showed does not back it up well enough. What happened: ${truth}${ruled ? ` ${ruled}` : ""}`;
    } else if (result.outcome === "misread") {
      soundEffects.play("wrong");
      this.celebrateProgress();
      note = `Not quite: you chose "${chosen}". Your evidence pointed the right way, but not to that answer. What really happened: ${truth}${ruled ? ` ${ruled}` : ""}`;
    } else {
      soundEffects.play("wrong");
      this.celebrateProgress();
      note = `Not quite: you chose "${chosen}". What really happened: ${truth}${ruled ? ` ${ruled}` : ""}`;
    }
    this.refreshObjective();
    this.refreshJournal();
    this.storyJournal.announce(note);
    this.message.textContent = note;
    this.announceUnlocks(note);
    void this.saveProgress();
    void this.maybeFinish();
  }

  // Shows each newly triggered twist once as a card. Returns true while a card is on screen.
  private showTwistReveals(): boolean {
    if (this.caseOverlay.isOpen) return true;
    if (this.dialogueBox.isOpen) return false;
    const [twist] = collectTwistReveals(this.story.pack, this.story.view, this.story.state);
    if (!twist) return false;
    void this.saveProgress();
    this.caseOverlay.showReveal(twist.description, () => { void this.maybeFinish(); });
    return true;
  }

  private presentCaseFromButton(): void {
    if (!this.running || this.paused || this.transitioning || this.dialogueBox.isOpen || this.caseOverlay.isOpen) return;
    this.startPresentation();
  }

  private startPresentation(): void {
    const questions = this.story.getSummation(this.areaId);
    if (!questions) return;
    this.storyJournal.close();
    this.inventoryUI.close();
    const options = summationOptions(this.story.pack, this.story.state);
    const proof = { choices: proofChoices(this.story.pack, this.story.state), slots: PROOF_SLOTS };
    const done = (): void => {
      this.casePresented = true;
      this.caseOverlay.setCaseButtonVisible(false);
      void this.maybeFinish();
    };
    if (!finaleHasStakes()) {
      // Assisted: the old finale with free retries; nothing is recorded.
      markAssisted(this.story.state);
      this.caseOverlay.presentCase(questions, options, proof,
        (question, answerId, evidence) => judgeSummation(this.story.state, question, answerId, evidence), done);
      return;
    }
    const truthText = (id: string): string => this.story.pack.truths.find((truth) => truth.id === id)?.text ?? id;
    const shownLabel = (piece: EvidenceRef): string => (piece.type === "item"
      ? this.story.pack.items.find((item) => item.id === piece.id)?.name
      : this.story.pack.clues.find((clue) => clue.id === piece.id)?.text) ?? piece.id;
    this.caseOverlay.presentFinalCase(questions, options, proof, {
      startAt: nextSummationIndex(this.story.state, questions),
      onAnswer: (question, answerId, evidence) => {
        answerSummation(this.story.state, question, answerId, evidence);
        void this.saveProgress();
      },
      results: () => {
        const record = caseRecordOf(this.story.state);
        return questions.map((question) => {
          const entry = record.summation.find((candidate) => candidate.truthId === question.truthId);
          return {
            question: question.question,
            answer: entry ? truthText(entry.answerId) : "",
            correct: entry?.correct ?? false,
            correctAnswer: truthText(question.truthId),
            outcome: entry?.outcome ?? "wrong",
            shown: (entry?.evidence ?? []).map(shownLabel),
            hadProof: question.proof !== undefined,
          };
        });
      },
      onDone: done,
    });
  }

  private async openConversation(name: string, character: CastMember, body?: BodyShape): Promise<void> {
    this.speaker = { castId: character.id, body };
    const context = this.buildDialogueContext(character);
    this.conversation = new ConversationController(this.story.client, this.story.pack, this.story.state, character, context, {
      speculate: getPrepareRepliesInAdvance(),
      greetings: this.greetings,
    });
    const player = this.story.pack.identity.player;
    this.dialogueBox.open(name, this.dialogueHandlers(), { character: character.sprite, player: this.playerSprite, playerName: player?.name });
    this.dialogueBox.setBusy(true);
    await this.runDialogueTurn(this.conversation.start());
  }

  // Pre-generates greetings for the pack characters standing in the current area. The work starts a little
  // after arrival so model inference does not compete with the fade and first frames for the GPU.
  private prefetchGreetings(): void {
    this.greetings.cancelAll();
    window.clearTimeout(this.greetingTimer);
    if (!getPrepareRepliesInAdvance()) return;
    const areaId = this.areaId;
    this.greetingTimer = window.setTimeout(() => {
      if (!this.running || this.areaId !== areaId) return;
      for (const entity of this.story.getArea(areaId).entities ?? []) {
        if (entity.kind !== "character") continue;
        const character = this.story.getCharacter(entity);
        if (character) this.greetings.prefetch(character, this.buildDialogueContext(character));
      }
    }, SPECULATION_DELAY_MS);
  }

  private buildDialogueContext(character: CastMember): DialogueContext {
    const brief = this.story.getBrief(this.areaId);
    const area = this.story.getArea(this.areaId);
    const ending = this.story.inEpilogue ? this.story.state.endingReached : undefined;
    return {
      locationName: brief?.name ?? area.name,
      locationMood: brief?.mood ?? area.mood,
      returnVisit: returnVisitFor(this.story.pack, this.story.state, character),
      storySummary: ending ? `${ending.scene} ${ending.epilogue}` : this.story.state.summary,
      ...(ending ? { afterEnding: true } : {}),
      // After the ending every confirmed truth is common knowledge.
      knownFacts: (ending ? this.story.state.truthsFound : character.knows_truths)
        .filter((truthId) => this.story.state.truthsFound.includes(truthId))
        .flatMap((truthId) => {
          const truth = this.story.pack.truths.find((entry) => entry.id === truthId);
          return truth ? [{ id: truth.id, text: truth.text }] : [];
        }),
      knownTerms: [
        this.story.pack.identity.title,
        this.story.pack.identity.logline,
        this.story.currentBeat.title,
        this.story.currentBeat.objective ?? "",
        this.story.currentBeat.guidance ?? "",
        ...(brief?.objects.map((object) => `${object.name} ${object.description}`) ?? []),
        ...(brief?.characters.map((member) => member.name) ?? []),
        ...this.story.state.visitedAreas
          .map((locationId) => this.story.pack.locations.find((location) => location.id === locationId)?.name)
          .filter((name): name is string => name !== undefined),
      ],
      lockNotes: this.story.inEpilogue ? [] : this.story.lockNotesFor(character.id),
      inventory: listInventory(this.story.pack, this.story.state).map((item) => ({ id: item.id, name: item.name })),
      getInventory: () => listInventory(this.story.pack, this.story.state).map((item) => ({ id: item.id, name: item.name })),
    };
  }

  private async runDialogueTurn(pending: Promise<DialogueTurn>): Promise<void> {
    this.dialogueBox.setBusy(true);
    let turn: DialogueTurn;
    let errorNotice: string | undefined;
    try {
      turn = await pending;
    } catch (error) {
      turn = this.conversation?.fallbackTurn() ?? {
        line: "I'm sorry, I lost my words. Please try again.",
        mode: "free",
        choices: [],
        gives: [],
        effects: { resolvedGoal: null, givenItem: null, revealedClue: null },
        quality: "fallback",
        notice: "A reply could not be generated.",
      };
      errorNotice = `A reply could not be generated: ${error instanceof Error ? error.message : String(error)}`;
    }
    this.dialogueBox.setBusy(false);
    if (!soundEffects.voicesEnabled) soundEffects.play("dialogue");
    this.announceUnlocks(this.announceEffects(turn.effects));
    this.refreshObjective();
    this.refreshJournal();
    if (errorNotice || turn.notice) this.dialogueBox.showNotice(errorNotice ?? turn.notice ?? "");
    void this.saveProgress();
    this.dialogueBox.showTurn(turn, this.dialogueHandlers());
    void this.maybeFinish();
  }

  private dialogueHandlers(): DialogueHandlers {
    return {
      onReply: (text: string) => {
        if (!this.conversation) return;
        if (text === QUICK_GOODBYE) {
          this.leaveConversation();
          return;
        }
        this.dialogueBox.showPlayerReply(text);
        void this.runDialogueTurn(this.conversation.reply(text));
      },
      onGive: (itemId: string) => {
        if (!this.conversation) return;
        const name = this.story.pack.items.find((item) => item.id === itemId)?.name ?? itemId;
        this.dialogueBox.showPlayerReply(`Here, take the ${name}.`);
        void this.runDialogueTurn(this.conversation.give(itemId));
      },
      getAskOptions: () => this.conversation?.askOptions() ?? { people: [], items: [], evidence: [] },
      getChallengeOptions: () => this.conversation?.challengeOptions() ?? { statements: [], evidence: [], locked: true },
      onChallenge: (statementId: string, evidence: EvidenceRef) => {
        if (!this.conversation) return;
        const topic = findStatement(this.story.pack, statementId)?.statement.topic ?? "that";
        const label = subjectLabel(this.story.pack, evidence) ?? evidence.id;
        this.dialogueBox.showPlayerReply(challengeLine(topic, label));
        let pending: Promise<DialogueTurn>;
        try {
          pending = this.conversation.challenge(statementId, evidence);
        } catch (error) {
          pending = Promise.reject(error);
        }
        void this.runDialogueTurn(pending);
      },
      onAsk: (subject: SubjectRef) => {
        if (!this.conversation) return;
        const label = subjectLabel(this.story.pack, subject) ?? subject.id;
        if (this.story.inEpilogue) {
          // Nothing is left to uncover, so the character simply chats about it.
          const text = `What do you think about ${label} now?`;
          this.dialogueBox.showPlayerReply(text);
          void this.runDialogueTurn(this.conversation.reply(text));
          return;
        }
        this.dialogueBox.showPlayerReply(`What can you tell me about ${label}?`);
        void this.runDialogueTurn(this.conversation.askAbout(subject));
      },
      onLeave: () => this.leaveConversation(),
      onReveal: (from: number, to: number, text: string) => {
        const speaker = this.speaker;
        if (!speaker) return;
        // One blip per second letter; the voice engine spaces them so they follow the typewriter.
        let delay = 0;
        for (let index = from; index < to; index += 1) {
          if (index % 2 !== 0 || !/[\p{L}\p{N}]/u.test(text.charAt(index))) continue;
          soundEffects.voiceBlip(speaker.castId, speaker.body, index, delay);
          delay += 0.001;
        }
      },
    };
  }

  private leaveConversation(): void {
    this.conversation?.close();
    this.dialogueBox.close();
    this.conversation = null;
    void this.saveProgress();
    void this.maybeFinish();
  }

  // Plays the sounds and toasts for what the turn changed and returns the notice text (shown by announceUnlocks).
  private announceEffects(effects: AppliedEffects): string {
    const notices: string[] = [];
    if (effects.challenge) {
      const found = findStatement(this.story.pack, effects.challenge.statementId);
      if (effects.challenge.fits) {
        this.toasts.show("deduction", "Statement broken", shorten(found?.statement.admission ?? ""));
        if (!effects.revealedClue) soundEffects.play("deduction");
        notices.push(`${found?.character.name ?? "They"} admitted the truth.`);
      } else {
        soundEffects.play("wrong");
        notices.push("That did not fit. They will not hear another challenge in this conversation; come back later.");
      }
    }
    if (effects.heardStatement) {
      const found = findStatement(this.story.pack, effects.heardStatement);
      notices.push(`Noted in your journal: what ${found?.character.name ?? "they"} said about ${found?.statement.topic ?? "this"}.`);
    }
    if (effects.resolvedGoal) {
      soundEffects.play("goal");
      notices.push("Goal completed.");
    }
    if (effects.givenItem) {
      const item = this.story.pack.items.find((candidate) => candidate.id === effects.givenItem);
      notices.push(`Received: ${item?.name ?? effects.givenItem}.`);
      this.refreshInventory();
    }
    return notices.join(" ");
  }


  private async travel(door: AreaDoor): Promise<void> {
    if (!this.running) return;
    this.transitioning = true;
    try {
      for (let step = 1; step <= 6; step += 1) {
        this.transitionOpacity = step / 6;
        await pause(25);
      }
      this.greetings.cancelAll();
      const transition = this.story.enterDoor(this.areaId, door.id);
      this.areaId = transition.area.id;
      this.prefetchGreetings();
      this.player.x = transition.spawn.x * TILE_SIZE + TILE_SIZE / 2;
      this.player.y = transition.spawn.y * TILE_SIZE + TILE_SIZE / 2;
      this.ensureAreaSolidity(transition.area, [transition.spawn]);
      this.refreshObjective();
      const description = this.story.getBrief(transition.area.id)?.description;
      this.objectiveHud.showArrival(description ?? `You arrive at ${transition.area.name}.`);
      if (this.locationLabel) this.locationLabel.textContent = transition.area.name.toLocaleUpperCase();
      this.refreshInventory();
      await this.saveProgress();
      if (await this.maybeFinish()) return;
      for (let step = 5; step >= 0; step -= 1) {
        this.transitionOpacity = step / 6;
        await pause(25);
      }
    } catch (error) {
      this.message.textContent = error instanceof Error ? error.message : "The area transition failed.";
      this.transitionOpacity = 0;
    } finally {
      this.transitioning = false;
    }
  }

  private async maybeFinish(): Promise<boolean> {
    if (!this.running || this.ending) return this.ending;
    if (this.showTwistReveals()) return false;
    const choices = this.story.getEndingChoices(this.areaId);
    if (choices.length === 0) {
      this.caseOverlay.setCaseButtonVisible(false);
      return false;
    }
    const summation = this.story.getSummation(this.areaId);
    // A finale answered before a reload is not asked again.
    if (summation && finaleHasStakes() && summationComplete(this.story.state, summation)) this.casePresented = true;
    if (summation && !this.casePresented) {
      // An open conversation is never interrupted; the case is offered once the dialogue box closes.
      this.caseOverlay.setCaseButtonVisible(!this.dialogueBox.isOpen);
      if (!this.dialogueBox.isOpen && !this.caseOffered) {
        this.caseOffered = true;
        this.caseOverlay.offerCase(() => this.startPresentation());
      }
      return false;
    }
    this.leaveWorldForEnding();
    const leaveEnding = (): void => {
      this.stop();
      this.onBackToTitle();
    };
    const finish = async (choiceIds: string[]): Promise<void> => {
      const ending = await this.story.finishEnding(choiceIds, this.areaId);
      // With an epilogue the save now puts the player in its area, so loading it later returns there.
      const epilogue = this.story.enterEpilogue(ending);
      if (epilogue) {
        this.areaId = epilogue.area.id;
        this.player.x = epilogue.spawn.x * TILE_SIZE + TILE_SIZE / 2;
        this.player.y = epilogue.spawn.y * TILE_SIZE + TILE_SIZE / 2;
      }
      await this.saveProgress();
      soundEffects.play("ending");
      this.showEndingScreen(ending);
    };
    if (choices.some((choice) => choice.choices.length > 0)) {
      mountEndingChoiceScreen(this.appRoot, this.story.pack.identity.title, choices, finish, leaveEnding);
    } else {
      const automatic: EndingChoice = choices[0]!;
      try {
        await finish(automatic.choices);
      } catch (error) {
        mountEndingChoiceScreen(this.appRoot, this.story.pack.identity.title, choices, finish, leaveEnding);
        const note = document.createElement("p");
        note.className = "llm-screen-note";
        note.textContent = `The ending could not be completed: ${error instanceof Error ? error.message : String(error)}`;
        this.appRoot.querySelector(".ending-screen")?.append(note);
      }
    }
    return true;
  }

  // Stops play in the world while an ending screen is shown. The screen's buttons then stop the game for good.
  private leaveWorldForEnding(): void {
    this.ending = true;
    this.running = false;
    this.stopAutosave();
    this.conversation?.close();
    this.dialogueBox.close();
    this.conversation = null;
    this.greetings.cancelAll();
    this.pauseOverlay?.remove();
    this.pauseOverlay = null;
    this.paused = false;
    soundEffects.setAmbience(null);
    soundEffects.setDucked(false);
  }

  private showEndingScreen(ending: EndingScene): void {
    const epilogue = this.story.inEpilogue ? this.story.epilogue : undefined;
    mountEndingScreen(
      this.appRoot,
      this.story.pack.identity.title,
      ending,
      () => {
        this.stop();
        this.onNewStory();
      },
      () => {
        this.stop();
        this.onBackToTitle();
      },
      {
        ...buildRecap(this.story.pack, this.story.view, this.story.state, this.story.getRecapSummation()),
        timePlayedMs: this.persistence.timePlayedMs + Math.max(0, Date.now() - this.startedAt),
      },
      epilogue ? {
        label: epilogue.join_label,
        onJoin: async () => {
          // The epilogue is played as a loaded save, so it runs the same way now and after a reload.
          const save = this.buildSave();
          this.stop();
          await this.onLoadSave(save);
        },
      } : undefined,
    );
  }

  private collides(centerX: number, centerY: number): boolean {
    const world = this.story.getArea(this.areaId);
    const left = centerX - PLAYER_HALF_SIZE;
    const right = centerX + PLAYER_HALF_SIZE;
    const top = centerY - PLAYER_HALF_SIZE;
    const bottom = centerY + PLAYER_HALF_SIZE;

    const blockedByEntity = (pixelX: number, pixelY: number): boolean => {
      const x = Math.floor(pixelX / TILE_SIZE);
      const y = Math.floor(pixelY / TILE_SIZE);
      const solidIds = this.ensureAreaSolidity(world);
      return (world.entities ?? []).some((entity) => {
        if (!solidIds.has(entity.id)) return false;
        const point = this.entityPosition(world, entity);
        return Math.floor(point.x) === x && Math.floor(point.y) === y;
      });
    };
    return isSolidAt(world, left, top) || blockedByEntity(left, top)
      || isSolidAt(world, right, top) || blockedByEntity(right, top)
      || isSolidAt(world, left, bottom) || blockedByEntity(left, bottom)
      || isSolidAt(world, right, bottom) || blockedByEntity(right, bottom);
  }
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
