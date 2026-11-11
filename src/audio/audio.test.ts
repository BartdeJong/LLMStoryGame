import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BODY_SHAPES } from "../art/sprites";
import type { StoryAtmosphere } from "../art/storyTheme";
import { AMBIENCE_BIOMES, MAX_AMBIENCE_LAYERS, ambienceRecipe } from "./ambienceRecipes";
import { footstepFor, voiceBlipHz, voiceFor } from "./voiceRecipes";
import { Tile } from "../world/types";

const ATMOSPHERES: StoryAtmosphere[] = ["fireflies", "tide-glow", "falling-ash", "motes"];

describe("ambience recipes", () => {
  it("are deterministic", () => {
    for (const biome of AMBIENCE_BIOMES) {
      expect(ambienceRecipe(biome, "warm and quiet", "motes")).toEqual(ambienceRecipe(biome, "warm and quiet", "motes"));
    }
  });

  it("cover every biome within the layer cap", () => {
    for (const biome of AMBIENCE_BIOMES) {
      for (const atmosphere of ATMOSPHERES) {
        const recipe = ambienceRecipe(biome, "calm", atmosphere);
        expect(recipe.layers.length).toBeGreaterThan(0);
        expect(recipe.layers.length).toBeLessThanOrEqual(MAX_AMBIENCE_LAYERS);
      }
    }
  });

  it("maps biomes and atmosphere to the intended layers", () => {
    const ids = (biome: Parameters<typeof ambienceRecipe>[0], mood = "calm", atmosphere: StoryAtmosphere = "motes") =>
      ambienceRecipe(biome, mood, atmosphere).layers.map((layer) => layer.id);
    expect(ids("shore")).toContain("waves");
    expect(ids("forest")).toEqual(expect.arrayContaining(["wind", "birds"]));
    expect(ids("meadow")).toEqual(expect.arrayContaining(["wind", "birds"]));
    expect(ids("cave")).toEqual(expect.arrayContaining(["rumble", "drips"]));
    expect(ids("building", "warm and quiet")).toContain("hearth");
    expect(ids("building", "cold")).toContain("clock");
    expect(ids("village")).toEqual(expect.arrayContaining(["wind", "bell"]));
    expect(ids("meadow", "calm", "falling-ash")).toContain("ash");
    expect(ids("meadow", "calm", "tide-glow")).toContain("shimmer");
  });

  it("makes quiet moods softer than lively ones", () => {
    const gain = (mood: string) => ambienceRecipe("forest", mood, "motes").layers[0]!.gain;
    expect(gain("still and hushed")).toBeLessThan(gain("bright and breezy"));
  });
});

describe("voice recipes", () => {
  it("are stable per cast id and differ between ids", () => {
    for (const body of BODY_SHAPES) {
      expect(voiceFor("cast_mira", body)).toEqual(voiceFor("cast_mira", body));
      expect(voiceBlipHz(voiceFor("cast_mira", body), "cast_mira", 3)).toBe(voiceBlipHz(voiceFor("cast_mira", body), "cast_mira", 3));
    }
    expect(voiceFor("cast_mira", "round")).not.toEqual(voiceFor("cast_hollis", "round"));
  });

  it("pitches tall bodies lower than small ones", () => {
    expect(voiceFor("a", "tall").baseHz).toBeLessThan(voiceFor("a", "small").baseHz);
  });

  it("varies footsteps by ground tile", () => {
    expect(footstepFor(Tile.Grass)).not.toEqual(footstepFor(Tile.Floor));
    expect(footstepFor(Tile.Water).seconds).toBeGreaterThan(footstepFor(Tile.Floor).seconds);
  });
});

function mockContext(state: AudioContextState = "running") {
  const created = { nodes: 0 };
  const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(), cancelScheduledValues: vi.fn(),
  });
  const node = () => {
    created.nodes += 1;
    return {
      connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(),
      gain: param(), frequency: param(), Q: param(), type: "", buffer: null, loop: false,
    };
  };
  return {
    created,
    state,
    currentTime: 0,
    sampleRate: 8000,
    destination: {},
    resume: vi.fn(async () => undefined),
    createGain: vi.fn(node),
    createOscillator: vi.fn(node),
    createBiquadFilter: vi.fn(node),
    createBufferSource: vi.fn(node),
    createBuffer: vi.fn((_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) })),
  };
}

describe("SoundEffects with a mocked AudioContext", () => {
  let context: ReturnType<typeof mockContext>;
  const store = new Map<string, string>();

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });
    context = mockContext();
    vi.stubGlobal("AudioContext", function AudioContextMock() { return context; });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function load() {
    const { SoundEffects } = await import("./soundEffects");
    return SoundEffects;
  }

  it("plays ambience, effects and voices once unlocked", async () => {
    const Sound = await load();
    const sound = new Sound();
    sound.setAmbience(ambienceRecipe("shore", "calm", "motes"));
    expect(context.created.nodes).toBe(0);
    await sound.unlock();
    expect(context.createBufferSource).toHaveBeenCalled();
    const before = context.created.nodes;
    sound.play("clue");
    sound.voiceBlip("cast_mira", "round", 0);
    expect(context.created.nodes).toBeGreaterThan(before);
  });

  it("schedules nothing when muted", async () => {
    store.set("cozy-mystery.muted", "true");
    const Sound = await load();
    const sound = new Sound();
    sound.setAmbience(ambienceRecipe("forest", "calm", "motes"));
    await sound.unlock();
    const baseline = context.created.nodes;
    sound.play("door");
    sound.playFootstep(Tile.Grass);
    sound.voiceBlip("cast_mira", "tall", 0);
    vi.advanceTimersByTime(60_000);
    expect(context.created.nodes).toBe(baseline);
    expect(context.createBufferSource).not.toHaveBeenCalled();
  });

  it("schedules nothing at zero volume", async () => {
    store.set("cozy-mystery.volume", "0");
    const Sound = await load();
    const sound = new Sound();
    sound.setAmbience(ambienceRecipe("cave", "calm", "motes"));
    await sound.unlock();
    const baseline = context.created.nodes;
    sound.play("item");
    sound.playFootstep(Tile.Path);
    sound.voiceBlip("cast_mira", "small", 0);
    vi.advanceTimersByTime(60_000);
    expect(context.created.nodes).toBe(baseline);
  });

  it("stops ambience when paused and releases it on area change", async () => {
    const Sound = await load();
    const sound = new Sound();
    await sound.unlock();
    sound.setAmbience(ambienceRecipe("forest", "calm", "motes"));
    const sources = context.createBufferSource.mock.results.map((result) => result.value as { stop: ReturnType<typeof vi.fn> });
    expect(sources.length).toBeGreaterThan(0);
    sound.setAmbience(ambienceRecipe("cave", "calm", "motes"));
    for (const source of sources) expect(source.stop).toHaveBeenCalled();
    const caveSources = context.createBufferSource.mock.results.slice(sources.length).map((result) => result.value as { stop: ReturnType<typeof vi.fn> });
    sound.setPaused(true);
    for (const source of caveSources) expect(source.stop).toHaveBeenCalled();
  });

  it("does not play voices when the toggle is off", async () => {
    const Sound = await load();
    const sound = new Sound();
    await sound.unlock();
    sound.setVoicesEnabled(false);
    const before = context.created.nodes;
    sound.voiceBlip("cast_mira", "round", 0);
    expect(context.created.nodes).toBe(before);
  });
});
