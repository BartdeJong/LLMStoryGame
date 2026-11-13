# Validation-fix prompt

Make the smallest edits to the supplied story pack that fix the validator errors
below. Preserve the approved bible, tone, and all unrelated pack content. Do not
weaken the schema or validator, lower complexity thresholds, remove story
content merely to silence an error, or rewrite the pack. Explain each targeted
change and return the corrected JSON (or a precise patch if requested).

Pack:
<paste the current complete pack here>

Exact output from `npm run validate-stories`:
<paste the complete relevant validator output here>

Warnings about locks that explain themselves (fix them the same way):
- `LOCK_NO_REASON`: a door lock or object-anchored gated clue has no authored
  text and the game cannot trace who or what opens it. Add the lock's `reason`
  or the clue's `locked_glimpse`.
- `BEAT_GATE_NO_REASON`: a beat after the first has no `gate_reason`. Add one
  (and an `unlock_text`) saying why its places are shut for now.
- `LOCK_NO_LEAD`: nobody in the story mentions what opens a door. Add the lock's
  `lead`, or have the character who holds the key mention it in their knowledge
  or goal hints.
