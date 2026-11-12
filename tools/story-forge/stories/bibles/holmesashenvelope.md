# The Ashen Envelope

## 1. Identity

- **Story ID:** `holmesashenvelope`
- **Title:** The Ashen Envelope
- **Logline:** A riverside clerk is found dead beside a blackened envelope; help Holmes learn where he died, who silenced him, and what the missing relief money was meant to conceal.
- **Premise:** In a wet, soot-dark London, Elias Wren, a bookkeeper for the Thames Relief Fund, is found dead near Blackfriars. His sister Ada fears he will be remembered as a thief. Holmes notices that the body and the evidence tell different stories. The player is a young newcomer assisting Holmes and Watson, unnamed throughout.
- **Tone:** Dark Victorian detective mystery: restrained, grave, atmospheric, and humane, with dry wit in Holmes and warmth in Watson.
- **Content notes:** Murder, a fatal head injury described without lingering detail, a body, blood evidence, institutional poverty, financial betrayal, and an inquest. No sexual violence, harm to children, hate content, or graphic gore.
- **Central question:** Who killed Elias Wren, and why?

## 2. Mystery and solution

Elias Wren was the Relief Fund's meticulous bookkeeper. He discovered that its treasurer, Gideon Vale, had diverted subscriptions to keep St Bartholomew's fever ward supplied after Vale's promised private grant failed. Vale meant to repay the money, but the accounts were false and the committee was about to audit them. Wren intended to report the discrepancy and preserve evidence for the ward.

Vale met Wren in the Fund's countinghouse, killed him there during an argument, and moved the body to the river stairs to make the death look like a dockside assault. He planted a dockworker's oily rag and a misleading ferry token, then told Lestrade that he had left London before the estimated time of death. The charred envelope at the countinghouse was a decoy: its contents were a harmless press proof, while Wren had entrusted a duplicate ledger to solicitor Arthur Pembroke. Vale's motive was to conceal the unauthorized diversion and avoid disgrace, not personal enrichment. That motive mitigates nothing about the murder.

Holmes explains the solution by separating the body's true place of death from its staged resting place, then testing Vale's claimed journey against the tide, cab record, key register, and the ward's dated receipts. Two independent routes establish each core truth. The duplicate ledger and press proof resolve the long-version twists; evidence clears Silas Ward, whom Vale tried to implicate. Lestrade can make a sound case without suppressing the ward's need or excusing the killing.

## 3. ID table

Every identifier in the pack is listed here. IDs are lowercase and use underscores only where the schema permits them; the pack ID itself is separator-free to satisfy both the schema and the read-through command.

### Characters

| ID | Character |
|---|---|
| `c_holmes` | Sherlock Holmes |
| `c_watson` | Dr John Watson |
| `c_hudson` | Mrs Hudson |
| `c_lestrade` | Inspector Lestrade |
| `c_vale` | Gideon Vale |
| `c_ada` | Ada Wren |
| `c_silas` | Silas Ward |
| `c_shaw` | Dr Miriam Shaw |
| `c_nora` | Nora Finch |
| `c_kit` | Kit Marlow |
| `c_pembroke` | Arthur Pembroke |
| `c_crane` | Elspeth Crane |

### Locations

| ID | Location |
|---|---|
| `l_baker_street` | 221B Baker Street |
| `l_scotland_yard` | Scotland Yard |
| `l_st_barts_mortuary` | St Bartholomew's mortuary |
| `l_blackfriars_stairs` | Blackfriars riverside stairs |
| `l_wren_countinghouse` | Wren's countinghouse |
| `l_relief_office` | Thames Relief Fund office |
| `l_fever_ward` | St Bartholomew's fever ward |
| `l_fleet_street_press` | Fleet Street pressroom |
| `l_print_archive` | Press archive |
| `l_cab_stand` | Blackfriars cab stand |
| `l_dock_watch_hut` | Dock watch hut |
| `l_ferry_landing` | South-bank ferry landing |
| `l_warehouse_yard` | Old warehouse yard |
| `l_warehouse_loft` | Warehouse loft |
| `l_pawnshop` | Bell Lane pawnshop |
| `l_clockmaker` | Rook's clockmaker shop |
| `l_telegraph_office` | Telegraph office |
| `l_charing_cross_hall` | Charing Cross booking hall |
| `l_parcels_office` | Railway parcels office |
| `l_british_museum` | British Museum reading room |
| `l_record_vault` | Municipal record vault |
| `l_pembroke_chambers` | Pembroke's chambers |
| `l_hampstead_house` | Vale's Hampstead house |
| `l_church_hall` | St Jude's parish hall |
| `l_relief_committee` | Relief Fund committee room |

