export type SoundEffect = "footstep" | "door" | "item" | "dialogue" | "ending";

const MUTED_KEY = "cozy-mystery.muted";

export class SoundEffects {
  private context: AudioContext | null = null;
  private mutedValue = localStorage.getItem(MUTED_KEY) === "true";

  get muted(): boolean {
    return this.mutedValue;
  }

  setMuted(muted: boolean): void {
    this.mutedValue = muted;
    localStorage.setItem(MUTED_KEY, String(muted));
  }

  toggleMuted(): boolean {
    this.setMuted(!this.mutedValue);
    return this.mutedValue;
  }

  async unlock(): Promise<void> {
    this.context ??= new AudioContext();
    if (this.context.state !== "running") await this.context.resume();
  }

  play(effect: SoundEffect): void {
    if (this.mutedValue || !this.context || this.context.state !== "running") return;
    const now = this.context.currentTime;
    const notes: Record<SoundEffect, readonly [number, number, number][]> = {
      footstep: [[115, 0, 0.045]],
      door: [[240, 0, 0.11], [180, 0.1, 0.15]],
      item: [[660, 0, 0.13], [880, 0.1, 0.18]],
      dialogue: [[520, 0, 0.055]],
      ending: [[523, 0, 0.2], [659, 0.18, 0.2], [784, 0.36, 0.34]],
    };

    for (const [frequency, offset, duration] of notes[effect]) {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      const start = now + offset;
      oscillator.type = effect === "footstep" ? "triangle" : "sine";
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain);
      gain.connect(this.context.destination);
      oscillator.start(start);
      oscillator.stop(start + duration);
    }
  }
}

export const soundEffects = new SoundEffects();
