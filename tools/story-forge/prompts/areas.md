# Pack part 5: area text

Write the area text for every location in the assembled pack, so the game
never has to generate a place while the player waits. Write only `description` and `doors`; the
layout fields (`biome`, `palette`, `floor`, `wall`, `map`, `placements`, `decor`)
are added afterwards by `npm run bake-areas` and then hand-edited for key rooms. Return a JSON object that maps
each location id to its `area` block; it is then added to that location.

For each location write:

- `description`: one or two short sentences the player reads on arrival. Show
  what the place looks, sounds and smells like, using the location's mood,
  palette and objects. Add no new plot, people or items.
- `doors`: one entry for every neighbouring location, including locations
  whose door leads here (doors work both ways). `to` is the neighbour's id,
  `label` is the sign text (at most 4 words, and it must not name any other
  location), and `hint` is one short line about what lies that way.

Match the pack's style guide and reading level. Run `npm run validate-stories`
afterwards; fix every `AREA_` error and warning.

Assembled pack:
<paste the assembled pack here>
