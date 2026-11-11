// Pure recipes: no AudioContext here, so they are deterministic and unit-testable.
import type { StoryAtmosphere } from "../art/storyTheme";
import type { Biome } from "../world/types";

export const MAX_AMBIENCE_LAYERS = 4;

export type NoiseColor = "white" | "pink" | "brown";
export type OneShotKind = "chirp" | "drip" | "bell" | "tick" | "crackle" | "shimmer";

export interface NoiseLayer {
  readonly kind: "noise";
  readonly id: string;
  readonly noise: NoiseColor;
  readonly filter: BiquadFilterType;
  readonly frequency: number;
  readonly q: number;
  readonly gain: number;
  // Slow modulation of the filter cutoff (waves, gusts). Rate in Hz, depth in Hz.
  readonly sweep?: { readonly rate: number; readonly depth: number };
}

export interface OneShotLayer {
  readonly kind: "oneshot";
  readonly id: string;
  readonly shot: OneShotKind;
  readonly minGapSeconds: number;
  readonly maxGapSeconds: number;
  readonly minFrequency: number;
  readonly maxFrequency: number;
  readonly gain: number;
}

export type AmbienceLayer = NoiseLayer | OneShotLayer;

export interface AmbienceRecipe {
  readonly key: string;
  readonly layers: readonly AmbienceLayer[];
}

export const AMBIENCE_BIOMES: readonly Biome[] = ["meadow", "forest", "shore", "cave", "building", "ruins", "village"];

const wind = (gain: number, frequency = 420): NoiseLayer => ({
  kind: "noise", id: "wind", noise: "pink", filter: "bandpass", frequency, q: 0.6, gain,
  sweep: { rate: 0.11, depth: frequency * 0.45 },
});

const chirps = (gain: number): OneShotLayer => ({
  kind: "oneshot", id: "birds", shot: "chirp", minGapSeconds: 3, maxGapSeconds: 9, minFrequency: 2200, maxFrequency: 3800, gain,
});

function biomeLayers(biome: Biome, mood: Moodiness): AmbienceLayer[] {
  switch (biome) {
    case "shore":
      return [{
        kind: "noise", id: "waves", noise: "brown", filter: "lowpass", frequency: 500, q: 0.4, gain: 0.9,
        sweep: { rate: 0.12, depth: 380 },
      }, wind(0.18, 600)];
    case "forest":
      return [wind(0.5, 360), chirps(0.7)];
    case "meadow":
      return [wind(0.45, 480), chirps(0.8)];
    case "cave":
      return [
        { kind: "noise", id: "rumble", noise: "brown", filter: "lowpass", frequency: 110, q: 0.7, gain: 0.8 },
        { kind: "oneshot", id: "drips", shot: "drip", minGapSeconds: 2, maxGapSeconds: 8, minFrequency: 700, maxFrequency: 1500, gain: 0.7 },
      ];
    case "building":
      return [
        { kind: "noise", id: "room", noise: "brown", filter: "lowpass", frequency: 160, q: 0.5, gain: 0.35 },
        mood.warm
          ? { kind: "oneshot", id: "hearth", shot: "crackle", minGapSeconds: 0.4, maxGapSeconds: 2.2, minFrequency: 1200, maxFrequency: 3200, gain: 0.7 }
          : { kind: "oneshot", id: "clock", shot: "tick", minGapSeconds: 1, maxGapSeconds: 1, minFrequency: 1800, maxFrequency: 1800, gain: 0.6 },
      ];
    case "ruins":
      return [wind(0.4, 300), { kind: "oneshot", id: "drips", shot: "drip", minGapSeconds: 4, maxGapSeconds: 12, minFrequency: 600, maxFrequency: 1200, gain: 0.5 }];
    case "village":
      return [
        wind(0.35, 520),
        { kind: "oneshot", id: "bell", shot: "bell", minGapSeconds: 14, maxGapSeconds: 30, minFrequency: 520, maxFrequency: 520, gain: 0.45 },
      ];
  }
}

function atmosphereLayer(atmosphere: StoryAtmosphere): AmbienceLayer | null {
  switch (atmosphere) {
    case "falling-ash":
      return { kind: "noise", id: "ash", noise: "white", filter: "highpass", frequency: 5200, q: 0.5, gain: 0.22 };
    case "tide-glow":
      return { kind: "oneshot", id: "shimmer", shot: "shimmer", minGapSeconds: 5, maxGapSeconds: 11, minFrequency: 1300, maxFrequency: 2400, gain: 0.45 };
    case "fireflies":
    case "motes":
      return null;
  }
}

interface Moodiness {
  readonly warm: boolean;
  readonly level: number; // overall loudness multiplier
  readonly windy: boolean;
}

const QUIET_WORDS = /\b(quiet|still|hushed|calm|peaceful|unhurried|soft|silent|misty)\b/;
const LOUD_WORDS = /\b(bright|breezy|windy|stormy|lively|busy|friendly|bustling)\b/;
const WARM_WORDS = /\b(warm|cozy|cosy|welcoming|friendly|snug)\b/;

export function readMood(mood: string): Moodiness {
  const text = mood.toLowerCase();
  const quiet = QUIET_WORDS.test(text);
  const loud = LOUD_WORDS.test(text);
  return {
    warm: WARM_WORDS.test(text),
    windy: /\b(breezy|windy|stormy)\b/.test(text),
    level: quiet && !loud ? 0.7 : loud && !quiet ? 1.2 : 1,
  };
}

export function ambienceRecipe(biome: Biome, mood: string, atmosphere: StoryAtmosphere): AmbienceRecipe {
  const moodiness = readMood(mood);
  const layers = biomeLayers(biome, moodiness).map((layer) =>
    layer.id === "wind" && moodiness.windy ? { ...layer, gain: layer.gain * 1.4 } : layer);
  const extra = atmosphereLayer(atmosphere);
  const all = extra ? [...layers, extra] : layers;
  const scaled = all.slice(0, MAX_AMBIENCE_LAYERS).map((layer) => ({ ...layer, gain: round(layer.gain * moodiness.level) }));
  return { key: `${biome}|${moodiness.warm ? "warm" : "plain"}|${moodiness.windy ? "windy" : "calm"}|${moodiness.level}|${atmosphere}`, layers: scaled };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
