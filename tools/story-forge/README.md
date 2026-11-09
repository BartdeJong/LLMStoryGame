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
   returned JSON fragments into `public/stories/<story-id>.json`. Generate the
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

## Rules for every pack

- The pack fixes plot facts, cast, mystery, clues, key items, locations, and
  endings. Runtime generation may add only surface descriptions, dialogue,
  flavor, and minor extras without contradicting the pack.
- Choose `visual.icon` for every item and location object from
  `icon-catalog.md`, using a catalog id. Use `accent` and `states` only when
  they help the object read clearly. If no glyph fits, add a
  `visual_requests` entry with its name, description, and suggested category;
  do not use a wrong icon. Fix every `weak visual match` warning before review.
- Follow `schema/story-pack.schema.json` and the validator's reference and text
  limits. Keep all three lengths coherent; every core truth needs two
  independent clue routes, and key items cannot be missable.
- Keep the tone cozy, avoid graphic violence, and write English only.
- Do not require a character to solve the mystery if that character's goal can
  be blocked.
- The validator's complexity thresholds are in `src/story/config.ts`; do not
  change them as a shortcut for a pack.
- A new story should require no code changes. Only add its JSON and index entry.
