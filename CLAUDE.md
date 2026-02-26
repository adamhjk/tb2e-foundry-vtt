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
| Stylesheet | `tb2e.css` |
| Data models | `module/data/` |
| Document classes | `module/documents/` |
| Sheet applications | `module/applications/` |
| Handlebars templates | `templates/` |
| Localization | `lang/en.json` |

## Reference Sources

| Source | Path |
|--------|------|
| Foundry VTT source | `../foundry/` (client + common) |
| dnd5e system source | `../dnd5e/` |

## Actor Types

- `character` — `CharacterData` model, `CharacterSheet` (AppV2)
