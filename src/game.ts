import { followCamera, type Position } from "./camera";
import { soundEffects } from "./audio/soundEffects";
import type { DialogueTurn } from "./dialogue/controller";
import { ConversationController } from "./dialogue/controller";
import type { AppliedEffects } from "./dialogue/effects";
import type { DialogueContext } from "./dialogue/prompt";
import { QUICK_GOODBYE } from "./dialogue/knowledge";
import type { DialogueHandlers } from "./dialogue/ui";
import { createDialogueBox, type DialogueBox } from "./dialogue/ui";
import { InputController } from "./input";
import { gamepadInput } from "./input/gamepad";
import type { Direction } from "./art";
import { getStoryVisualTheme } from "./art";
import { listInventory } from "./items/inventory";
import { createInventoryUI, type InventoryUI } from "./items/inventoryUi";
import { createExamineUI, type ExamineUI } from "./items/examineUi";
import { resolveVisualSpec } from "./art/glyphs";
import { Renderer, VIEW_HEIGHT, VIEW_WIDTH } from "./renderer";
import { mountEndingChoiceScreen, mountEndingScreen } from "./ui/ending";
import { mountPauseMenu } from "./ui/pause";
import { createObjectiveHud, type ObjectiveHud } from "./ui/objectiveHud";
import { createStoryJournal, type JournalFact, type JournalRequest, type StoryJournal } from "./ui/storyJournal";
import { createWorldMap, type WorldMap } from "./ui/worldMap";
import { getMovementSpeed } from "./ui/preferences";
import type { EndingChoice } from "./story/ending";
import type { StorySession } from "./story/storySession";
import type { CastMember } from "./story/types";
import type { SaveRepository } from "./save/repository";
import { SAVE_FORMAT_VERSION } from "./save/types";
import type { GameSave, PlayerSave } from "./save/types";
import {
  TILE_SIZE,
  isSolidAt,
  type Area,
  type AreaDoor,
  type AreaEntity,
} from "./world";