### Items

| ID | Item |
|---|---|
| `i_wren_docket` | Wren's pocket docket |
| `i_charred_envelope` | Charred envelope |
| `i_ferry_token` | Brass ferry token |
| `i_ward_receipt` | Ward supply receipt |
| `i_press_proof` | Press proof |
| `i_duplicate_ledger` | Duplicate ledger |

### Truths

| ID | Truth |
|---|---|
| `t_wren_discovered` | Wren had discovered irregular Relief Fund payments and meant to report them. |
| `t_scene_staged` | Wren died in the countinghouse; his body was moved to the river stairs. |
| `t_fane_killed_wren` | Gideon Vale killed Wren and staged the riverside discovery. |
| `t_diversion_for_ward` | Vale diverted subscriptions to keep the fever ward supplied after his promised grant failed. |
| `t_fane_alibi_false` | Vale's claimed ferry departure before Wren's death was false. |
| `t_fane_access` | Vale used his treasurer's key to enter the countinghouse after hours. |
| `t_fane_diverted` | Vale concealed unauthorized transfers in the Relief Fund accounts. |
| `t_envelope_decoy` | The charred envelope was a decoy; its paper held no incriminating account. |
| `t_duplicate_ledger` | Wren left a true duplicate ledger with Pembroke before his death. |
| `t_silas_framed` | Vale planted dock grease to implicate Silas, whose grease came from ordinary pump work. |

### Clues

| ID | Evidence / route |
|---|---|
| `cl_wren_docket` | Wren's docket at the mortuary; route to `t_wren_discovered`. |
| `cl_watson_inquest` | Watson's account of Wren's intended report; route to `t_wren_discovered`. |
| `cl_mortuary_fibres` | Fibres and blood pattern indicate the body was moved; route to `t_scene_staged`. |
| `cl_river_drag` | Scuffs, undisturbed silt, and the oily rag's placement disprove a river assault; route to `t_scene_staged` and resolve the short red herring. |
| `cl_wax_initials` | Fund seal and Vale's initials at the countinghouse; route to `t_fane_killed_wren`. |
| `cl_lestrade_keylog` | Lestrade's record puts Vale at the scene after hours; route to `t_fane_killed_wren`. |
| `cl_vale_key_admission` | Vale admits holding the treasurer's key; route to `t_fane_access`. |
| `cl_ward_appeal` | Hudson's remembered appeal from the ward; route to `t_diversion_for_ward`. |
| `cl_unpaid_vouchers` | Unpaid supply vouchers preserved at the mortuary; route to `t_diversion_for_ward`. |
| `cl_token_register` | Ferry register disproves Vale's claimed crossing; route to `t_fane_alibi_false`. |
| `cl_cab_entry` | Cabman's time and fare entry contradict Vale's departure; route to `t_fane_alibi_false`. |
| `cl_duplicate_key` | Vale's key impression in the office register; route to `t_fane_access`. |
| `cl_relief_columns` | Repeated altered columns in the Fund book; route to `t_fane_diverted`. |
| `cl_ward_receipts` | Shaw's dated receipts show the diverted money reached the ward; route to `t_fane_diverted` and `t_diversion_for_ward`. |
| `cl_envelope_proof` | Preserved museum press entry identifies the harmless proof paper; route to `t_envelope_decoy`. |
| `cl_press_archive` | Municipal archive dates the proof before the murder; route to `t_envelope_decoy`. |
| `cl_pembroke_copy` | Pembroke's duplicate ledger; route to `t_duplicate_ledger`. |
| `cl_ada_receipt` | Ada's receipt for Wren's sealed parcel, preserved in the railway parcels office; route to `t_duplicate_ledger`. |
| `cl_silas_pump_grease` | Ordinary pump grease from Silas's work; route to `t_silas_framed`. |
| `cl_planting_trace` | Vale's boot grit and the planted rag's placement; route to `t_silas_framed` and `t_fane_killed_wren`. |

