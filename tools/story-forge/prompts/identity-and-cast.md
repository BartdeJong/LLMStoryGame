# Pack part 1: identity, style guide, and cast

Convert the approved bible and length-cut decisions into the JSON members for
`identity`, `style_guide`, and `cast`, following the supplied
`schema/story-pack.schema.json` exactly. Return only these members as a JSON
fragment. Include every cast member used by any length. Use stable ids and
ensure all cross-references agree with the bible. Character example lines are
short author-written style samples, not dialogue history.

Schema version 2 requires these fields on every cast member (the validator
rejects the pack without them):
- `greetings`: at least 3 opening lines in the character's voice. First person,
  spoken words only, no scene description, no narration, never starting with
  the character's own name plus a verb, never "Welcome to <name>".
- `knowledge`: 5 to 8 items `{ id, topic (max 3 words), ask, text (max 140
  characters), keywords (at least 3), clue_id?, truth_id? }`. `ask` is what a
  player would naturally say ("What happened to the missing lantern?"), never a
  label like "Ask about the lantern". Every clue a character tells (clue `where`
  or `alternatives`) needs a knowledge item with that `clue_id`; code, not the
  model, reveals clues. Facts must not contradict truths.
- `goal_hints`: `unmet`, `in_progress` and `resolved`, each with at least 2
  short first-person lines about what the character needs or what happens next.
- `deflections`: at least 5 in-character lines for questions the character
  cannot or will not answer.
- `reactions` (optional): `{ id, about: { type: "cast" | "item" | "clue", id },
  text (max 140 characters), requires?, clue_id? }`. What the character says when
  the player picks "Ask about..." for that person, item or found clue. `requires`
  uses the same shape as a goal state's `requires` and hides the reaction until
  it holds. A `clue_id` must be a clue this character tells (clue `where` or
  `alternatives`); saying the reaction marks it found. Never put a secret in a
  reaction unless `requires` gates it. Without a reaction code falls back to a
  matching knowledge item, a relationship, a needed item, and finally a deflection.
Characters only talk and hand over items: do not invite physical actions.

Approved bible:
<paste the complete approved bible here>

Length-cut decisions:
<paste the relevant approved decisions here>
