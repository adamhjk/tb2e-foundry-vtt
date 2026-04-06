# Torchbearer 2E for Foundry VTT

This is a game system for the Foundry Virtual Tabletop for Torchbearer 2nd Edition.

## Architecture

- **Target**: Foundry VTT v13
- **Conventions**: Follows dnd5e patterns (plain `.mjs` ES modules, no bundler, no TypeScript)
- **Sheets**: AppV2 architecture (`ActorSheetV2`), registered via `DocumentSheetConfig`
- **Entry point**: `tb2e.mjs` — imports all modules and registers in `init` hook
- **Barrel files**: Each module directory has `_module.mjs` re-exporting its contents
- **Data models**: `module/data/actor/_module.mjs` exports a `config` object mapping type names to `TypeDataModel` subclasses, assigned to `CONFIG.Actor.dataModels`

## Key Paths

| Purpose | Path |
|---------|------|
| Entry point | `tb2e.mjs` |
| System manifest | `system.json` |
| Compiled stylesheet | `tb2e.css` (generated — do not edit directly) |
| LESS source | `less/` (edit styles here) |
| LESS entry point | `less/tb2e.less` |
| Data models | `module/data/` |
| Document classes | `module/documents/` |
| Sheet applications | `module/applications/` |
| Handlebars templates | `templates/` |
| Localization | `lang/en.json` |
| Pack sources (YAML) | `packs/_source/` (edit these) |
| Compiled packs (LevelDB) | `packs/` (generated — do not edit) |
| Pack build script | `utils/packs.mjs` |

## Reference Sources

| Source | Path |
|--------|------|
| Foundry VTT source | `../foundry/` (client + common) |
| dnd5e system source | `../dnd5e/` |
| Torchbearer 2E PDFs | `../reference/` (Scholar's Guide + Dungeoneer's Handbook) |
| Extracted rules references | `../reference/rules/<topic>/` |
| Reference extractor tool | `reference-extractor/` |
| Reference search index | `../reference/index.json` |

## Reference Extractor

A `uv`-managed Python CLI tool at `reference-extractor/` for searching and extracting rules from the Torchbearer 2E PDFs into structured markdown.

A Claude Code skill at `~/.claude/skills/torchbearer-reference-extraction/SKILL.md` automates the workflow — trigger it with phrases like "find rules about \<topic\>" or "extract rules for \<topic\>".

### Commands

Run from the project root (or `cd reference-extractor`):

```sh
# Build/rebuild the search index (one-time, or after PDF changes)
cd reference-extractor && uv run tb2e-ref index

# Search for a topic
cd reference-extractor && uv run tb2e-ref search "<topic>"

# Extract pages to markdown + images
cd reference-extractor && uv run tb2e-ref extract --topic "<topic>" --pages scholars-guide:36-42
cd reference-extractor && uv run tb2e-ref extract --topic "<topic>" --pages scholars-guide:46-57 --pages dungeoneers-handbook:10-12
```

### Looking Up Rules

When asked about Torchbearer rules, how a mechanic works, or when implementing a game feature:

1. **Check for existing extractions first**: Read `../reference/rules/` — if a `<topic>/` directory exists, read its markdown files directly.
2. **If not yet extracted**: Use the skill workflow or run the commands above to search and extract the relevant pages.
3. **Always cite the source**: When referencing rules, note the book and page number (included in the markdown as `<!-- Page N -->` comments and in the file header).

### Managing References

- **Index**: Stored at `../reference/index.json`. Rebuild with `uv run tb2e-ref index` if PDFs change.
- **Extracted rules**: Output to `../reference/rules/<topic>/` with a `README.md`, per-book markdown files, and an `images/` directory.
- **Before implementing a game mechanic**, search for and extract the relevant rules to ensure accuracy.

## Actor Types

- `character` — `CharacterData` model, `CharacterSheet` (AppV2)

## Compendium Packs

Item compendiums are maintained as YAML source files in `packs/_source/<pack>/` and compiled to LevelDB in `packs/<pack>/` via `@foundryvtt/foundryvtt-cli`.