### Twists, red herrings, subplots, and endings

| Kind | IDs |
|---|---|
| Twists | `tw_staged_scene`, `tw_ward_diversion`, `tw_decoy_envelope` |
| Red herrings | `rh_silas_grease`, `rh_false_ferry`, `rh_ada_letter`, `rh_kit_ink` |
| Subplots | `sp_fever_ward`, `sp_ada_reputation`, `sp_kit_press` |
| Endings | `e_first_accounting`, `e_ward_inquest`, `e_public_trial`, `e_tempered_truth` |
| Goal states | `gs_holmes_solution`, `gs_watson_scene`, `gs_hudson_letter`, `gs_lestrade_case`, `gs_vale_account`, `gs_ada_name`, `gs_silas_clear`, `gs_shaw_ward`, `gs_nora_record`, `gs_kit_proof`, `gs_pembroke_copy`, `gs_crane_patients` |
| Knowledge | `k_<character>_<topic>`; each character has five IDs: `case`, `wren`, `ward`, `vale`, and `place`. |
| Beats | `b_opening`, `b_river`, `b_accounts`, `b_witnesses`, `b_records`, `b_confrontation` |
| Doors | `d_baker_street_scotland_yard`, `d_scotland_yard_baker_street`, `d_scotland_yard_st_barts_mortuary`, `d_st_barts_mortuary_scotland_yard`, `d_st_barts_mortuary_blackfriars_stairs`, `d_blackfriars_stairs_st_barts_mortuary`, `d_blackfriars_stairs_wren_countinghouse`, `d_wren_countinghouse_blackfriars_stairs`, `d_wren_countinghouse_relief_office`, `d_relief_office_wren_countinghouse`, `d_relief_office_fever_ward`, `d_fever_ward_relief_office`, `d_fever_ward_fleet_street_press`, `d_fleet_street_press_fever_ward`, `d_fleet_street_press_print_archive`, `d_print_archive_fleet_street_press`, `d_print_archive_cab_stand`, `d_cab_stand_print_archive`, `d_cab_stand_dock_watch_hut`, `d_dock_watch_hut_cab_stand`, `d_dock_watch_hut_ferry_landing`, `d_ferry_landing_dock_watch_hut`, `d_ferry_landing_warehouse_yard`, `d_warehouse_yard_ferry_landing`, `d_warehouse_yard_warehouse_loft`, `d_warehouse_loft_warehouse_yard`, `d_warehouse_loft_pawnshop`, `d_pawnshop_warehouse_loft`, `d_pawnshop_clockmaker`, `d_clockmaker_pawnshop`, `d_clockmaker_telegraph_office`, `d_telegraph_office_clockmaker`, `d_telegraph_office_charing_cross_hall`, `d_charing_cross_hall_telegraph_office`, `d_charing_cross_hall_parcels_office`, `d_parcels_office_charing_cross_hall`, `d_parcels_office_british_museum`, `d_british_museum_parcels_office`, `d_british_museum_record_vault`, `d_record_vault_british_museum`, `d_record_vault_pembroke_chambers`, `d_pembroke_chambers_record_vault`, `d_pembroke_chambers_hampstead_house`, `d_hampstead_house_pembroke_chambers`, `d_hampstead_house_church_hall`, `d_church_hall_hampstead_house`, `d_church_hall_relief_committee`, `d_relief_committee_church_hall` |
| Knowledge | `k_holmes_case`, `k_holmes_wren`, `k_holmes_ward`, `k_holmes_vale`, `k_holmes_place`; `k_watson_case`, `k_watson_wren`, `k_watson_ward`, `k_watson_vale`, `k_watson_place`; `k_hudson_case`, `k_hudson_wren`, `k_hudson_ward`, `k_hudson_vale`, `k_hudson_place`; `k_lestrade_case`, `k_lestrade_wren`, `k_lestrade_ward`, `k_lestrade_vale`, `k_lestrade_place`; `k_vale_case`, `k_vale_wren`, `k_vale_ward`, `k_vale_books`, `k_vale_place`; `k_ada_case`, `k_ada_wren`, `k_ada_ward`, `k_ada_letter`, `k_ada_place`; `k_silas_case`, `k_silas_wren`, `k_silas_ward`, `k_silas_pump`, `k_silas_place`; `k_shaw_case`, `k_shaw_wren`, `k_shaw_ward`, `k_shaw_receipts`, `k_shaw_place`; `k_nora_case`, `k_nora_wren`, `k_nora_ferry`, `k_nora_clock`, `k_nora_place`; `k_kit_case`, `k_kit_wren`, `k_kit_proof`, `k_kit_ink`, `k_kit_place`; `k_pembroke_case`, `k_pembroke_wren`, `k_pembroke_ledger`, `k_pembroke_ada`, `k_pembroke_place`; `k_crane_case`, `k_crane_wren`, `k_crane_ward`, `k_crane_books`, `k_crane_place`. |

