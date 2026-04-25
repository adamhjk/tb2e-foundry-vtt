# Camp Panel — Implementation Plan

**Rules source:** Scholar's Guide pp. 90–96 (Camp), Dungeoneer's Handbook p. 81 (Spending Checks).
Extracted at `../reference/rules/camp/` and `../reference/rules/camp-checks/`.

**Style guide:** `module/applications/conflict/conflict-panel.mjs` + `templates/conflict/panel*.hbs` + `less/conflict/panel.less`.
We are deliberately mirroring the Conflict Panel's wizard shape: header bar, tab strip with state icons (`✓` / `▶` / `○`), scrollable content, roster strip at the bottom.

**Scaffold already in place:**
- `module/applications/camp-panel.mjs` — empty AppV2 singleton
- `templates/camp-panel.hbs` — placeholder shell
- `fa-campground` button in the scene-controls toolbar
- `tests/e2e/camp/open-close.spec.mjs` — open/close via toolbar passes

This plan layers the real procedure onto that scaffold.

---

## 1. Rules we must enforce (source of truth)

Each bullet is a rule we will cite in code comments and verify with an e2e test. **When the test disagrees with the rule, the test is right and the code must change.**

### Entry conditions (SG p. 90 "Making Camp")
- Party has ≥ 1 check among them.
- GM judges the party is not in conflict or immediate peril.
- There is a place to rest.

### Procedure (SG p. 90 "Camp Phase Procedure")
1. GM determines camp type.
2. GM selects danger level.
3. Players decide: survey the site (costs an adventure turn, uses Survivalist factors).
4. Players decide: lit fire or dark camp.
5. Players decide: set watch or not (one or more volunteers).
6. GM rolls 3d6 on the appropriate camp events table with modifiers applied.
7. Apply result — if no disaster, strategize and spend checks.

### Camp types (SG p. 91)
`ancient-ruins`, `dungeons`, `natural-caves`, `outside-of-town`, `squatting-in-town`, `wilderness`.

### Danger levels (SG p. 91 + p. 93)
- `typical`: 0
- `unsafe`: −2
- `dangerous`: −3

### Dark camp (SG p. 92 + p. 93)
- Reduces danger penalty by 1 (unsafe → −1, dangerous → −2).
- Blocks fire-dependent actions: cooking, distilling alchemical solutions, forging arrowheads.
- All recovery tests in dark camp suffer +1 Ob.

### Watch (SG p. 92)
- Watchers grant **+1** to the events roll regardless of count.
- Additional watchers may help the avert test; non-watchers may not.
- Watchers **cannot** make recovery tests, memorize spells, or purify Immortal burden this camp.
- Watchers **may** spend checks on other tests (repair armor, forage).
- If the roll is a disaster, watch may spend **1 check** to attempt an avert (test or conflict); failure ends camp. Some disasters are unavertable (e.g. cave-ins).

### Events-roll bonuses (SG p. 93, cumulative)
- Shelter (from Survivalist): +1
- Concealment (from Survivalist): +1
- Ranger in party while in wilderness: +1
- Outcast in party while exploring dungeons or dwarven-made structures: +1
- Watch set: +1
- Prior camp-events bonuses persist on return.
- Water sources grant no roll bonus.

### Events-roll penalties (SG p. 93)
- Typical 0 / Unsafe −2 / Dangerous −3.
- Dark-camp relief: reduce danger penalty by 1.
- Prior disasters this adventure in this area: cumulative −1 each.
- GM situational: −1 for natural phenomena, pursuing foes, curses, etc.

### Safe vs. disaster (SG p. 94)
- **Safe:** no further events; proceed to strategize.
- **Disaster + no watch:** break camp immediately, no rest, **all checks lost**.
- **Disaster + watch:** spend 1 check to avert. If averted, continue; if failed, camp ends.

### Spending checks (SG p. 94–95, DH p. 81)
- 1 check = 1 test (or conflict) in camp.
- Players may share checks peer-to-peer at any time during the phase.
- Helping in camp is free (does not cost a check) — with one exception below.
- Memorizing spells: 1 check, **once per camp**.
- Purifying Immortal burden: 1 check, **once per camp**.
- Spells and invocations: cost a check only if they require a turn to cast/perform. **Receiving help on a spell or invocation always costs 1 check regardless of cast time** (SG p. 95 — this is the only camp exception to "help is free").
- Instincts in camp are free **unless the adventurer is exhausted**.
- Failed recovery tests in camp do **not** generate twists or conditions.
- Checks may not be spent to explore or fight creatures (conflict-in-camp still costs one check).

### Rules that we deliberately DO NOT enforce in code (table-enforced)
- **"No player may make two tests in a row"** (SG p. 95). GM / table enforces.
- **Camp Instincts satisfied before break** (SG p. 95). GM / table enforces.

### Breaking camp (SG p. 95–96)
- Triggered when all checks are spent/discarded and camp instincts satisfied, OR on an ending disaster.
- Unspent checks are **discarded** — lost.
- Inventory that can't be packed out is left behind.
- Light sources with turns remaining may be continued where they left off.
- Upon breaking, turn count **resets to 1** for the next adventure phase.

---

## 2. Architecture

### Persistence model — Camp is an Actor

Camps are **map-pinned, persistent locations** (SG pp. 91, 93, 94): amenities accumulate, disasters leave marks, and parties return. A world setting can't model that. We add a new Actor type `camp` so the GM can:

- Create a named camp actor when the party first makes camp at a new site.
- Continue an existing camp actor when the party returns to a known site.
- Drag camp actors onto scenes as tokens / notes for map pinning.
- Keep pre-built "canned" camps for adventure modules in compendium packs (future).
- Inspect amenities, prior disasters, and visit history from the actor sheet.

Why Actor (not JournalEntry or custom document): TB2E already extends Actor for `character` / `monster` / `npc` (`module/data/actor/`, `module/applications/actor/`, `CONFIG.Actor.dataModels`). Reusing that machinery gives us sheet UI, scene-token placement, compendium packs, and flags — all things JournalEntry would require us to rebuild.

### Camp actor data model (`module/data/actor/camp.mjs`)

Persistent, survives across visits:

```json
{
  "type":             "ancient-ruins" | "dungeons" | "natural-caves" |
                      "outside-of-town" | "squatting-in-town" | "wilderness",
  "defaultDanger":    "typical" | "unsafe" | "dangerous",
  "amenities":        { "shelter": false, "concealment": false, "water": false },
  "persistentEvents": [ { "key": "cave-in", "note": "...", "ts": 0 } ],
  "disastersThisAdventure": 0,
  "visits":           [ { "sessionId": "...", "ts": 0, "outcome": "safe|averted|ended", "disasterKey": null } ],
  "notes":            ""
}
```

Adventure-scoped state (`disastersThisAdventure`, eventually `visits` filtered by adventure) resets when the GM advances to a new adventure — manual button on the camp sheet in v1, eventually hooked to an Adventure phase tracker.

### Session state — world setting `tb2e.campState`

Ephemeral, resets on Break Camp. Holds a **pointer** to the active camp actor plus per-visit choices that don't belong on the actor:

