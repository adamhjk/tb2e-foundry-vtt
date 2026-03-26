# Set Design Conversion Examples

---

## Example 1: Classic Dungeon Room

### BEFORE

> **Room 7 — The Old Library**
>
> This large chamber was once a library, though time has not been kind to it. Rows of wooden bookshelves line the north and east walls, most of them sagging or collapsed. Thousands of pages of rotting paper litter the floor, and the smell of mold is overwhelming. A single shaft of light enters from a narrow window high in the south wall, illuminating motes of dust drifting through the air.
>
> A large oak desk sits in the southwest corner. Its drawers have been pulled out and dumped on the floor, but one locked drawer remains intact (DC 15 Thieves' Tools to open, or DC 18 Strength to force). Inside the locked drawer is a leather scroll case containing a *spell scroll of detect magic* and a handwritten note in Elvish that reads: "The vault key rests with the captain. Do not trust the priest."
>
> Three **giant rats** (HP 7, 6, 5) nest behind the collapsed shelving on the north wall. They attack if anyone disturbs the bookshelves but otherwise remain hidden and quiet. Each rat wears a crude collar — a wizard was experimenting on them. Removing a collar reveals a tiny arcane rune that a DC 13 Arcana check identifies as a tracking enchantment.
>
> A successful DC 14 Perception check reveals that one section of the east wall bookshelves has scratch marks on the floor in front of it. The bookshelf swings open (DC 10 Strength) to reveal a hidden passage leading to Room 12.
>
> Treasure: Scattered among the ruined books, a DC 12 Investigation check turns up three intact volumes worth 25gp each to a collector.

### AFTER

```
Old Library 7) | **Bookshelves** N+E walls → sagging, collapsed
                 **Rotting Paper** → floor, mold smell
                 **Light Shaft** → narrow S window → dust motes
                 **Oak Desk** SW → drawers dumped
                               → locked drawer → DC 15 Thieves' / DC 18 Str
                                 → scroll case → spell scroll (detect magic)
                                               → note (Elvish): "Vault key with captain. Don't trust priest."

                 Giant Rats (3) → behind collapsed N shelves
                   (_HP 7, 6, 5_)
                   → attack if shelves disturbed, otherwise hidden
                   → collars → crude → wizard experiment
                             → runes → DC 13 Arcana → tracking enchantment

                 E bookshelf → scratch marks on floor → DC 14 Perception
                             → swings open → DC 10 Str → Room 12

                 Ruined books → DC 12 Investigation → 3 intact volumes (25gp ea.)
```

**Notes**: Rats are not bold — hidden until shelves disturbed. The desk decomposes into drawer → lock → scroll case → contents. Secret door branches off the E bookshelf element.

---

## Example 2: Social/NPC Location

### BEFORE

> **The Crossed Swords Inn (Area 3)**
>
> The Crossed Swords is a two-story timber-framed inn at the center of the village. A painted sign depicting two crossed longswords hangs above the door, creaking in the wind. The common room takes up most of the ground floor. A stone fireplace dominates the east wall, and six heavy oak tables fill the room. The place smells of wood smoke and roasting meat. At any given time during the day, 2d4 villagers are eating or drinking here.
>
> **Marta Deepwell** runs the inn. She is a stout, no-nonsense woman in her 50s with grey-streaked red hair and flour-dusted apron. Marta is fiercely protective of her regulars and suspicious of outsiders, but can be won over with honest conversation and good coin. She charges 5sp per night for a room (there are four rooms upstairs, each with two beds) and 2sp for a meal and drink.
>
> Marta knows the following information:
> - The old mill on the river has been making strange noises at night for the past week
> - Farmer Aldric hasn't been seen in three days and his fields are going untended
> - A group of soldiers from the Baron's garrison passed through heading north two days ago — they seemed worried
> - There's an herbalist named Sage who lives in the woods east of town who might know about strange happenings
>
> If the characters ask about hiring help, Marta will direct them to **Brok**, a retired soldier who drinks here most evenings. Brok is willing to serve as a guide to the old mill for 1gp per day. He knows the terrain well but will not enter the mill itself — "something wrong about that place."
>
> Behind the bar, Marta keeps a locked strongbox (DC 20 to pick) containing the inn's earnings: 45gp, 120sp. A loaded crossbow is mounted under the bar within her reach.

### AFTER

```
Crossed Swords Inn 3) | **Timber-Frame** → two-story, village center
                        **Sign** → crossed longswords, creaking
                        **Common Room** → fireplace E wall → six oak tables
                                       → smoke, roasting meat
                        **Villagers** (2d4) → eating, drinking

                        **Marta Deepwell** (Protective/Suspicious → warm w/ honesty + coin)
                          Stout, 50s, red hair, flour apron
                          → Room → 5sp/night (4 rooms, 2 beds ea.)
                          → Meal + drink → 2sp
                          → Mill on river → strange noises at night, past week
                          → Farmer Aldric → missing 3 days, fields untended
                          → Baron's soldiers → headed N, 2 days ago, worried
                          → Sage → herbalist, woods E of town
                          |→ **Brok** → retired soldier, here evenings

                        **Brok** (evenings)
                          → mill guide → 1gp/day → won't enter mill
                          → "something wrong about that place"

                        Behind bar → strongbox → locked DC 20 → 45gp, 120sp
                                  |→ crossbow → loaded, under bar (Marta's)
```

**Notes**: Marta's attitude is in parentheses after her name. Her knowledge decomposes as arrow chains — each piece of info she can share. Brok branches off Marta because she refers players to him. Behind bar is not bold — patrons can't see it.

---

## Example 3: Hazardous Environment

### BEFORE

> **12. The Flooded Crypt**
>
> Steps descend 10 feet into murky, stagnant water that fills this crypt to a depth of 3 feet. The water is cold and foul-smelling, with a thin film of greenish scum on the surface. The ceiling is low, only 7 feet above the water's surface, and covered in dripping condensation. Visibility in the water is zero — characters cannot see their feet.
>
> Six stone sarcophagi are arranged in two rows of three, their tops just above the waterline. The lids are carved with the likenesses of armored warriors. The sarcophagi are sealed with lead and extremely heavy (DC 20 Strength to open, or two characters can combine efforts at DC 14 each).
>
> The third sarcophagus in the east row (closest to the far wall) contains the remains of Sir Aldred and his enchanted longsword, *Dawnbringer* (+1 longsword, sheds bright light 20ft/dim 40ft on command). The other five contain skeletal remains and corroded grave goods of no value.
>
> Hazard: The water conceals a 5-foot-deep pit in the center of the room (between the two rows of sarcophagi). Characters wading through must succeed on a DC 12 Perception check to notice the drop-off before stepping in. Failing means falling into water over their head. Characters in heavy armor must succeed on a DC 10 Strength (Athletics) check each round or begin drowning. The pit also contains the skeletal remains of a previous adventurer, still wearing a *cloak of elvenkind*.
>
> The south wall has a corroded bronze door, swollen shut. DC 16 Strength to force open, leads to Room 14.

### AFTER

```
Flooded Crypt 12) | **Steps** → descend 10ft → murky water → 3ft deep → cold, green scum
                    **Ceiling** → low, 7ft → dripping
                    **Water** → zero visibility
                    **Sarcophagi** (6) → two rows of three → tops above waterline
                                      → lids → carved armored warriors → sealed, lead
                                      → DC 20 Str (DC 14 ea. if two)
                                      → E row, 3rd → Sir Aldred → **Dawnbringer**
                                        (+1 longsword, light 20ft bright/40ft dim)
                                      → other five → bones, corroded junk

                    Pit → center, between rows → 5ft deep → DC 12 Perception
                       → fall in → water over head
                                 → heavy armor → DC 10 Athletics/round → drowning
                       → bottom → skeleton → **cloak of elvenkind**

                    **Bronze Door** S → corroded, swollen shut → DC 16 Str → Room 14
```

**Notes**: The pit is not bold — concealed by water. Sarcophagi decompose into their physical description → opening method → contents. The pit decomposes into detection → consequences → reward at the bottom.

---

## Example 4: Minimal Room

### BEFORE

> **5. Guardroom**
>
> This small room contains a wooden table, two chairs, and a weapon rack holding three spears and a shortbow with a quiver of 12 arrows. A half-eaten meal sits on the table — the guards left in a hurry. A door on the north wall leads to the corridor (Room 6).

### AFTER

```
Guardroom 5) | **Table** → two chairs → half-eaten meal (guards left in hurry)
               **Weapon Rack** → 3 spears, shortbow, 12 arrows
               N → Room 6
```

Three lines. That's all it needs.
