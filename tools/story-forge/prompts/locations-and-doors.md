# Pack part 3: locations and doors

Convert the approved bible and length-cut decisions into the JSON member for
`locations`, following the supplied `schema/story-pack.schema.json` exactly.
Return only the `locations` array as a JSON fragment. Include each location
required by any length, its required characters and objects, and doors linking
the intended location graph. Keep ids consistent with the earlier pack parts.
The graph must be connected and every location must be reachable; avoid
circular or impossible door locks.

Give every object a `visual: { "icon": "<catalog-id>" }` selected by name from
`icon-catalog.md`. If no glyph fits, add a top-level `visual_requests` entry in
the assembled pack instead of choosing a wrong icon. Fix every `weak visual
match` warning.

Approved bible:
<paste the complete approved bible here>

Length-cut decisions:
<paste the relevant approved decisions here>

Accepted cast, truths, clues, and items:
<paste the accepted earlier fragments here>