```sh
npm run build:db     # Compile YAML → LevelDB (all packs)
```

- **Stop Foundry before rebuilding packs** (or restart it after). Foundry locks LevelDB databases; rebuilding while running causes empty compendiums.
- **Never edit LevelDB files** in `packs/` directly — edit the YAML sources and rebuild.
- To add a new item: create a `.yml` file in the appropriate `packs/_source/<pack>/` directory with a unique `_id` (16-char hex) and a `_key: '!items!<_id>'` field, then run `npm run build:db`. **Both `_id` and `_key` are required** — without `_key` the CLI silently skips the entry. **Do not escape `!` in `_key`** — `'\!items\!'` embeds literal backslashes, which Foundry can't find.
- To add a new pack: create a `packs/_source/<name>/` directory, add YAML files, and register the pack in `system.json` under `packs`.
- To extract from LevelDB back to YAML: `node utils/packs.mjs --extract`.
- **Troubleshooting**: `npm run build:db` logs each packed entry (e.g. `Packed <id> (Name)`). If a compendium appears empty, check the build output to see which items were packed and verify missing items have a `_key` field.

## Mailbox Pattern (Cross-Permission Operations)

**Any time you build functionality where a player needs to modify a document they don't own (GM-owned chat messages, other players' actors, combat encounters, etc.), you MUST use the mailbox pattern.** Do not attempt direct updates — they will silently fail for non-owner players. Always design with this constraint in mind from the start.

Foundry VTT restricts document updates to owners. The mailbox pattern works as follows:

1. **Player writes** to a `pending*` field on a document they own (actor flag, combatant system field, etc.)
2. **GM detects** the write via a hook (`updateActor`, `updateCombatant`, etc.) and processes it
3. **GM clears** the mailbox field after processing

### Conventions

- Name mailbox fields `pending<Action>` (e.g., `pendingSynergy`, `pendingDisposition`)
- Always re-validate on the GM side — player-side checks are for UX only
- Clear the mailbox after processing (`unsetFlag` or reset to empty)
- Guard the hook with `if ( !game.user.isGM ) return;`

### Existing Uses

| Feature | Mailbox field | Document | Hook |
|---------|--------------|----------|------|
| Conflict disposition | `system.pendingDisposition` | Combatant | `updateCombatant` (in `TB2ECombat`) |
| Conflict distribution | `system.pendingDistribution` | Combatant | `updateCombatant` (in `TB2ECombat`) |
| Conflict actions | `system.pendingActions` | Combatant | `updateCombatant` (in `TB2ECombat`) |
| Synergy | `flags.tb2e.pendingSynergy` | Actor | `updateActor` (in `tb2e.mjs`) |
| Wise advancement | `flags.tb2e.pendingWiseAdvancement` | Actor | `updateActor` (in `tb2e.mjs`) |
| Versus finalize | `flags.tb2e.pendingVersusFinalize` | Actor | `updateActor` (in `tb2e.mjs`) |
| Conflict HP | `flags.tb2e.pendingConflictHP` | Actor | `updateActor` (in `tb2e.mjs`) |
| Light extinguish | `flags.tb2e.pendingLightExtinguish` | Actor | `updateActor` (in `tb2e.mjs`) |
| Grind condition apply | `flags.tb2e.pendingGrindApply` | Actor | `updateActor` (in `tb2e.mjs`) |

## Unlinked Actors (Synthetic Tokens)

Monsters and NPCs typically use **unlinked tokens** (synthetic actors). When accessing actor data from a combatant, **always use `combatant.actor`**, never `game.actors.get(combatant.actorId)`:

- `combatant.actor` — returns the **token's synthetic actor** (correct for unlinked tokens; reflects per-token state like conflict HP)
- `game.actors.get(combatant.actorId)` — returns the **world actor** (the template; does NOT have per-token conflict HP or other runtime state)

For unlinked tokens, updates made via `combatant.actor.update()` only affect the synthetic actor. The world actor's data stays at its default values. Reading HP from the world actor will always return 0, causing false KO detection.

