import { followCamera, type Position } from "./camera";
import { soundEffects } from "./audio/soundEffects";
import type { DialogueTurn } from "./dialogue/controller";
import { ConversationController } from "./dialogue/controller";
import type { AppliedEffects } from "./dialogue/effects";
import type { DialogueContext } from "./dialogue/prompt";
import { createDialogueBox, type DialogueBox } from "./dialogue/ui";
import { InputController } from "./input";
import { listInventory } from "./items/inventory";
import { createInventoryUI, type InventoryUI } from "./items/inventoryUi";
import { Renderer, VIEW_HEIGHT, VIEW_WIDTH } from "./renderer";
import { mountEndingChoiceScreen, mountEndingScreen } from "./ui/ending";
import { mountPauseMenu } from "./ui/pause";
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
  private readonly player: { x: number; y: number };
  private readonly locationLabel: HTMLElement | null;
  private readonly dialogueBox: DialogueBox;
  private readonly inventoryUI: InventoryUI;
  private transitioning = false;
  private running = false;
  private ending = false;
  private transitionOpacity = 0;
  private previousFrame = 0;
  private animationFrame: number | null = null;
  private paused = false;
  private pauseOverlay: HTMLElement | null = null;
  private lastFootstepAt = 0;
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
    private readonly pauseButton: HTMLButtonElement,
    private readonly message: HTMLElement,
    private readonly story: StorySession,
    startArea: Area,
    private readonly appRoot: HTMLElement,
    private readonly onNewStory: () => void,
    private readonly onBackToTitle: () => void,
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
    this.renderer = new Renderer(canvas);
    this.input = new InputController(joystick, actionButton, () => {
      this.interact();
    });
    const shell = canvas.parentElement ?? document.body;
    this.dialogueBox = createDialogueBox(shell);
    this.inventoryUI = createInventoryUI(shell);
    this.refreshInventory();
    canvas.addEventListener("pointerup", this.handleCanvasTap);
    window.addEventListener("keydown", this.handlePauseKeyDown);
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
    if (this.paused) this.resume();
    else this.openPauseMenu();
  };

  private readonly openPauseMenu = (): void => {
    if (this.paused || !this.running) return;
    this.paused = true;
    this.input.clear();
    this.pauseOverlay = mountPauseMenu(this.appRoot, this.persistence.repository, this.persistence.slotId, {
      onResume: () => this.resume(),
      onSave: async () => {
        if (!await this.saveProgress()) throw new Error("The save could not be written. Check available storage.");
      },
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
    this.pauseButton.removeEventListener("click", this.openPauseMenu);
    this.canvas.removeEventListener("pointerup", this.handleCanvasTap);
    this.input.destroy();
    this.dialogueBox.element.remove();
    for (const element of this.inventoryUI.elements) element.remove();
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
    const write = (): Promise<void> => this.persistence.repository.save(save).then(() => { succeeded = true; });
    this.saveQueue = this.saveQueue.then(write, write).catch((error: unknown) => {
      this.message.textContent = `Could not save your game: ${error instanceof Error ? error.message : String(error)}`;
    });
    return this.saveQueue.then(() => succeeded);
  }

  private readonly frame = (timestamp: number): void => {
    if (!this.running) return;
    const delta = this.previousFrame === 0 ? 0 : Math.min((timestamp - this.previousFrame) / 1000, 0.05);
    this.previousFrame = timestamp;

    if (!this.paused) this.update(delta);
    const world = this.story.getArea(this.areaId);
    this.camera = followCamera(this.player, world, VIEW_WIDTH, VIEW_HEIGHT);
    this.renderer.draw(world, this.player, this.camera, this.transitionOpacity);
    this.animationFrame = requestAnimationFrame(this.frame);
  };

  private update(delta: number): void {
    if (this.transitioning || this.inDialogue) return;
    const world = this.story.getArea(this.areaId);
    const movement = this.input.getMovement();
    const deltaX = movement.x * PLAYER_SPEED * delta;
    const deltaY = movement.y * PLAYER_SPEED * delta;
    const previousX = this.player.x;
    const previousY = this.player.y;

    if (!this.collides(this.player.x + deltaX, this.player.y)) {
      this.player.x += deltaX;
    }
    if (!this.collides(this.player.x, this.player.y + deltaY)) {
      this.player.y += deltaY;
    }

    if (movement.x !== 0 || movement.y !== 0) {
      if ((this.player.x !== previousX || this.player.y !== previousY)
        && performance.now() - this.lastFootstepAt >= 300) {
        soundEffects.play("footstep");
        this.lastFootstepAt = performance.now();
      }
      const door = world.doors.find((candidate) =>
        Math.floor(this.player.x / TILE_SIZE) === candidate.x
        && Math.floor(this.player.y / TILE_SIZE) === candidate.y);
      if (door) {
        this.enterDoorIfUnlocked(door);
        return;
      }
      this.message.textContent = "Explore with WASD, arrows, or the joystick.";
    }
  }

  private interact(): void {
    if (!this.running || this.paused || this.transitioning || this.inDialogue) return;
    const world = this.story.getArea(this.areaId);
    const distance = (point: { x: number; y: number }): number => {
      const dx = this.player.x - (point.x * TILE_SIZE + TILE_SIZE / 2);
      const dy = this.player.y - (point.y * TILE_SIZE + TILE_SIZE / 2);
      return Math.hypot(dx, dy);
    };
    const entity = (world.entities ?? [])
      .filter((candidate) => distance(candidate) <= INTERACT_RANGE)
      .sort((a, b) => distance(a) - distance(b))[0];
    const nearby = world.doors.find((door) => distance(door) <= INTERACT_RANGE);
    if (entity && (!nearby || distance(entity) < distance(nearby))) {
      this.examine(entity);
    } else if (nearby) {
      this.enterDoorIfUnlocked(nearby);
    } else {
      this.message.textContent = "There is nothing to interact with nearby.";
    }
  }

  // Tap a nearby character, object or door directly on the screen to interact with it.
  private readonly handleCanvasTap = (event: PointerEvent): void => {
    if (!this.running || this.paused || this.transitioning || this.inDialogue) return;
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
      return;
    }
    const door = world.doors.find(near);
    if (door) this.enterDoorIfUnlocked(door);
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
    const clue = this.story.examineClue(entity);
    if (clue !== null) {
      this.message.textContent = `Clue: ${clue}`;
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

  private async openConversation(name: string, character: CastMember): Promise<void> {
    const brief = this.story.getBrief(this.areaId);
    const area = this.story.getArea(this.areaId);
    const context: DialogueContext = {
      locationName: brief?.name ?? area.name,
      locationMood: brief?.mood ?? area.mood,
      storySummary: this.story.state.summary,
      inventory: listInventory(this.story.pack, this.story.state).map((item) => ({ id: item.id, name: item.name })),
      getAvailableClues: () => this.story.getAvailableCharacterClues(character.id),
    };
    this.conversation = new ConversationController(this.story.client, this.story.pack, this.story.state, character, context);
    this.dialogueBox.open(name);
    await this.runDialogueTurn(this.conversation.start());
  }

  private async runDialogueTurn(pending: Promise<DialogueTurn>): Promise<void> {
    this.dialogueBox.setBusy(true);
    let turn: DialogueTurn;
    try {
      turn = await pending;
    } catch {
      this.dialogueBox.setBusy(false);
      this.dialogueBox.showTurn({ line: "They seem lost in thought. Try again in a moment.", mode: "free", choices: [] }, this.dialogueHandlers());
      return;
    }
    this.dialogueBox.setBusy(false);
    soundEffects.play("dialogue");
    this.announceEffects(turn.effects);
    void this.saveProgress();
    this.dialogueBox.showTurn(turn, this.dialogueHandlers());
    void this.maybeFinish();
  }

  private dialogueHandlers(): { onReply: (text: string) => void; onLeave: () => void } {
    return {
      onReply: (text: string) => {
        if (this.conversation) void this.runDialogueTurn(this.conversation.reply(text));
      },
      onLeave: () => {
        this.dialogueBox.close();
        this.conversation = null;
        void this.saveProgress();
      },
    };
  }

  private announceEffects(effects: AppliedEffects): void {
    if (!effects.givenItem) return;
    soundEffects.play("item");
    const item = this.story.pack.items.find((candidate) => candidate.id === effects.givenItem);
    this.dialogueBox.showNotice(`You received: ${item?.name ?? effects.givenItem}.`);
    this.refreshInventory();
  }


  private async travel(door: AreaDoor): Promise<void> {
    if (!this.running) return;
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
      mountEndingChoiceScreen(this.appRoot, this.story.pack.identity.title, choices, finish);
    } else {
      const automatic: EndingChoice = choices[0]!;
      try {
        await finish(automatic.choices);
      } catch (error) {
        mountEndingChoiceScreen(this.appRoot, this.story.pack.identity.title, choices, finish);
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
