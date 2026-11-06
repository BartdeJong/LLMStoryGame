import { followCamera } from "./camera";
import { InputController } from "./input";
import { Renderer, VIEW_HEIGHT, VIEW_WIDTH } from "./renderer";
import {
  TILE_SIZE,
  WorldSession,
  generateArea,
  getPlaceholderBrief,
  isSolidAt,
  type AreaDoor,
} from "./world";

const PLAYER_SPEED = 58;
const PLAYER_HALF_SIZE = 5;

export class Game {
  private readonly session = new WorldSession(generateArea(2026, getPlaceholderBrief("meadow")));
  private areaId: string;
  private readonly renderer: Renderer;
  private readonly input: InputController;
  private readonly player: { x: number; y: number };
  private readonly locationLabel: HTMLElement | null;
  private transitioning = false;
  private transitionOpacity = 0;
  private previousFrame = 0;

  constructor(
    canvas: HTMLCanvasElement,
    joystick: HTMLButtonElement,
    actionButton: HTMLButtonElement,
    private readonly message: HTMLElement,
  ) {
    const area = this.session.getArea(this.session.initialAreaId);
    this.areaId = area.id;
    this.player = {
      x: area.entry.x * TILE_SIZE + TILE_SIZE / 2,
      y: area.entry.y * TILE_SIZE + TILE_SIZE / 2,
    };
    this.locationLabel = document.querySelector<HTMLElement>(".location-label");
    this.renderer = new Renderer(canvas);
    this.input = new InputController(joystick, actionButton, () => {
      this.useNearbyDoor();
    });
  }

  start(): void {
    requestAnimationFrame(this.frame);
  }

  private readonly frame = (timestamp: number): void => {
    const delta = this.previousFrame === 0 ? 0 : Math.min((timestamp - this.previousFrame) / 1000, 0.05);
    this.previousFrame = timestamp;

    this.update(delta);
    const world = this.session.getArea(this.areaId);
    const camera = followCamera(this.player, world, VIEW_WIDTH, VIEW_HEIGHT);
    this.renderer.draw(world, this.player, camera, this.transitionOpacity);
    requestAnimationFrame(this.frame);
  };

  private update(delta: number): void {
    if (this.transitioning) return;
    const world = this.session.getArea(this.areaId);
    const movement = this.input.getMovement();
    const deltaX = movement.x * PLAYER_SPEED * delta;
    const deltaY = movement.y * PLAYER_SPEED * delta;

    if (!this.collides(this.player.x + deltaX, this.player.y)) {
      this.player.x += deltaX;
    }
    if (!this.collides(this.player.x, this.player.y + deltaY)) {
      this.player.y += deltaY;
    }

    if (movement.x !== 0 || movement.y !== 0) {
      const door = world.doors.find((candidate) =>
        Math.floor(this.player.x / TILE_SIZE) === candidate.x
        && Math.floor(this.player.y / TILE_SIZE) === candidate.y);
      if (door) {
        void this.travel(door);
        return;
      }
      this.message.textContent = "Explore with WASD, arrows, or the joystick.";
    }
  }

  private useNearbyDoor(): void {
    if (this.transitioning) return;
    const world = this.session.getArea(this.areaId);
    const nearby = world.doors.find((door) => {
      const dx = this.player.x - (door.x * TILE_SIZE + TILE_SIZE / 2);
      const dy = this.player.y - (door.y * TILE_SIZE + TILE_SIZE / 2);
      return dx * dx + dy * dy <= (TILE_SIZE * 1.5) ** 2;
    });
    if (nearby) {
      void this.travel(nearby);
    } else {
      this.message.textContent = "There is nothing to interact with nearby.";
    }
  }

  private async travel(door: AreaDoor): Promise<void> {
    this.transitioning = true;
    try {
      for (let step = 1; step <= 6; step += 1) {
        this.transitionOpacity = step / 6;
        await pause(25);
      }
      const transition = this.session.enterDoor(this.areaId, door.id);
      this.areaId = transition.area.id;
      this.player.x = transition.spawn.x * TILE_SIZE + TILE_SIZE / 2;
      this.player.y = transition.spawn.y * TILE_SIZE + TILE_SIZE / 2;
      if (transition.generated) {
        this.message.textContent = `You arrive at ${transition.area.name}.`;
        await pause(180);
      } else {
        this.message.textContent = `Back at ${transition.area.name}.`;
      }
      if (this.locationLabel) this.locationLabel.textContent = transition.area.name.toLocaleUpperCase();
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

  private collides(centerX: number, centerY: number): boolean {
    const world = this.session.getArea(this.areaId);
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