```json
{
  "active":        false,
  "campActorId":   null | "<actorId>",
  "phase":         "select" | "setup" | "decisions" | "events" | "strategy" | "break",
  "danger":        "typical" | "unsafe" | "dangerous",   // this visit only; may override defaultDanger
  "survey":        { "performed": false, "shelter": false, "concealment": false, "water": false },
  "fire":          "lit" | "dark",
  "watchers":      ["<actorId>", ...],
  "events": {
    "rolled":       false,
    "dice":         [0, 0, 0],
    "modifier":     0,
    "total":        0,
    "resultKey":    null,
    "isDisaster":   false,
    "averted":      null,
    "outcome":      "pending" | "continuing" | "averted" | "ended"
  },
  "log":           [ { "actorId": "...", "kind": "test|share|memorize|purify|avert", "detail": "...", "ts": 0 } ],
  "memorizedBy":   ["<actorId>", ...],
  "purifiedBy":    ["<actorId>", ...]
}
```

Survey **discoveries** flow *back* to the camp actor on Break Camp: newly-found amenities persist (SG p. 91), and any disaster outcome increments `disastersThisAdventure` and appends to `visits`.

### Ranger / Outcast detection

Character actors store class as a plain string: `actor.system.class` (`module/data/actor/character.mjs:17`). Classes use lowercase identifiers (confirmed from `module/data/actor/chargen.mjs:527`, where `SHIELD_ELIGIBLE_CLASSES = ["outcast", "theurge", "warrior", "shaman"]`). So:

- **Ranger-in-wilderness bonus** (SG p. 93): `partyHasRanger && campType === "wilderness"`.
- **Outcast-in-dungeon bonus** (SG p. 93): `partyHasOutcast && (campType === "dungeons" || dwarvenMade)`. The "dwarven-made" flavor doesn't map to a camp type enum value — we'll treat it as a GM-toggleable checkbox on the camp actor (`system.isDwarvenMade`) that also grants the outcast bonus.

### Events tables — Foundry RollTable compendium

Events tables are Foundry `RollTable` documents shipped in a new compendium pack `tb2e.camp-events`. This reuses the idiom already established by `TB2ELootTable` (`module/documents/loot-table.mjs`, pack `tb2e.loot-tables`) and gives us:

- Native 3d6-with-modifier rolling (`table.roll({ roll: new Roll("3d6 + @mod", { mod }) })`).
- Recursive subtable drawing + chain-trace (already implemented in `TB2ELootTable.roll()`; applies to *all* RollTables regardless of pack).
- Compendium packaging via the existing YAML → LevelDB pipeline (`packs/_source/camp-events/` → `packs/camp-events/`).
- GM customization: GMs can import any camp-events table into their world and edit it.

**Content rule (per user):** results store only the **name + page reference**, never the full prose. GMs and players read the rule text from the book. Example result name: `"Cave-in (SG p. 270)"`.

**One main table per camp type** (6 tables, formula `3d6`):

```
packs/_source/camp-events/
  Ancient_Ruins_ce0000000000001.yml          ← SG pp. 266–267, 19 results
  Dungeons_ce0000000000002.yml               ← SG pp. 268–269
  Natural_Caves_ce0000000000003.yml          ← SG pp. 270–271
  Outside_Town_ce0000000000004.yml           ← SG pp. 272–273
  Squatting_In_Town_ce0000000000005.yml      ← SG pp. 274–276
  Wilderness_ce0000000000006.yml             ← SG pp. 276–277
```

**Subtables** are separate RollTables in the same pack, referenced from a parent result via `documentUuid: Compendium.tb2e.camp-events.RollTable.<id>`. Each inner-roll prompt in the rules becomes one subtable. Identified from the extracted rules:

| Parent table          | Parent result           | Subtable                       | Formula | Source       |
|-----------------------|-------------------------|--------------------------------|---------|--------------|
| Ancient Ruins         | 7 Strange corrosion     | `Corrosion Location`           | 1d6     | SG p. 267    |
| Dungeons              | 3 Monsters attack       | `Dungeon Interlopers`          | 1d6     | SG p. 268    |
| Dungeons              | 4 Curiosity             | `Dungeon Curiosity`            | 1d6     | SG p. 268    |
| Natural Caves         | 1 Lair                  | `Cave Lair Owner`              | 1d6     | SG p. 270    |
| Natural Caves         | 5 Raid                  | `Cave Raiders`                 | 1d6     | SG p. 270    |
| Outside Town          | 3 Raiding beasts        | `Near-Town Raiders`            | 1d6     | SG p. 272    |
| Squatting in Town     | 3 Late night lurker     | `Town Lurkers`                 | 1d6     | SG p. 274    |
| Squatting in Town     | 11 Dalliance            | `Teen Activity`                | 1d6     | SG p. 275    |
| Squatting in Town     | 15 Eavesdropping        | `Eavesdrop Topic`              | 1d6     | SG p. 275    |
| Squatting in Town     | 19 Disembodied eyes     | `House Goblin Consequence`     | 1d6     | SG p. 276    |
| Wilderness            | 5–6 Wandering monsters  | `Wilderness Wanderers`         | 1d6     | SG p. 277    |

**Document linkage** — wherever an event points to a monster or item, the subtable result links into the appropriate compendium:

- Monster encounters → `Compendium.tb2e.monsters.Actor.<id>` (e.g. Black Dragon, Stone Spider, Ghouls).
- Loot references (Gear, Tome of Ancient Lore, Works of Art, Magic, Treasure & Valuables, Books & Maps, Gems, Tavern Rumors) → link to the existing tables in `tb2e.loot-tables`. Per-event names like "Roll on the Gear subtable" become result rows with `documentUuid` pointing at that loot table.
- Missing monsters (e.g. Strix, Troll rat, Linnorm, Troll bear, Owlbear, Troll haunt, Stone spider, Kobold, Troll bat, Dragefolk raider, Gnoll, Hobgoblin, Bugbear, Sprikken, Wererat, Thug, Dire wolf, Devil boar) are a **follow-up** to populate `packs/_source/monsters/` as needed; placeholders with just a text name are acceptable until the monster actors exist.

**Per-result `flags.tb2e.campEvents`** holds the TB2E-specific metadata the panel needs:

```yaml
flags:
  tb2e:
    campEvents:
      isDisaster:    true
      isUnavertable: false        # true when the prose says "nothing can be done" / "no watch will save you"
      avert:                      # null if not a disaster
        allowed: true
        kind:    test             # or "conflict"
        skill:   scout            # skill/ability key
        ob:      4
        notes:   "Watch may spend 1 check to sound the alarm and get the group to safety."
      # For safe camp results, all three flags are omitted / false.
```

**Clamp behavior.** 3d6 produces 3–18, but modifiers can push out-of-envelope. `table.roll({ roll })` natively clamps to the result-range bounds — whatever range the lowest / highest result covers will catch out-of-bound totals.

Source attribution lives in `description` at the table level (`"Scholar's Guide, pp. 266–267 — Ancient Ruins Camp Events"`) and per-result as a parenthetical page reference in `name`.

### Chat card — reuse the loot-draw style

