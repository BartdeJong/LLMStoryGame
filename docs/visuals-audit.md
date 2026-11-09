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

## lanterntide (7 items, 56 objects)

| Kind | Name | Description | Current icon recipe -> rendered shape |
|---|---|---|---|
| Item | Dusk Ink | A small bottle of dark blue ink that shows faded writing. | `potion/ink/accent` -> `potion` |
| Item | Tallow Key | A small brass key with a wren stamped on its bow. | `key/accent/earth` -> `key` |
| Item | Mothlight Ember | A warm ember that glows without burning. | `lantern/accent/highlight` -> `lantern` |
| Item | Brass Spyglass | A dented spyglass with W.T. scratched on the rim. | `gem/accent/highlight` -> `gem` |
| Item | Empty Flask | A clear glass flask with a cork stopper. | `potion/cream/water` -> `potion` |
| Item | Warm Bun | A thirteen-spice bun that smells of home. | `coin/earth/cream` -> `coin` |
| Item | Lamp-Wick | A neatly braided lamp-wick that Rook keeps for Berth Thirteen. | `feather/cream/shadow` -> `feather` |
| Objects | Ferry bell; Regatta poster; Founders' banner; Sailmaker's worktable; Spool basket; Lantern post; Notice board; Bun tray; Flour sack; Cooling table; Study door; Council table; Tall windows; Ledger desk; Archive bookshelf; Reading chair; Boat-hook; Tally ledger; Ink shelf; Press stool; Apprentice cot; Old coat; Attic window; Bedside table; Hoard shelf; Peg rail; Washbasin; Apprentice hook; Keeper's chair; Oil cupboard; Ember bowl; Oil can; Lamp-room window; Spyglass stand; Bell ledger; Bell rope; Keeper's stool; Empty lamp-stand; Recipe book; Letter box; Barometer; Fog bank; Moth flowers; Reed boat; Amber threads; Glowing tidepool; Scorched log; Signalling mirrors; Stair lanterns; Gallery windows; Cistern plaque; Cistern shelf; The Thirteenth Light; Wren's cot; Bedside table; Round window. | Descriptions, in order: A small bell that rings when the ferry arrives.; A faded poster for the Founders' Regatta.; A torn banner with thirteen stitched stars.; A broad table scattered with thread, needles and folded canvas.; A wicker basket full of colored thread and sailmaker's twine.; A row of lantern posts, each lit by a keeper.; A board of chores, ferries and lost things.; A tray of thirteen buns, one more than anyone orders.; A flour sack with a wooden scoop tucked into its folded top.; A sturdy table where warm buns cool beside the oven.; Hobb's study, where a locket lies on the desk.; A long oak table polished smooth by years of careful meetings.; Tall windows look out over the harbour and its many berths.; A desk with fading ledgers and a drawer of copies.; A tall shelf holds carefully labeled books and bundles of paper.; A well-used chair sits beside the desk for long afternoons of copying.; A boat-hook leaning by a wet doorstep.; A ledger tracking how much oil is lost each night.; A shelf with a bottle of dark Dusk Ink.; A stout wooden stool stands beside the humming oil press.; A small cot with a scarf and the letters W.T. carved beneath.; A coat with W.T. sewn inside the collar.; A small round window catches the last gold of the evening tide.; A little table holds a chipped cup and a folded handkerchief.; A shelf of buttons, spoons and a small brass key.; A wooden rail is crowded with hats, aprons and odd lengths of string.; A tin basin and a folded towel sit by the shed's little window.; A coat hook with a small scarf thread caught on it.; A broad chair waits beside the warm lamp for a tired keeper.; A wooden cupboard keeps spare wicks and clean oil tins close at hand.; A bowl holding a warm Mothlight Ember.; A small brass can rests near the lamp's careful controls.; A narrow window opens onto the drifting islands below.; A brass stand pointing at the dark tide.; A ledger of every bell rung, including a thirteenth.; A thick rope hangs from the rafters, polished by many careful hands.; A small stool sits beside the bell ledger.; A lamp-stand with thirteen mooring rings around it and no lamp.; The founders' recipe book and a chorus rite page.; A box of unsent letters tied with string.; A cracked barometer with a faded scale.; A soft wall of whispering fog with pale lights in it.; Night flowers the glow-moths love.; A little boat tangled in the reeds.; Glowing amber threads drifting down through the kelp.; A tidepool with a faint amber glow in its depths.; A ship's log scorched at the edges.; Old signalling mirrors in a battered chest.; Dim lanterns lining each stair.; Tall windows with amber threads streaming past.; A plaque thanking every giver of a memory.; A shelf holding a clear Empty Flask.; A bright but tired lamp with a small figure beside it.; A tiny cot beside the lamp, with a wren-stamped mug.; A narrow table holds a chipped cup and a neatly folded blanket.; A round window looks out toward the quiet tide. | No object recipes in pack; inferred shapes, respectively: none, none, none, `furniture`, none, `lantern`, none, `bread`, none, `furniture`, none, `furniture`, `window`, `furniture`, `shelf`, `furniture`, none, `book`, `shelf`, `furniture`, `furniture`, none, `window`, `furniture`, `shelf`, none, none, none, `furniture`, none, none, none, `window`, `spyglass`, `book`, `wick`, `furniture`, `lantern`, `book`, `envelope`, none, none, `flower`, none, `wick`, none, none, none, `window`, none, `shelf`, `lantern`, `furniture`, `furniture`, `window`. |

## Obvious mismatches

- `Charred envelope` is painted as a book; the recipe should be an envelope-like silhouette.
- `Brass Spyglass` is painted as a gem; the named object should read as a telescope.
- `Warm Bun` is painted as a coin; a baked-goods silhouette is needed.
- `Press proof` is painted as a feather; the proof/document shape is wrong.
- Objects such as `Dough bin`, `Spool basket`, `Oil can`, and `Barometer` have no semantic shape rule and therefore can render as unrelated seeded/LLM icons. Object icon recipes are not authored in these packs.
