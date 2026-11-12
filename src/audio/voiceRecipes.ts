// Pure recipes for character voices and footsteps. Same input always gives the same sound.
import { createSeededRandom } from "../art/random";
import type { BodyShape } from "../art/sprites";
import { Tile } from "../world/types";

export interface VoiceParams {
  readonly wave: OscillatorType;
  readonly baseHz: number;
  readonly rangeSemitones: number; // pitch wander between blips
  readonly blipSeconds: number;
  readonly letterSpacingSeconds: number; // minimum time between blips
  readonly glide: number; // end pitch as a ratio of start pitch
  readonly vibratoHz: number; // 0 = none
}

const BODY_VOICE: Record<BodyShape, { low: number; high: number; waves: readonly OscillatorType[]; speed: number }> = {
  tall: { low: 120, high: 190, waves: ["triangle", "sawtooth"], speed: 0.062 },
  round: { low: 190, high: 290, waves: ["triangle", "square"], speed: 0.055 },
  small: { low: 340, high: 520, waves: ["sine", "triangle"], speed: 0.045 },
  quadruped: { low: 150, high: 260, waves: ["sawtooth", "square"], speed: 0.07 },
  floaty: { low: 420, high: 640, waves: ["sine", "sine"], speed: 0.065 },
};

export function voiceFor(castId: string, body: BodyShape | undefined): VoiceParams {
  const shape = BODY_VOICE[body ?? "round"];
  const random = createSeededRandom(`voice:${castId}`);
  const baseHz = shape.low + random() * (shape.high - shape.low);
  const wave = shape.waves[Math.floor(random() * shape.waves.length)] ?? "triangle";
  const speed = shape.speed * (0.85 + random() * 0.3);
  return {
    wave,
    baseHz: Math.round(baseHz * 10) / 10,
    rangeSemitones: 2 + Math.floor(random() * 5),
    blipSeconds: Math.round((0.035 + random() * 0.02) * 1000) / 1000,
    letterSpacingSeconds: Math.round(speed * 1000) / 1000,
    glide: random() < 0.5 ? 0.92 : 1.08,
    vibratoHz: body === "floaty" ? 6 + Math.floor(random() * 3) : 0,
  };
}

// Pitch of the nth blip of a line: stable pseudo-melody in the voice's range.
export function voiceBlipHz(voice: VoiceParams, castId: string, index: number): number {
  const random = createSeededRandom(`blip:${castId}:${index % 16}`);
  const semitones = (random() * 2 - 1) * voice.rangeSemitones;
  return Math.round(voice.baseHz * 2 ** (semitones / 12) * 10) / 10;
}

export interface FootstepParams {
  readonly noiseHz: number; // bandpass centre of the noise burst
  readonly q: number;
  readonly toneHz: number; // 0 = no tonal thump
  readonly seconds: number;
  readonly gain: number;
}

export function footstepFor(ground: Tile | undefined): FootstepParams {
  switch (ground) {
    case Tile.Grass:
    case Tile.Flowers:
      return { noiseHz: 1800, q: 0.7, toneHz: 0, seconds: 0.07, gain: 0.7 };
    case Tile.Path:
      return { noiseHz: 900, q: 1.1, toneHz: 90, seconds: 0.06, gain: 0.8 };
    case Tile.Water:
      return { noiseHz: 700, q: 0.5, toneHz: 0, seconds: 0.14, gain: 0.8 };
    case Tile.Rug:
      return { noiseHz: 700, q: 0.6, toneHz: 0, seconds: 0.08, gain: 0.45 };
    case Tile.Floor:
    case Tile.Wall:
    case Tile.Counter:
    case Tile.Void:
      return { noiseHz: 2600, q: 2.2, toneHz: 150, seconds: 0.04, gain: 0.7 };
    case Tile.Bridge:
      return { noiseHz: 1300, q: 1.6, toneHz: 200, seconds: 0.05, gain: 0.8 };
    case Tile.Rock:
      return { noiseHz: 3000, q: 1.4, toneHz: 120, seconds: 0.045, gain: 0.65 };
    default:
      return { noiseHz: 1200, q: 1, toneHz: 115, seconds: 0.05, gain: 0.7 };
  }
}
