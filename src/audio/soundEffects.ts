import type { BodyShape } from "../art/sprites";
import type { Tile } from "../world/types";
import { AmbienceEngine } from "./ambienceEngine";
import type { AmbienceRecipe } from "./ambienceRecipes";
import { footstepFor, voiceBlipHz, voiceFor, type VoiceParams } from "./voiceRecipes";

export type SoundEffect =
  | "footstep" | "door" | "item" | "dialogue" | "ending" | "deduction"
  | "clue" | "goal" | "locked" | "journal" | "map" | "wrong";

const MUTED_KEY = "cozy-mystery.muted";
const VOLUME_KEY = "cozy-mystery.volume";
const AMBIENCE_KEY = "cozy-mystery.ambience-volume";
const VOICES_KEY = "cozy-mystery.character-voices";

const NOTES: Record<Exclude<SoundEffect, "footstep">, readonly [number, number, number][]> = {
  door: [[240, 0, 0.11], [180, 0.1, 0.15]],
  item: [[660, 0, 0.13], [880, 0.1, 0.18]],
  dialogue: [[520, 0, 0.055]],
  ending: [[523, 0, 0.2], [659, 0.18, 0.2], [784, 0.36, 0.34]],
  deduction: [[587, 0, 0.12], [740, 0.1, 0.12], [988, 0.2, 0.26]],
  clue: [[784, 0, 0.09], [1175, 0.08, 0.2]],
  goal: [[440, 0, 0.1], [554, 0.09, 0.1], [659, 0.18, 0.1], [880, 0.27, 0.3]],
  locked: [[150, 0, 0.07], [150, 0.1, 0.09]],
  journal: [[392, 0, 0.06], [523, 0.05, 0.09]],
  map: [[330, 0, 0.07], [247, 0.06, 0.1]],
  wrong: [[220, 0, 0.14], [185, 0.12, 0.22]],
};

export class SoundEffects {
  private context: AudioContext | null = null;
  private ambience: AmbienceEngine | null = null;
  private recipe: AmbienceRecipe | null = null;
  private mutedValue = localStorage.getItem(MUTED_KEY) === "true";
  private volumeValue = this.readVolume(VOLUME_KEY, 0.65);
  private ambienceValue = this.readVolume(AMBIENCE_KEY, 0.6);
  private voicesValue = localStorage.getItem(VOICES_KEY) !== "false";
  private ducked = false;
  private paused = false;
  private hidden = false;
  private nextVoiceAt = 0;
  private readonly voices = new Map<string, VoiceParams>();

  constructor() {
    if (typeof document !== "undefined") {
      this.hidden = document.hidden;
      document.addEventListener("visibilitychange", () => this.handleVisibility());
    }
  }

  get muted(): boolean {
    return this.mutedValue;
  }

  get volume(): number {
    return this.volumeValue;
  }

  get ambienceVolume(): number {
    return this.ambienceValue;
  }

  get voicesEnabled(): boolean {
    return this.voicesValue;
  }

  private readVolume(key: string, fallback: number): number {
    const saved = localStorage.getItem(key);
    if (saved === null) return fallback;
    const value = Number(saved);
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
  }

  private get audible(): boolean {
    return !this.mutedValue && this.volumeValue > 0 && this.context !== null && this.context.state === "running";
  }