## 4. Truth dependencies and routes

All ten truths are **core** for the Long version. Medium uses the first seven plus `t_silas_framed`; Short uses the first four, all with the same wording and meaning. Every core truth has at least two independent clues, both available within every length that includes that truth.

| Truth | Depends on | Independent routes |
|---|---|---|
| `t_wren_discovered` | — | `cl_wren_docket`, `cl_watson_inquest` |
| `t_scene_staged` | — | `cl_mortuary_fibres`, `cl_river_drag` |
| `t_fane_killed_wren` | `t_scene_staged` | `cl_wax_initials`, `cl_lestrade_keylog` |
| `t_diversion_for_ward` | `t_wren_discovered` | `cl_ward_appeal`, `cl_unpaid_vouchers` |
| `t_fane_alibi_false` | `t_scene_staged` | `cl_token_register`, `cl_cab_entry` |
| `t_fane_access` | `t_scene_staged` | `cl_vale_key_admission`, `cl_duplicate_key` |
| `t_fane_diverted` | `t_wren_discovered` | `cl_relief_columns`, `cl_ward_receipts` |
| `t_envelope_decoy` | `t_wren_discovered` | `cl_envelope_proof`, `cl_press_archive` |
| `t_duplicate_ledger` | `t_wren_discovered` | `cl_pembroke_copy`, `cl_ada_receipt` |
| `t_silas_framed` | `t_scene_staged` | `cl_silas_pump_grease`, `cl_planting_trace` |

## 5. Cast

Every person is human (`species: person`). Holmes, Watson, Hudson, and Lestrade are the core cast in every length. Goals are concrete and optional unless explicitly named in an ending condition; no character must cooperate for a core truth to be discoverable.

