# Story bible: Paddington and the Missing Hat (MEDIUM only)

Status: APPROVED by the user. Id: `paddingtonhat`.
Brief: Paddington Bear, a sunny Saturday in Windsor Gardens, happy and bright,
simple English for a Dutch reader with dyslexia, one length of 30-45 minutes.

This story has only a Medium version (target 40 minutes). There is no Long
version and no length cut.

## 1. Premise

The player is Paddington Bear. It is a warm, sunny Saturday at 32 Windsor
Gardens. Paddington wakes up and goes down to the hall. His old hat is not on
its peg. Then he finds that all the marmalade is gone from the kitchen too!

Everyone is acting a bit strange. Mrs Bird sends him out of the kitchen. Mr
Brown hides in the shed. Jonathan hides a list behind his back. Judy says
"No secrets here!" much too fast.

Paddington gets his magnifying glass and becomes a detective for the day.

## 2. The mystery and its solution

**Mystery:** Where is Paddington's hat, where is the marmalade, and why is
everyone keeping secrets?

**Solution:**
- Today is Paddington's summer birthday. He forgot! Bears in his family have
  two birthdays each year.
- The family is planning a surprise party at the park bandstand at three
  o'clock.
- Judy took the hat early in the morning on the bus to Mr Gruber's shop on
  Portobello Road. Mr Gruber is sewing up the little hole and adding a bright
  new red ribbon. It is a birthday present.
- Mrs Bird used all the marmalade to bake a giant marmalade cake.
- Mr Brown painted a big banner in the shed: HAPPY BIRTHDAY, PADDINGTON!
- Jonathan is in charge of the balloons.
- Aunt Lucy sent a birthday postcard from Peru. Mrs Brown is keeping it for
  the party.

Nobody did anything wrong. Every secret is a kind one.

## 3. Core truths (9) and dependencies

| ID | Core truth | Depends on |
|---|---|---|
| t_hat_missing | Paddington's hat is not on its peg in the hall. | none |
| t_marmalade_gone | All the marmalade is gone from the kitchen. | none |
| t_secret | Everyone at home is hiding something from Paddington. | none |
| t_judy_took_hat | Judy took the hat early this morning. | t_hat_missing |
| t_hat_at_gruber | The hat is at Mr Gruber's shop. | t_judy_took_hat |
| t_hat_mended | Mr Gruber is mending the hat with a new red ribbon, as a present. | t_hat_at_gruber |
| t_marmalade_cake | Mrs Bird used the marmalade to bake a giant marmalade cake. | t_marmalade_gone |
| t_party_in_park | A party is being set up at the park bandstand at three o'clock. | t_secret |
| t_birthday | Today is Paddington's summer birthday, and the party is a surprise for him. | t_party_in_park |

No side truths.

### Two independent routes per core truth

