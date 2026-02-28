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