```javascript
// WRONG — reads world actor; HP will be 0 for unlinked tokens
const actor = game.actors.get(combatant.actorId);
const hp = actor.system.conflict.hp.value; // always 0 for unlinked!

// CORRECT — reads the token's synthetic actor
const actor = combatant.actor;
const hp = actor.system.conflict.hp.value; // reflects distributed HP
```

**Rule**: In conflict code (panel, tracker, combat document), always use `combatant.actor` or `c.actor` when you need runtime state (HP, conditions, conflict data). Use `game.actors.get()` only when you specifically need the world-level actor document (rare).

## Releasing

Releases are automated via GitHub Actions (`.github/workflows/release.yml`). Pushing a `release-*` tag triggers a workflow that builds, zips, and publishes a GitHub Release.

### Steps

1. Bump `version` in `system.json` (e.g., `"0.2.0"`)
2. Commit and push to `main`
3. Create and push a git tag matching the version:
   ```sh
   git tag release-0.2.0
   git push origin refs/tags/release-0.2.0
   ```
4. The workflow validates the tag matches `system.json` version, builds CSS + packs, creates a zip of runtime files, and publishes the release

### What the workflow does

- Patches `system.json` with correct `download` and `manifest` URLs before packaging
- Zips only runtime files (`system.json`, `tb2e.mjs`, `tb2e.css`, `module/`, `templates/`, `lang/`, `packs/`, `assets/`, `icons/`, `LICENSE`) — excludes `packs/_source/`, dev tooling, and build files
- Uploads `system.json` + zip as release assets

### Manifest URL

Users install the system in Foundry using:
```
https://github.com/adamhjk/tb2e-foundry-vtt/releases/latest/download/system.json
```

This always redirects to the latest release's `system.json`, which contains the version-pinned `download` URL.

## Localization (lang/en.json)

Foundry VTT's i18n system builds a **nested object** from the flat JSON keys using `.` as a separator. This means a key like `"TB2E.Foo.Bar"` creates `{ TB2E: { Foo: { Bar: "value" } } }`.

**Never define a key that is both a leaf value and a parent prefix.** If `"TB2E.Foo.Bar": "some string"` exists, you cannot also define `"TB2E.Foo.Bar.Baz": "another string"` — the first key sets `Bar` to a string, so Foundry cannot add `.Baz` as a child property. This silently breaks the entire language file.

```jsonc
// WRONG — "TestType" is both a string and a parent
"TB2E.Conflict.TestType": "Test Type",
"TB2E.Conflict.TestType.ability": "Ability",  // breaks lang loading

// CORRECT — use flat sibling keys instead
"TB2E.Conflict.TestTypeAbility": "Ability",
"TB2E.Conflict.TestTypeSkill": "Skill",

// ALSO CORRECT — use only children, no parent leaf
"TB2E.Conflict.TestType.ability": "Ability",
"TB2E.Conflict.TestType.skill": "Skill",
// (just don't also define "TB2E.Conflict.TestType" as a plain value)
```

## Styles (LESS → CSS)

Styles are authored in LESS and compiled to `tb2e.css`. **Never edit `tb2e.css` directly** — it is a generated file. Edit the `.less` sources under `less/` and rebuild.

### Build Commands

```sh
npm run build:css    # One-shot compile: less/tb2e.less → tb2e.css (+ source map)
npm run watch:css    # Watch mode: recompiles on any .less file change
```

**Always run `npm run build:css` after editing any `.less` file.** Foundry loads `tb2e.css` directly — it does not process LESS at runtime. If you forget to rebuild, your changes won't appear.

### LESS Directory Structure

