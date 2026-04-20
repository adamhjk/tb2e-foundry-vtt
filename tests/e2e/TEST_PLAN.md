# TB2E E2E Test Plan

Long-term roadmap for Playwright E2E coverage of the Torchbearer 2nd Edition system. Each checkbox is one spec file. Agents are expected to work through this list incrementally, one (or a handful of) checkboxes per run.

## How to use this plan

**For the orchestrator (me):**
- Pick one or more unchecked boxes whose agent briefings are unambiguous.
- Spawn an Explore or general-purpose agent with the relevant section's briefing inlined into the prompt, plus instructions to (a) write the spec, (b) run it until green, (c) tick the box in this file.
- After the agent reports back, verify the spec runs in isolation (`npx playwright test tests/e2e/<file>`) and as part of the suite, then commit with jj.

**For the worker agent:**
- Read the agent-briefing block at the top of the section you were assigned.
- Reuse POMs in `tests/e2e/pages/` — add new POMs only when no existing one fits.
- Follow the conventions established in the existing specs (`login.spec.mjs`, `character-creation.spec.mjs`, `compendium-drag.spec.mjs`, `auth.setup.mjs`).
- Cite rule sources in comments where behavior depends on rules-as-written (`// DH p.53`, `// SG p.69`).
- Tests must be independent: use `Date.now()` suffixes on actor/item names, never depend on ordering.
- Role-based locators first (`getByRole`/`getByLabel`); CSS only inside POMs, never in specs.
- If Foundry's DOM differs from what the briefing expects, update the briefing before moving on.
- When a spec passes reliably (run `--repeat-each=3`), tick the checkbox.

**File path convention:** `tests/e2e/<area>/<feature>.spec.mjs` (e.g., `tests/e2e/conflict/disposition.spec.mjs`). Keep the flat `tests/e2e/*.spec.mjs` layout for infra/scaffolding specs only.

---

## 0. Infrastructure

Already shipped. Listed for completeness.

- [x] `tests/e2e/login.spec.mjs` — GM can join the world
- [x] `tests/e2e/character-creation.spec.mjs` — create a blank character via sidebar dialog
- [x] `tests/e2e/compendium-drag.spec.mjs` — drag Gerald from iconic-characters into Actors

---

## 1. Character Creation

### Agent briefing

**Files:**
- `module/applications/actor/character-wizard.mjs` — 12-step wizard
- `module/applications/actor/character-sheet.mjs` — "Launch Wizard" button in sheet header
- `module/data/actor/character.mjs` — data model
- Wizard steps in order: class → stock → upbringing → hometown → hometown skill → home trait → social → specialty → wises → nature → circles → gear pack → weapons → armor → finishing
- Rules: DH pp.25–47, LMM pp.9–14 (Gather Round)

**Patterns:**
- Wizard data-actions: `openWizard`, `selectClass`, `selectStock`, `selectUpbringing`, `selectHometown`, `selectHometownSkill`, `selectHomeTrait`, `selectSocial`, `selectSpecialty`, `selectRequiredWise`, `answerNature`, `selectNatureWise`, `selectNatureHomeTrait`, `answerCircles`, `selectPackType`, `rollSpells`, `rollRelics`, `selectWeapon`, `toggleShield`, `selectArmor`, `selectEquipment`, `finish`
- Wizard writes to actor on `finish`; each step persists incrementally.
- **Upbringing step** is dynamically filtered out for non-human/changeling stocks (`shouldSkipUpbringing` in chargen.mjs) — elves, dwarves, halflings get a 11-step sequence.
- **rollSpells / rollRelics** are NOT dedicated wizard steps — they surface as sub-sections of step 9 (Gear) when the class is Scholar / Theurge / Shaman. Buttons render conditionally on `needsSpellRoll` / `needsRelicRoll`; clicking rerenders the step with `.relic-list` + `.invocation-list` badge lists.
- **Theurge relic roll**: 3d6 → `THEURGE_RELIC_TABLE[total]` → always 2 relics + 2 invocations; `#applyToActor` resolves names against `tb2e.theurge-relics` / `tb2e.theurge-invocations` compendiums and creates embedded Items. On compendium miss, falls back to stub `{ type: "relic", system: { tier: "minor" } }` — note the `tier` vs schema's `relicTier` drift. Shaman mirrors this with `SHAMAN_RELIC_TABLE` + `tb2e.shamanic-*` packs.
- **Magician (Scholar) spell roll**: 2d6 → `SPELL_SCHOOL_TABLE`; entries 2–10 yield 3 spells each grouped by school; entries 11–12 set `school: "Choose"` with empty `spells[]` (GM picks manually — no dialog in the wizard, user strands at 0 spells). Resolved from `tb2e.spells`. **No stub fallback** — missing names silently drop. Roll button disappears after first roll (no re-roll). For deterministic tests, stub `CONFIG.Dice.randomUniform = () => 0.5` before click; each d6 maps to face 3, total 6 → Conjuration.
- **CLASS_DEFS keys** (from `chargen.mjs`): `ranger`, `magician` (not "scholar"), `theurge`, `shaman`, `warrior`, `outcast`, `burglar`, etc. Check `CLASS_DEFS` before writing specs that reference class keys.
- **Armor step** is a no-op for classes with no starting armor or with `autoLeather` pre-set (Ranger, Theurge): `#isStepComplete("armor")` delegates to `"weapons"` and the step displays only an informational note.
- **Launch the wizard directly** via `new CharacterWizard(actor).render(true)` (imported from `/systems/tb2e/module/applications/actor/character-wizard.mjs`) to avoid opening the character sheet first.

**Checkboxes:**