| Character | Personality, goal, secret, relations, truths, resolution, reveal |
|---|---|
| **Sherlock Holmes (`c_holmes`)** | Precise, dry, and impatient with loose inference. Goal: establish who killed Wren and why. Secret: he had already suspected a staged scene before the player arrived. Watson is his trusted companion; Hudson is his landlady; Lestrade is his police counterpart. Knows `t_scene_staged`, `t_wren_discovered`. `gs_holmes_solution` resolves with `t_fane_killed_wren` and `t_diversion_for_ward`; he states the complete solution. |
| **Dr John Watson (`c_watson`)** | Warm, practical, medically observant. Goal: establish where Wren died. Secret: he recognizes a wound pattern from his medical service but will not overstate it. Holmes is his friend; Hudson is family to the household. Knows `t_wren_discovered`, `t_scene_staged`. `gs_watson_scene` resolves with `t_scene_staged`; he supplies his account of the injury and the docket. |
| **Mrs Hudson (`c_hudson`)** | Motherly, sharp, and quietly formidable. Goal: return Ada's private letter without exposing its contents. Secret: she once helped Ada find respectable work. Knows Holmes, Watson, Ada; knows `t_diversion_for_ward`. `gs_hudson_letter` resolves when Ada's connection is understood; she recalls the ward's appeal and protects Ada's privacy. |
| **Inspector Lestrade (`c_lestrade`)** | Gruff but fair, careful with evidence. Goal: build a case that will stand in court. Secret: he initially accepted Vale's timetable. Knows Holmes and Watson; professional acquaintance of Vale. Knows `t_scene_staged`, `t_fane_access`. `gs_lestrade_case` resolves with `t_fane_killed_wren`; he provides the key log and accepts the corrected timeline. |
| **Gideon Vale (`c_vale`)** | A composed treasurer whose courtesy hardens under pressure. Goal: prevent the ward's closure and save his name. Secret: he diverted money and killed Wren. Knows the fund, Ada, Pembroke; distrusts Lestrade. Knows all ten truths. `gs_vale_account` resolves when `t_fane_diverted` is established; he admits the transfers but not at first the murder. |
| **Ada Wren (`c_ada`)** | Proud, grieving, and guarded. Goal: keep her brother from being branded a thief. Secret: she delivered Wren's sealed parcel to Pembroke. Sister of Elias; Mrs Hudson once aided her. Knows `t_wren_discovered`, `t_duplicate_ledger`. `gs_ada_name` resolves with `t_duplicate_ledger`; she tells of the parcel and clears her brother's name. |
| **Silas Ward (`c_silas`)** | Blunt dock watchman, more patient than his manner suggests. Goal: clear his name after the oily rag is found. Secret: he repaired the ferry pump that night. Knows Nora and Lestrade; distrusts Vale. Knows `t_scene_staged`, `t_silas_framed`. `gs_silas_clear` resolves with `t_silas_framed`; he explains the grease and his route. |
| **Dr Miriam Shaw (`c_shaw`)** | Exact, humane, and resistant to committee pressure. Goal: keep the fever ward supplied. Secret: she retained receipts after Vale asked her to destroy obsolete papers. Knows Watson, Crane, Vale. Knows `t_diversion_for_ward`, `t_fane_diverted`. `gs_shaw_ward` resolves when the ward funding is understood; she provides dated receipts. |
| **Nora Finch (`c_nora`)** | A crisp telegraph clerk with a precise memory for times. Goal: correct the ferry departure record. Secret: she copied a corrected time into her private notebook after a faulty clock misled a porter. Knows Silas and Kit. Knows `t_fane_alibi_false`, `t_fane_access`. `gs_nora_record` resolves with `t_fane_alibi_false`; she explains the crossing and the correction. |
| **Kit Marlow (`c_kit`)** | Quick-witted printer, proud of clean type and cleaner hands. Goal: prove he printed no false account. Secret: the charred envelope carried one of his harmless proofs. Knows Nora and Ada. Knows `t_envelope_decoy`, `t_kit_printed_proof`. `gs_kit_proof` resolves with `t_envelope_decoy`; he identifies the proof and print date. |
| **Arthur Pembroke (`c_pembroke`)** | Measured solicitor who dislikes theatrical accusations. Goal: protect Wren's duplicate ledger for a lawful inquiry. Secret: he accepted the parcel before Wren died. Knows Ada and Vale professionally. Knows `t_duplicate_ledger`, `t_wren_discovered`. `gs_pembroke_copy` resolves with `t_duplicate_ledger`; he produces the copy and confirms its chain of custody. |
| **Elspeth Crane (`c_crane`)** | A brisk ward matron, compassionate without sentimentality. Goal: keep the patients supplied. Secret: she tracked every donated shilling after the promised grant failed. Knows Shaw and Watson. Knows `t_diversion_for_ward`, `t_shaw_kept_receipts`. `gs_crane_patients` resolves when `t_diversion_for_ward` is known; she distinguishes the ward's need from Vale's crime. |

## 6. Locations, objects, clues, doors

All doors are reciprocal, unlocked, and connect consecutive locations in the numbered order. This prevents a locked-door dead end; the player only walks, examines, talks, and hands over items. For each adjacent pair `A`, `B`, the pack uses `d_A_B` from A to B and `d_B_A` from B to A.