| Truth | Route A | Route B |
|---|---|---|
| t_hat_missing | Place: the empty hat peg (Hall). | Spoken: Jonathan says the hat was not on the peg at breakfast. |
| t_marmalade_gone | Object: empty marmalade shelf (Kitchen). | Spoken: Mrs Brown says Mrs Bird told her the marmalade has run out. |
| t_secret | Object: something big under a sheet (Shed). | Spoken: Judy says "No secrets here!" much too fast. |
| t_judy_took_hat | Object: bus ticket for 8 o'clock on Judy's desk (Judy's Room). | Spoken: Mr Curry saw Judy carry the hat down the street (after he gets his newspaper back). |
| t_hat_at_gruber | Spoken: Barnaby saw Judy go into Mr Gruber's shop. | Object: paper tag on Mr Gruber's counter: "Paddington's hat. Ready by two." |
| t_hat_mended | Object: the hat with a new red ribbon on the workbench (Back Room, opened after cocoa and buns with Mr Gruber). | Object: Judy's drawing of the hat with a new ribbon (Judy's Room). Also Mr Gruber tells (shares a need with Judy's drawing, so it is a bonus route). |
| t_marmalade_cake | Place: warm oven and orange peel in the bin (Kitchen). | Spoken: Barnaby sold Mrs Bird lots of oranges and sugar "for a big cake". |
| t_party_in_park | Spoken: Mrs Penny the park keeper must keep the bandstand free at three. | Object: Jonathan's balloon list on the garden table (Back Garden). |
| t_birthday | Object: the banner under the sheet in the shed (after the party truth). | Spoken: Mrs Brown shows Aunt Lucy's birthday postcard (after Paddington brings her flowers). |

### Deductions (player picks the answer and shows evidence)

- **t_judy_took_hat** - "Who took Paddington's hat?"
  - Right: Judy took the hat early this morning.
  - Wrong: Mr Curry took the hat. / The wind blew the hat away. / Jonathan hid the hat.
  - Rules out: rh_curry_hat, rh_open_window.
- **t_hat_at_gruber** - "Where is the hat now?"
  - Right: The hat is at Mr Gruber's shop.
  - Wrong: The hat is in Mr Curry's garden. / The hat is at the bus stop. / The hat is up a tree in the park.
- **t_hat_mended** - "Why did Judy take the hat to Mr Gruber?"
  - Right: So Mr Gruber can mend it and add a new red ribbon, as a present.
  - Wrong: So Mr Gruber can sell it in his shop. / Because the hat is too small for Paddington. / So Mr Gruber can wear it.
- **t_marmalade_cake** - "Where did all the marmalade go?"
  - Right: Mrs Bird used it to bake a giant marmalade cake.
  - Wrong: Jonathan ate it all for breakfast. / Mr Curry took it. / Paddington ate it in his sleep.
  - Rules out: rh_sticky_jonathan.
- **t_birthday** - "Why is everyone keeping secrets today?"
  - Right: Today is Paddington's summer birthday, and they are planning a surprise party.
  - Wrong: They are cross with Paddington. / They are going on holiday without Paddington. / They are hiding from Mr Curry.

## 4. Cast (9)

The player is Paddington. Everyone talks to him kindly and uses short, simple
sentences.

| Id | Name | Home | Role, goal and secret |
|---|---|---|---|
| c_mrs_brown | Mrs Brown | Hall | Warm and kind. Goal: get flowers for the party table. Secret: she has Aunt Lucy's postcard. Gives the postcard clue after Paddington brings flowers. |
| c_mrs_bird | Mrs Bird | Kitchen | Housekeeper, firm but loving. Goal: finish the cake in secret. Secret: the giant marmalade cake. Never tells, but blushes. |
| c_jonathan | Jonathan | Back Garden | Cheerful, bad at secrets. Goal: blow up twenty balloons. Has sticky orange fingers (red herring: he licked the cake spoon). |
| c_mr_brown | Mr Brown | Shed | Busy and proud of his painting. Goal: finish the banner. Secret: the banner. |
| c_judy | Judy | Judy's Room | Clever, smiles a lot. Goal: keep the hat present a surprise. Secret: she took the hat to Mr Gruber. |
| c_mr_curry | Mr Curry | Mr Curry's Garden | Grumpy neighbour, but not bad. Goal: get his lost newspaper back. Wears a brown gardening hat (red herring). Tells what he saw after Paddington brings the newspaper. |
| c_barnaby | Barnaby | Portobello Market | Jolly fruit seller (new character). Goal: he missed breakfast. Gives currant buns and flowers for Paddington's marmalade sandwich. |
| c_mr_gruber | Mr Gruber | Mr Gruber's Shop | Paddington's gentle best friend. Goal: have cocoa and buns at eleven with Paddington. After the buns he opens his back room. |
| c_mrs_penny | Mrs Penny | Park Gate | Friendly park keeper (new character). Goal: keep the park tidy. Knows about the bandstand at three. |

## 5. Locations (14) and travel

Beat 1, **At Home** (start in Paddington's Room):
- Paddington's Room: bed, emergency marmalade sandwich (item).
- Hall (Mrs Brown): empty hat peg, letter box, open window.
- Kitchen (Mrs Bird): empty marmalade shelf, warm oven, orange peel.
- Back Garden (Jonathan): garden table with balloon list.
- Shed (Mr Brown): something big under a sheet, paint pots.
- Judy's Room (Judy): desk with bus ticket, notebook with a drawing.

Beat 2, **Out and About**:
- Windsor Gardens (the street): lamp post, front door of number 32.
- Mr Curry's Garden (Mr Curry): his brown gardening hat on the fence.
- Bus Stop: bus sign, bench, Mr Curry's newspaper (item).
- Portobello Market (Barnaby): fruit stall, flower bucket.
- Mr Gruber's Shop (Mr Gruber): counter with paper tag, old clock.
- Mr Gruber's Back Room: workbench with the hat. Door opens after cocoa and buns with Mr Gruber.
- Park Gate (Mrs Penny): park sign, flower beds.

Beat 3, **The Party**:
- The Bandstand: the finale.

Doors: Room - Hall; Hall - Kitchen, Judy's Room, Windsor Gardens; Kitchen -
Back Garden; Back Garden - Shed; Windsor Gardens - Mr Curry's Garden, Bus Stop,
Park Gate; Bus Stop - Market; Market - Mr Gruber's Shop; Shop - Back Room
(locked until cocoa and buns); Park Gate - Bandstand.

Beat 1 ends when Paddington knows the hat is missing and that everyone is
hiding something. Beat 2 ends when he knows about the hat, the cake and the
birthday. Then the Bandstand opens.

## 6. Items

- Emergency marmalade sandwich (Paddington's Room): give to Barnaby.
- Mr Curry's newspaper (Bus Stop): give to Mr Curry.
- Bag of currant buns (from Barnaby, key item): give to Mr Gruber.
- Bunch of flowers (from Barnaby): give to Mrs Brown.

## 7. Twists and red herrings

Twists:
- **tw_hat_present**: The hat was not lost. Judy took it so Mr Gruber can make it
  like new, as a present. Setup: bus ticket. Payoff: t_hat_mended.
- **tw_surprise_party**: All the secrets are for one happy surprise: a party for
  Paddington's summer birthday. Setup: the sheet in the shed, Judy's "no
  secrets". Payoff: t_birthday.

Red herrings:
- **rh_curry_hat**: Mr Curry wears a brown hat, just like Paddington's.
  Resolution: it is his own old gardening hat.
- **rh_open_window**: The hall window is open. Did the wind blow the hat away?
  Resolution: Mrs Bird opened it to let the cake smell out.
- **rh_sticky_jonathan**: Jonathan has sticky orange fingers. Did he eat the
  marmalade? Resolution: he only licked the spoon from the cake bowl.

## 8. Subplot

- **sp_grumpy_neighbour**: Paddington finds Mr Curry's newspaper. Mr Curry is
  pleased (but tries not to show it) and comes to the party too.

## 9. Endings

At the Bandstand the player answers these summation questions:
- "Who took Paddington's hat?" -> t_judy_took_hat
- "Why is the hat at Mr Gruber's shop?" -> t_hat_mended
- "Where did the marmalade go?" -> t_marmalade_cake
- "What is the big secret?" -> t_birthday

Then the player chooses:
- **e_happy_surprise** (choice: act surprised). Paddington lets his friends
  shout "Surprise!" and he is very happy. Judy gives him the hat with its new
  red ribbon. Everyone eats marmalade cake. Needs all four truths above.
- **e_happy_surprise_with_curry** (choice: act surprised, plus Mr Curry has his
  newspaper). The same, and Mr Curry comes too and even has a slice of cake.
- **e_detective_bear** (choice: tell them you solved it). Paddington proudly
  says he solved the case. Everyone laughs and cheers "Detective Paddington!"
  and the party starts.

All endings are happy.

## 10. Questions for the user

- Is the title "Paddington and the Missing Hat" good?
- Are the two new characters (Barnaby the fruit seller and Mrs Penny the park
  keeper) okay?