- [x] `tests/e2e/character/wizard-walkthrough.spec.mjs` — Ranger/elf happy path (upbringing auto-skipped for non-human stocks); all 11 effective steps walked; asserts class/stock/abilities/traits/wises/items
- [x] `tests/e2e/character/wizard-theurge-relics.spec.mjs` — `rollRelics` is a sub-section of step 9 (Gear), not a dedicated step; 3d6 → THEURGE_RELIC_TABLE → 2 relics + 2 invocations; noted schema drift (stub uses `tier`, compendium relics use `relicTier`)
- [x] `tests/e2e/character/wizard-shaman-invocations.spec.mjs` — Shaman mirrors Theurge: same 3d6 roll shape (2 relics + 2 invocations) against `SHAMAN_RELIC_TABLE`, resolved from `tb2e.shamanic-relics` / `tb2e.shamanic-invocations`; narrower weapon list (`Dagger | Hand Axe | Sling | Staff`); class trait "Between Two Worlds"
- [x] `tests/e2e/character/wizard-scholar-spells.spec.mjs` — class key is actually `magician` (not "scholar"); 2d6 `SPELL_SCHOOL_TABLE` (entries 2–10 give 3 spells, 11–12 yield `school:"Choose"` + empty spells[]); no stub fallback (missing names silently drop); no re-roll path; weapon list `["Dagger","Staff"]`; `requiresMentor: true`. Test stubs `CONFIG.Dice.randomUniform` for determinism.
- [x] `tests/e2e/character/import-from-iconic.spec.mjs` — 9 iconics (not 11 — original count was stale): Beren, Gerald, Karolina, Nienna, Rörik, Taika, Tiziri, Ulrik, Varg. One UI-drag path (Taika) + one bulk programmatic import asserting class/stock against a ground-truth table. `afterEach` deletes tagged actors via `flags.tb2e.e2eTag`.
- [x] `tests/e2e/character/create-monster.spec.mjs` — Create Actor dialog, type=monster, assert monster sheet opens
- [ ] `tests/e2e/character/create-npc.spec.mjs` — Create Actor dialog, type=npc, assert NPC sheet opens

---

## 2. Character Sheet

### Agent briefing

**Files:**
- `module/applications/actor/character-sheet.mjs` — sheet class (2100+ lines)
- `templates/actor/character/*.hbs` — tab templates
- Tabs: Identity, Abilities, Skills, Traits & Wises, Inventory, Magic, Biography
- Conditions (DH p.53): fresh, hungry, angry, afraid, exhausted, injured, sick, dead

**Patterns:**
- Data-actions: `toggleCondition`, `toggleBubble`, `setTraitLevel`, `addTrait`, `deleteTrait`, `addRow`/`deleteRow` (generic; used for wises and several other arrays — read `data-array` attr), `resetSession`, `conserveNature`, `recoverNature`, `removeFromSlot`, `dropItem`, `pickUpItem`, `consumePortion`, `drinkDraught`, `consumeLight`, `toggleDamaged`, `toggleLiquidType`, `splitBundle`
- Wises: `system.wises` array on the actor (not an Item type), capped at 4 slots; each entry has `{ name, pass, fail, fate, persona }`. Add via `addRow[data-array="wises"]`, delete via `deleteRow[data-array="wises"][data-index="<i>"]`. Rename via `input[name="system.wises.<i>.name"]`. Rows are keyed by array index (re-index on delete).
- Sheet root: `form.application.sheet.tb2e.actor.character` (title = `Character: <name>`)
- Inventory slots: head, neck, hand-L, hand-R, torso, belt, feet, pocket + custom container slots

