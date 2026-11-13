// The example pack ships with authored lock text. Tests that cover the derived fallback (src/story/locks.ts) use this
// to get a deep copy without any of it.
export function stripLockText<T>(pack: T): T {
  const copy = structuredClone(pack) as any;
  for (const location of copy.locations ?? []) {
    for (const door of location.doors ?? []) {
      if (!door.lock) continue;
      delete door.lock.reason;
      delete door.lock.lead;
      delete door.lock.unlock_text;
    }
  }
  for (const clue of copy.clues ?? []) {
    delete clue.locked_glimpse;
    delete clue.reveal_text;
  }
  for (const length of Object.values<any>(copy.lengths ?? {})) {
    for (const beat of length?.beats ?? []) {
      delete beat.gate_reason;
      delete beat.unlock_text;
    }
  }
  return copy as T;
}
