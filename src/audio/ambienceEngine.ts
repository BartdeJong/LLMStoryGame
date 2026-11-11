import type { AmbienceLayer, AmbienceRecipe, NoiseColor, NoiseLayer, OneShotLayer } from "./ambienceRecipes";

export const CROSSFADE_SECONDS = 1.5;
const NOISE_SECONDS = 4;
// Ambience sits well below the effects: recipe gains are relative to this.
const LAYER_LEVEL = 0.1;

interface Scene {
  readonly key: string;
  readonly gain: GainNode;
  readonly sources: (AudioScheduledSourceNode)[];
  readonly nodes: AudioNode[];
  readonly timers: Set<ReturnType<typeof setTimeout>>;
  stopped: boolean;
}

// Plays one ambience recipe at a time with noise buffers, filters and sparse one-shots.
// Noise buffers are built once; a scene's nodes are all released when it fades out.
export class AmbienceEngine {
  private readonly bus: GainNode;
  private readonly noiseBuffers = new Map<NoiseColor, AudioBuffer>();
  private scene: Scene | null = null;
  private recipe: AmbienceRecipe | null = null;
  private level = 0;
  private ducked = false;
  private active = true;

  constructor(private readonly context: AudioContext) {
    this.bus = context.createGain();
    this.bus.gain.value = 0;
    this.bus.connect(context.destination);
  }

  get currentKey(): string | null {
    return this.scene?.key ?? null;
  }

  setRecipe(recipe: AmbienceRecipe | null): void {
    this.recipe = recipe;
    this.refresh();
  }

  setLevel(level: number): void {
    this.level = Math.min(1, Math.max(0, level));
    this.refresh();
  }

  setDucked(ducked: boolean): void {
    this.ducked = ducked;
    this.refresh();
  }

  setActive(active: boolean): void {
    this.active = active;
    this.refresh();
  }

  dispose(): void {
    this.retire(this.scene, 0.05);
    this.scene = null;
    this.bus.disconnect();
  }

  private refresh(): void {
    const audible = this.active && this.level > 0 && this.recipe !== null && this.recipe.layers.length > 0;
    const now = this.context.currentTime;
    if (!audible || !this.recipe) {
      if (this.scene) {
        this.retire(this.scene, 0.25);
        this.scene = null;
      }
      return;
    }
    const target = this.level * (this.ducked ? 0.5 : 1);
    this.bus.gain.cancelScheduledValues(now);
    this.bus.gain.setTargetAtTime(target, now, 0.15);
    if (this.scene?.key === this.recipe.key) return;
    const previous = this.scene;
    this.scene = this.build(this.recipe);
    this.scene.gain.gain.setValueAtTime(0, now);
    this.scene.gain.gain.linearRampToValueAtTime(1, now + CROSSFADE_SECONDS);
    this.retire(previous, CROSSFADE_SECONDS);
  }

  // Fades a scene out, then stops and disconnects everything it created.
  private retire(scene: Scene | null, seconds: number): void {
    if (!scene || scene.stopped) return;
    scene.stopped = true;
    for (const timer of scene.timers) clearTimeout(timer);
    scene.timers.clear();
    const now = this.context.currentTime;
    scene.gain.gain.cancelScheduledValues(now);
    scene.gain.gain.setValueAtTime(scene.gain.gain.value, now);
    scene.gain.gain.linearRampToValueAtTime(0, now + seconds);
    const end = now + seconds + 0.05;
    for (const source of scene.sources) source.stop(end);
    setTimeout(() => {
      for (const node of scene.nodes) node.disconnect();
    }, (seconds + 0.2) * 1000);
  }

  private build(recipe: AmbienceRecipe): Scene {
    const gain = this.context.createGain();
    gain.connect(this.bus);
    const scene: Scene = { key: recipe.key, gain, sources: [], nodes: [gain], timers: new Set(), stopped: false };
    for (const layer of recipe.layers) this.addLayer(scene, layer);
    return scene;
  }

  private addLayer(scene: Scene, layer: AmbienceLayer): void {
    if (layer.kind === "noise") this.addNoise(scene, layer);
    else this.scheduleShot(scene, layer);
  }