**Gotchas:**
- Ability/skill rating inputs are `input[name="system.abilities.<key>.rating"]`
- Will / Health / Circles / Resources: schema min=0 max=10 (via `advancementField`)
- Nature: rating 0–7, max 0–7; the Nature rating HTML input caps at current `max` (dynamic `max="{{nature.max}}"`) — set `max` *before* `rating` or the browser silently rejects
- Nature crisis triggers at rating=0
- Skill rating input is replaced by an `✕` icon when `rating===0 && learning>0` — default actors have `learning=0`, so the input is present; if a spec puts a skill into "learning" mode, switch to the appropriate UI
- Condition toggles on the sheet do a **direct** `document.update()` (no mailbox, no chat card). Toggling `fresh` clears all negative conditions. The `pendingGrindApply` mailbox is a separate path used by the grind-tracker's "Apply" button (grind-tracker.mjs); the `updateActor` hook in `tb2e.mjs` consumes + clears it.
- Conditions strip lives at sheet top; selector `nav.conditions-strip button.condition-btn[data-condition="<key>"]`. No tab switch needed.
- Traits: `module/data/item/trait.mjs` has `level` 1–3 only (min=1, max=3, integer, initial=1). **No flawed flag, no -1 level.** The "used against" state is a separate `usedAgainst: BooleanField`, written by `module/dice/versus.mjs`, not via the bubble UI.
- `addTrait` data-action has **no dialog** — it unconditionally creates an Item named "New Trait" with level 1 via `Item.create(..., { parent: actor })`.
- Traits tab template: `templates/actors/tabs/character-traits.hbs`. Each row has three `.level-pip` buttons (levels 1/2/3) with `data-action="setTraitLevel"` and `data-level`.
- **Session usage tracking lives on the trait Item, not the actor.** `system.beneficial` = *remaining* uses this session (not consumed count): L1 max=1, L2 max=2, L3 max=0/unlimited (`TraitData.maxBeneficial` getter). `resetSession` (in `module/session.mjs` `resetTraitsForSession`) does **three things**: restores `trait.beneficial` to max, clears `trait.usedAgainst`, and ALSO resets `spell.cast` and `invocation.performed` flags. Gated by `DialogV2.confirm` (yes / no buttons with `data-action`).
- The `resetSession` button lives in `character-header.hbs` (always visible on the sheet header; no tab switch needed).
- `conserveNature` (on Abilities tab, Nature row): behind `DialogV2.confirm`; guards `nature.max > 1`. Yes path: `max -= 1`, `rating = new max` (slammed, not preserved), `pass = 0`, `fail = 0`. `recoverNature`: no dialog; guards `rating < max`; `rating += 1`. Neither touches anything outside `system.abilities.nature`.
- **Inventory slot system** (`module/data/item/_fields.mjs`): every inventory Item has `system.slot` (string key, "" = unassigned), `system.slotIndex` (int, for multi-slot groups), `system.dropped` (bool, ground state), plus `slotOptions` (per-location cost map). Body slot groups: head(1), neck(1), hand-L/hand-R(2 each, Worn+Carried), feet(1), pocket(1), torso(3), belt(3). Plus a 12-slot `cache` group + dynamic container groups. **Unassigned section** = `slot === "" && dropped === false`. Actions: `removeFromSlot` (clears slot/slotIndex, keeps dropped); `dropItem` (clears slot + sets dropped=true, cascades to container children, preserving their slot); `pickUpItem` (clears dropped only — does NOT reassign slot). `placeItem` is separate for assigning into slots.
- Drop button is only exposed on Unassigned items and on container slot-group headers (NOT on items placed in ordinary body slots).
- Data-attribute selectors like `[data-item-id="..."]` match many elements per card (placement + action buttons nested inside). Scope via `.dropped-item` / `.unassigned-item` row classes.
- **Supply item type** (`module/data/item/supply.mjs`): `system.supplyType` enum = `food` | `light` | `spellMaterial` | `sacramental` | `ammunition` | `other`. Food uses `system.quantity` / `quantityMax`; light uses `system.turnsRemaining` + `system.lit`. Items are NOT deleted at 0 — they stay for refill. Unassigned items render NO consume button; items must be in a real slot with matching `slotOptions`.
- `consumePortion` = `quantity -= 1` (floor at 0) + clears `conditions.hungry` if true. No chat card.
- `consumeLight` = `turnsRemaining -= 1` (floor at 0). **Does NOT flip `lit: false`, does NOT post chat card, does NOT trigger `pendingLightExtinguish` mailbox.** The light-extinguish / torch-expired flow is a separate path: `updateItem` hook watches for `changes.system?.lit === false`. Button persists as a no-op past turnsRemaining=0 (intentional).
- **Draughts are on CONTAINERS, not supplies.** Type `container` with `CONFIG.TB2E.containerTypes.<kind>.liquid === true` (waterskin, bottle, jug, barrel, cask, clayPot, woodenCanteen). `system.liquidType` ∈ `water` | `wine` | `oil` | `holyWater` (default water). `drinkDraught` handler: decrement `quantity`; `water` clears hungry; `wine` opens `DialogV2.wait` with quench / bolster choice (bolster sets `flags.tb2e.wineBolster`); `oil` / `holyWater` decrement only.
- **Bundles** are `container` items with `quantityMax > 1` (e.g. stacked rations, arrows). `isSplittableBundle` = `type==="container" && quantityMax > 1`. `splitBundle` handler peels ONE off per click (no dialog): clones `item.toObject()` with `quantity=1, quantityMax=1, slot="", slotIndex=0, containerKey=""` (lands in Unassigned); source: `quantity -= 1, quantityMax -= 1`. Button only surfaces in the **occupied** branch of `.inventory-slot` cells (not Unassigned / Dropped). A container with `quantityMax === 1` becomes its OWN slot-group (backpack, etc.); a bundle is always an occupant inside another slot. `belt` forbids bundles; `torso` accepts them.
- **Biography tab** renders: `textarea[name="system.bio"]` (plain StringField — no ProseMirror), an allies table (`system.allies.<i>.name | location | status`), and a level-choices table (`system.levelChoices.<level>`).
- **Convictions** (`belief` / `creed` / `goal` / `instinct`) ARE on the character sheet — in the **identity** tab's "What You Fight For" fieldset, not biography. Rendered via `convictionFields` array built in `character-sheet.mjs` `_prepareConvictionFields()`; template `templates/actors/tabs/character-identity.hbs`. Each is a `<textarea name="system.<field>" rows="2">`. Header also renders `system.goal` as a badge (read-only).

**Checkboxes:**