Per the user: the camp-events chat card uses the **same visual treatment as the loot-draw card** (`templates/chat/loot-draw.hbs` — golden-amber accent, table portrait header, chain-trace links, terminal drops with content-link anchors + drag handles). Rationale: it's the right aesthetic for a camp moment, and reusing the template keeps us DRY.

Implementation:

- Broaden `TB2ELootTable` so it also intercepts `draw()` for tables in `tb2e.camp-events`. Introduce a `#TB2E_PACKS = new Set(["tb2e.loot-tables", "tb2e.camp-events"])` and replace the single-pack check.
- Extract `_toLootMessage` into a `_toTb2eMessage({ kind, label, icon })` that takes a small context object so the header label can read "Camp Event" (icon `fa-solid fa-campground`) vs "Draw Loot" (icon `fa-solid fa-coins`). The template receives `kind` and swaps `card-label` content.
- Existing loot-table behavior is unchanged — still called `_toLootMessage` under the hood, just with `{ kind: "loot", label: "TB2E.Loot.Draw", icon: "fa-solid fa-coins" }`.

The Events tab in the Camp Panel triggers the draw on "Roll 3d6". The chat card posts automatically. The panel reads the drawn TableResult by id and renders its own interactive block (avert buttons, GM unavertable override, continue-to-break). The result exists in exactly one place (the TableResult), surfaced in both chat and panel — they stay in sync.

### Singleton + entry points

`module/applications/camp/camp-panel.mjs` stays a singleton on `game.tb2e.campPanel`. Opened via:
- Campground button in tokens scene-controls (already wired).
- Optionally: "Open in Camp Panel" button on the camp actor sheet header.
- *Not auto-opened* on `grindPhase` change (per earlier user call).

### Mailbox fields (per CLAUDE.md Mailbox Pattern)

Per-actor flag on the **PC actor** (not the camp actor), processed in `updateActor`:
- `flags.tb2e.pendingCampAction` — `{ kind: "spend-check" | "share-check" | "avert" | "memorize" | "purify" | "help-spell", payload: {...} }`

Camp-actor writes happen GM-side only; players never write to camp actors directly.

**Share-check peer-to-peer.** A player shares a check by writing a handoff flag on their own actor: `flags.tb2e.pendingCampAction: { kind: "share-check", toActorId, amount }`. The GM client auto-processes (no approval workflow — sharing is unconditionally allowed per DH p. 81): decrement giver's `system.checks`, increment receiver's `system.checks`, append a log entry, clear the flag. We label this "peer-to-peer" because no GM judgment is involved; the GM client is just the only process with write access to both actors.

### Tabs
| id         | label       | icon                        | enter gate                                                        |
|------------|-------------|-----------------------------|-------------------------------------------------------------------|
| `select`   | Site        | `fa-solid fa-map-location-dot` | Always (GM lands here first — pick existing camp or create new)|
| `setup`    | Setup       | `fa-solid fa-campground`    | `campActorId` set AND party has ≥1 check (SG p. 90)               |
| `decisions`| Decisions   | `fa-solid fa-person-hiking` | `danger` set for this visit                                       |
| `events`   | Events      | `fa-solid fa-dice-d6`       | Decisions complete (survey flags, fire, watchers finalized)       |
| `strategy` | Strategy    | `fa-solid fa-clipboard-list`| Events rolled; `outcome` is `continuing` or `averted`             |
| `break`    | Break Camp  | `fa-solid fa-sun`           | Strategy entered once; or forced on ending disaster               |

Tabs use the same `completed`/`current`/`upcoming` state-icon system from `templates/conflict/panel.hbs:41-54`.

### Rendering hooks
Subscribe in `_onFirstRender`, unsubscribe in `_onClose` (same pattern as `ConflictPanel`):
- `updateSetting` (filter on `tb2e.campState`) → re-render
- `updateActor` (filter on party members) → re-render roster strip
- `updateItem` → re-render roster strip (for check count changes)

---

## 3. Visual layout (ASCII mockups)

Panel footprint: **width 572, height 682** (matches `ConflictPanel.DEFAULT_OPTIONS.position`). Tokens: dark gradient header (`--tb-bg-dark` → `--tb-bg-darkest`), amber accents for camp/fire (`--tb-amber`, `--tb-amber-glow`) where conflict uses blue.

### Shell (constant across all tabs)

```
┌───────────────────────────────────────────────────────────────┐
│  ⛺ CAMP · The Overlook · Natural Cave · Unsafe  Party:6✓  × │  panel-header-bar
│  ▲ Disasters here this adventure: 1  ·  Visits: 3             │
├───────────────────────────────────────────────────────────────┤
│  ✓ Site  ✓ Setup  ✓ Decisions  ▶ Events  ○ Strategy  ○ Break  │  panel-tabs
├───────────────────────────────────────────────────────────────┤
│                                                                │
│                                                                │
│                        (tab content)                           │  panel-content
│                                                                │
│                                                                │
├───────────────────────────────────────────────────────────────┤
│ 🧝 Thrar ✓✓  H&E │ 🧔 Grima ✓ 👁 │ 🧑 Mira · Exh │ 🗡 Pyre ✓✓✓  │  panel-roster
└───────────────────────────────────────────────────────────────┘
```

Legend: `✓` = a check · `👁` = on watch · `H&E` = Hungry/Exhausted badges · `Exh` = exhausted.

### Site tab — `panel-site.hbs`

```
╭─ Camp Site ──────────────────────────────────────────────────╮
│                                                              │
│   Continue an existing camp                                  │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │  ○ The Overlook                                          │ │
│ │      Natural Cave · Typical · Shelter, Water             │ │
│ │      Last visit: 2 sessions ago · 1 disaster here        │ │
│ │                                                          │ │
│ │  ●  Skogenby Barrow Entry                                │ │
│ │      Ancient Ruins · Dangerous · (no amenities)          │ │
│ │      Last visit: this session · 0 disasters              │ │
│ │                                                          │ │
│ │  ○ Stream in the Hollow                                  │ │
│ │      Wilderness · Typical · Water, Concealment           │ │
│ │      Last visit: last adventure · 0 disasters            │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│   ─── or ─────────────────────────────────────────────────   │
│                                                              │
│   [ + Create a new camp site ]                               │
│                                                              │
│                                          [ Next → ]          │
╰──────────────────────────────────────────────────────────────╯
```

- List is `game.actors.filter(a => a.type === "camp")`.
- "Create new" opens a mini-dialog (name, type, default danger) and creates the camp actor; the panel then advances to Setup with the new actor selected.
- Selecting an existing camp pre-populates Setup with that actor's `type` and `defaultDanger` (GM can override danger on this visit only).

### Setup tab — `panel-setup.hbs`

