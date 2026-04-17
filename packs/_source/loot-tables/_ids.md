# Loot Tables — ID Reference

RollTable IDs used in this pack. IDs are stable across rebuilds — cross-table
`documentUuid` references depend on these. **Do not renumber.**

A leading `_` on this filename keeps it out of the build; `utils/packs.mjs`
walks every subdir of `packs/_source/` but only compiles `.yml` files.

## Top-level Loot Tables

| Table          | ID                 | Source                     |
|----------------|--------------------|----------------------------|
| Loot Table 1   | `lt00000000000001` | Scholar's Guide p.152      |
| Loot Table 2   | `lt00000000000002` | Scholar's Guide p.153      |
| Loot Table 3   | `lt00000000000003` | Scholar's Guide p.153      |
| Loot Table 4   | `lt00000000000004` | Lore Master's Manual p.241 |
| Loot Table 5   | `lt00000000000005` | Lore Master's Manual p.241 |

## Scholar's Guide subtables

| Table                          | ID                 | Page   |
|--------------------------------|--------------------|--------|
| Books & Maps                   | `lt00000000000006` | p.153  |
| Tome of Ancient Lore           | `lt00000000000007` | p.154  |
| Gear                           | `lt00000000000008` | p.155  |
| Weapons                        | `lt00000000000009` | p.156  |
| Magic                          | `lt0000000000000a` | p.157  |
| Potions                        | `lt0000000000000b` | p.158  |
| Cursed Item                    | `lt0000000000000c` | p.158  |
| Stuff                          | `lt0000000000000d` | p.159  |
| Treasure & Valuables 1         | `lt0000000000000e` | p.159  |
| Treasure & Valuables 2         | `lt0000000000000f` | p.159  |
| Coins Subtable 1               | `lt00000000000010` | p.159  |
| Coins Subtable 2               | `lt00000000000011` | p.160  |
| Gem Subtable 1                 | `lt00000000000012` | p.160  |
| Jewelry Subtable 1             | `lt00000000000013` | p.160  |
| Magical Gems                   | `lt00000000000014` | p.161  |

## Lore Master's Manual subtables (Richer Loot)

| Table                   | ID                 | Page   |
|-------------------------|--------------------|--------|
| Treasure & Valuables 3  | `lt00000000000015` | p.241  |
| Treasure & Valuables 4  | `lt00000000000016` | p.241  |
| Coins Table 3           | `lt00000000000017` | p.242  |
| Coins Table 4           | `lt00000000000018` | p.242  |
| Works of Art            | `lt00000000000019` | p.242  |
| Jewelry Table 2         | `lt0000000000001a` | p.242  |
| Silver & Plate          | `lt0000000000001b` | p.243  |
| Rugs & Tapestries       | `lt0000000000001c` | p.243  |
| Titles & Deeds          | `lt0000000000001d` | p.244  |

## Sub-sub-tables (promoted inline rolls)

### Gear Subtable promotions (SG p.155)

| Table                                    | ID                 | Parent row |
|------------------------------------------|--------------------|------------|
| Rare Item (1d6)                          | `lt0000000000001e` | Gear 4     |
| Battle Regalia (1d2)                     | `lt0000000000001f` | Gear 5     |
| Sacks and Such (1d6)                     | `lt00000000000020` | Gear 6     |
| Fortunate Food Type (1d6)                | `lt00000000000021` | Gear 7     |
| Equipment (1d6)                          | `lt00000000000022` | Gear 8     |
| Light Source Type (1d6)                  | `lt00000000000023` | Gear 9     |
| Supplies (1d6)                           | `lt00000000000024` | Gear 10    |
| Clothing (1d6)                           | `lt00000000000025` | Gear 11    |
| Bottles and Barrels (1d6)                | `lt00000000000026` | Gear 12    |
| Armor Type (1d6)                         | `lt00000000000027` | Gear 15    |
| Animal (1d4)                             | `lt00000000000028` | Gear 16    |
| Hidden Dwarven or Elven Armor (1d6)      | `lt00000000000029` | Gear 18    |

### Magic Subtable promotions (SG p.157)

| Table                       | ID                 | Parent row |
|-----------------------------|--------------------|------------|
| Wards and Charms (1d6)      | `lt0000000000002a` | Magic 3    |
| Staves and Wands (1d6)      | `lt0000000000002b` | Magic 4    |
| Enchanted Clothing (1d6)    | `lt0000000000002c` | Magic 6    |
| Scroll Circle (1d6)         | `lt0000000000002d` | Magic 8    |
| Relic Type (1d6)            | `lt0000000000002e` | Magic 9    |
| Magical Gear (1d6)          | `lt0000000000002f` | Magic 10   |
| Enchanted Weapon (1d6)      | `lt00000000000030` | Magic 11   |
| Enchanted Armor (1d6)       | `lt00000000000031` | Magic 12   |

## Compendium UUID format

- RollTables: `Compendium.tb2e.loot-tables.RollTable.<id>`
- Linked Items: `Compendium.tb2e.<pack>.Item.<id>` where `<pack>` is
  `loot` (aa…), `richer-loot` (dd…), `equipment` (a3b4…), `light-sources`
  (e1f2…), `clothing` (d4e5…), `containers` (a1b2…), `weapons`,
  `armor`, `magic-items` (cc…), `potions` (bb…), `magical-religious` (8a7b…),
  `food-and-drink` (b1c2…), or `bulk-goods` (c3d4…).