| # | Location | Biome / palette | Mood and role | Characters, objects, clues |
|---|---|---|---|---|
| 1 | `l_baker_street` | building / village | Gaslit, intimate hub; first meeting and case hook. | Holmes, Watson, Hudson; docket copy and Hudson's remembered appeal; `cl_watson_inquest`, `cl_ward_appeal`. |
| 2 | `l_scotland_yard` | building / village | Formal and guarded; police record. | Lestrade; key log; `cl_lestrade_keylog`. |
| 3 | `l_st_barts_mortuary` | building / dusk | Quiet, clinical, rain against glass; evidence about wound and records. | Watson, Shaw only in Long; docket and vouchers; `cl_wren_docket`, `cl_mortuary_fibres`, `cl_unpaid_vouchers`. |
| 4 | `l_blackfriars_stairs` | shore / dusk | Slippery steps and black water; staged discovery. | Lestrade; tide mark and scuffs; `cl_river_drag`. |
| 5 | `l_wren_countinghouse` | building / dusk | Close, paper-dry room; first solution point. | Holmes, Vale in later lengths; envelope, wax; `cl_wax_initials`. |
| 6 | `l_relief_office` | building / village | Respectable office with troubled books. | Vale; Ada is met in Long; key register and account columns; `cl_duplicate_key`, `cl_relief_columns`. |
| 7 | `l_fever_ward` | building / village | Hushed, strained, human; ward subplot. | Shaw, Crane; dated receipts; `cl_ward_receipts`. |
| 8 | `l_fleet_street_press` | building / dusk | Clattering pressroom; rumor and press subplot. | No required character in Medium; Kit's testimony is reserved for Long. |
| 9 | `l_print_archive` | building / village | Dry stacks and old ink. | Press proof item. |
| 10 | `l_cab_stand` | village / dusk | Rain-dark, watchful; tests Vale's departure. | Lestrade, Silas; fare book; `cl_cab_entry`. |
| 11 | `l_dock_watch_hut` | building / dusk | Sooty shelter above the quay; clears Silas. | Silas; pump rag; `cl_silas_pump_grease`. |
| 12 | `l_ferry_landing` | shore / mist | Foggy crossing, no supernatural element; verifies the alibi. | Nora, Silas; token register; `cl_token_register`. |
| 13 | `l_warehouse_yard` | village / dusk | Empty yard, planted trail. | Lestrade, Silas; grit; `cl_planting_trace`. |
| 14 | `l_warehouse_loft` | building / dusk | Abandoned storage, an unnecessary suspect's former workroom. | Silas; pump tools; resolves `rh_silas_grease`. |
| 15 | `l_pawnshop` | building / village | Narrow shop of ordinary transactions. | Ada; pawn ledger; resolves `rh_ada_letter`. |
| 16 | `l_clockmaker` | building / village | Measured ticks; checks the false time. | Nora; clock service book. |
| 17 | `l_telegraph_office` | building / dusk | Official messages and imperfect clocks. | Nora; message register. |
| 18 | `l_charing_cross_hall` | building / village | Crowded station, public alibi. | Lestrade, Vale; departure board. |
| 19 | `l_parcels_office` | building / dusk | Sealed parcels and railway labels. | Ada; parcel stub and `cl_ada_receipt`. |
| 20 | `l_british_museum` | building / village | Quiet public reading room; preserved press entry. | Holmes, Kit; `cl_envelope_proof`. |
| 21 | `l_record_vault` | building / dusk | Municipal accounts in locked-looking but accessible shelves. | Lestrade; fund charter and `cl_press_archive`. |
| 22 | `l_pembroke_chambers` | building / village | Respectable law office; missing ledger recovered. | Pembroke, Ada; duplicate ledger; `cl_pembroke_copy`. |
| 23 | `l_hampstead_house` | building / dusk | Vale's private rooms, controlled and severe. | Vale; grant letter. |
| 24 | `l_church_hall` | building / village | Neighborhood meeting place; Ada's reputation subplot. | Ada, Hudson, Crane; donation roll. |
| 25 | `l_relief_committee` | building / dusk | Public confrontation, final accounting and endings. | All Long cast as appropriate; committee book. |

The item ledger: `i_wren_docket` at the mortuary; `i_charred_envelope` at the countinghouse; `i_ferry_token` at the ferry landing; `i_ward_receipt` at the fever ward; `i_press_proof` at the print archive; `i_duplicate_ledger` at Pembroke's chambers. Items are never required to unlock a door. The docket and envelope are available in Short; the ferry token and ward receipt in Medium; the proof and duplicate ledger in Long.

## 7. Twists, red herrings, subplots, endings

### Twists

- `tw_staged_scene`: the riverside is not the murder scene. Setup: mortuary fibres and the river's undisturbed silt. Payoff: Holmes reconstructs the body's movement.
- `tw_ward_diversion`: Vale diverted money for the ward, not for private gain. Setup: unpaid vouchers and Shaw's receipts. Payoff: Wren's own note and the ward records establish the purpose without excusing Vale.
- `tw_decoy_envelope`: the blackened envelope is bait, not the proof. Setup: press marks and Kit's date record. Payoff: Pembroke's surviving ledger supplies the real account.