```
less/
├── tb2e.less                     # Entry point (@imports + theme application blocks)
├── variables/
│   ├── base.less                 # :root invariant tokens (fonts, radii, condition colors)
│   ├── light.less                # .mixin-theme-light() — light theme token values
│   └── dark.less                 # .mixin-theme-dark() — dark theme token values
├── elements.less                 # Fieldsets, form inputs, textareas, conviction
├── sheets/                       # Character sheet partials
│   ├── shell.less                # .tb2e.sheet base
│   ├── header.less               # Header, logo, name, conditions strip
│   ├── reference-bar.less        # Reference bar
│   ├── tabs.less                 # Tab navigation + tab content
│   ├── abilities.less            # Abilities tab + advancement bubbles + nature
│   ├── skills.less               # Skills tab
│   ├── traits-wises.less         # Traits & Wises tab
│   ├── inventory.less            # Inventory tab
│   ├── magic.less                # Magic tab
│   ├── biography.less            # Biography tab
│   ├── rollable.less             # Rollable rows + advance button
│   ├── monster.less              # Monster sheet
│   └── npc.less                  # NPC sheet
├── dice/                         # Dialog partials
│   ├── roll-dialog.less          # Roll dialog
│   └── advancement-dialog.less   # Advancement dialog
├── chat/                         # Chat card partials
│   ├── roll-card.less            # Roll result card
│   ├── advancement-card.less     # Advancement chat card
│   ├── versus-card.less          # Versus pending/resolution cards
│   └── nature-crisis.less        # Nature crisis card
└── conflict/                     # Conflict system partials
    ├── tracker.less              # Conflict tracker (header/body/footer)
    ├── inline-rolling.less       # Inline rolling phase
    ├── distribution.less         # Distribution phase
    ├── cards.less                # Playing cards (face/back/animations)
    ├── window.less               # Conflict resolution window + volleys
    └── character-panel.less      # Character sheet conflict panel
```

### Theme System

Uses a CSS custom property system compatible with Foundry VTT v13's built-in theme toggling. No JavaScript needed.

Light/dark tokens are defined as LESS mixins (`.mixin-theme-light()` / `.mixin-theme-dark()` in `variables/light.less` and `variables/dark.less`). These are applied in `tb2e.less` across 4 selector blocks:

1. **Fallback block** — Light defaults on element selectors (`.tb2e.sheet`, `.tb2e-roll-card`, etc.)
2. **`body.theme-light/dark :is(...)`** — Body-level application theme
3. **`.themed.theme-light/dark.tb2e` / `.themed.theme-light/dark :is(...)`** — Scoped interface theme (highest specificity)

### Token Naming Convention

`--tb-{category}-{variant}`

| Category | Examples |
|----------|---------|
| `bg-*` | `--tb-bg-mid`, `--tb-bg-raised`, `--tb-bg-white` |
| `text-*` | `--tb-text-body`, `--tb-text-dim`, `--tb-text-faint` |
| `blue-*` | `--tb-blue`, `--tb-blue-bright`, `--tb-blue-dim` |
| `border-*` | `--tb-border`, `--tb-border-light` |
| `frost-*` | `--tb-frost`, `--tb-frost-bright` |
| `green-*` | `--tb-green`, `--tb-green-subtle` |
| `amber-*` | `--tb-amber`, `--tb-amber-glow` |
| `red-*` | `--tb-red`, `--tb-red-dim` |
| `banner-*` | `--tb-banner-pass-from`, `--tb-banner-fail-text` |
| `steel-*` | `--tb-steel`, `--tb-steel-bright` |

### Rules

- **Never edit `tb2e.css` directly.** Edit `.less` files and run `npm run build:css`.
- **Never use hardcoded hex colors** in component rules. Use `var(--tb-*)` tokens.
- **New themed colors** must be added to both `variables/light.less` and `variables/dark.less` mixins.
- **New chat card classes** outside `.tb2e` must be added to the theme selector lists in `tb2e.less`.
- Theme-invariant values (condition colors, action hues, fonts, radii) go in `variables/base.less` (`:root`) only.

### Example

```less
/* Correct — in the appropriate .less partial */
.my-element { color: var(--tb-text-body); background: var(--tb-bg-raised); }

/* Wrong — hardcoded color won't adapt to dark theme */
.my-element { color: #1e293b; background: #f5f7fa; }
```