- [x] `tests/e2e/sheet/edit-identity.spec.mjs` — edit name/level/home, verify persistence after reload (TB2E has no "alignment" field — substituted `system.home`)
- [x] `tests/e2e/sheet/edit-abilities.spec.mjs` — set Will, Health, Nature rating/max; verify data model constraints (ranges, clamping)
- [x] `tests/e2e/sheet/edit-skills.spec.mjs` — set rating for each relevant skill; verify persistence
- [x] `tests/e2e/sheet/toggle-conditions.spec.mjs` — toggle each condition (DH p.53); sheet does a direct update (no mailbox/chat card from the toggle itself); also covers `pendingGrindApply` mailbox clearing by GM hook
- [x] `tests/e2e/sheet/trait-crud.spec.mjs` — add a trait, set level, demote, delete; verify bubble UI state (traits are level 1–3 only; no flawed/-1 bubble — `usedAgainst` is a separate boolean set by versus system)
- [x] `tests/e2e/sheet/wise-crud.spec.mjs` — add a wise, rename, delete (wises are an actor-field array, not Items; capped at 4 per DH p.87; generic `addRow`/`deleteRow` actions with `data-array="wises"`)
- [x] `tests/e2e/sheet/session-reset.spec.mjs` — run resetSession (behind DialogV2.confirm); verify trait `beneficial` restored + `usedAgainst` cleared; also resets spell `cast` / invocation `performed` flags
- [x] `tests/e2e/sheet/nature-tax.spec.mjs` — use `conserveNature` (dialog; -1 max, rating slammed to new max, pass/fail zeroed) / `recoverNature` (no dialog; rating +1 toward max); verify guards
- [x] `tests/e2e/sheet/inventory-slots.spec.mjs` — drop / pickUp / removeFromSlot verified against `system.slot`, `system.slotIndex`, `system.dropped` fields; dropItem cascades to container children; pickUp clears `dropped` only (does NOT reassign slot — item lands in "Unassigned")
- [x] `tests/e2e/sheet/inventory-supplies.spec.mjs` — consumePortion (decrement quantity + clear hungry), drinkDraught (on containers!), consumeLight (decrement turnsRemaining); items never auto-delete at 0
- [x] `tests/e2e/sheet/inventory-bundle-split.spec.mjs` — bundles are `container` items with `quantityMax > 1`; splitBundle is "peel one off" (no dialog); creates qty=1 Item in Unassigned, decrements source. Buttons hidden at qty<2.
- [x] `tests/e2e/sheet/biography-edit.spec.mjs` — `system.bio` is plain textarea (not ProseMirror); covers bio + allies table rows + level-choices table (NOTE: convictions belief/creed/goal/instinct are NOT on this tab — they're on Identity tab; see edit-convictions box below)
- [ ] `tests/e2e/sheet/edit-convictions.spec.mjs` — edit belief / creed / goal / instinct textareas on the Identity tab's "What You Fight For" fieldset; verify persistence + header badge updates for `system.goal`

---

## 3. Rolls (Ability & Skill Tests)

### Agent briefing

**Files:**
- `module/dice/tb2e-roll.mjs` — main roll entry, modifier gathering
- `module/dice/roll-utils.mjs` — wise aiders, nature tax, advancement logging
- `module/dice/help.mjs` — help eligibility
- `module/dice/post-roll.mjs` — chat card post-roll actions
- `templates/chat/roll-card.hbs`, `less/chat/roll-card.less`

**Rules:**
- Core test: DH pp.56–62. Pool = rating + mods; count 4–6 as successes; compare vs obstacle.
- Conditions modify (afraid: -1D to Will; injured: -1D to physical actions etc. — see DH p.53).
- Help (DH p.63): +1D per helper; KO'd / dead / afraid cannot help.
- Wise aid (DH p.87): post-roll, spend Persona, pick relevant wise; may advance wise on milestone.
- Nature tax (DH p.119): offered post-roll; taxing to 0 triggers nature crisis card.
- Fate / Persona (DH p.47): spend in roll dialog or post-roll.

**Patterns:**
- `rollTest` data-action on ability/skill rows triggers the roll dialog.
- Dialog has modifier inputs, help-dice checkbox, Fate/Persona spinners, submit button.
- Chat card actions: `fateReroll`, `personaDeeperUnderstanding`, `natureTax`, `spendWise`, `acceptHelp`, `finalizeVersus`.

**Checkboxes:**

- [ ] `tests/e2e/roll/ability-test-basic.spec.mjs` — roll Will vs Ob, no mods; verify chat card shows pool, successes, pass/fail
- [ ] `tests/e2e/roll/skill-test-basic.spec.mjs` — roll Fighter vs Ob; verify chat card + pass/fail pips ticked on sheet
- [ ] `tests/e2e/roll/roll-dialog-modifiers.spec.mjs` — open roll dialog, add +1D modifier manually, submit; verify added to pool
- [ ] `tests/e2e/roll/condition-modifiers.spec.mjs` — toggle afraid, roll Will; verify -1D applied per DH p.53
- [ ] `tests/e2e/roll/help-accept.spec.mjs` — Character A rolls, Character B clicks Help on chat card; verify +1D added to A's pool
- [ ] `tests/e2e/roll/help-blocked-when-ko.spec.mjs` — KO'd helper cannot accept Help (help.mjs line 57)
- [ ] `tests/e2e/roll/wise-aid-persona.spec.mjs` — post-roll, spend Persona + pick wise; verify wise added as +1s; wise-advancement card posts on milestone
- [ ] `tests/e2e/roll/fate-reroll.spec.mjs` — post-roll spend Fate; verify 6s rerolled, new successes shown (DH p.47)
- [ ] `tests/e2e/roll/persona-deeper-understanding.spec.mjs` — post-roll spend Persona; verify +2s added
- [ ] `tests/e2e/roll/nature-tax-decrement.spec.mjs` — post-roll spend nature, rating decrements by 1

---

## 4. Advancement

### Agent briefing

**Files:**
- `module/dice/advancement.mjs` — dialog
- `module/applications/actor/advancement-chat-card.mjs` (if exists)
- Pass/fail pip auto-trigger: in `post-roll.mjs`, when pip thresholds are met per DH p.84

**Rules:**
- Rating N advances requires N passes + N-1 fails (routine N, D and Ch for higher tiers; DH p.84).
- Auto-trigger on the roll that fills the final pip.

**Checkboxes:**

- [ ] `tests/e2e/advancement/auto-trigger.spec.mjs` — set character to 1 pass + 1 fail below threshold, roll the triggering test, assert advancement dialog opens
- [ ] `tests/e2e/advancement/accept.spec.mjs` — accept advancement; verify rating +1 and pips reset
- [ ] `tests/e2e/advancement/cancel.spec.mjs` — cancel advancement; verify rating unchanged, pips unchanged
- [ ] `tests/e2e/advancement/skill-open.spec.mjs` — roll a skill the character doesn't have (opens a beginner's luck attempt); verify skill-opened card on success per DH p.84
- [ ] `tests/e2e/advancement/wise-advancement.spec.mjs` — use wise aid on a milestone roll; verify wise-advancement card and rating bump (DH p.87)

---

## 5. Versus Tests

### Agent briefing

**Files:**
- `module/dice/versus.mjs` — PendingVersusRegistry, finalize, tie-break
- `templates/chat/versus-pending.hbs`, `versus-resolution.hbs`, `versus-tied.hbs`
- Mailbox: `flags.tb2e.pendingVersusFinalize`

**Rules:**
- Versus (DH pp.56, 89): both sides roll; highest successes wins. Tie: either side with trait level 3+ can spend to win.

**Patterns:**
- Initiator opens a roll dialog and marks it as versus → posts `versus-pending` card.
- Opponent clicks "Respond" on card → rolls → posts resolution or tied card.
- Tied card: "Spend Trait to Win" button for each side.

