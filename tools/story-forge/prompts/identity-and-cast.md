# Pack part 1: identity, style guide, and cast

Convert the approved bible into the JSON members for
`identity`, `style_guide`, and `cast`, following the supplied
`schema/story-pack.schema.json` exactly. Return only these members as a JSON
fragment. Include every cast member of the story. Use stable ids and
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
- `statements` (optional, at most 3): things the character says that are false or
  leave out the important part, taken from the bible's statements table. Shape:
  `{ id, topic (max 3 words), ask, keywords (3+), text, requires?, broken_by: {
  items?, clues? }, admission, clue_id?, rebuff? }`. `text` is the cover story and
  `admission` what they say once the player challenges it with any one item or
  clue in `broken_by`; both are first-person spoken lines of at most 200
  characters in the character's `voice_notes`. `clue_id` is a clue this character
  tells (clue `where` or `alternatives`) that the admission reveals; then no
  knowledge item or reaction of the same character may give that clue, and
  `requires` must include the clue's requirements. Base each lie on the secret,
  motivations or relationships; people hide things out of embarrassment,
  loyalty, fear or kindness, and the admission should sound like relief. Keep at
  least one other route to every core truth, and make sure no knowledge item or
  reaction already admits what the statement hides. `rebuff` is the authored
  brush-off when the evidence does not fit (a deflection is used otherwise).
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

