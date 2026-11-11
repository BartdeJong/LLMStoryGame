# Pack part 2: truths, clues, and items

Convert the approved bible and length-cut decisions into the JSON members for
`truths`, `clues`, `items`, `twists`, and `red_herrings`, following the supplied
`schema/story-pack.schema.json` exactly. Return only these members as a JSON
fragment. Ensure every core truth has at least two independent clue routes;
record the route ids consistently in both the truth and clue entries. Every
item needs a reachable source, and key items must not be missable. Requirements
must be achievable before they are needed.

For the key truths, add a `deduction`: `question`, the correct `answer`
(normally the truth's own text), 2-3 plausible `wrong_answers`, and optionally
`rules_out` listing red herring ids the answer settles. Leave minor truths
without one; they are confirmed as soon as a clue is found. Twist
`description` text is shown to the player once as a reveal, so write it for
the player after the payoff.

For every item, include `visual: { "icon": "<catalog-id>" }` selected by name
from `icon-catalog.md`; optional `accent` may be a palette color slot or a `#RRGGBB` color and optional
`states` must use known state names. If no glyph fits, do not choose a near
match: add a top-level `visual_requests` entry with `name`, `description`, and
`suggested_category`. Fix every `weak visual match` warning.

Approved bible:
<paste the complete approved bible here>

Length-cut decisions:
<paste the relevant approved decisions here>

Part 1 ids and cast:
<paste the accepted identity/style-guide/cast fragment here>