**Checkboxes:**

- [ ] `tests/e2e/versus/initiate-respond.spec.mjs` — A rolls versus, B responds; verify resolution card has margin and winner
- [ ] `tests/e2e/versus/tie-break.spec.mjs` — force a tie via equal rolls (or mocked), A spends a level-3 trait, verify A wins
- [ ] `tests/e2e/versus/tie-no-trait.spec.mjs` — tie, no side has spendable trait; verify resolution is a compromise / stand-off per rules
- [ ] `tests/e2e/versus/finalize-via-mailbox.spec.mjs` — exercise `pendingVersusFinalize` for a player respondent (non-GM); verify GM hook processes and clears the flag

---

## 6. Spells

### Agent briefing

**Files:**
- `module/dice/spell-casting.mjs` — three casting types
- `module/applications/item/spell-sheet.mjs`
- `module/data/item/spell.mjs` — castingType: fixed / factors / versus / skillSwap
- Spellbook: `module/data/item/spellbook.mjs`
- Scroll: `module/data/item/scroll.mjs`
- Rules: DH pp.99–101, p.116; Arcanist skill

**Patterns:**
- `castSpell` data-action on Magic tab.
- Fixed casting: roll Arcanist vs spell's `fixedObstacle`.
- Factor casting: factor picker dialog → computed obstacle → roll.
- Versus casting: target the opponent; resolves via versus system.
- Materials/focus: +1D each when marked on the item.

**Checkboxes:**

- [ ] `tests/e2e/spell/cast-fixed-obstacle.spec.mjs` — cast a fixed-Ob spell; verify roll vs correct Ob, chat card has spell source
- [ ] `tests/e2e/spell/cast-factors.spec.mjs` — cast a factors spell; factor dialog opens, selections compute Ob, roll resolves
- [ ] `tests/e2e/spell/cast-versus.spec.mjs` — cast a versus spell; verify versus-pending card, opponent responds
- [ ] `tests/e2e/spell/materials-focus-bonus.spec.mjs` — toggle materials+focus on spell; verify +2D added to roll
- [ ] `tests/e2e/spell/scroll-one-use.spec.mjs` — cast from a scroll; verify scroll is consumed / marked burned
- [ ] `tests/e2e/spell/spellbook-source.spec.mjs` — cast from spellbook; verify chat card shows spellbook as source
- [ ] `tests/e2e/spell/cast-skill-swap.spec.mjs` — skillSwap casting type; verify success chat posted with no roll

---

## 7. Invocations & Relics

### Agent briefing

**Files:**
- `module/dice/invocation-casting.mjs`
- `module/applications/item/invocation-sheet.mjs`
- `module/data/item/invocation.mjs`, `relic.mjs`
- Packs: `theurge-invocations`, `theurge-relics`, `shamanic-invocations`, `shamanic-relics`
- Relic auto-detection: great relics match by circle; lesser by invocation name link; relic must be slotted (not dropped)

**Checkboxes:**

- [ ] `tests/e2e/invocation/perform-basic.spec.mjs` — perform a Theurge invocation with no relic; verify burden applied
- [ ] `tests/e2e/invocation/perform-with-relic.spec.mjs` — relic slotted + auto-detected; verify reduced burden (`burdenWithRelic`) applied
- [ ] `tests/e2e/invocation/perform-without-relic-penalty.spec.mjs` — versus invocation, no relic; verify -1s applied
- [ ] `tests/e2e/invocation/sacramental.spec.mjs` — sacramental flag behavior on appropriate invocation
- [ ] `tests/e2e/invocation/shaman-invocation.spec.mjs` — shaman invocation end-to-end
- [ ] `tests/e2e/invocation/relic-dropped-not-detected.spec.mjs` — drop the relic from a slot; verify it's NOT auto-detected (see invocation-casting.mjs logic)

---

## 8. Compendiums

### Agent briefing

**Files:**
- Foundry core compendium behavior
- `module/config.mjs` — pack registrations
- POMs: `pages/CompendiumSidebar.mjs`, `pages/CompendiumWindow.mjs`

**Checkboxes:**

- [ ] `tests/e2e/compendium/open-each-pack.spec.mjs` — open every pack under system.json, assert window renders with expected entry count range
- [ ] `tests/e2e/compendium/drag-weapon-to-inventory.spec.mjs` — drag a weapon from the `weapons` pack onto a character sheet inventory
- [ ] `tests/e2e/compendium/drag-spell-to-magic-tab.spec.mjs` — drag a spell from `spells` pack onto character magic tab
- [ ] `tests/e2e/compendium/drag-monster-to-scene.spec.mjs` — drag a monster from `monsters` pack onto the active scene; verify token created
- [ ] `tests/e2e/compendium/drag-relic-to-slot.spec.mjs` — drag a relic into a character's inventory slot
- [ ] `tests/e2e/compendium/search-filter.spec.mjs` — search within a pack, verify filtering reduces list

---

## 9. Loot Tables

### Agent briefing

**Files:**
- `module/documents/loot-table.mjs` — `TB2ELootTable`, chain trace
- Pack: `loot-tables` (52 subtables)
- Templates: `templates/chat/loot-draw.hbs`
- Recursion: max depth 5; results can be another table

**Rules:**
- Scholar's Guide loot tables (various pages). Subtable drawing cascades until a terminal item.

**Checkboxes:**

- [ ] `tests/e2e/loot/draw-terminal-table.spec.mjs` — roll a non-recursive loot table (e.g. "Coins"); verify single chat card with terminal result
- [ ] `tests/e2e/loot/draw-recursive-chain.spec.mjs` — roll a top-level table that chains to a subtable (e.g. "Treasure Type" → "Enchanted Weapon"); verify chain trace shown in single card
- [ ] `tests/e2e/loot/draw-max-depth.spec.mjs` — verify recursion stops at depth 5
- [ ] `tests/e2e/loot/draw-page-refs.spec.mjs` — verify page references appear in chat card

