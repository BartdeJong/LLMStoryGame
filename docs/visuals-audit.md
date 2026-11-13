# Object visuals audit

Current rendering: items use `icon_recipe` when it parses, otherwise semantic inference from name/description, then a seeded legacy icon. Required world objects have no pack recipe; runtime semantic inference takes precedence over an LLM recipe, with a seeded recipe as fallback. These recipes are painted as 16x16 legacy pixel icons. “No inferred shape” means the final shape depends on generated recipe/fallback.

Counts: 3 stories; 16 items; 84 world objects (100 total). Existing recipes use legacy `IconShape` values.

## example (3 items, 5 objects)

| Kind | Name | Description | Current icon recipe -> rendered shape |
|---|---|---|---|
| Item | Overdue book | A dusty book of tower clock repairs, three weeks late. | `small blue book with a ribbon` -> inferred `book` |
| Item | Tower key | A heavy iron key with a clock-face handle. | `iron key with a round handle` -> inferred `key` |
| Item | Glass shard | A curved piece of pale lantern glass. | `small pale curved triangle` -> inferred `shard` |
| Object | Notice board | A wooden board with festival notes. | none in pack; inferred `envelope` from “notes” |
| Object | Dough bin | A large bin of rising dough. | none in pack; no inferred shape |
| Object | Flowerbed | Neat rows of herbs and daisies. | none in pack; inferred `flower` |
| Object | Key log | A ledger of who borrowed which key. | none in pack; inferred `book` |
| Object | Workbench | A cluttered bench of tiny tools. | none in pack; no inferred shape |

## holmesashenvelope (6 items, 23 objects)

| Kind | Name | Description | Current icon recipe -> rendered shape |
|---|---|---|---|
| Item | Wren's pocket docket | A narrow book of figures and notes about the Relief Fund. | `book/ink/cream` -> `book` |
| Item | Charred envelope | A blackened envelope with a trace of printing ink beneath the ash. | `book/shadow/accent` -> `book` |
| Item | Brass ferry token | A worn token recovered beside the ferry register. | `coin/earth/cream` -> `coin` |
| Item | Ward supply receipt | A dated receipt for supplies delivered to St Bartholomew's fever ward. | `book/cream/ink` -> `book` |
| Item | Press proof | A small public-notice proof with a visible flaw in its headline. | `feather/ink/cream` -> `feather` |
| Item | Duplicate ledger | Wren's copy of the Relief Fund accounts, kept by Pembroke. | `book/earth/ink` -> `book` |
| Objects | Watson's account; Hudson's recollection; After-hours key record; Wren's pocket docket; Pocket docket; Coat fibres; Unpaid vouchers; Tide mark; Charred envelope; Fund seal; Key register; Account columns; Ward supply receipt; Press proof; Cab fare book; Pump grease; Brass ferry token; Ferry register; Boot grit; Parcel receipt; Press archive entry; Print date; Duplicate ledger. | Descriptions, in order: Watson's spoken recollection of Wren's intended report; Hudson remembers the fever ward's appeal; Lestrade's record of the countinghouse key; A narrow book of figures and notes.; Wren's notes record the irregular payments.; Fibres and blood marks indicate that the body was moved.; Wren's vouchers show the ward's unpaid bills.; Scuffs, undisturbed silt, and a late-placed oily rag contradict the dockside assault.; A blackened envelope with a trace of printing ink.; Vale's distinct initials remain in the wax beside signs of a struggle.; The office record of Vale's duplicate key.; Repeated alterations conceal unauthorized transfers.; A dated record of delivered supplies.; A public notice proof with a flaw in its headline.; A time and fare entry contradicts Vale's journey.; Silas's explanation of the grease from ordinary repair work.; A worn token recovered beside the register.; The corrected times leave no crossing at Vale's claimed hour.; The rag lies outside Silas's route and carries Vale's boot grit.; Ada's dated receipt for the parcel delivered to Pembroke.; A preserved notice identifies the envelope's harmless paper.; A dated municipal archive record proves the proof predates Wren's murder.; Wren's copy of the Relief Fund accounts. | No object recipes in pack; inferred shapes, respectively: `book`, none, `key`, `book`, none, none, none, none, `envelope`, none, `book`, `book`, `book`, `scroll`, `book`, none, `coin`, `book`, none, `book`, none, none, `book`. |

## Obvious mismatches

- `Charred envelope` is painted as a book; the recipe should be an envelope-like silhouette.
- `Brass Spyglass` is painted as a gem; the named object should read as a telescope.
- `Warm Bun` is painted as a coin; a baked-goods silhouette is needed.
- `Press proof` is painted as a feather; the proof/document shape is wrong.
- Objects such as `Dough bin`, `Spool basket`, `Oil can`, and `Barometer` have no semantic shape rule and therefore can render as unrelated seeded/LLM icons. Object icon recipes are not authored in these packs.