```
╭─ Make Camp ──────────────────────────────────────────────────╮
│                                                              │
│   Camp Site     Skogenby Barrow Entry  [ open sheet ⤴ ]      │
│   Type          Ancient Ruins  (locked; edit on sheet)       │
│                                                              │
│   Amenities (from prior visits)                              │
│     · Shelter      — not yet found                           │
│     · Concealment  — not yet found                           │
│     · Water source — not yet found                           │
│   (Amenities are earned via Survivalist tests — SG p. 91)    │
│                                                              │
│   Danger this visit                                          │
│   ( ) Typical      0                                         │
│   ( ) Unsafe      −2                                         │
│   (●) Dangerous   −3   ← default for this site               │
│     (overrides persist only for this visit)                  │
│                                                              │
│ ┌─ Party Check Pool ───────────────────────────────────────┐ │
│ │   Thrar    ✓✓        Mira    ·                           │ │
│ │   Grima    ✓         Pyre    ✓✓✓                         │ │
│ │   ─────────────────────────────                          │ │
│ │   Total    6 checks (≥1 required — SG p. 90)             │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│                        [ ← Back ]           [ Next → ]       │
╰──────────────────────────────────────────────────────────────╯
```

Disabled `Next` when party checks < 1.

### Decisions tab — `panel-decisions.hbs`

```
╭─ Decisions ──────────────────────────────────────────────────╮
│                                                              │
│   Survey the Camp Site                                       │
│   ☑ Surveyed   (costs an adventure turn — SG p. 91)         │
│      Amenities found (Survivalist tests, pre-camp):         │
│      ☑ Shelter        → +1 events roll                       │
│      ☐ Concealment    → +1 events roll                       │
│      ☐ Water source   → no events bonus                      │
│                                                              │
│   Fire                                                       │
│   (●) Lit camp fire                                          │
│   ( ) Dark camp                                              │
│       └─ Cooking / distilling / forging blocked              │
│          Recovery tests +1 Ob                                │
│          Danger penalty reduced by 1                         │
│                                                              │
│   Set Watch                                                  │
│   ┌────────────────────────────────────────────────────┐     │
│   │  ☑ Thrar    ☑ Grima    ☐ Mira    ☐ Pyre            │     │
│   └────────────────────────────────────────────────────┘     │
│   Watchers: no recovery / memorize / purify this camp        │
│             (SG p. 92). Other tests OK.                      │
│                                                              │
│                        [ ← Back ]          [ Next → ]        │
╰──────────────────────────────────────────────────────────────╯
```

Ranger/Outcast bonuses are computed from party composition and are *not* in this tab — they surface on the Events tab's modifier breakdown. Water-source has no bonus (SG p. 93) and is tracked for narrative only.

### Events tab — `panel-events.hbs`

```
╭─ Camp Events ────────────────────────────────────────────────╮
│                                                              │
│ ┌─ Modifier breakdown (SG p. 93) ──────────────────────────┐ │
│ │   Shelter                               +1               │ │
│ │   Concealment                            —               │ │
│ │   Ranger in wilderness                   —               │ │
│ │   Outcast in dungeon                    +1               │ │
│ │   Watch set                             +1               │ │
│ │   Danger: Unsafe                        −2               │ │
│ │   Dark-camp relief                       —               │ │
│ │   Prior disasters this adventure         —               │ │
│ │   GM situational         [ − ] 0 [ + ]                   │ │
│ │   ────────────────────────────────                       │ │
│ │   Net modifier                          +1               │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│            ╭─────────────────────╮                           │
│            │   🎲  Roll 3d6      │  →  [ 4 · 3 · 5 ] + 1 = 13│
│            ╰─────────────────────╯                           │
│                                                              │
│ ┌─ Result — Natural Caves · 0 ─────────────────────────────┐ │
│ │   CAVE-IN   (Disaster — SG p. 270)                        │ │
│ │                                                           │ │
│ │   The area you're camping in is obliterated. If you set   │ │
│ │   watch, they may spend a check to make a test to sound   │ │
│ │   the alarm and get the group to safety. Otherwise, remain│ │
│ │   in the adventure phase as camp ends; all packs and gear │ │
│ │   are destroyed in the chaos. Run!                        │ │
│ │                                                           │ │
│ │   Avert: watcher spends 1 ✓, Scout Ob 4                   │ │
│ │   [ Avert — Thrar (watcher) ]  [ Avert — Grima (watcher) ]│ │
│ │   [ GM override: unavertable ]                            │ │
│ │                                                           │ │
│ │   [ Continue to Break Camp → ]  (disabled until resolved) │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│                        [ ← Back ]                            │
╰──────────────────────────────────────────────────────────────╯
```

Non-disaster rendering (safe result):
```
 ┌─ Result ─────────────────────────────────────────────────┐
 │   9 · Natural Cave Events — A Quiet Night                 │
 │   No event. Proceed to strategize.                        │
 │   [ Next → ]                                              │
 └──────────────────────────────────────────────────────────┘
```

Avertable disaster rendering:
```
 ┌─ Result ─────────────────────────────────────────────────┐
 │   15 · ... — PROWLERS                                     │
 │   [ Avert — Grima spends 1 ✓ (Scout Ob 4) ]              │
 │   [ Avert — Thrar spends 1 ✓ (Scout Ob 4) ]              │
 │   [ Avert — GM rules this cannot be averted ]            │
 └──────────────────────────────────────────────────────────┘
```

Events tables are shipped in v1 (see §2 "Events tables"). The result card renders the table entry directly — title, body, disaster flag, avert config.

### Strategy tab — `panel-strategy.hbs`

```
╭─ Strategy ───────────────────────────────────────────────────╮
│                                                              │
│   Party Check Pool                                           │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │  Thrar ✓✓   Hungry, Exhausted                            │ │
│ │    [ Recover (1 ✓) ]  [ Memorize spell (1 ✓) ]          │ │
│ │    [ Purify burden (1 ✓) ]  [ Share → ]                  │ │
│ │                                                          │ │
│ │  Grima ✓    On Watch 👁                                  │ │
│ │    [ Repair armor (1 ✓) ]  [ Forage (1 ✓) ]             │ │
│ │    (Recover / Memorize / Purify disabled — SG p. 92)    │ │
│ │                                                          │ │
│ │  Mira  ·    Exhausted (instincts cost 1 ✓)               │ │
│ │    [ Receive check ← ]                                   │ │
│ │                                                          │ │
│ │  Pyre  ✓✓✓                                               │ │
│ │    [ Test (1 ✓) ]  [ Memorize (1 ✓) ]  [ Purify (1 ✓) ]  │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│   Camp Log                                                   │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │  · Thrar recovered Hungry (1 ✓)  — pass                  │ │
│ │  · Grima forage test           — pass, +2 rations        │ │
│ │  · Pyre memorized Aegis (1 ✓)                            │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│                           [ Break Camp → ]                   │
╰──────────────────────────────────────────────────────────────╯
```

Rule affordances this tab enforces:
- **Watcher lockout.** Recover / memorize / purify are disabled for watchers (SG p. 92).
- **Once-per-camp.** Memorize and purify disable after use per actor (tracked in `memorizedBy` / `purifiedBy`; SG p. 95).
- **Exhausted instincts.** Instincts button for an exhausted PC deducts a check; non-exhausted is free (SG p. 95).
- **Spell/invocation help surcharge.** When a PC "Helps" a spell or invocation test, the test actor is charged 1 additional check regardless of cast time (SG p. 95). Other help is free.

