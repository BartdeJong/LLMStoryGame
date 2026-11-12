# Story Forge

Story Forge creates one reviewed JSON story pack at a time. Work in a separate
Copilot chat for each agent-written step to keep context and output focused.
The user owns the brief and must approve the story bible before pack generation.
Do not change the schema to make a pack pass; fix the pack instead.

## Files and commands

- Pack schema: `schema/story-pack.schema.json`
- Example pack copied from the M4.5 fixture: `examples/example-pack.json`
- Reviewed game packs: `../../public/stories/<story-id>.json`
- Story index: `../../public/stories/index.json`
- Brief and bible folders: `stories/briefs/` and `stories/bibles/`
- Validator: from the repository root, run `npm run validate-stories`
- Visual catalog and checks: run `npm run icon-catalog`, `npm run icon-lint`,
  `npm run visual-report -- <story-id>`, and `npm run list-visual-requests`.
  `validate-stories` also regenerates `icon-catalog.md`.
- Visual review pages: open `?debug=icons` or
  `?debug=story-visuals&story=<story-id>`.
- Read-through: from the repository root, run
  `npm run story-readthrough -- <story-id> <short|medium|long>`

Use a lowercase, hyphen-separated story id for filenames. The read-through
command loads `public/stories/<story-id>.json`, validates it, and uses the
validator's solver. It reports locations in solved order, discovered clues,
met characters, items required by solved actions, revealed truths, and reached
endings. The solver does not consume items. A requested length must exist in the
pack; the example currently has only `short`.

## Eight-step workflow

1. **Brief.** Fill in `prompts/brief.md` with a few lines about theme, setting,
   tone, desired twists, and things to avoid. Save it as
   `stories/briefs/<story-id>.md`. Keep this as user-authored input.
2. **Story bible.** In a new chat, give the agent the brief and
   `prompts/bible.md`. Ask it to write `stories/bibles/<story-id>.md` for the
   Long version first. The bible must cover the premise and mystery solution,
   dependent truths, cast and their goals/secrets, locations, twists and red
   herrings, and ending outlines.
3. **User review.** Read the whole bible. Request edits or approve it yourself.
   Do not generate length cuts or a pack until it is approved.
4. **Length cut.** In a new chat, provide the approved bible and
   `prompts/length-cut.md`. Derive coherent Medium and Short versions from Long,
   and record what was removed and why. Shared content must retain the same
   facts, characters, and goals.
5. **Pack generation.** In separate focused chats, give the approved bible,
   length-cut notes, schema, and the corresponding prompt, in this order:
   `identity-and-cast.md`, `truths-clues-and-items.md`,
   `locations-and-doors.md`, then `lengths-and-endings.md`. Assemble the
   returned JSON fragments into `public/stories/<story-id>.json`. Then, in
   one more chat, give the assembled pack and `areas.md` and add the returned
   `area` block (description and door texts) to each location. Then run
   `npm run bake-areas` (see "Baking areas" below) to generate the layouts. The
   game only reads the baked areas and generates no places while it runs. Generate the
   style guide as part of identity and cast. Treat the schema as authoritative:
   do not invent fields or omit required fields.
6. **Validation loop.** Run `npm run validate-stories` from the repository
   root. For each failure, give the exact validator output and pack to a new
   agent chat using `prompts/validation-fix.md`. Apply only the targeted pack
   fixes, then rerun the validator. Repeat until there are no errors; resolve
   warnings deliberately rather than hiding them.
7. **Read-through.** Run the command for each length defined by the pack, for
   example `npm run story-readthrough -- <story-id> short`. Review the solved
   locations, clues, characters, item requirements, truths, and ending for
   coherence. Fix the pack and repeat validation and read-through as needed.
8. **Register and commit.** Add the story's id, title, logline, available
   lengths, and estimated minutes to `public/stories/index.json`. Check that the
   filenames and identity id match, run validation and read-through once more,
   review the diff, then commit the brief, bible, pack, and index entry.

## Baking areas

An agent writes the area text (`prompts/areas.md`: `description` and the door
`label`/`hint` texts). `npm run bake-areas` then adds everything else: biome,
palette, floor and wall style, the ASCII `map`, `placements` (a tile for each
object, key item, required character and clue of the location, keyed
`obj:<id>`, `item:<id>`, `char:<id>`, `clue:<id>`) and `decor`. Key rooms are
then hand-edited.

```
npm run bake-areas -- [story-id] [--only <location-id>] [--force]
```

- Without flags only locations whose area is not complete are baked; baked and
  hand-edited maps are left alone.
- `--force` bakes again even when the area is complete (the description and
  door texts are kept; hand edits are lost). `--only <id>` limits the run to one
  location. `story-id` limits it to one pack.
- `--placements` keeps the map and decor and only recomputes where the story
  things stand: run `npm run bake-areas -- <story> --only <id> --placements`
  after editing a `map` by hand.
- `--adopt <file.json>` applies hand-drawn layouts, given as
  `{ "<story>/<location>": { "map": [...], "decor": [...], "placements": {...} } }`.
  Placements named there stay where they are, the rest are computed.
