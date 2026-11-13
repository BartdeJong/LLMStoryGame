# Pack part 4: lengths and endings

Convert the approved bible into the JSON members for
`endings` and `lengths`, following the supplied
`schema/story-pack.schema.json` exactly. Return only these members as a JSON
fragment. Define exactly one length (the longest version, normally `long`) under
`lengths`; preserve the approved beat order, starting location, included cast,
required truths, subplots, twists, red herrings, and available endings. Ensure beat requirements are
discoverable before the next beat opens and each ending is reachable.
Include `opening.context` with a brief, spoiler-safe
orientation for a new player. Give every beat a player-facing `objective` and
an actionable `guidance` line that points to a reachable next step from that
beat's locations. The opening screen and persistent in-game lead use these
authored fields; do not rely on generated area descriptions to explain the plot
or tell the player what to do.

For each ending that depends on the player solving the case, add a
`summation` of 2-4 `{ question, truth_id }` entries. Every `truth_id` must
appear in that ending's `conditions.truths`, so list the truths the player
must have confirmed there. Endings without a `summation` play as soon as their
conditions are met.

Give `proof` (`items`, `clues`, and `required` as in the truths part) to one
central question per ending, the one the ending turns on, and leave the other
questions without it. Choose evidence for the correct truth only, not for a red
herring, and only evidence the player can gather before the finale without
already knowing the answer.

Give each ending an optional `flawed` variant: `{ scene_outline, tone,
epilogue_notes }`. It plays instead of the normal scene when the player's case
record is flawed (many wrong final answers or failed challenges). Keep every
plot fact of the normal ending; the case is still closed, but something is left
unsettled or someone else has to put it right. Keep it cozy and never punishing.

Give the length an `epilogue`: after the ending scene the player can walk one
area and talk with the people who belong in the ending. Choose a `location`
that fits how the story ends (a party for everyone, a quiet room where the
case is talked over) and list in `cast` only the people who would be there,
never a culprit who was taken away. Each entry has the tile `at` [x, y] where
they stand (walkable floor in that location's baked map, not on an object,
decor, door or the start tile), an authored `greeting` in their voice that
reflects the resolution, and optional `endings` to limit them to some endings.
Add a short arrival `description`, an `objective`, a `join_label` for the
ending screen button, a `door_message` for when the player tries to leave, 2-3
generic small-talk `deflections`, and an optional `player_sprite` when the
ending changes how the player looks.

Approved bible:
<paste the complete approved bible here>


Accepted identity, cast, truths, clues, items, and locations:
<paste the accepted earlier fragments here>
