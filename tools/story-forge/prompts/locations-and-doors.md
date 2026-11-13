# Pack part 3: locations and doors

Convert the approved bible into the JSON member for
`locations`, following the supplied `schema/story-pack.schema.json` exactly.
Return only the `locations` array as a JSON fragment. Include each location
required by the story, its required characters and objects, and doors linking
the intended location graph. Keep ids consistent with the earlier pack parts.
The graph must be connected and every location must be reachable; avoid
circular or impossible door locks.

Every door `lock` should explain itself in the story's own words. Add `reason`
(at most 160 characters, shown when the player tries the door: why it is shut),
`lead` (at most 200 characters, the journal note: who or what opens it, naming
the character or item a player can follow) and `unlock_text` (at most 200
characters, announced when it opens, and it should name what opened it). The
character who holds the key must say or hint at it somewhere in their
knowledge, goal hints or a clue.

Every clue found at a location needs an object there whose id is that clue's
`object_id` (the clue is found by examining it). Several clues may share one
object. Do not list an item that is found at a location in that location's
`objects`: the item is the only thing placed there.

Give every object a `visual: { "icon": "<catalog-id>" }` selected by name from
`icon-catalog.md`. If no glyph fits, add a top-level `visual_requests` entry in
the assembled pack instead of choosing a wrong icon. Fix every `weak visual
match` warning.

Approved bible:
<paste the complete approved bible here>


Accepted cast, truths, clues, and items:
<paste the accepted earlier fragments here>