The "no two tests in a row" rule (SG p. 95) is table-enforced — we do not gate buttons in code.

### Break Camp tab — `panel-break.hbs`

```
╭─ Break Camp ─────────────────────────────────────────────────╮
│                                                              │
│   Camp Summary                                               │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │  Camp Type        Natural Cave                            │ │
│ │  Danger           Unsafe                                  │ │
│ │  Fire             Lit                                     │ │
│ │  Watch            Thrar, Grima                            │ │
│ │  Events Roll      13 (+1 mods) → Cave-In                  │ │
│ │  Outcome          ended (unavertable disaster)            │ │
│ │  Tests made       4                                       │ │
│ │  Checks spent     5                                       │ │
│ │  Checks remaining 3  ← will be discarded                  │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│   Breaking camp:                                             │
│     · Discard 3 unspent checks (SG p. 95)                    │
│     · Reset grind turn to 1 (SG p. 96)                       │
│     · Set grindPhase → adventure                             │
│     · Continue lit light sources at remaining turns          │
│                                                              │
│                [ ← Back ]        [ End Camp & Break → ]      │
╰──────────────────────────────────────────────────────────────╯
```

### Roster strip — `panel-roster-camp.hbs`

Reuses visual shape from `templates/conflict/panel-roster.hbs`:
```
│ 🧝 Thrar ✓✓ H&E │ 🧔 Grima ✓ 👁 │ 🧑 Mira · Exh │ 🗡 Pyre ✓✓✓  │
```

Per entry: portrait · name · checks pips · condition badges · watcher eye · last-tester dot.

---

## 4. File layout

Mirrors `module/applications/conflict/`, plus a new actor type:

```
module/data/actor/
  camp.mjs              ← new data model (type, amenities, history, …)
  _module.mjs           ← register camp in config map

module/applications/actor/
  camp-sheet.mjs        ← ActorSheetV2 for camp type (minimal: name, type,
                          amenities checklist, visit history, notes)
templates/actors/
  camp-sheet.hbs        ← plural `actors/` to match existing npc/monster sheets

module/applications/camp/
  camp-panel.mjs        ← moved from module/applications/camp-panel.mjs
  mailbox.mjs           ← GM-side processor for pendingCampAction
  _module.mjs

templates/actor/
  camp-sheet.hbs

templates/camp/
  panel.hbs             ← shell + tab strip + roster include
  panel-site.hbs        ← site picker (continue / new)
  panel-setup.hbs
  panel-decisions.hbs
  panel-events.hbs
  panel-strategy.hbs
  panel-break.hbs
  panel-roster.hbs
  new-camp-dialog.hbs   ← mini dialog for "Create new camp site"

less/camp/
  panel.less
  sheet.less            ← camp actor sheet styling

module/data/camp/
  state.mjs             ← schema + helpers for tb2e.campState (session)

packs/_source/camp-events/
  Ancient_Ruins_ce0000000000001.yml           ← SG pp. 266–267
  Dungeons_ce0000000000002.yml                ← SG pp. 268–269
  Natural_Caves_ce0000000000003.yml           ← SG pp. 270–271
  Outside_Town_ce0000000000004.yml            ← SG pp. 272–273
  Squatting_In_Town_ce0000000000005.yml       ← SG pp. 274–276
  Wilderness_ce0000000000006.yml              ← SG pp. 276–277
  <subtable>.yml                              ← one per subtable in §2
```

Update:
- `module/applications/_module.mjs` — export `CampSheet`, `CampPanel`.
- `module/data/actor/_module.mjs` — add camp to the config map.
- `module/documents/loot-table.mjs` — broaden `isLootTable` / `_toLootMessage` to handle `tb2e.camp-events` as well; pass a `{ kind, label, icon }` context into the shared chat template.
- `templates/chat/loot-draw.hbs` — swap the hardcoded `.card-label` content for `kind`-driven label + icon from context.
- `tb2e.mjs` — register camp sheet via `DocumentSheetConfig`; preload templates.
- `less/tb2e.less` — add new partials.
- `lang/en.json` — new `TB2E.Camp.*` keys (including `TB2E.CampEvents.Draw` for the chat label).
- `system.json` — add `camp` to the `documentTypes.Actor` list AND register the new compendium pack `tb2e.camp-events` (type `RollTable`).

---

## 5. Implementation checklist

### Phase A — Panel shell refactor ✅
- [x] Move `module/applications/camp-panel.mjs` → `module/applications/camp/camp-panel.mjs`; add `_module.mjs`.
- [x] Update barrel re-export path; keep singleton at `game.tb2e.campPanel`.
- [x] Split placeholder template into `templates/camp/panel.hbs` with header bar, tab strip (6 tabs with state icons), scrollable `.panel-content`, roster include.
- [x] Add `static PARTIALS` array and `static { Hooks.once("init", ...) }` preloader (mirror `ConflictPanel`).
- [x] Register state icon + tab strip markup driven by a `tabs` context array.
- [x] Keep open/close e2e test green. Added `tests/e2e/camp/tab-strip.spec.mjs` to lock the tab structure in place.

### Phase B — Camp Actor type ✅
- [x] `module/data/actor/camp.mjs` — `TypeDataModel` subclass with schema: `type` (enum), `defaultDanger` (enum), `amenities` (object of booleans), `isDwarvenMade` (boolean; feeds outcast bonus), `persistentEvents` (array), `disastersThisAdventure` (number), `visits` (array), `notes` (string).
- [x] Register in `module/data/actor/_module.mjs` config map.
- [x] Add `camp` to `system.json` → `documentTypes.Actor`.
- [x] Set the prototype token via `preCreateActor` hook: camping-tent icon (`systems/tb2e/icons/ffffff/transparent/1x1/delapouite/camping-tent.svg`) + `actorLink: true`.
- [x] `module/applications/actor/camp-sheet.mjs` — minimal ActorSheetV2 with name + type dropdown + amenities checklist + dwarven-made toggle + visit-history list + notes textarea + "Reset adventure disasters" button.
- [x] **Template path: `templates/actors/camp-sheet.hbs`** (plural `actors/` to match existing npc/monster sheets — plan §4 originally had `templates/actor/`; amended here).
- [x] Register the sheet via `DocumentSheetConfig.registerSheet` for `types: ["camp"]` in `tb2e.mjs` init.
- [x] Localization keys: `TB2E.Camp.Sheet.*`, `TB2E.Camp.Type.*`, `TB2E.Camp.Amenity.*`, `TB2E.SheetCamp`, `TYPES.Actor.camp`.
- [ ] `less/camp/sheet.less` — minimal sheet styling (amber accent to match panel). **Deferred to Phase J** (roster + styles) since no styling means no blocker for functional/test phases B2–I.
- [x] `tests/e2e/camp/camp-actor.spec.mjs` — verifies schema defaults, prototype token wiring, sheet renders with toggles and disaster reset.