---

## 10. Grind Tracker

### Agent briefing

**Files:**
- `module/applications/grind-tracker.mjs` — singleton HUD
- Rules: DH p.53 (conditions), p.75 (phases), grind turn counter
- Mailbox: `flags.tb2e.pendingGrindApply` (player → GM condition application)
- Consolidated condition chat card (recent commit)

**Checkboxes:**

- [ ] `tests/e2e/grind/advance-turn.spec.mjs` — GM advances turn counter; verify display updates for all clients
- [ ] `tests/e2e/grind/set-phase.spec.mjs` — cycle phases; verify dropdown/state
- [ ] `tests/e2e/grind/apply-condition-mailbox.spec.mjs` — player triggers a condition via sheet; GM hook processes; verify condition applied and mailbox cleared
- [ ] `tests/e2e/grind/consolidated-card.spec.mjs` — multiple conditions in one turn render as single consolidated chat card
- [ ] `tests/e2e/grind/light-extinguish.spec.mjs` — exhaust a torch; verify torch-expired card and inventory state change via `pendingLightExtinguish` mailbox

---

## 11. Nature Crisis

### Agent briefing

**Files:**
- `module/dice/post-roll.mjs` — nature tax trigger
- `templates/chat/nature-crisis.hbs`
- Rule: DH p.119

**Checkboxes:**

- [ ] `tests/e2e/nature/crisis-triggered.spec.mjs` — nature=1, tax 1 point post-roll, verify nature-crisis card posted
- [ ] `tests/e2e/nature/recovery.spec.mjs` — after crisis, recover nature via sheet action; verify rating restored toward max

---

## 12. Conflict: Setup

### Agent briefing

**Files:**
- `module/applications/conflict/conflict-panel.mjs` — 7-tab wizard
- `module/applications/conflict/conflict-tracker.mjs` — sidebar scoreboard
- `module/documents/combat.mjs` — TB2ECombat (extends Combat)
- `templates/conflict/panel-setup.hbs`
- Conflict types: config.mjs `CONFIG.TB2E.conflictTypes` (14 types: Kill, Capture, Chase, DriveOff, Flee, Convince, ConvinceCrowd, Trick, Negotiate, Abjure, Riddle, War, Journey, Manual)

**Gotchas:**
- `combatant.actor` not `game.actors.get(combatant.actorId)` (CLAUDE.md synthetic token section)
- Combatant data is `system.pending*` mailboxes for cross-permission writes

**Checkboxes:**

- [ ] `tests/e2e/conflict/setup-create-conflict.spec.mjs` — create a new conflict, assert panel opens on setup tab, tracker appears in sidebar
- [ ] `tests/e2e/conflict/setup-add-combatants.spec.mjs` — add two characters + two monsters via the panel, assert combatant list
- [ ] `tests/e2e/conflict/setup-assign-captain.spec.mjs` — assign captain per side; verify captain flag stored
- [ ] `tests/e2e/conflict/setup-assign-boss.spec.mjs` — assign monster boss; verify `setBoss` action stored
- [ ] `tests/e2e/conflict/setup-select-type.spec.mjs` — cycle through all 14 conflict types; verify each type's allowed actions/skills shown per config

---

## 13. Conflict: Disposition

### Agent briefing

**Files:**
- `module/applications/conflict/conflict-panel.mjs` — `rollDisposition`, `distribute`, `setFlatDisposition`
- `templates/conflict/panel-disposition.hbs`
- `module/documents/combat.mjs` — `distributeDisposition()`
- Mailboxes: `system.pendingDisposition`, `system.pendingDistribution` on combatant

**Rules:**
- Disposition roll: captain rolls selected skill or ability bonus + conflict-type skill; total = team HP (DH pp.120–122)
- Monster disposition is typically flat from stat block.
- Distribution: captain splits total across teammates.

**Checkboxes:**

- [ ] `tests/e2e/conflict/disposition-roll-captain.spec.mjs` — GM captain rolls disposition, verify `conflict.hp` set on each combatant
- [ ] `tests/e2e/conflict/disposition-flat-monster.spec.mjs` — monster side uses flat disposition; verify HP set without roll
- [ ] `tests/e2e/conflict/disposition-distribution-player.spec.mjs` — player captain writes to `pendingDistribution`; verify GM processes and clears mailbox
- [ ] `tests/e2e/conflict/disposition-order-of-might.spec.mjs` — Kill conflict; team with higher Might bonus receives +1s per point advantage (SG p.80; see `computeOrderModifier`)
- [ ] `tests/e2e/conflict/disposition-precedence.spec.mjs` — Convince conflict; team with higher Precedence gains +1s (SG p.82)

---

## 14. Conflict: Weapons

### Agent briefing

**Files:**
- `conflict-panel.mjs` — weapons tab handlers
- `templates/conflict/panel-weapons.hbs`
- Each conflict type has `conflictWeapons` (e.g., "Blackmail" for social conflicts); some assignable bonuses

**Checkboxes:**

- [ ] `tests/e2e/conflict/weapons-assign-per-combatant.spec.mjs` — assign a weapon per combatant via dropdown; verify state persists through scripting
- [ ] `tests/e2e/conflict/weapons-improvised.spec.mjs` — use "improvised" weapon with custom name; verify stored and displayed
- [ ] `tests/e2e/conflict/weapons-assignable-bonus.spec.mjs` — assignable conflict weapon (e.g., Blackmail) grants +1D to target action

---

## 15. Conflict: Scripting

### Agent briefing

**Files:**
- `conflict-panel.mjs` — `beginScripting`, `lockActions`, `peekActions`
- `templates/conflict/panel-script.hbs`
- Mailbox: `system.pendingActions`, `system.pendingActionsLocked`
- 4 action types: Attack, Defend, Feint, Maneuver (config.mjs 392–397)

**Checkboxes:**