### Red herrings

- `rh_silas_grease`: Silas's oily rag suggests assault; the Short route shows it was placed after the body, while longer routes establish its ordinary pump-work source.
- `rh_false_ferry`: the token appears to confirm Vale's departure; the register and cab entry disprove it.
- `rh_ada_letter`: Ada hides a letter; it concerns her brother's dignity and leads to the parcel receipt, not guilt.
- `rh_kit_ink`: printer's ink on the envelope suggests Kit's complicity; the harmless proof predates the crime.

### Subplots

- `sp_fever_ward` (Medium and Long): Shaw and Crane try to keep the ward supplied; the evidence distinguishes public need from Vale's private responsibility.
- `sp_ada_reputation` (Long): Ada protects her brother's name; the duplicate ledger vindicates his work.
- `sp_kit_press` (Long): Kit identifies the harmless proof and clears the pressroom.

### Endings

- `e_first_accounting` (Short): With the staged scene, Wren's discovery, motive, and killer established, Lestrade proceeds with a compact, defensible case. The ward's need is acknowledged; Vale is not excused.
- `e_ward_inquest` (Medium and Long): The inquest names Vale and the diversion plainly, keeps the ward open through lawful support, and rejects the dockside rumor.
- `e_public_trial` (Long): The duplicate ledger and framing evidence support a public trial; Silas is cleared and the committee is forced to account for its failures.
- `e_tempered_truth` (Long): Pembroke protects Wren's copy and Ada's privacy; Vale is charged, but the evidence reaches the court without turning the ward's patients into spectacle. The result is just, not neat.

## 8. Style guide

- **Narrator voice:** Second person, present tense, restrained and atmospheric; narration may describe the world, but never appears in spoken dialogue fields.
- **Use:** fog, soot, river, paper, ink, gaslight, account, evidence, silence, restraint, conscience, inquest.
- **Avoid:** modern slang, modern forensic terminology, melodrama, supernatural explanations, jokes about the dead, lurid injury detail, and quoted Doyle prose.
- **Naming style:** Period-appropriate British names and modestly specific London place names. Holmes is exact and dry; Watson practical and humane; Lestrade plain and gruff; Hudson warm and shrewd; other voices remain distinct.
- **Dialogue:** Every cast line is first-person spoken speech, never narration, action, or a stage direction. No character asks the player to perform an unsupported action.

## 9. Length cuts

Shared truth wording, cast goals, location facts, clue texts, and item facts do not change between lengths. Short is a complete spine; Medium adds the ward and alibi investigation; Long adds the full paper trail and the additional suspicions.

### Short — target 15 minutes

- **Ordered locations / beats:** `b_opening`: `l_baker_street`; `b_river`: `l_scotland_yard`, `l_st_barts_mortuary`, `l_blackfriars_stairs`, `l_wren_countinghouse`.
- **Cast:** `c_holmes`, `c_watson`, `c_hudson`, `c_lestrade`.
- **Core truths:** `t_wren_discovered`, `t_scene_staged`, `t_fane_killed_wren`, `t_diversion_for_ward`. **Side truths:** none.
- **Subplots:** none. **Twists:** `tw_staged_scene`. **Red herrings:** `rh_silas_grease`. **Ending:** `e_first_accounting`.
- **Must find before next stage:** Wren's docket or Watson's account plus the mortuary/river evidence. The finale is reachable by the two routes for each required truth; no item is needed to open a location.
- **Cast available in beats:** Holmes, Watson, Hudson at Baker Street; Lestrade at Scotland Yard and the stairs. The countinghouse is examinable without Vale.

### Medium — target 35 minutes

- **Ordered locations / beats:** `b_opening`: locations 1–5; `b_accounts`: locations 6–7; `b_witnesses`: locations 8–13.
- **Cast:** Short cast plus `c_vale`, `c_silas`, `c_shaw`, `c_crane`.
- **Core truths:** Short truths plus `t_fane_alibi_false`, `t_fane_access`, `t_fane_diverted`, and `t_silas_framed` (8 total). **Side truths:** none.
- **Subplots:** `sp_fever_ward`. **Twists:** `tw_staged_scene`, `tw_ward_diversion`. **Red herrings:** `rh_silas_grease`, `rh_false_ferry`. **Endings:** `e_first_accounting`, `e_ward_inquest`.
- **Must find before next stage:** The staged scene and Wren's discovery open the accounts beat. The accounts and ward records open the witness beat. Both alibi routes and both diversion routes are within the Medium map; the ferry register is examinable without Nora, and the warehouse-yard trace completes the Silas routes.

