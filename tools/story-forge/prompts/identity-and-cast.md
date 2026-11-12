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
Sprites. Every character, and the player, gets a layered pixel-sprite spec that
makes them recognisable at a glance. The cast step writes it; nothing is drawn
by guesswork later.
- `identity.player`: `{ name, species, description, sprite }`. Take the player's
  name and species from the bible and the opening text (a named hero such as
  Paddington Bear, "Spark" the apprentice, or a plain "Visitor"/"Newcomer"). The
  description is one sentence about how the player looks.
- `cast[].sprite` (replaces the old free-text `sprite_recipe`):
  `{ species, height, girth, skin, accent?, hair?, outfit?, headwear?, accessories? }`
  - `species`: human, bear, dog, cat, fox, mouse, rabbit, owl, badger, hedgehog,
    otter, frog, sheep, mole, tortoise, magpie, crow, wren, heron, moth.
  - `height`: tiny (child) | short | average | tall. `girth`: slim | average | stout.
  - Every colour is a `#rrggbb` hex. `skin` is skin, fur or feather colour;
    `accent` is the muzzle, belly, face disc, shell or wing colour.
  - `hair`: `{ style, color }`, style one of none, short, messy, long, bob, bun,
    ponytail, curly, balding, pigtails, mop.
  - `outfit`: `{ style, color, trim?, legs? }`, style one of none, shirt, jumper,
    striped, dress, coat, duffle-coat, suit, waistcoat, uniform, cape, overalls,
    cardigan, robe, smock. `trim` is collar, buttons, hem or stripes.
  - `headwear`: `{ style, color, trim? }`, style one of none, deerstalker, bowler,
    top-hat, flat-cap, bonnet, headscarf, bush-hat, police-helmet, chef-hat,
    captain-cap, peaked-cap, beret, woolly-hat, straw-hat, hood, veil-hat.
  - `accessories` (at most 4, at most one carried in a hand): glasses, monocle,
    moustache, beard, brows, pipe, freckles, scarf, bowtie, apron, shawl, locket,
    nametag, belt, satchel, and carried: cane, umbrella, spoon, broom, notebook,
    basket, lantern, suitcase, orange, book, spyglass, medical-bag, flower, ball.
    Each is `{ kind, color? }`.
  - Show who they are: the signature clothes, hat and prop from the bible
    (Paddington: blue duffle-coat, red bush-hat, suitcase). Never reuse a look:
    any two sprites in a story must differ in at least 3 attributes (species,
    height, girth, a clearly different colour, hair style, outfit, headwear or
    accessories). Check the result with `?debug=art&section=cast`.
Characters only talk and hand over items: do not invite physical actions.

Approved bible:
<paste the complete approved bible here>

Length-cut decisions:
<paste the relevant approved decisions here>