### Phase B2 — Events RollTable compendium (from SG pp. 266–278) ✅
- [x] Register `tb2e.camp-events` pack in `system.json` (type `RollTable`).
- [x] Author one YAML file per main table in `packs/_source/camp-events/` — all six packed cleanly.
- [x] Author 12 subtables (added Fellow Traveler Class for Wilderness result 19 from SG p. 278 — **plan amendment**: originally 11 in §2, now 12 after extending the extraction to p. 278).
- [x] Each result `name` = `"<Event Title> (SG p.<N>)"`. Verified by `events-compendium.spec.mjs` — prose-body guard.
- [x] Each result's `flags.tb2e.campEvents = { isDisaster, isUnavertable, avert? }` populated from SG.
- [x] Unavertable entries hand-reviewed: Ancient Ruins 0-1 Collapse, 2 Pits of despair, 3 Terror; Dungeons 2 Foul vapors; Wilderness 3 Gnits.
- [x] Monster rows link to `Compendium.tb2e.monsters.Actor.<id>` where the actor exists. Linnorm and Troll bear are text placeholders (no existing monster).
- [x] Loot-subtable references link to `Compendium.tb2e.loot-tables.RollTable.<id>` — Tome of Ancient Lore (2×), Magic (2×), Works of Art, Treasure & Valuables 1 (2×), Gear (2×), Books & Maps, Gem. Tavern Rumors (SG pp. 273, 275) remains text — no table exists in `tb2e.loot-tables`; left with a page ref for the GM to reference.
- [x] Every result has a `_key: '!tables.results!<table_id>.<result_id>'`.
- [x] `npm run build:db` compiles the new pack — 18 tables packed (6 main + 12 sub).
- [x] `tests/e2e/camp/events-compendium.spec.mjs` — 5 specs: shape, prose guard, disaster flags, subtable linkage, loot linkage.

### Phase B3 — Chat card integration (extend TB2ELootTable) ✅
- [x] In `module/documents/loot-table.mjs`, replaced `TB2E_PACK` with `TB2E_PACK_KINDS` dispatcher (`tb2e.loot-tables` → loot kind, `tb2e.camp-events` → camp-event kind). Added a `tb2eKind` getter alongside `isLootTable` (kept for back-compat).
- [x] `_toLootMessage` takes a `kindCfg` and passes `kind`, `labelKey`, `labelIcon`, `bannerKey`, `bannerIcon` into the template. Flag key also varies (`lootDraw` vs `campEventDraw`).
- [x] `templates/chat/loot-draw.hbs` reads `kind` (adds `.loot-card--<kind>` class) and renders `labelIcon`/`labelKey` in the header and `bannerIcon`/`bannerKey` in the footer banner.
- [x] Localization: `TB2E.CampEvents.Draw` = "Camp Event"; `TB2E.CampEvents.CampIsMade` = "Camp is made".
- [x] `tests/e2e/camp/chat-card.spec.mjs`: camp-event draw posts amber card with "Camp Event" label + `fa-campground` + `fa-fire-flame-curved` banner; loot-table draws unchanged (no regression).

### Phase C — Session state + world setting ✅
- [x] Define `tb2e.campState` setting in `tb2e.mjs:init` — default via `defaultCampState()` from `module/data/camp/state.mjs`. **Amendment:** default `phase` is `"site"` (matching panel tab ids) rather than `"select"` in the original plan draft.
- [x] Add `module/data/camp/state.mjs` with helpers: `getCampState`, `getCampActor`, `defaultCampState`, `beginCamp`, `createAndBeginCamp`, `selectExistingCamp`, `setPhase`, `setDanger`, `toggleSurvey`, `setFire`, `toggleWatcher`, `setGmSituational`, `rollEvents`, `markAvertAttempt`, `recordTest`, `endCamp`.
- [x] All helpers GM-gated (`if (!game.user.isGM) return null`).
- [x] `endCamp` writes amenities back, appends visit entry, increments `disastersThisAdventure` when the outcome ends on a disaster, discards unspent PC checks (SG p. 95), resets grind turn/phase (SG p. 96).
- [x] `computeEventsModifier(state, campActor, party)` deterministic: shelter, concealment, ranger-in-wilderness, outcast-in-dungeon-or-dwarven, watch, danger, dark-camp relief, prior disasters, GM situational.
- [x] `tests/e2e/camp/session-state.spec.mjs` — 6 specs covering defaults, `beginCamp`, modifier breakdown, outcast-in-dwarven, `endCamp` writeback, `rollEvents` draws correct camp-type table.

### Phase D — Site tab ✅
- [x] `panel-site.hbs` — list of existing camp actors + inline create-new-camp form.
- [x] `CampPanel._prepareContext` surfaces `existingCamps[]` with name, type label, danger default, amenities summary, disaster count, visit count.
- [x] `selectCamp(campActorId)` action (GM only) → `campState.beginCamp` → advances phase to "setup".
- [x] **Amendment:** inline form instead of separate dialog — simpler UX, no new dialog infra. Dialog approach can be added later if we want modal isolation.
- [x] `createNewCamp` action reads the inline form and calls `campState.createAndBeginCamp`.
- [x] `openCampSheet` action for the 🡕 shortcut button per existing camp.
- [x] `advanceTo` action for the Next button (phase-gated — only visible when a camp is selected).
- [x] Panel subscribes to `updateSetting` + `createActor` / `updateActor` / `deleteActor` hooks in `_onFirstRender` so the Site list refreshes automatically.
- [x] Active tab auto-follows `campState.phase` when it advances.
- [x] `tests/e2e/camp/site-tab.spec.mjs` — 2 specs; updated `tab-strip.spec.mjs` to reflect new state-vs-active semantics (state icons track procedure, active tracks navigation).