  setMuted(muted: boolean): void {
    this.mutedValue = muted;
    localStorage.setItem(MUTED_KEY, String(muted));
    this.syncAmbience();
  }

  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) throw new Error("Sound volume must be a finite number.");
    this.volumeValue = Math.min(1, Math.max(0, volume));
    localStorage.setItem(VOLUME_KEY, String(this.volumeValue));
    this.syncAmbience();
  }

  setAmbienceVolume(volume: number): void {
    if (!Number.isFinite(volume)) throw new Error("Ambience volume must be a finite number.");
    this.ambienceValue = Math.min(1, Math.max(0, volume));
    localStorage.setItem(AMBIENCE_KEY, String(this.ambienceValue));
    this.syncAmbience();
  }

  setVoicesEnabled(enabled: boolean): void {
    this.voicesValue = enabled;
    localStorage.setItem(VOICES_KEY, String(enabled));
  }

  toggleMuted(): boolean {
    this.setMuted(!this.mutedValue);
    return this.mutedValue;
  }

  async unlock(): Promise<void> {
    this.context ??= new AudioContext();
    if (this.context.state !== "running") await this.context.resume();
    this.ambience ??= new AmbienceEngine(this.context);
    this.syncAmbience();
  }

  // Ambience follows the area; the recipe is kept until the first unlock gesture has happened.
  setAmbience(recipe: AmbienceRecipe | null): void {
    this.recipe = recipe;
    this.syncAmbience();
  }

  setDucked(ducked: boolean): void {
    if (this.ducked === ducked) return;
    this.ducked = ducked;
    this.ambience?.setDucked(ducked);
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.syncAmbience();
  }

  private handleVisibility(): void {
    this.hidden = document.hidden;
    if (!this.hidden && this.context && this.context.state !== "running") {
      void this.context.resume().then(() => this.syncAmbience()).catch(() => undefined);
    }
    this.syncAmbience();
  }

  private syncAmbience(): void {
    if (!this.ambience) return;
    const playing = this.audible && !this.paused && !this.hidden;
    this.ambience.setDucked(this.ducked);
    this.ambience.setLevel(playing ? this.volumeValue * this.ambienceValue : 0);
    this.ambience.setActive(playing);
    this.ambience.setRecipe(this.recipe);
  }

  play(effect: SoundEffect): void {
    if (effect === "footstep") {
      this.playFootstep(undefined);
      return;
    }
    if (!this.audible || !this.context) return;
    const now = this.context.currentTime;
    for (const [frequency, offset, duration] of NOTES[effect]) {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      const start = now + offset;
      oscillator.type = effect === "locked" ? "square" : "sine";
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime((effect === "locked" ? 0.06 : 0.12) * this.volumeValue, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain);
      gain.connect(this.context.destination);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
      oscillator.start(start);
      oscillator.stop(start + duration);
    }
  }

  // A short noise burst plus a faint thump, shaped by the ground tile under the player.
  playFootstep(ground: Tile | undefined): void {
    if (!this.audible || !this.context || !this.ambience) return;
    const step = footstepFor(ground);
    const now = this.context.currentTime;
    const source = this.context.createBufferSource();
    source.buffer = this.ambience.noise("white");
    const filter = this.context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = step.noiseHz;
    filter.Q.value = step.q;
    const gain = this.context.createGain();
    const peak = 0.14 * step.gain * this.volumeValue;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + step.seconds);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.context.destination);
    const nodes: AudioNode[] = [source, filter, gain];
    if (step.toneHz > 0) {
      const thump = this.context.createOscillator();
      thump.type = "triangle";
      thump.frequency.setValueAtTime(step.toneHz, now);
      thump.connect(gain);
      thump.start(now);
      thump.stop(now + step.seconds);
      nodes.push(thump);
    }
    source.onended = () => {
      for (const node of nodes) node.disconnect();
    };
    source.start(now, Math.random() * 3, step.seconds);
  }

  // One blip of a character's voice; `delay` lets a caller queue a short run ahead of time.
  voiceBlip(castId: string, body: BodyShape | undefined, index: number, delay = 0): void {
    if (!this.voicesValue || !this.audible || !this.context) return;
    const cacheKey = `${castId}|${body ?? ""}`;
    let voice = this.voices.get(cacheKey);
    if (!voice) {
      voice = voiceFor(castId, body);
      this.voices.set(cacheKey, voice);
    }
    const now = this.context.currentTime;
    const start = Math.max(now + delay, this.nextVoiceAt);
    if (start > now + delay + 0.7) return;
    this.nextVoiceAt = start + voice.letterSpacingSeconds * 0.9;
    const hz = voiceBlipHz(voice, castId, index);
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = voice.wave;
    oscillator.frequency.setValueAtTime(hz, start);
    oscillator.frequency.exponentialRampToValueAtTime(hz * voice.glide, start + voice.blipSeconds);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.07 * this.volumeValue, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + voice.blipSeconds);
    oscillator.connect(gain);
    gain.connect(this.context.destination);
    if (voice.vibratoHz > 0) {
      const vibrato = this.context.createOscillator();
      const depth = this.context.createGain();
      vibrato.frequency.value = voice.vibratoHz;
      depth.gain.value = hz * 0.03;
      vibrato.connect(depth);
      depth.connect(oscillator.frequency);
      vibrato.start(start);
      vibrato.stop(start + voice.blipSeconds + 0.02);
    }
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(start);
    oscillator.stop(start + voice.blipSeconds + 0.02);
  }
}

export const soundEffects = new SoundEffects();
