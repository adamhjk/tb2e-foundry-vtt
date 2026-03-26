---
name: set-design
description: Convert RPG adventure locations into the set design quick-reference format for DMs. Use this skill whenever the user wants to reformat, restructure, or convert dungeon rooms, adventure locations, encounter areas, or keyed entries into a scannable reference format. Also use when the user mentions "set design", "room keying", "location formatting", "adventure conversion", "dungeon key", mentions Courtney Campbell or Hack & Slash blog, or asks to make adventure text more usable at the table. Works with pasted text, files, or PDFs from any RPG system.
---

# Set Design Conversion

Convert prose adventure descriptions into the set design format — a visual decomposition tree that works like a stat block for exploration. Originated by Courtney Campbell on the Hack & Slash blog.

The format breaks each location into a tree of nouns connected by arrows (`→`). Bold marks what players see immediately. Everything else branches off those visible elements through arrows and indentation. No prose, no sentences — just things and their relationships.

## The Core Mental Model

From the blog: "What I'm actually doing when I'm keying a room this way is thinking of how the players are walking into the room. What can they immediately see? What is going on nearby? What is most obvious? What must I mention at a bare minimum to maintain their agency?"

This is the entire method. Walk into the room in your mind. The bold items are what hits you first. Then each of those things breaks down — what's it made of? What's on/in/behind it? What happens when you touch it? Each answer is another arrow in the tree.

## Input Handling

- **Pasted text**: Parse and convert directly.
- **File path**: Read with the Read tool.
- **PDF**: Use Read with page ranges. Ask for page numbers if not provided.
- **Partial**: Single room → convert that room. Whole dungeon → convert all locations.

## How to Convert

### 1. Read the Prose

Read the whole entry. Understand what this place IS, what happens here, what matters.

### 2. Decompose, Don't Summarize

This is the key insight. You are not summarizing or abbreviating — you are **breaking things down into their parts**. Each element decomposes into what it's made of, what it contains, what it leads to.

Prose: "Five human male bodies lie sprawled near the entrance. Two appear to be bandits wearing ratty wolf skin cloaks. The others seem to be adventurers — a cleric with a broken Sol symbol, a fighter in ruined leather, and a thief with a murky red bandana."

Set design:
```
**5 Bodies** → Human → Male
                       Bandit (2) → ratty wolf skin cloak
                       Cleric → broken Sol Symbol
                       Fighter → Ruined Leather
                       Thief → Murky Red Bandana
```

The arrows trace how you'd actually examine these bodies — first you see bodies, then you notice they're human men, then you start distinguishing individuals and what they're wearing.

### 3. Build the Tree

Start with the room header, then list bold visible elements. Each branches into sub-elements via `→` and indentation:

```
Room Name #) | **Visible Thing** → detail → further detail
               **Another Thing** → what it contains
                                 |→ what else it leads to
               **Creature** → behavior
                 (stats in italics)
```

### 4. Verify

Every number, stat, treasure value, and mechanical detail from the source must appear somewhere in the tree. No information lost — just restructured.

## Format Reference

See `references/format.md` for the complete formatting conventions (arrows, bold, branching, stats, NPCs).

See `references/examples.md` for before/after conversions from prose to set design.

## System Agnosticism

Preserve whatever stat conventions the source uses. Do not convert between systems.

## Output

Present conversions in a code block (monospace preserves the indentation tree). Briefly note any ambiguities or judgment calls after the conversion.

## Foundry VTT Journal Output

When writing set design content into a Foundry VTT adventure journal page (YAML pack source with `format: 1` HTML content), use the `.tb2e-set-design` HTML structure instead of a plain code block. The CSS is at `adventures/dread-crypt/dread-crypt.css` and supports both light and dark Foundry themes.

### HTML Structure

```html
<section class="tb2e-set-design">
<header>
<h2>Scene or Location Title</h2>
<p>Optional flavor note or context line.</p>
</header>
<pre><strong>Visible Thing</strong> → detail → further detail
  → sub-branch
  → <strong>Another Visible</strong> → what it contains
      → deeper sub-branch

<strong>Second Top-Level Element</strong>
  → branch detail
  → <em>(Nature 6, Might 4, Disposition 10)</em></pre>
</section>
```

### Key Differences from Plain Text

| Plain text | Foundry HTML |
|-----------|-------------|
| `**Bold**` | `<strong>Bold</strong>` |
| `*italic*` | `<em>italic</em>` |
| Code block (`` ``` ``) | `<pre>...</pre>` (no `<code>` wrapper) |
| None | `<section class="tb2e-set-design">` wrapper |
| None | `<header>` with `<h2>` and optional `<p>` |

### Indentation

Use consistent 4-space indentation for sub-branches rather than aligning to parent names. The `<strong>` tags are invisible in rendered `<pre>` output, so character-count alignment from the plain text version won't line up. Consistent indentation is clearer:

```html
<pre><strong>Village Elders</strong> (Desperate/Fearful → afraid of overlord)
  → reached out quietly for help
  → <strong>Jora</strong> → youth → disappeared into the crypt
      → crawled through passage → pulled back screaming
  → <strong>Haunting</strong> → stalks village at night
      → breaks into homes → dead, seemingly of fright</pre>
```