### Phase E — Setup tab ✅
- [x] `panel-setup.hbs` with camp-actor summary row, amenities display, danger radio group, party check pool fieldset.
- [x] `CampPanel._prepareContext` surfaces `campActor` (flattened to plain object as `campActorView` with `hasCampActor` flag — plan amendment: Handlebars `{{#unless}}` against Actor proxies was unreliable), `partyChecks[]`, `partyCheckTotal`, `canBeginDecisions`, `campTypeLabel` (pre-computed since `concat` helper isn't available), `dangerOptions`.
- [x] "Open sheet" button on the camp-site row opens the camp actor's sheet via `openCampSheet` action.
- [x] `setDanger` action — per-visit override; writes through `campState.setDanger`.
- [x] `Next` button disabled when `partyCheckTotal < 1` (SG p. 90).
- [x] **Lifecycle fix (amendment):** `_prepareContext` pulls `#activeTab` forward when `campState.phase` has advanced past it, so that opening the panel after `beginCamp` lands on the active phase tab. (Originally I tried syncing in `_onFirstRender`, but that runs *after* the first `_prepareContext` — too late for the first paint.)
- [x] `tests/e2e/camp/setup-tab.spec.mjs` — 4 specs covering summary rendering, 0-check gate, danger radio write-through, and Next→Decisions advance.

### Phase F — Decisions tab ✅
- [x] `panel-decisions.hbs` with survey toggle + amenities checkboxes, fire radios, watchers checkbox list.
- [x] Actions: `toggleSurvey` (with `data-key` for performed/shelter/concealment/water), `setFire`, `toggleWatcher`.
- [x] Existing amenities (from the camp actor) render as disabled-checked; session survey flags track NEW discoveries this visit (flushed back to actor on Break Camp).
- [x] Inline help text cites SG pp. 91–92. Dark-camp hint surfaces when fire=dark (per user's live testing, the hint is informational — GMs enforce the cooking/forging blocks at the table).
- [x] Back-to-setup / Next-to-events navigation.
- [x] **Phase J partial start (styling):** `less/camp/panel.less` authored for the Setup + Decisions tabs. Checkbox/radio elements get explicit `appearance: auto; width: 14px; height: 14px` so they're visible + clickable by a human — caught during Phase F tests (my initial hack was `click({ force: true })`, corrected per user feedback; now documented in CLAUDE.md Development Flow).
- [x] `tests/e2e/camp/decisions-tab.spec.mjs` — 3 specs covering survey reveal, dark-camp hint, and watcher toggles; all use `.check()` (no force-click workarounds).

### Phase G — Events tab ✅
- [x] `panel-events.hbs` with modifier-breakdown, GM situational stepper (−/+ buttons), 🎲 Roll button, result card.
- [x] `rollEvents` action (in `campState.rollEvents`): resolves the camp-type → RollTable via the `tb2e.camp-events` compendium, builds `new Roll("3d6 + @mod", { mod })`, calls `table.draw({ roll })`, writes resultUuid + isDisaster + isUnavertable into session state. Chat card posts per Phase B3.
- [x] Result card renders title + (SG p.N) from the TableResult + avert config from flags.
- [x] GM-side avert buttons for each watcher (`markAvert` with `success=true` marks averted, `success=false` ends camp). Mailbox version will land in Phase L for non-GM player clients.
- [x] Unavertable branch: skull-crossbones header, immediate Break Camp button.
- [x] GM "override: unavertable" toggle — flips `events.isUnavertable` in session state.
- [x] **Amendment:** Direct subtable chain rendering in the panel deferred — the chat card already shows the full chain trace, and `fromUuid` resolution inside `_prepareContext` keeps the panel view simple. Good enough for v1; revisit once we have Strategy-tab experience.
- [x] `tests/e2e/camp/events-tab.spec.mjs` — 5 specs: modifier breakdown labels, GM stepper ±1, Roll→chat card+panel result, no-watch disaster surface, watcher avert success.

### Phase H — Strategy tab ✅
- [x] `panel-strategy.hbs`: per-actor rows with check pips, condition badges, watcher badge, action buttons.
- [x] `spendCheck` action (GM-side; mailbox variant lands in Phase L) deducts 1 check + appends to log.
- [x] Watcher lockout: `canRecover` / `canMemorize` / `canPurify` flags set false for watchers; buttons disabled in template.
- [x] Once-per-camp: button `disabled` and styled `.used` if `memorizedBy` / `purifiedBy` contains the PC.
- [x] Share-check peer-to-peer: `<select>` listing OTHER party members; on-change handler transfers 1 check via direct actor updates (GM processes automatically per CLAUDE.md mailbox pattern; Phase L will wire the player-driven version).
- [x] Instinct button: label swaps to "Instinct (1 ✓)" when exhausted; `useInstinct` deducts only when exhausted.
- [x] Camp log rendering from `campState.log`.
- [x] **Deferred to Phase L (mailbox):** Player-initiated check spending via `flags.tb2e.pendingCampAction` — for v1, GM clicks.
- [x] **Deferred to Phase L (mailbox):** spell/invocation help-surcharge — it's triggered from the roll dialog (external to the panel), which is itself a Phase L concern.
- [x] `tests/e2e/camp/strategy-tab.spec.mjs` — 5 specs: spend deducts + logs; watcher lockouts; once-per-camp memorize/purify; instinct free vs exhausted; share-check transfer.

### Phase I — Break Camp tab ✅
- [x] `panel-break.hbs`: definition-list summary (site, danger, fire, watch, events roll+outcome, log count, checks remaining) + "Breaking camp:" notice block + big End Camp button.
- [x] `endCamp` implementation was already in `campState.endCamp` from Phase C — the Panel action just calls it and closes.
- [x] Summary uses pre-computed `dangerLabel` in context (amendment: `concat` helper not available, same pattern as `campTypeLabel`).
- [x] `tests/e2e/camp/break-camp.spec.mjs` — 1 comprehensive spec: summary renders, End Camp closes panel, wipes session, resets grind turn/phase, discards PC checks, persists newly-found shelter on the camp actor, appends visit entry.

### Phase J — Roster + styles ✅
- [x] `panel-roster.hbs` (camp variant) with portrait + name + checks pips + watcher eye + condition badges.
- [x] `less/camp/panel.less` — full stylesheet: header bar amber gradient, tab strip state classes, all six tab bodies (Site / Setup / Decisions / Events / Strategy / Break), roster strip.
- [x] Registered in `less/tb2e.less` (theme selectors updated so `.camp-panel` gets light/dark tokens).
- [x] `npm run build:css` passes.

### Phase K — Localization ✅
- [x] `lang/en.json` grew to 120 `TB2E.Camp*` keys across the phases.
- [x] Audited: no parent/leaf collisions (script in `npm run build:db` lineage — tested inline).

### Phase L — Mailbox wiring ✅
- [x] `module/applications/camp/mailbox.mjs` — `processCampActionMailbox(actor, changes)` dispatches on `payload.kind` over spend-check / share-check / memorize / purify / instinct / avert. Respects the once-per-camp rules for memorize / purify and the exhausted-instinct surcharge (SG p. 95). Always `unsetFlag` on completion.
- [x] `tb2e.mjs` `updateActor` hook now matches `flags.tb2e.pendingCampAction?.kind` and dispatches. GM-only guard at the top of the hook handles the owner-write constraint.
- [x] CLAUDE.md Mailbox Pattern table updated with the `pendingCampAction` row pointing at `module/applications/camp/mailbox.mjs`.
- [x] `tests/e2e/camp/mailbox.spec.mjs` — 3 specs: spend-check (deduct + log + flag clear), share-check (P2P transfer), memorize (once-per-camp enforcement).

---

## 6. e2e test checklist

Per CLAUDE.md Development Flow: each test names the book/page it enforces and fails if the code drifts from the rule.

Location: `tests/e2e/camp/` — one spec per coherent concern. Page object: `tests/e2e/pages/CampPanel.mjs` (extend from open-close scaffold).

- [ ] `open-close.spec.mjs` — already landed; keep green.
- [ ] `camp-actor-create.spec.mjs` — SG p. 91. "Create new camp" dialog creates a `type: "camp"` Actor with the submitted name/type/danger; it appears in the Actors sidebar; its sheet opens.
- [ ] `camp-actor-select-existing.spec.mjs` — SG pp. 91, 94. A pre-existing camp actor appears in the Site tab list with its amenities and disaster count; selecting it pre-populates Setup.
- [ ] `camp-actor-writeback.spec.mjs` — SG pp. 91, 93, 94. Ending camp merges newly-found amenities into the camp actor; appends a visit entry; increments `disastersThisAdventure` if this visit ended on a disaster.
- [ ] `camp-actor-persistence-modifier.spec.mjs` — SG p. 93. A camp actor with `disastersThisAdventure = 2` contributes −2 to the modifier breakdown on the next visit.
- [ ] `setup-entry-gate.spec.mjs` — SG p. 90. Party with 0 checks → `Next` disabled; add 1 check → enabled.
- [ ] `camp-type-and-danger.spec.mjs` — SG p. 91. Selecting each camp type persists on the camp actor; danger radio (per-visit override) persists in session state only.
- [ ] `decisions-fire-dark.spec.mjs` — SG p. 92. Selecting dark camp surfaces the +1 Ob note; modifier breakdown shows danger relief.
- [ ] `decisions-watch-lockouts.spec.mjs` — SG p. 92. Watcher cannot access Recover / Memorize / Purify in Strategy tab.
- [ ] `events-table-compendium.spec.mjs` — SG pp. 266–277. All six camp-type RollTables exist in `Compendium.tb2e.camp-events` with the expected formula `3d6` and 19-ish results each; every result has a `flags.tb2e.campEvents` block; names include a `(SG p.XXX)` reference; no result has rule-body prose (spot-check: result `text`/`description` is empty or just a one-line hint).
- [ ] `events-subtable-linkage.spec.mjs` — SG pp. 268, 270, 272, etc. Parent results that should have a subtable (Monsters attack, Curiosity, Lair, Raid, Raiding beasts, Lurkers, Wandering monsters, Dalliance, Eavesdropping, House goblin) link to `Compendium.tb2e.camp-events.RollTable.<id>` via `documentUuid`.
- [ ] `events-loot-linkage.spec.mjs` — SG pp. 267, 269, 271, 273, 276. Results that reference an existing loot subtable link to `Compendium.tb2e.loot-tables.RollTable.<id>` (not inline text).
- [ ] `events-chat-card-style.spec.mjs` — reuses loot-draw style. Rolling the events table posts a chat card with class `card-accent--amber loot-card`; label reads the camp-event localization; chain trace shows parent → subtable transitions where applicable; terminal drops render `content-link` anchors for linked monsters/items.
- [ ] `events-roll-with-modifier.spec.mjs` — SG p. 93. `table.draw({ roll: new Roll("3d6 + @mod", { mod: 2 }) })` applied to a controlled dice mock lands on the expected result row (e.g. forced dice total 8 + mod 2 = 10 → "Safe camp").
- [ ] `events-modifier-breakdown.spec.mjs` — SG p. 93. Party with Ranger in wilderness shows +1; Outcast in a `dungeons`-type OR `isDwarvenMade` camp shows +1; cumulative totals correct; Unsafe −2 applied; dark-camp relief reduces Unsafe to −1.
- [ ] `events-roll-and-disaster.spec.mjs` — SG p. 94. 3d6 rolls, total = dice + modifier; disaster flag drives avert UI.
- [ ] `events-avert-nowatch.spec.mjs` — SG p. 94. Disaster + no watch → forced Break Camp, all checks discarded.
- [ ] `events-avert-watch-success.spec.mjs` — SG p. 94. Watcher spends 1 check, averts, camp continues; check is deducted from actor.
- [ ] `events-unavertable.spec.mjs` — SG p. 92 (+ specific entries). For an entry with `isUnavertable: true` (e.g. SG p. 266 Collapse), avert buttons are hidden and Break Camp is forced.
- [ ] `strategy-spend-check.spec.mjs` — SG p. 94. Player spends 1 check via mailbox; GM processes; actor check count decrements by 1; log entry appears.
- [ ] `strategy-memorize-once.spec.mjs` — SG p. 95. Memorize button disables for actor after one use this camp.
- [ ] `strategy-purify-once.spec.mjs` — SG p. 95. Same for purify.
- [ ] `strategy-instinct-exhausted.spec.mjs` — SG p. 95. Exhausted PC's instinct deducts a check; non-exhausted is free.
- [ ] `strategy-spell-help-surcharge.spec.mjs` — SG p. 95. Spell test with help charges caster 1 check regardless of cast time; spell test without help and with zero-turn cast does not charge a check; regular (non-spell) test with help stays free.
- [ ] `strategy-share-check-peer.spec.mjs` — DH p. 81. Giver writes mailbox; GM client auto-processes; giver's actor −1, receiver's actor +1; no approval UI appears.
- [ ] `break-camp.spec.mjs` — SG pp. 95–96. End Camp discards unspent checks; `grindTurn == 1`; `grindPhase == "adventure"`; `campState.active == false`.
- [ ] `mailbox-non-owner.spec.mjs` — CLAUDE.md Mailbox Pattern. Log in as a non-GM player client; spend-check and share-check mailboxes both processed successfully.

Each spec follows the pattern already in `tests/e2e/grind/set-phase.spec.mjs`: reset `tb2e.campState` + actor check counts in `afterEach`.

---

## 7. Rule deviations / ambiguities — resolved

- [x] **Events tables** — ship in v1 as RollTable documents in a new compendium pack `tb2e.camp-events`. Sourced as YAML under `packs/_source/camp-events/`. Results store names + page refs only (no rule prose); subtables as separate RollTables; monster/item/loot-subtable links via `documentUuid`. Chat card reuses the loot-draw style.
- [x] **Ranger/Outcast detection** — `actor.system.class === "ranger"` / `"outcast"` (confirmed from `module/data/actor/character.mjs:17` and `module/data/actor/chargen.mjs:527`). "Dwarven-made structures" for the outcast bonus is a per-camp-actor toggle (`system.isDwarvenMade`).
- [x] **"Two tests in a row"** (SG p. 95) — *not enforced in code; table-enforced.*
- [x] **Spell/invocation help** — clarified (SG p. 95): help in camp is free except when helping a spell or invocation test, which *always* costs 1 check regardless of cast time. Encoded as a surcharge mailbox action in Phase H.
- [x] **Camp Instincts** (SG p. 95) — *not tracked in code; GM/table handles.*
- [x] **Sharing checks** (DH p. 81) — peer-to-peer: giver writes a handoff flag on their own actor; GM client auto-processes (no approval workflow).
- [x] **Adventure-boundary reset for `disastersThisAdventure`** — "Reset adventure disasters" button on the camp sheet (GM-triggered) until an Adventure phase tracker exists.
- [x] **Camp actor token** — regular token, `actorLink: true`, camp icon set on the prototype.

---

## 8. Open design questions (for iteration)

- **Auto-sync with grindPhase?** When GM cycles `grindPhase → "camp"` from the grind tracker, should the camp panel auto-open? (User previously said no — re-confirm for the real implementation.)
- **Water-source annotation.** No events bonus, but Survivalist finds water. Track in state for narrative? Yes/no.
- **Inventory at break.** "Anything that can't be carried or packed out is left behind" (SG p. 96). Out of scope for v1 of the panel?
- **GM situational modifier.** Stepper or free-text + number? Proposed: `[ − ] 0 [ + ]` with ±10 clamp.
- **Conflict-in-camp.** A check can initiate a conflict. Does the Strategy tab wire directly into the existing ConflictPanel flow, or just debit the check and let the GM open the conflict panel manually? Proposed: the latter, with a log entry noting "conflict initiated."
