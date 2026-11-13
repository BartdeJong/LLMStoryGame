# Pack part 2: truths, clues, and items

Convert the approved bible into the JSON members for
`truths`, `clues`, `items`, `twists`, and `red_herrings`, following the supplied
`schema/story-pack.schema.json` exactly. Return only these members as a JSON
fragment. Ensure every core truth has at least two independent clue routes;
record the route ids consistently in both the truth and clue entries. Every
item needs a reachable source, and key items must not be missable. Requirements
must be achievable before they are needed.

For the key truths, add a `deduction`: `question`, the correct `answer`
(normally the truth's own text), 2-3 plausible `wrong_answers`, and optionally
`rules_out` listing red herring ids the answer settles. Also add a `proof` to
each deduction: `items` and `clues` ids that back the correct answer, and a
`required` count (default 1, at most 3) for how many of them the player must
show. List only evidence for the correct answer, not evidence that supports a
red herring, and only evidence the player can gather without already knowing
the answer. Use `required: 2` only when the answer genuinely rests on two
sources. A clue that a broken statement reveals may be listed. Leave minor truths
without a deduction; they are confirmed as soon as a clue is found. Twist
`description` text is shown to the player once as a reveal, so write it for
the player after the payoff.

For every clue that can be found at a location (`where` or an `alternatives`
entry of type `location`), set `object_id` to the id of the location object the
player examines to find it. Name that object in the locations part, with the
same id as `object_id`, at that location. Several clues may share one object. A
clue told only by a character has no `object_id`. Items are not also listed
under a location's `objects`: an item found at a location is that object.

For every item, include `visual: { "icon": "<catalog-id>" }` selected by name
from `icon-catalog.md`; optional `accent` may be a palette color slot or a `#RRGGBB` color and optional
`states` must use known state names. If no glyph fits, do not choose a near
match: add a top-level `visual_requests` entry with `name`, `description`, and
`suggested_category`. Fix every `weak visual match` warning.

Approved bible:
<paste the complete approved bible here>


Part 1 ids and cast:
<paste the accepted identity/style-guide/cast fragment here>