### Long — target 65 minutes

- **Ordered locations / beats:** `b_opening`: locations 1–5; `b_accounts`: locations 6–7; `b_witnesses`: locations 8–12; `b_records`: locations 13–22; `b_confrontation`: locations 23–25.
- **Cast:** all twelve listed characters.
- **Core truths:** all ten truths. **Side truths:** none.
- **Subplots:** `sp_fever_ward`, `sp_ada_reputation`, `sp_kit_press`. **Twists:** all three. **Red herrings:** all four. **Endings:** `e_ward_inquest`, `e_public_trial`, `e_tempered_truth`.
- **Must find before next stage:** Establish the staged scene and discovery of the account irregularities before pursuing office records; establish the false alibi and ward diversion before the long witness/records trail; find the duplicate ledger and resolve the envelope before the final committee confrontation. No gate requires a missed item.

**Threshold check:** Short meets 5 locations / 4 cast / 4 core truths / 1 red herring / 1 twist / 0 subplots / 1 ending / 2 routes; Medium meets 13 / 8 / 8 / 2 / 2 / 1 / 2 / 2; Long meets 25 / 12 / 10 / 4 / 3 / 3 / 3 / 2.

## 10. Statements and flawed endings

Pack version 4 adds statements. A character says something false or incomplete; the player hears it, finds evidence against it and challenges it. If the evidence fits, the character admits the truth, and the admission is the only way that character gives the clue. Each lie comes from the character's secret or motivations and changes nothing about the solution.

| Statement | Who | The cover story | Why they hide it | Broken by (any one) | Admission reveals | Lengths |
|---|---|---|---|---|---|---|
| `st_lestrade_timetable` | Lestrade | Vale's ferry timetable is sound; the stairs look like a robbery. | He accepted Vale's timetable before he had the river evidence. | `cl_mortuary_fibres`, `cl_river_drag` | `cl_lestrade_keylog` (`t_fane_killed_wren`, core) | S, M, L |
| `st_hudson_appeal` | Mrs Hudson | She knows nothing of hospital matters. | She gave to the ward's appeal and will not be thought soft. | `i_wren_docket`, `cl_wren_docket` | `cl_ward_appeal` (`t_diversion_for_ward`, core) | S, M, L |
| `st_holmes_stairs` | Holmes | He has formed no view of the stairs yet. | He suspected a staged scene and kept quiet so as not to colour the player's eyes. | `cl_mortuary_fibres`, `cl_river_drag` | (no clue) | S, M, L |
| `st_vale_key` | Vale | He had no key and no reason to enter after hours. | Concealment; he concedes only to specific evidence. | `cl_duplicate_key`, `cl_lestrade_keylog` | `cl_vale_key_admission` (`t_fane_access`, core) | M, L |
| `st_silas_grease` | Silas | He never touched grease that night. | Fear of being blamed for Wren's death. | `cl_river_drag`, `cl_mortuary_fibres` (proof the rag was placed) | `cl_silas_pump_grease` (`t_silas_framed`, core) | M, L |
| `st_shaw_receipts` | Dr Shaw | She cleared out the old papers as Vale asked. | Protecting the ward from the inquiry. | `i_ward_receipt` | `cl_ward_receipts` (`t_fane_diverted`, core) | M, L |

Short has three statements; Medium and Long have six. `cl_ward_receipts` no longer requires the receipt item, because the statement now gates it. Kit and Ada keep no statements: their existing lines already admit what they would hide. Every core truth keeps a second route that needs no challenge.

Every ending also has a flawed variant. It plays when the player's case record is flawed (too many wrong final answers or failed challenges). Vale is still charged and the facts stand, but the case is thinner than it should be, and Lestrade, Dr Shaw and Matron Crane, Pembroke, or Mrs Hudson and Ada have to put right what the player's account left crooked.
