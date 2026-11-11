# Pack part 4: lengths and endings

Convert the approved bible and length-cut decisions into the JSON members for
`endings` and `lengths`, following the supplied
`schema/story-pack.schema.json` exactly. Return only these members as a JSON
fragment. Define short, medium, and long; preserve the approved beat order,
starting location, included cast, required truths, subplots, twists,
red herrings, and available endings for each. Ensure beat requirements are
discoverable before the next beat opens and each ending is reachable.
For every length, include `opening.context` with a brief, spoiler-safe
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
Approved bible:
<paste the complete approved bible here>

Length-cut decisions:
<paste the relevant approved decisions here>

Accepted identity, cast, truths, clues, items, and locations:
<paste the accepted earlier fragments here>