- [ ] `tests/e2e/conflict/script-assign-actions.spec.mjs` — each player selects A/D/F/M per volley; verify `pendingActions` mailbox updated
- [ ] `tests/e2e/conflict/script-lock.spec.mjs` — lock actions; verify `pendingActionsLocked` set, UI shows locked state
- [ ] `tests/e2e/conflict/script-peek-gm.spec.mjs` — GM peek shows scripted actions; verify player view remains hidden
- [ ] `tests/e2e/conflict/script-change-before-lock.spec.mjs` — changing an action before locking updates the mailbox
- [ ] `tests/e2e/conflict/script-independent-ko-sub.spec.mjs` — if a combatant is KO'd mid-round, scripting UI handles substitution (see `swapActionCombatant`)

---

## 16. Conflict: Resolve / Versus

### Agent briefing

**Files:**
- `conflict-panel.mjs` — `beginResolve`, `revealAction`, `rollAction`, `resolveAction`
- `module/dice/conflict-roll.mjs` — `calculateMargin`, `computeOrderModifier`
- `templates/conflict/panel-resolve.hbs`, `conflict-action-reveal.hbs`
- Interaction matrix (config.mjs 407–424): versus / independent / none
- Playing-card animation CSS in `less/conflict/cards.less`

**Rules:**
- DH pp.120–127: action vs action resolution.
- Attack vs Defend = versus; Attack vs Attack = independent with Ob 0/3.
- Feint vs Attack/Defend = none (defender/feinter doesn't roll).

**Checkboxes:**

- [ ] `tests/e2e/conflict/resolve-attack-vs-defend.spec.mjs` — versus resolution, higher successes wins; HP reduced by margin on loser
- [ ] `tests/e2e/conflict/resolve-attack-vs-attack.spec.mjs` — independent roll vs Ob 0; both may hit
- [ ] `tests/e2e/conflict/resolve-feint-vs-attack.spec.mjs` — feinter rolls, defender does not; feinter hits on any successes
- [ ] `tests/e2e/conflict/resolve-feint-vs-feint.spec.mjs` — versus resolution between two feints
- [ ] `tests/e2e/conflict/resolve-maneuver-vs-defend.spec.mjs` — versus resolution; MoS opens `maneuver-spend-dialog.mjs`
- [ ] `tests/e2e/conflict/resolve-card-animation.spec.mjs` — assert the playing-card DOM elements appear on reveal
- [ ] `tests/e2e/conflict/resolve-monster-nature.spec.mjs` — monster uses Nature for all action rolls (conflict-roll.mjs lines 49–53)

---

## 17. Conflict: Maneuver MoS Spends

### Agent briefing

**Files:**
- `module/applications/conflict/maneuver-spend-dialog.mjs`
- Mailbox: `system.pendingManeuverSpend` on combatant
- Rule: SG p.69; MoS combos 1–4
  - 1 MoS: Impede (-1D opponent next action)
  - 2 MoS: Position (+2D team next action)
  - 3 MoS: Disarm (remove weapon/trait/gear)
  - 4 MoS: Rearm (equip dropped weapon) or Impede+Disarm

**Checkboxes:**

- [ ] `tests/e2e/conflict/mos-impede.spec.mjs` — winning maneuver with 1 MoS; choose Impede; verify -1D applied on next volley
- [ ] `tests/e2e/conflict/mos-position.spec.mjs` — 2 MoS Position; verify +2D to whole team's next action
- [ ] `tests/e2e/conflict/mos-disarm-weapon.spec.mjs` — 3 MoS Disarm of opponent's weapon; verify weapon removed from that combatant's assignment
- [ ] `tests/e2e/conflict/mos-disarm-trait.spec.mjs` — Disarm of a trait usage; verify trait flag cleared for remainder of conflict
- [ ] `tests/e2e/conflict/mos-rearm-dropped-weapon.spec.mjs` — 4 MoS Rearm; pick from `droppedWeapons`; verify weapon re-equipped
- [ ] `tests/e2e/conflict/mos-impede-disarm-combo.spec.mjs` — 4 MoS Impede+Disarm combo
- [ ] `tests/e2e/conflict/mos-carries-across-rounds.spec.mjs` — Impede/Position persist into next round per conflict-panel tracking (lines 1271–1277)

---

## 18. Conflict: HP & KO

### Agent briefing

**Files:**
- `module/documents/combat.mjs`, `combatant.mjs`
- `module/dice/help.mjs` — help blocked when KO'd (line 57)
- Mailbox: `flags.tb2e.pendingConflictHP`
- CLAUDE.md synthetic token rules — use `combatant.actor` always

**Checkboxes:**

- [ ] `tests/e2e/conflict/hp-damage-reduces.spec.mjs` — losing action reduces HP by margin; `combatant.actor.system.conflict.hp.value` updated
- [ ] `tests/e2e/conflict/hp-player-mailbox.spec.mjs` — player-side HP change goes via `pendingConflictHP`; GM hook processes
- [ ] `tests/e2e/conflict/hp-ko-at-zero.spec.mjs` — HP hitting 0 marks combatant `knockedOut`
- [ ] `tests/e2e/conflict/hp-ko-swap-mid-volley.spec.mjs` — panel-resolve "swap" replaces KO'd combatant; verify `swapActionCombatant` call
- [ ] `tests/e2e/conflict/hp-help-blocked-when-ko.spec.mjs` — KO'd combatant cannot help on rolls (already covered in §3 but duplicate here for conflict-specific surface)
- [ ] `tests/e2e/conflict/hp-synthetic-token-parity.spec.mjs` — unlinked monster's HP is written to synthetic actor, not world actor; verify world actor unchanged (regression test for CLAUDE.md gotcha)

---

## 19. Conflict: Team, Helping, Artha

### Agent briefing

**Files:**
- `module/dice/conflict-roll.mjs` — synergy, helpers
- Actions can be helped by teammates not scripted this volley
- Fate / Persona available in conflict roll dialogs (`showPersona` flag in tb2e-roll.mjs lines 395–397)

**Checkboxes:**

- [ ] `tests/e2e/conflict/team-synergy.spec.mjs` — teammate synergy on resolve adds +1D to the rolling teammate's action
- [ ] `tests/e2e/conflict/team-helper-from-unscripted.spec.mjs` — unscripted teammate can help a scripted action
- [ ] `tests/e2e/conflict/artha-fate-in-conflict.spec.mjs` — spend Fate during conflict roll; verify reroll
- [ ] `tests/e2e/conflict/artha-persona-in-conflict.spec.mjs` — spend Persona +1D during conflict roll

---

## 20. Conflict: Resolution & Compromise

### Agent briefing

**Files:**
- `conflict-panel.mjs` — `resolveConflict`, `endConflict`, `nextRound`
- `templates/conflict/panel-resolution.hbs`, `chat/conflict-compromise.hbs`, `conflict-round-summary.hbs`
- Rule: DH pp.125–127 (compromise determined by remaining HP)

**Checkboxes:**

- [ ] `tests/e2e/conflict/resolution-victory.spec.mjs` — one side reduced to 0 HP while other > 50%; verify "major victory" outcome and chat card
- [ ] `tests/e2e/conflict/resolution-minor-compromise.spec.mjs` — winner at high HP, loser at 0; verify minor compromise
- [ ] `tests/e2e/conflict/resolution-major-compromise.spec.mjs` — winner at low HP, loser at 0; verify major compromise
- [ ] `tests/e2e/conflict/resolution-end-conflict-clears-state.spec.mjs` — end conflict; verify tracker removed, combatants' conflict.hp cleared, panel closed
- [ ] `tests/e2e/conflict/resolution-round-summary.spec.mjs` — end of round posts conflict-round-summary card with actions + outcomes

---

## 21. Monster & NPC Sheets

### Agent briefing

**Files:**
- `module/applications/actor/monster-sheet.mjs` (if exists), `templates/actor/monster/*.hbs`
- `module/applications/actor/npc-sheet.mjs` (if exists), `templates/actor/npc/*.hbs`
- `module/data/actor/monster.mjs`, `npc.mjs`
- Packs: `monsters` (42), `npcs` (43)

**Checkboxes:**

- [ ] `tests/e2e/sheet/monster-open.spec.mjs` — open a monster from compendium; verify sheet renders with Nature, conflict dispositions, traits
- [ ] `tests/e2e/sheet/monster-nature-roll.spec.mjs` — roll Nature from monster sheet; verify roll card
- [ ] `tests/e2e/sheet/npc-open.spec.mjs` — open an NPC; verify sheet renders
- [ ] `tests/e2e/sheet/npc-edit-basics.spec.mjs` — edit NPC name/notes; verify persistence

---

## 22. Items (Non-Magic)

### Agent briefing

**Files:**
- `module/data/item/weapon.mjs`, `armor.mjs`, `gear.mjs`, `supply.mjs`, `container.mjs`
- `module/applications/item/gear-sheet.mjs`
- Inventory slots: head, neck, hand-L, hand-R, torso, belt, feet, pocket + custom container slots

**Checkboxes:**

- [ ] `tests/e2e/item/weapon-sheet.spec.mjs` — open weapon item sheet from inventory; edit damage/weight; verify persistence
- [ ] `tests/e2e/item/armor-sheet.spec.mjs` — open armor; edit protection/burden
- [ ] `tests/e2e/item/container-custom-slots.spec.mjs` — create container with custom slot definitions; verify slots appear on character sheet
- [ ] `tests/e2e/item/supply-quality-portions.spec.mjs` — supply with multiple portions; consume one; verify counter decrement

---

## Execution order suggestion

Roughly lowest-dependency first so earlier specs establish POMs/fixtures later specs reuse:

1. §2 Character Sheet (foundation POMs for sheet interactions)
2. §3 Rolls (roll dialog / chat-card POMs)
3. §4 Advancement, §5 Versus (build on §3)
4. §21 Monster/NPC sheets (simple coverage, expands fixture set)
5. §22 Items, §8 Compendiums, §9 Loot Tables
6. §6 Spells, §7 Invocations
7. §10 Grind, §11 Nature Crisis
8. §12–§20 Conflict (largest area; ~40 specs; do last because it depends on characters, items, rolls, mailboxes)
9. §1 Character Creation Wizard (very long flow; deferred because the iconic-characters drag already gives us populated characters for earlier tests)

---

## Out of scope for this plan

- Visual regression / screenshot snapshots (could be added later under a separate project)
- Performance/load (single-browser, single-Foundry harness)
- Module compatibility (other Foundry modules installed)
- Cross-browser (Firefox/WebKit) — chromium only until the suite stabilizes
- Multi-client (two browsers simultaneously joined) — mailbox pattern still testable via `page.evaluate` to force player-side writes and a hook observer in GM context

---

## Tally

| Section | Unchecked specs |
|---|---|
| 1. Character Creation | 7 |
| 2. Character Sheet | 12 |
| 3. Rolls | 10 |
| 4. Advancement | 5 |
| 5. Versus | 4 |
| 6. Spells | 7 |
| 7. Invocations & Relics | 6 |
| 8. Compendiums | 6 |
| 9. Loot Tables | 4 |
| 10. Grind Tracker | 5 |
| 11. Nature Crisis | 2 |
| 12. Conflict: Setup | 5 |
| 13. Conflict: Disposition | 5 |
| 14. Conflict: Weapons | 3 |
| 15. Conflict: Scripting | 5 |
| 16. Conflict: Resolve | 7 |
| 17. Conflict: Maneuver MoS | 7 |
| 18. Conflict: HP & KO | 6 |
| 19. Conflict: Team/Artha | 4 |
| 20. Conflict: Resolution | 5 |
| 21. Monster/NPC Sheets | 4 |
| 22. Items | 4 |
| **Total unchecked** | **127** |
| Infrastructure (checked) | 3 |