const PLAYER_SPEED = 58;
const PLAYER_HALF_SIZE = 5;
const INTERACT_RANGE = TILE_SIZE * 1.5;
const TAP_INTERACT_RANGE = TILE_SIZE * 2;
// The fog never lifts faster than this, so quick arrivals still feel like a transition.
const MIN_FOG_MS = 150;

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
  private readonly examineUI: ExamineUI;
  private readonly storyJournal: StoryJournal;
  private readonly objectiveHud: ObjectiveHud;
  private readonly worldMap: WorldMap;
  private transitioning = false;
  private running = false;
  private ending = false;
  private transitionOpacity = 0;
  private previousFrame = 0;
  private animationFrame: number | null = null;
  private paused = false;
  private pauseOverlay: HTMLElement | null = null;
  private lastFootstepAt = 0;
  private playerDirection: Direction = "down";
  private playerMoving = false;
  private readonly startedAt = Date.now();
  private saveQueue: Promise<void> = Promise.resolve();
  private autosaveTimer: number | null = null;
  private camera: Position = { x: 0, y: 0 };
  private conversation: ConversationController | null = null;
  private get inDialogue(): boolean {
    return this.dialogueBox.isOpen;
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
    this.player = {
      x: persistence.player?.x ?? startArea.entry.x * TILE_SIZE + TILE_SIZE / 2,
      y: persistence.player?.y ?? startArea.entry.y * TILE_SIZE + TILE_SIZE / 2,
    };
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
    this.objectiveHud = createObjectiveHud(hud);
    this.refreshObjective();
    this.renderer = new Renderer(canvas, this.story.pack.identity.id);
    this.input = new InputController(joystick, actionButton, () => {
      this.interact();
    });
    this.dialogueBox = createDialogueBox(shell);
    this.inventoryUI = createInventoryUI(shell);
    this.examineUI = createExamineUI(shell);
    this.storyJournal = createStoryJournal(shell);
    this.worldMap = createWorldMap(
      shell,
      () => this.story.getSavedAreas().map(({ area }) => area),
      () => this.areaId,
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
        this.storyJournal.toggle();
        return;
      }
      if (frame.pressed.a) this.interact();
    });
    canvas.addEventListener("pointerup", this.handleCanvasTap);
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
      this.storyJournal.toggle();
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
    this.worldMap.toggle();
  };

  private readonly handleMapButtonClick = (): void => {
    if (!this.running || this.paused || this.transitioning || this.inDialogue) return;
    this.inventoryUI.close();
    this.storyJournal.close();
    this.worldMap.toggle();
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
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.stopAutosave();
    window.removeEventListener("keydown", this.handlePauseKeyDown);
    window.removeEventListener("keydown", this.handleMapKeyDown);
    window.removeEventListener("keydown", this.handleUtilityKeyDown);
    this.stopGamepadListener();
    this.mapButton.removeEventListener("click", this.handleMapButtonClick);
    this.pauseButton.removeEventListener("click", this.openPauseMenu);
    this.canvas.removeEventListener("pointerup", this.handleCanvasTap);
    this.input.destroy();
    this.worldMap.remove();
    this.dialogueBox.element.remove();
    for (const element of this.inventoryUI.elements) element.remove();
    for (const element of this.storyJournal.elements) element.remove();
    this.objectiveHud.element.remove();
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
    this.autosaveTimer = null;
    document.removeEventListener("visibilitychange", this.saveWhenHidden);
    window.removeEventListener("pagehide", this.saveOnPageHide);
  }

  private saveProgress(): Promise<boolean> {
    const save: GameSave = {
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
      areas: structuredClone(this.story.getSavedAreas()),
      player: { areaId: this.areaId, x: this.player.x, y: this.player.y },
    };
    let succeeded = false;
    this.saveStatus.textContent = "Saving…";
    const write = (): Promise<void> => this.persistence.repository.save(save).then(() => {
      succeeded = true;
      this.saveStatus.textContent = "Saved just now";
    });
    this.saveQueue = this.saveQueue.then(write, write).catch((error: unknown) => {
      this.saveStatus.textContent = "Save failed";
      this.message.textContent = `Could not save your game: ${error instanceof Error ? error.message : String(error)}`;
    });
    return this.saveQueue.then(() => succeeded);
  }

  private readonly frame = (timestamp: number): void => {
    if (!this.running) return;
    const delta = this.previousFrame === 0 ? 0 : Math.min((timestamp - this.previousFrame) / 1000, 0.05);
    this.previousFrame = timestamp;

    this.playerMoving = false;
    if (!this.paused) this.update(delta);
    const world = this.story.getArea(this.areaId);
    this.camera = followCamera(this.player, world, VIEW_WIDTH, VIEW_HEIGHT);
    const nearbyEntity = this.isInteractive ? this.findNearbyEntity(world) : undefined;
    const nearbyDoor = this.isInteractive ? this.findNearbyDoor(world) : undefined;
    const interactionTarget = this.updateInteractionPrompt(nearbyEntity, nearbyDoor);
    this.renderer.draw(
      world,
      this.player,
      this.camera,
      this.transitionOpacity,
      interactionTarget,
      this.playerDirection,
      this.playerMoving,
    );
    this.animationFrame = requestAnimationFrame(this.frame);
  };

  private update(delta: number): void {
    if (this.transitioning || this.inDialogue || this.worldMap.isOpen) return;
    const movement = this.input.getMovement();
    const speed = PLAYER_SPEED * getMovementSpeed();
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
        soundEffects.play("footstep");
        this.lastFootstepAt = performance.now();
      }
      this.message.textContent = "Explore with WASD, arrows, or the joystick.";
    }
  }

  private interact(): void {
    if (!this.running || this.paused || this.transitioning || this.inDialogue || this.worldMap.isOpen) return;
    const world = this.story.getArea(this.areaId);
    const entity = this.findNearbyEntity(world);
    const distance = (point: { x: number; y: number }): number => Math.hypot(
      this.player.x - (point.x * TILE_SIZE + TILE_SIZE / 2),
      this.player.y - (point.y * TILE_SIZE + TILE_SIZE / 2),
    );
    const nearby = this.findNearbyDoor(world);
    if (entity && (!nearby || distance(entity) < distance(nearby))) {
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
    const distance = (entity: AreaEntity): number => Math.hypot(
      this.player.x - (entity.x * TILE_SIZE + TILE_SIZE / 2),
      this.player.y - (entity.y * TILE_SIZE + TILE_SIZE / 2),
    );
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
      ? `Action / E / A · ${action}`
      : door
        ? `Action / E / A · ${lockMessage ? `${door.label} (locked)` : `Enter ${door.label}`}`
        : "";
    if (this.interactionPrompt.textContent !== prompt) this.interactionPrompt.textContent = prompt;
    this.interactionPrompt.hidden = !entity && !door;
    return useEntity ? entity : undefined;
  }

  // Tap a nearby character, object or door directly on the screen to interact with it.
  private readonly handleCanvasTap = (event: PointerEvent): void => {
    if (!this.running || this.paused || this.transitioning || this.inDialogue || this.worldMap.isOpen) return;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const worldX = ((event.clientX - rect.left) * VIEW_WIDTH) / rect.width + this.camera.x;
    const worldY = ((event.clientY - rect.top) * VIEW_HEIGHT) / rect.height + this.camera.y;

    const world = this.story.getArea(this.areaId);
    const near = (point: { x: number; y: number }): boolean => {
      const centerX = point.x * TILE_SIZE + TILE_SIZE / 2;
      const centerY = point.y * TILE_SIZE + TILE_SIZE / 2;
      const tappedClose = Math.hypot(worldX - centerX, worldY - centerY) <= TILE_SIZE;
      const playerClose = Math.hypot(this.player.x - centerX, this.player.y - centerY) <= TAP_INTERACT_RANGE;
      return tappedClose && playerClose;
    };
    const entity = (world.entities ?? []).find(near);
    if (entity) {
      this.examine(entity);
      this.refreshObjective();
    }
  };

  private enterDoorIfUnlocked(door: AreaDoor): void {
    const lockMessage = this.story.describeDoorLock(this.areaId, door.id);
    if (lockMessage) {
      this.message.textContent = lockMessage;
      return;
    }
    soundEffects.play("door");
    void this.travel(door);
  }

  private examine(entity: AreaEntity): void {
    if (entity.kind === "character") {
      this.examineUI.hide();
    } else {
      const area = this.story.getArea(this.areaId);
      this.examineUI.show(
        entity.name,
        entity.description,
        entity.visual ?? resolveVisualSpec(entity.name, entity.description),
        area.palette,
        entity.icon,
        entity.visualInferred ?? !entity.visual,
      );
    }
    const clue = this.story.examineClue(entity);
    if (clue !== null) {
      this.message.textContent = `Clue: ${clue}`;
      this.refreshJournal();
      void this.saveProgress();
      void this.maybeFinish();
      return;
    }
    if (entity.kind === "character") {
      const character = this.story.getCharacter(entity);
      if (character) {
        void this.openConversation(entity.name, character);
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
        soundEffects.play("item");
        this.message.textContent = `You take the ${result.item.name}. ${entity.description}`;
        this.refreshInventory();
        void this.saveProgress();
        void this.maybeFinish();
      } else if (result.blocked) {
        this.message.textContent = "This may be useful a little later. No need to hurry.";
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
    this.storyJournal.render(facts, evidence, requests);
  }

  private refreshObjective(): void {
    this.objectiveHud.update(this.story.currentBeat);
  }

  private async openConversation(name: string, character: CastMember): Promise<void> {
    const brief = this.story.getBrief(this.areaId);
    const area = this.story.getArea(this.areaId);
    const context: DialogueContext = {
      locationName: brief?.name ?? area.name,
      locationMood: brief?.mood ?? area.mood,
      storySummary: this.story.state.summary,
      knownFacts: character.knows_truths
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
      inventory: listInventory(this.story.pack, this.story.state).map((item) => ({ id: item.id, name: item.name })),
      getInventory: () => listInventory(this.story.pack, this.story.state).map((item) => ({ id: item.id, name: item.name })),
    };
    this.conversation = new ConversationController(this.story.client, this.story.pack, this.story.state, character, context);
    this.dialogueBox.open(name, this.dialogueHandlers());
    this.dialogueBox.setBusy(true);
    await this.runDialogueTurn(this.conversation.start());
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
    soundEffects.play("dialogue");
    this.announceEffects(turn.effects);
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
      onLeave: () => this.leaveConversation(),
    };
  }

  private leaveConversation(): void {
    this.dialogueBox.close();
    this.conversation = null;
    void this.saveProgress();
  }

  private announceEffects(effects: AppliedEffects): void {
    const notices: string[] = [];
    if (effects.resolvedGoal) notices.push("Goal completed.");
    if (effects.givenItem) {
      soundEffects.play("item");
      const item = this.story.pack.items.find((candidate) => candidate.id === effects.givenItem);
      notices.push(`Received: ${item?.name ?? effects.givenItem}.`);
      this.refreshInventory();
    }
    if (notices.length > 0) this.dialogueBox.showNotice(notices.join(" "));
  }


  private async travel(door: AreaDoor): Promise<void> {
    if (!this.running) return;
    this.examineUI.hide();
    this.transitioning = true;
    try {
      for (let step = 1; step <= 6; step += 1) {
        this.transitionOpacity = step / 6;
        await pause(25);
      }
      // The fog stays up until the brief and map are ready.
      const [transition] = await Promise.all([this.story.enterDoor(this.areaId, door.id), pause(MIN_FOG_MS)]);
      this.areaId = transition.area.id;
      this.player.x = transition.spawn.x * TILE_SIZE + TILE_SIZE / 2;
      this.player.y = transition.spawn.y * TILE_SIZE + TILE_SIZE / 2;
      this.refreshObjective();
      const description = this.story.getBrief(transition.area.id)?.description;
      this.message.textContent = description ?? `You arrive at ${transition.area.name}.`;
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
    const choices = this.story.getEndingChoices(this.areaId);
    if (choices.length === 0) return false;
    this.ending = true;
    this.running = false;
    this.stopAutosave();
    this.dialogueBox.close();
    this.conversation = null;
    const leaveEnding = (): void => {
      this.stop();
      this.onBackToTitle();
    };
    const finish = async (choiceIds: string[]): Promise<void> => {
      const ending = await this.story.finishEnding(choiceIds, this.areaId);
      await this.saveProgress();
      soundEffects.play("ending");
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
      );
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

  private collides(centerX: number, centerY: number): boolean {
    const world = this.story.getArea(this.areaId);
    const left = centerX - PLAYER_HALF_SIZE;
    const right = centerX + PLAYER_HALF_SIZE;
    const top = centerY - PLAYER_HALF_SIZE;
    const bottom = centerY + PLAYER_HALF_SIZE;

    return isSolidAt(world, left, top)
      || isSolidAt(world, right, top)
      || isSolidAt(world, left, bottom)
      || isSolidAt(world, right, bottom);
  }
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
