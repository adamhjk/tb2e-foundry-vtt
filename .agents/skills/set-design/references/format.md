# Set Design Format Reference

## Room Header

Each location starts with its name/number and a pipe, then the first visible element:

```
Kitchen 17) | **Tables** → Stained, **Wooden Cask** → Giant Tick!
```

Or the header on its own line if the room is complex:

```
1. Rune-Covered Dolmen
---
**Standing Stones** (2) → rune-scrawled → table stone cap
```

## The Arrow `→`

The arrow is the fundamental building block. `X → Y` means "looking at/into/behind X, you find Y." It covers all relationships — containment, discovery, consequence, decomposition:

- **Containment**: `**Chest** → 500gp, potion`
- **Decomposition**: `**Bodies** → Human → Male → Bandit (2)`
- **Discovery**: `Floor → loose flagstone → iron key`
- **Consequence**: `**Stairway** → Triggers Magic Mouth → "Welcome!" (Audio Only)`
- **Investigation**: `Dolmen → Ob 3 Lore Master → passage grave, ancient chieftain`

Arrows can chain: `**Pool** → Mineral Formation → Skeleton → Hand → Key`

## Branching `|→`

When one thing leads to multiple independent paths, use `|→`:

```
**Portcullis** → wooden → blocks tunnel
             |→ can pass under
             |→ If party noticed → 2 Toad-Man Sentries approach
```

## Bold `**text**`

Bold marks what players perceive the moment they enter. These are the top-level entries the DM describes first. Everything else is discovered through interaction.

Bold items are short noun phrases — the thing itself, plus one or two immediate qualities:
- `**Ornate Columns** → Damaged`
- `**5 Bodies** → Human → Male`
- `**Tiled Floor** → Elaborate coloured mosaic, Broken Tiles`
- `**Stream** → Cold, Fast, N to S, 7'-5' wide, 3'-5' deep`

If something requires a check to notice, it is NOT bold.

## Stats

Stats go in italic parentheses on their own line or inline:

```
**Wooden Cask** → Giant Tick!
  (_AC 16, HD 3, HP 19, Bite +5/1-4/1-6 auto, ML (20) XP 141_)
```

For Torchbearer: `(_Nature 6, Might 4, Disposition 10_)`

## NPC/Creature Blocks

Name in bold at the top. Behavior/attitude in parentheses. Then what they offer, want, know — as arrow chains, not labeled categories:

```
**Gundren Rockseeker** (Excited/Secretive/Friendly)
  → **Job** → haul provisions, immediate
             → **Brothers** → Tharden and Nundro
             → **"something big"** → won't tell
             → **10gp/day** → persuade DC 15 → 30gp/day
  → **Leaving early** → horseback
                       → **Sildar Hallwinter** → warrior escort
```

Reaction modifiers go right after the name/attitude line if applicable.

## Indentation

Indentation shows the tree structure. Sub-items indent under their parent. Deeper = more nested = more investigation required to find:

```
**6 Alcoves** → Broken Statues → Minor Pleasure Goddesses (Knowledge to ID)

The Statues →
       Holding Writing Tablet (Calliope, Epic Poetry),
       Lyre (Terpsichore, Dance),
       Comic mask (Thalia, Comedy),
       Tragic mask (Melpomene, Tragedy)
```

Top-level = what you see first. Each indent level = one more step of interaction.

## Treasure

Treasure items get broken down like everything else. Material, value, weight, and special properties are all arrow-chained:

```
**Ornate Iron Armchair** → Dwarven, decorative cobalt inlay (900gp) 65lbs. + Bulky
**Blanket** (60gp) Chiffon, covering → **ottoman**, Hollow slate (200gp) 35lbs.
  → **Gem**, Kunzite (202gp)
  → Human sized **Iron mail** (Chain +1, weightless)
  → Fleece **Pouch** (Pouch of Accessibility)
```

## Connections and Exits

Exits are just more arrows, typically at the bottom or inline:

```
**Stairway** → Triggers Magic Mouth → "Welcome!" (Audio Only)
```

```
Down → Area 2
N passage → Area 5
S alcoves (4) → Areas 6-9
```

## What NOT to Do

- No prose sentences. No "This room was once a library."
- No category labels (Trigger:, Effect:, Knows:). The tree structure shows relationships.
- No redundant information. If it's on the map, don't repeat it unless mechanically relevant.
- No abbreviating when you should be decomposing. Don't compress "five human male bodies, two bandits and three adventurers" into "5 bodies (2 bandits, 3 adventurers)". Break it DOWN: `**5 Bodies** → Human → Male → Bandit (2) → ...`