  private addNoise(scene: Scene, layer: NoiseLayer): void {
    const source = this.context.createBufferSource();
    source.buffer = this.noise(layer.noise);
    source.loop = true;
    const filter = this.context.createBiquadFilter();
    filter.type = layer.filter;
    filter.frequency.value = layer.frequency;
    filter.Q.value = layer.q;
    const level = this.context.createGain();
    level.gain.value = layer.gain * LAYER_LEVEL * 3;
    source.connect(filter);
    filter.connect(level);
    level.connect(scene.gain);
    scene.sources.push(source);
    scene.nodes.push(source, filter, level);
    if (layer.sweep) {
      const lfo = this.context.createOscillator();
      lfo.frequency.value = layer.sweep.rate;
      const depth = this.context.createGain();
      depth.gain.value = layer.sweep.depth;
      lfo.connect(depth);
      depth.connect(filter.frequency);
      scene.sources.push(lfo);
      scene.nodes.push(lfo, depth);
      lfo.start();
    }
    source.start();
  }

  private scheduleShot(scene: Scene, layer: OneShotLayer): void {
    const wait = (layer.minGapSeconds + Math.random() * (layer.maxGapSeconds - layer.minGapSeconds)) * 1000;
    const timer = setTimeout(() => {
      scene.timers.delete(timer);
      if (scene.stopped) return;
      this.playShot(scene, layer);
      this.scheduleShot(scene, layer);
    }, wait);
    scene.timers.add(timer);
  }

  private tone(scene: Scene, type: OscillatorType, from: number, to: number, start: number, attack: number, length: number, peak: number): void {
    const osc = this.context.createOscillator();
    const env = this.context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, start);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, start + length);
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * LAYER_LEVEL), start + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, start + length);
    osc.connect(env);
    env.connect(scene.gain);
    osc.onended = () => {
      osc.disconnect();
      env.disconnect();
    };
    osc.start(start);
    osc.stop(start + length + 0.02);
  }

  private playShot(scene: Scene, layer: OneShotLayer): void {
    const now = this.context.currentTime;
    const pick = layer.minFrequency + Math.random() * (layer.maxFrequency - layer.minFrequency);
    switch (layer.shot) {
      case "chirp": {
        const count = 2 + Math.floor(Math.random() * 3);
        for (let index = 0; index < count; index += 1) {
          const at = now + index * 0.11;
          this.tone(scene, "sine", pick, pick * (index % 2 === 0 ? 1.25 : 0.85), at, 0.01, 0.07, layer.gain);
        }
        break;
      }
      case "drip":
        this.tone(scene, "sine", pick, pick * 0.55, now, 0.004, 0.12, layer.gain);
        break;
      case "bell":
        this.tone(scene, "sine", pick, pick, now, 0.02, 3, layer.gain);
        this.tone(scene, "sine", pick * 2.76, pick * 2.76, now, 0.02, 1.6, layer.gain * 0.4);
        break;
      case "tick":
        this.tone(scene, "square", pick, pick * 0.9, now, 0.002, 0.03, layer.gain);
        break;
      case "shimmer":
        this.tone(scene, "sine", pick, pick, now, 0.8, 2.4, layer.gain);
        this.tone(scene, "sine", pick * 1.5, pick * 1.5, now + 0.15, 0.8, 2.2, layer.gain * 0.5);
        break;
      case "crackle": {
        const source = this.context.createBufferSource();
        source.buffer = this.noise("white");
        const filter = this.context.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.value = pick;
        filter.Q.value = 1.2;
        const env = this.context.createGain();
        env.gain.setValueAtTime(layer.gain * LAYER_LEVEL * 2, now);
        env.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
        source.connect(filter);
        filter.connect(env);
        env.connect(scene.gain);
        source.onended = () => {
          source.disconnect();
          filter.disconnect();
          env.disconnect();
        };
        source.start(now, Math.random() * (NOISE_SECONDS - 0.1), 0.04);
        break;
      }
    }
  }

  // Shared with the effects: one buffer per colour, created on first use.
  noise(color: NoiseColor): AudioBuffer {
    let buffer = this.noiseBuffers.get(color);
    if (!buffer) {
      buffer = this.makeNoise(color);
      this.noiseBuffers.set(color, buffer);
    }
    return buffer;
  }

  private makeNoise(color: NoiseColor): AudioBuffer {
    const length = Math.floor(this.context.sampleRate * NOISE_SECONDS);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let index = 0; index < length; index += 1) {
      const white = Math.random() * 2 - 1;
      if (color === "white") {
        data[index] = white;
      } else if (color === "pink") {
        b0 = 0.99765 * b0 + white * 0.0990460;
        b1 = 0.96300 * b1 + white * 0.2965164;
        b2 = 0.57000 * b2 + white * 1.0526913;
        data[index] = (b0 + b1 + b2 + white * 0.1848) * 0.25;
      } else {
        last = (last + 0.02 * white) / 1.02;
        data[index] = last * 3.5;
      }
    }
    return buffer;
  }
}