- `--check` checks all baked areas and writes nothing; `--show` prints the maps
  (letters are story things, `&` is decor).

Layouts are deterministic (seeded by story id and location id). The room type
comes from the location name and free-text biome (`bake/kinds.ts`): indoor
places are ONE room of a size that fits the type (bedroom small, kitchen/shop
medium, halls large) with a wall two tiles thick along the top, optionally
L-shaped, octagonal (towers) or ship-shaped (wrecks), with counters, rugs,
partitions and sparse decor along the walls. Outdoor places get hedge, fence,
brick or rock edges, paths, ponds, stalls, jetties and so on. Door tiles sit in
the wall on the side that faces the neighbour in `layoutStoryWorld`. Before a
map is written the tool checks the size limits, that every door digit appears
once, and that all doors, story things and the player start are reachable from
every door over floor only (also with the things solid, and with doors treated
as walls).

Map legend and size limits: `src/world/mapLegend.ts`. In short: `#` wall,
`.` floor, `R` rug, `C` counter/table/shelf run, `O` boulder, `,` grass,
`:` path, `~` water, `=` bridge, `T` tree, `o` rock, `*` flowers, `@` player
start, `1`-`9` doors (digit n is `area.doors[n - 1]`), space is void. A `#` with
walkable floor below it is drawn as a wall face, so rooms get two `#` rows at
the top. Decor icons are catalog ids from `icon-catalog.md` (solid, 1 tile).
`?debug=world` shows the baked maps in the browser. `?debug=world&art=1` draws them
with the real renderer (tiles, decor, story things), every area of every story, or
`&story=<id>&loc=<id>[,<id>...]` for a few; `&outdoor=1` skips rooms and `&zoom=2`
enlarges. Rocks (`o`, `O`) carry a grass tile, so sand, deck and cobble places get
stones and shells as decor instead. Streets, squares and markets have building
fronts on top and trees on the other sides; harbours and shores get a land-side
building block or a grassy bank; outdoors, things named pond, fountain, boat,
fog or flowers are placed at the water or in the flowers.

## Rules for every pack

- The pack fixes plot facts, cast, mystery, clues, key items, locations, and
  endings. Runtime generation may add only surface descriptions, dialogue,
  flavor, and minor extras without contradicting the pack. Every location needs a complete, baked `area` block (text and layout).
- Choose `visual.icon` for every item and location object from
  `icon-catalog.md`, using a catalog id. Use `accent` and `states` only when
  they help the object read clearly. If no glyph fits, add a
  `visual_requests` entry with its name, description, and suggested category;
  do not use a wrong icon. Fix every `weak visual match` warning before review.
- Follow `schema/story-pack.schema.json` and the validator's reference and text
  limits. Keep all three lengths coherent; every core truth needs two
  independent clue routes, and key items cannot be missable.
- Keep the tone cozy, avoid graphic violence, and write English only.
- Make the player solve the mystery. Give key truths an optional
  `deduction` (`question`, `answer`, 2-3 `wrong_answers`, and optional
  `rules_out` red herring ids). Such a truth becomes an open question in the
  casebook once a clue for it is found and its `depends_on` truths are
  confirmed, and is confirmed only when the player picks the right answer.
  Wrong answers must be plausible but clearly wrong given the clues, and all
  options must differ. Truths without a `deduction` are confirmed as soon as a
  clue is found. Answering correctly also settles the red herrings in
  `rules_out`, showing their `resolution` text.
- Give an ending an optional `summation`: 2-4 `{ question, truth_id }` entries,
  each `truth_id` taken from that ending's `conditions.truths`. At the finale
  the player presents the case by matching each question to a confirmed truth.
  Endings without a `summation` play as soon as their conditions are met. The
  solver assumes a player who answers every deduction correctly, so these
  fields never make an ending unreachable.
- Optionally give a cast member `reactions` so the player can use "Ask about..."
  on a person, item or found clue. A reaction with a `clue_id` marks that clue
  found, so it must be a clue that character tells; gate it with `requires` when
  the clue has requirements. Reactions are optional and keep `schema_version` 2.
- Every cast member needs a `sprite` and `identity.player` (`name`, `species`,
  `description`, `sprite`) describes the player. A sprite is a layered spec:
  species, height, girth, skin/accent colours, hair, outfit, headwear and up to
  four accessories, all colours as `#rrggbb` (format in
  `src/art/spriteSpec.ts` and the schema; the cast step writes them, see
  `prompts/identity-and-cast.md`). The free-text `sprite_recipe` is gone. The
  validator errors when a sprite is missing or invalid, or when two sprites in a
  story differ in fewer than 3 attributes. Review every story's cast side by side
  at `?debug=art&section=cast` (`&scale=5` to enlarge).
- Twists are shown once as a reveal card when their `payoff_trigger` first
  becomes true; write `description` as a player-facing reveal.
- Do not require a character to solve the mystery if that character's goal can
  be blocked.
- The validator's complexity thresholds are in `src/story/config.ts`; do not
  change them as a shortcut for a pack.
- A new story should require no code changes. Only add its JSON and index entry.
