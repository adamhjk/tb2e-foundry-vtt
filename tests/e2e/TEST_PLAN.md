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
- [ ] ~~skipped~~ `tests/e2e/character/create-npc.spec.mjs` — **PRODUCTION BUG**: `module/applications/actor/npc-sheet.mjs:43` references `templates/actors/character-conflict.hbs` which doesn't exist; NPC sheets throw ENOENT on render. Spec + POM are written and ready behind `test.fixme()`; remove the fixme once the bug is fixed.

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
- [x] `tests/e2e/sheet/edit-convictions.spec.mjs` — edit belief / creed / goal / instinct textareas on the Identity tab's "What You Fight For" fieldset; verify persistence + header badge updates for `system.goal`

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

- [x] `tests/e2e/roll/ability-test-basic.spec.mjs` — roll Will vs Ob 3 with stubbed dice (all-3s FAIL path + all-6s PASS path); verifies pool/successes/outcome on the chat card. Foundational RollDialog + RollChatCard POMs shipped.
- [x] `tests/e2e/roll/skill-test-basic.spec.mjs` — roll Fighter vs Ob; verify chat card + pass/fail pips ticked on sheet
- [x] `tests/e2e/roll/roll-dialog-modifiers.spec.mjs` — open roll dialog, add +1D modifier manually, submit; verify added to pool
- [ ] ~~skipped~~ `tests/e2e/roll/condition-modifiers.spec.mjs` — **TEST-PLAN / RAW MISMATCH**: afraid does NOT impose -1D per RAW (SG p.48 says afraid blocks help + BL only; -1D is for injured/sick per SG pp.49-52). `module/dice/tb2e-roll.mjs` `gatherConditionModifiers` correctly implements RAW (fresh +1D, injured/sick -1D, afraid = no dice mod). Spec is written behind `test.fixme()` with the expected-pass shape; to green it, either retarget the entry to injured/sick OR add afraid → -1D as an explicit deviation from SG p.48 in `gatherConditionModifiers`.
- [x] `tests/e2e/roll/help-accept.spec.mjs` — Character A opens roll dialog with Helper B eligible (scene token, same-ability rating > 0); toggle Help in the dialog, verify +1D added to A's pool (DH p.63). Note: help is a pre-roll dialog toggle in this codebase, not a post-roll chat-card action — only `synergy` (helper fate-for-advancement) lives on the chat card.
- [x] `tests/e2e/roll/help-blocked-when-ko.spec.mjs` — KO'd helper is filtered out of the pre-roll eligible-helpers pool (no `.helper-toggle` renders); gate is `conflictHP?.max > 0 && conflictHP.value <= 0` in `isBlockedFromHelping` (help.mjs line 57, DH p.63).
- [x] `tests/e2e/roll/wise-aid-persona.spec.mjs` — pre-roll pick wise on dialog, post-roll click "Ah, Of Course!" to spend 1 Persona; verifies Persona decrement, the reroll of all wyrms (DH p.77 — reroll all failed dice, not flat +1s), the `wise.persona` advancement tick, and the wise-advancement card posting when the 4th of pass/fail/fate/persona is marked (DH p.78). Extends RollDialog POM with `selectWise()` and RollChatCard POM with `clickOfCourse()`.
- [x] `tests/e2e/roll/fate-reroll.spec.mjs` — post-roll "Fate: Luck" (data-action `fate-luck`) spends 1 Fate, rerolls every 6 (sun) in the original pool, **cascades on new 6s** (post-roll.mjs line 141-146 — the loop re-filters each reroll batch for suns and re-rolls until none remain), appends luck dice tagged `isLuck: true`, and recalculates pass (DH p.47 / SG p.87). Button gated on `hasFate ∧ hasSuns`; `luckUsed: true` flag hides it after use. Spec covers the happy path (2 suns → reroll with non-6 success faces → +2 successes, FAIL→PASS flip, fate decrement) plus a no-fate gating test (button absent when fate.current = 0). Extends RollChatCard POM with `fateLuckButton` + `clickFateLuck()`.
- [x] `tests/e2e/roll/persona-deeper-understanding.spec.mjs` — **RAW-corrected:** the "Deeper Understanding" mechanic is SG p.87, spending **1 Fate** (not Persona; not "+2s") to reroll a **single wyrm in place on a wise-related roll**. Data-action is `deeper-understanding`; handler is `_handleDeeperUnderstanding` in `module/dice/post-roll.mjs` (line 181-249). Button gating: `!deeperUsed && !luckUsed && hasFate && wiseSelected && hasWyrms` (roll-result.hbs lines 90-99). `_handleDeeperUnderstanding` replaces the first wyrm IN PLACE tagged `isRerolled: true` (line 208 — not appended like Luck/Of Course), deducts 1 Fate, flips `wises[i].fate = true` (DH p.78 advancement box), and sets `flags.tb2e.deeperUsed = true`. Spec covers happy path (3D all-3s FAIL → reroll-to-6 PASS flip, fate decrement, wise.fate flip, in-place dice count preserved, `isRerolled` tag) and a no-fate gating test. Extends RollChatCard POM with `deeperUnderstandingButton` + `clickDeeperUnderstanding()`.
- [x] `tests/e2e/roll/nature-tax-decrement.spec.mjs` — post-roll Nature tax prompt after a Channel Nature spend (DH p.119 / SG p.87). Data-actions are `nature-yes` (within descriptors → 0 tax) and `nature-no` (outside descriptors → tax applies); handler is `_handleNatureTax` in `module/dice/post-roll.mjs` (lines 328-365). Tax amount is `calculateNatureTax` from roll-utils.mjs line 68-71 (pass → 1, fail → `max(obstacle - finalSuccesses, 1)`); decrement clamped to >= 0 rating. Prompt gating: `showNatureTax = channelNature && !natureTaxResolved` (post-roll.mjs line 892 / tb2e-roll.mjs line 1518). Side-effects: `flags.tb2e.natureTaxResolved = true` + `natureTaxAmount` on the message (lines 359-362); `system.abilities.nature.rating` updated; `system.abilities.nature.max` **unchanged** (max is only touched by the sheet `conserveNature` flow and by crisis resolution). Rating-to-0 posts a nature-crisis chat card via `_postNatureCrisis` (line 600-632) — deep crisis-card assertions deferred to §11. Spec covers (1) pass-path decrement rating 3→2 with max/pips unchanged, (2) "Yes" within-descriptors no-tax path, (3) rating 1→0 triggers a nature-crisis ChatMessage (minimal shape check only). Extends `RollChatCard` with `natureTaxYesButton`/`natureTaxNoButton` + `clickNatureTaxYes()`/`clickNatureTaxNo()` and `RollDialog` with `toggleChannelNature()`.

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

- [x] `tests/e2e/advancement/auto-trigger.spec.mjs` — stage Fighter rating 2 at (1P, 1F) one pass-pip below the (2P, 1F) threshold (DH p.84); PASS roll + Finalize fills the final pip and auto-opens the advancement dialog (label/current→new rating asserted); negative control at (0, 0) confirms the dialog stays closed
- [x] `tests/e2e/advancement/accept.spec.mjs` — stage Fighter rating 2 at (1P, 1F), PASS roll + Finalize opens the dialog; clicking Advance bumps rating 2 → 3 and hard-resets pips to (0, 0) per advancement.mjs:57-61 (NOT overflow-carry), and a celebration chat card (advancement-result.hbs) is posted speaker-scoped to the actor
- [x] `tests/e2e/advancement/cancel.spec.mjs` — cancel advancement should leave rating unchanged and pips at their threshold-met values (the pip tick in `_logAdvancement` fires pre-dialog and cancel is a no-op), plus no celebration chat card. **Landed as `test.fixme` — production bug in advancement.mjs:45-54**: the cancel button has no `callback`, so DialogV2's `_onSubmit` resolves `wait()` with the truthy string `"cancel"` (dialog.mjs:242 `?? button?.action`), which passes the `if (!result) return` guard and runs the accept mutation. Fix: add `callback: () => false` to the cancel button OR tighten the guard to `if (result !== true) return`
- [x] `tests/e2e/advancement/skill-open.spec.mjs` — **RAW-corrected:** the "skill opens on success" framing in the checkbox description is a briefing-ism. Per DH p.75 ("Pass or fail doesn't matter when learning new skills, just the number of tests") and `_logBLLearning` in tb2e-roll.mjs:213-232, a skill opens at rating 2 after `natureMax` BL attempts regardless of pass/fail outcome. Spec stages Fighter rating 0 with `learning = natureMax-1` so the next BL attempt trips the open path; a negative-control test at `learning = 0, natureMax = 4` asserts a sub-threshold BL attempt just bumps `learning` to 1 without opening. Also asserts the dialog's live summary reflects the BL halving (`baseDice = 4` Health pre-halving, summary shows `2D` post-halving per tb2e-roll.mjs:647-663 / DH p.58 "Beginners Roll Half"). Skill-opened card is scoped via `speaker.actor === actorId` + the unique `.card-accent--green` + "DH p. 75" reference-bar text from templates/chat/skill-opened.hbs. No advancement dialog fires for BL (`logAdvancementForSide` at roll-utils.mjs:194-199 delegates to `_logBLLearning` and bypasses `_logAdvancement` entirely), so `card.clickFinalize()` works without the native-click deadlock workaround used in the §4 auto-trigger/accept specs.
- [x] `tests/e2e/advancement/wise-advancement.spec.mjs` — **perk-choice flow** on an already-posted wise-advancement card (milestone detection itself is covered in `roll/wise-aid-persona.spec.mjs`). All three perks (`wise-change`, `wise-bl`, `wise-skill-test`) are pure mark-resets at post-roll.mjs lines 781-805 — they zero the four advancement boxes (pass/fail/fate/persona) on `actor.system.wises[i]`. `wise-change` ALSO clears the wise `name` (line 783); the other two leave it intact. No perk opens a follow-up dialog or writes to a mailbox; the card re-renders as resolved with `flags.tb2e.wiseAdvResolved = true` gating the listener from re-firing. Note: wises have no numeric rating field — the briefing's "rating bump" is actually the mark-reset (the wise is ready to accrue a new advancement cycle). Spec covers `wise-change` (name cleared + marks reset + card resolved) and `wise-bl` (name preserved + marks reset + card resolved); `wise-skill-test` has identical data semantics to `wise-bl` (only the localized resolved-text string differs at post-roll.mjs line 800 vs 794) and is not separately exercised.

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

- [x] `tests/e2e/versus/initiate-respond.spec.mjs` — A rolls versus, B responds; GM-driven end-to-end (both actors GM-owned; single browser session). Versus is a **dialog mode toggle** (`.roll-dialog-mode-toggle` cycles `independent` → `versus` → `disposition`) + challenge dropdown (`select[name="challengeMessageId"]` inside `.roll-dialog-challenge`, live-populated by the `createChatMessage` hook in tb2e-roll.mjs line 1032-1045). There is NO "Respond" button — the opponent opens their own roll dialog and picks the initiator's message id from the dropdown. Finalize is the shared `data-action="finalize"` on the roll-result card; `_handleFinalize` (post-roll.mjs line 506-522) versus-branches into `processVersusFinalize` (GM path, skipping the mailbox). The resolution card is rendered from `templates/chat/versus-resolution.hbs` with `flags.tb2e.versus.type === "resolution"` + `winnerId`; margin is NOT a rendered field — computed via `Math.abs(iS - oS)` in versus.mjs line 170 and asserted against the per-side `.versus-successes` text in the POM. Winner-name banner has `text-transform: uppercase` CSS so `textContent` (not `innerText`) is used to preserve the actor's cased name. Cards render twice (chat log + `#chat-notifications`) — POM pins to `.first()`. New `tests/e2e/pages/VersusCard.mjs` exports `VersusPendingCard`, `VersusResolutionCard`, `VersusDialogExtras` sized for §5's remaining 3 checkboxes.
- [x] `tests/e2e/versus/tie-break.spec.mjs` — force a tie via equal rolls (or mocked), A spends a level-3 trait, verify A wins. Tie-break is wired via a distinct chat card (template `templates/chat/versus-tied.hbs` + flag `versus.type === "tied"`) posted by `_handleVersusTied` (versus.mjs line 309-394) when `_executeVersusResolution` detects `iSuccesses === oSuccesses` (line 149-158). The tied card renders per-side L3 "Win the tie" buttons (`[data-action="level3-break-tie"]` with `data-actor-id` + `data-trait-id`) for each `level === 3` trait — only actors with L3 traits see buttons; empty-state shows `.tied-no-traits` (template line 42/60). Handler `handleLevel3TraitBreakTie` (versus.mjs line 485-518) guards on `level === 3`, `tiedResolved === false`, and `_wasTraitUsedOnRoll` (once-per-test), then routes to `_resolveFromTied` which posts a `type: "resolution"` card with `winnerId = actingActor`. L3 beneficial is **unlimited per session** (DH p.80 / SG p.33) — the handler does NOT mutate the trait (`usedAgainst` stays false, `beneficial` unchanged); spec asserts this. Tie used PRNG stub `u=0.001` for both sides → 3D Will × all-6s = 3 successes each. Extended `VersusCard.mjs` POM with `VersusTiedCard` (banner + `level3BreakTieButton(actorId, traitId)` + `level3BreakTieButtonsFor(actorId)` + native-click `clickLevel3BreakTie`). Verified stable under `--repeat-each=3`.
- [x] `tests/e2e/versus/tie-no-trait.spec.mjs` — tie where NEITHER side has a Level 3 trait, so the `[data-action="level3-break-tie"]` button list is empty for both sides (versus-tied.hbs `{{else}}` branches line 41-43 / 59-61 render `.tied-no-traits`). The concession path is the code-level "compromise" for this case: `handleTraitBreakTie` (versus.mjs line 435-476) accepts ANY trait level — `_getEligibleTieBreakTraits` (line 278-282) filters only on `!system.usedAgainst`, not on level — so per SG p.33 "Breaking Ties" the actor using a trait against themselves concedes the tie and earns 2 checks. Concession semantics verified: (1) `trait.system.usedAgainst = true` flips to gate once-per-session reuse, (2) `trait.system.checks += 2` on the trait item itself, (3) `actor.system.checks += 2` on the character actor (versus.mjs line 463-467; only for `actor.type === "character"`), (4) `winnerId = OTHER actor` (line 471 — the conceder LOSES), (5) tied card's `flags.tb2e.tiedResolved: true` flips (line 569), (6) resolution card posts via `_resolveFromTied`. Both sides' L3 button lists asserted empty; both sides' single-trait concede buttons asserted visible; winner's checks/trait untouched. Extended `VersusCard.mjs` POM with `traitBreakTieButton(actorId, traitId)`, `traitBreakTieButtonsFor(actorId)`, and `clickTraitBreakTie(actorId, traitId)` using the same native-click evaluate pattern as the L3 variants. PRNG stub `u=0.001` both sides → 3D Will all-6s = 3 successes each (tie). Verified stable under `--repeat-each=3` (3/3 green, ~31-35 s each).
- [x] `tests/e2e/versus/finalize-via-mailbox.spec.mjs` — exercise the `pendingVersusFinalize` mailbox end-to-end with no second connected client. The E2E harness only auths as GM (`tests/e2e/auth.setup.mjs`), so `_handleFinalize` always hits the GM fast-path (`post-roll.mjs` line 513-516) when Finalize is clicked in-UI — that's what the other three §5 specs exercise. To drive the non-GM branch (`post-roll.mjs` line 517-519) without impersonating a user, simulate the exact two-step player-side sequence via `page.evaluate`: (1) `message.update({ "flags.tb2e.resolved": true })` mirroring `post-roll.mjs` line 508 (required or `_executeVersusResolution` short-circuits at `versus.mjs` line 126), then (2) `actor.setFlag("tb2e", "pendingVersusFinalize", { messageId })` mirroring line 518. Payload shape: `{ messageId: <finalized versus roll message id> }` — the ONLY field `processVersusFinalize` reads (versus.mjs line 103). GM hook dispatcher at `tb2e.mjs` line 185-192 guards on `!game.user.isGM` (line 186), picks off `changes.flags?.tb2e?.pendingVersusFinalize`, and calls `processVersusFinalize(actor, pending)` when `.messageId` is truthy. Clearing semantics: `processVersusFinalize` at `versus.mjs` line 102-129 unsets the flag at line 106 BEFORE any partner-message work, so the mailbox is drained even when the partner hasn't finalized yet (idempotent clear — no double-processing on duplicate writes). Spec asserts: (a) pre-write `getFlag("tb2e", "pendingVersusFinalize")` is null, (b) no resolution card exists pre-write, (c) resolution card with `versus.type === "resolution"` + matching `initiatorMessageId`/`opponentMessageId` posts within 10 s, (d) `pendingVersusFinalize` is null post-processing (polled via `expect.poll`), (e) resolution card flags + winner/successes/margin all correct, (f) both roll messages flip to `versus.resolved === true` (versus.mjs line 225-226), (g) `PendingVersusRegistry` entry removed (line 229). Reuses `VersusPendingCard` / `VersusResolutionCard` / `VersusDialogExtras` POMs unchanged — mailbox assertions are flag-level page.evaluate, not DOM selectors. Stable under `--repeat-each=3` (3/3 green, ~28-32 s each).

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

- [x] `tests/e2e/spell/cast-fixed-obstacle.spec.mjs` — cast a fixed-Ob spell; verify roll vs correct Ob, chat card has spell source (Beast Cloak `a1b2c3d4e5f63003`, `fixedObstacle: 3`; castSpell→`#onCastSpell` at character-sheet.mjs:1396 → `castSpell` at spell-casting.mjs:11 → rolls Arcanist; spell label on card from `flags.tb2e.testContext.spellName` rendered via roll-result.hbs:21-26 `.roll-card-spell`)
- [x] `tests/e2e/spell/cast-factors.spec.mjs` — cast a factors spell; factor dialog opens, selections compute Ob, roll resolves (Wyrd Lights `a1b2c3d4e5f60010`, factors Number/Duration; `castSpell`→`_showFactorDialog` at spell-casting.mjs:59-64,77-139 renders templates/dice/spell-factors.hbs; `cast` callback sums all `input[type='radio']:checked` values at spell-casting.mjs:104-111 and passes total as `testContext.obstacle`; roll dialog pre-fills obstacle from `testContext.obstacle` at tb2e-roll.mjs:513-515; selecting Number=3 + Duration=1 ⇒ Ob 4, Arcanist rating 4 vs Ob 4 PASS)
- [x] `tests/e2e/spell/cast-versus.spec.mjs` — cast a versus spell; verify versus-pending card, opponent responds, resolution consumes memory-sourced spell (Wizard's Bane `a1b2c3d4e5f6200c`, `castingType: versus`; `castSpell`→spell-casting.mjs:66-69 stamps `testContext.isVersus` → tb2e-roll.mjs:929-937 pre-sets the dialog mode to versus and un-hides the challenge block → `_handleVersusRoll` at tb2e-roll.mjs:1630-1652 posts a roll-result card with `flags.tb2e.versus = { type: "initiator" }` + full `flags.tb2e.testContext` spell payload; opponent cycles `.roll-dialog-mode-toggle` and selects via `challengeMessageId` per VersusCard POM; `_executeVersusResolution` at versus.mjs:261-262 calls `processSpellCast` for the winning caster, flipping `system.cast=true, memorized=false` per spell-casting.mjs:162-173. The plain-versus finalize branch at post-roll.mjs:507-522 does NOT consume the spell — only resolution does, asserted by checking state both before and after the opponent's finalize)
- [x] `tests/e2e/spell/materials-focus-bonus.spec.mjs` — toggle materials+focus on spell; verify +2D added to roll (Beast Cloak `a1b2c3d4e5f63003` with truthy `system.materials` + `system.focus` → `castSpell` pushes two pre-timing dice modifiers per spell-casting.mjs:27-43 with labels from lang/en.json:851-852 `Materials (+1D)` / `Focus (+1D)`; roll dialog keeps `input[name="poolSize"]` at Arcanist rating 3 while `.roll-dialog-modifiers` renders both rows and `updateSummary` at tb2e-roll.mjs:939-962 shows 5D; `rollTest` at tb2e-roll.mjs:1316-1319 computes `poolSize = baseDice + diceBonus = 5`; chat card flags prove `baseDice: 3, poolSize: 5, successes: 5` vs Ob 3 PASS)
- [x] `tests/e2e/spell/scroll-one-use.spec.mjs` — cast from a scroll; verify scroll is consumed / marked burned (Beast Cloak `a1b2c3d4e5f63003` + a `scroll` Item whose `system.spellId` points at the embedded spell per module/data/item/scroll.mjs:9; spell row's `canCast` flips true via the scroll-count branch at character-sheet.mjs:725-728 → `castSpell` button in templates/actors/tabs/character-magic.hbs:44-47 → `#onCastSpell` at character-sheet.mjs:1396-1433 treats scroll as the sole source and passes `opts.scrollItemId`; `castSpell` at spell-casting.mjs:45-56 stamps `testContext.castingSource: "scroll"` + `scrollItemId`; on Finalize `processSpellCast` routes the scroll branch FIRST at spell-casting.mjs:153-158 — sets `spell.system.cast=true`, posts a `spell-source` chat card with `.spell-source-confirm` button; clicking the button runs `activateSpellSourceListeners` at spell-casting.mjs:248-289 which deletes the scroll Item and flips `flags.tb2e.spellSource.resolved = true`. Asserts pre-Finalize state, post-Finalize scroll-still-present + spell.cast=true, and post-confirm scroll-deleted + card resolved)
- [x] `tests/e2e/spell/spellbook-source.spec.mjs` — cast from spellbook; verify chat card shows spellbook as source (Beast Cloak `a1b2c3d4e5f63003` + a `spellbook` Item per module/data/item/spellbook.mjs:9; spell's `system.spellbookId` set to the spellbook Item id per module/data/item/spell.mjs:63 → `canCast` flips via the `inSpellbook` branch at character-sheet.mjs:726-728 → `castSpell` button in templates/actors/tabs/character-magic.hbs:44-47 → `#onCastSpell` at character-sheet.mjs:1409,1418-1420 pushes a `"spellbook"` source and short-circuits the chooser (no `opts` needed — scroll is the only source that sets `scrollItemId` at character-sheet.mjs:1432); `castSpell` at spell-casting.mjs:45-56 stamps `testContext.castingSource: "spellbook"`, `scrollItemId: null`; Finalize → `processSpellCast` spellbook branch at spell-casting.mjs:168-173 flips `system.cast=true` and posts a `spell-source` chat card via `_postSpellSourceCard` — the spellbook branch at spell-casting.mjs:199-210 looks up the spellbook name via `actor.items.get(spell.system.spellbookId)` and renders templates/chat/spell-source.hbs:19 with flavor text from lang/en.json:866 `TB2E.Spell.SpellbookSourceText` embedding the spellbook name; card flags carry `flags.tb2e.spellSource = { type: "spellbook", spellbookName, ... }` per spell-casting.mjs:236; clicking `.spell-source-confirm` runs `activateSpellSourceListeners` at spell-casting.mjs:263-265 which clears `spell.system.spellbookId` (the spell Item remains; only the binding severs, matching "ink burns away from the page" per DH p.100). Asserts flag payload, DOM text contains the spellbook name, and post-confirm spellbookId is `""` while the spell + spellbook Items still exist)
- [x] `tests/e2e/spell/cast-skill-swap.spec.mjs` — skillSwap casting type; verify success chat posted with no roll (Wizard's Ægis `a1b2c3d4e5f6000e`, `castingType: skillSwap`; `canCast` flips true unconditionally via the skillSwap disjunct at character-sheet.mjs:727-728 — memorized/spellbookId/scrolls all empty and the Cast button still renders; `#onCastSpell` short-circuits at character-sheet.mjs:1402-1404 with `castSpell(actor, item, "memory")` — NO source chooser; `castSpell` returns at spell-casting.mjs:16-24 after a single `ChatMessage.create` with localized `TB2E.Spell.SkillSwapActive` content (lang/en.json:856) scoped via `speaker.actor`, NO `rollTest` call so NO roll dialog (`.roll-dialog` count 0), NO `flags.tb2e.roll`, NO `flags.tb2e.testContext`, NO `flags.tb2e.spellSource`, `isRoll=false`; `processSpellCast` never runs so `spell.system.memorized` and `spell.system.cast` stay exactly as seeded — no state mutation from the cast)

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

- [x] `tests/e2e/invocation/perform-basic.spec.mjs` — perform a Theurge invocation with no relic; verify burden applied (Bone Knitter, packs/_source/theurge-invocations/Bone_Knitter_b2c3d4e5f6a7b8c9.yml — fixedObstacle 3 → Ob 4 with no-relic bump per invocation-casting.mjs:52; burden 2 added to `actor.system.urdr.burden` via processInvocationPerformed invocation-casting.mjs:231-262, wired from Finalize in post-roll.mjs:582-584; handler `CharacterSheet.#onPerformInvocation` at character-sheet.mjs:1372-1377)
- [x] `tests/e2e/invocation/perform-with-relic.spec.mjs` — relic slotted + auto-detected; verify reduced burden (`burdenWithRelic`) applied (Bone Knitter invocation `b2c3d4e5f6a7b8c9` + Bone Knitting Needles relic `e02a2b3c4d5e6f7a` — lesser/minor auto-detect via `linkedInvocations.includes(name)` at invocation-casting.mjs:92-93; slotted (`slot: "head", dropped: false`) satisfies `findApplicableRelic` guard at invocation-casting.mjs:88-89; with hasRelic=true the `obstacle += 1` at invocation-casting.mjs:52 is skipped so Ob stays at fixedObstacle 3; `burdenWithRelic: 1` picked over `burden: 2` at invocation-casting.mjs:39 and applied via processInvocationPerformed invocation-casting.mjs:231-262)
- [x] `tests/e2e/invocation/perform-without-relic-penalty.spec.mjs` — versus invocation, no relic; verify -1s applied (Wrath of the Lords of Law `a00000000000001b` — `castingType: versus`, `versusDefense: nature`, `burden: 3`; `performInvocation` at invocation-casting.mjs:64-76 stamps `testContext.isVersus=true` and, when `!hasRelic`, pushes a post-timing `success` modifier with value -1 + label `TB2E.Invocation.NoRelicPenalty` "No Relic (-1s)" (lang/en.json:896); dialog pre-selects versus mode via tb2e-roll.mjs:929-937 and renders the `.roll-modifier` row via tb2e-roll.mjs:517-544; `_handleVersusRoll` at tb2e-roll.mjs:1566-1653 stores raw successes 4 on `flags.tb2e.roll.successes` and adjusted `finalSuccesses: 3` via tb2e-roll.mjs:1577-1583; resolution reads `iRoll.finalSuccesses ?? iRoll.successes` at versus.mjs:146-147 so caster wins 3 vs 0 margin 3. Caster dice stub `u=0.001` → all-6s = 4D = 4 raw → 3 after -1s; opponent stub `u=0.5` → all-3s = 0. Burden/performed side-effects are out of scope: post-roll.mjs:507-521 takes the versus branch and returns BEFORE processInvocationPerformed fires at post-roll.mjs:582-584; versus.mjs:258-266 only calls processSpellCast — so for versus invocations those side-effects are a separate production gap)
- [x] `tests/e2e/invocation/sacramental.spec.mjs` — sacramental flag behavior on appropriate invocation (Breath of the Burning Lord `c3d4e5f6a7b8c9d0` — `castingType: fixed`, `fixedObstacle: 2`, `sacramental: "A bit of blubber or fine incense"`, `burden: 2`. `performInvocation` at invocation-casting.mjs:30-37 pushes a pre-timing `dice` context modifier `{value: 1, source: "invocation"}` with label `TB2E.Invocation.SacramentalBonus` "Sacramental (+1D)" (lang/en.json:895) whenever `invocation.system.sacramental` is truthy (StringField — empty string falsy, any material name truthy). The modifier flows through `_showRollDialog` contextModifiers → `_collectAllModifiers` (tb2e-roll.mjs:549-551) so the `.roll-modifier` row pre-renders in the dialog; `updateSummary` (tb2e-roll.mjs:939-962) sums `pre/dice` into `diceBonus` so the summary shows `5D vs Ob 3`; `rollTest` (tb2e-roll.mjs:1316-1319) computes `poolSize = baseDice + diceBonus = 5` on the chat card and serializes the sacramental modifier entry onto `flags.tb2e.roll.modifiers` (tb2e-roll.mjs:1431). No-relic path bumps Ob 2 → 3 (invocation-casting.mjs:52); dice stub `u=0.001` → all-6s → 5 successes PASS. Finalize still applies the full no-relic `burden: 2` via processInvocationPerformed invocation-casting.mjs:231-262 (sacramental bonus is orthogonal to burden selection at invocation-casting.mjs:39). No supply-item decrement — sacramental is a pure dice-bonus feature in the current codebase)
- [x] `tests/e2e/invocation/shaman-invocation.spec.mjs` — shaman invocation end-to-end (Hound of the Hunt `c1c2c3c4c5c61003` from `tb2e.shamanic-invocations`, Lore Master's Manual p.42 — `castingType: fixed`, `fixedObstacle: 3`, `burden: 2`, `burdenWithRelic: 1`, `sacramental: ''`, chosen as the shaman analogue of Bone Knitter for number-for-number parity with line 261. Actor created with `system.class: "shaman"` as a self-documenting marker. Shaman/theurge code path parity: `performInvocation` (invocation-casting.mjs:9-77) contains NO class branching — no `actor.system.class` read, no shaman-specific dispatch — so the fixed-Ob switch at invocation-casting.mjs:50-55 (+1 Ob when `!hasRelic`) and the Finalize side-effects via `processInvocationPerformed` (invocation-casting.mjs:231-262) run identically for shaman-class actors. Burden lives on the shared `actor.system.urdr.burden` field (character.mjs:155-157), common to all character classes. No-relic path → Ob 4 Ritualist rating 4 → all-6s PRNG stub PASS (4 successes). Pre-Finalize `urdr.burden=0, performed=false`; post-Finalize `urdr.burden=2, performed=true`. `flags.tb2e.testContext.invocationId` matches the embedded item's id, confirming the shamanic pack entry flows through the shared handler unchanged)
- [x] `tests/e2e/invocation/relic-dropped-not-detected.spec.mjs` — dropped relic NOT auto-detected (direct inverse of line 262; Bone Knitter `b2c3d4e5f6a7b8c9` + Bone Knitting Needles relic `e02a2b3c4d5e6f7a`). Relic embedded with `system.slot: "head", slotIndex: 0, dropped: true` — mirrors the player-dropped steady state. `findApplicableRelic` guard at invocation-casting.mjs:88-89 (`!relic.system.slot || relic.system.dropped`) flags the dropped half of the OR → returns undefined → `_askRelicStatus` shows the fallback `RelicPrompt` dialog (invocation-casting.mjs:111-116), not the auto-detect `HasRelic` prompt (invocation-casting.mjs:108-109). Clicking "Without Relic" resolves `hasRelic=false` → `obstacle += 1` bump runs (invocation-casting.mjs:52) → Ob 3 → 4; `burdenAmount = invocation.system.burden` at invocation-casting.mjs:39 picks full `burden: 2` not `burdenWithRelic: 1`. PRNG `u=0.001` all-6s: Ritualist 4 vs Ob 4 PASS (4 successes). Preflight inlines the production guard to prove `autoDetectMatch` is `null` despite `linkedInvocations: ["Bone Knitter"]`, `slot: "head"`. Flag assertions: `hasRelic: false`, `burdenAmount: 2`. Post-Finalize: `urdr.burden` 0 → 2, `performed: true`

---

## 8. Compendiums

### Agent briefing

**Files:**
- Foundry core compendium behavior
- `module/config.mjs` — pack registrations
- POMs: `pages/CompendiumSidebar.mjs`, `pages/CompendiumWindow.mjs`

**Checkboxes:**

- [x] `tests/e2e/compendium/open-each-pack.spec.mjs` — open every pack under system.json, assert window renders with expected entry count range (programmatic sweep over `game.system.packs` + per-pack floor table in `EXPECTED_MIN_ENTRIES`; UI sanity test opens `tb2e.monsters` via sidebar and asserts rendered rows)
- [x] `tests/e2e/compendium/drag-weapon-to-inventory.spec.mjs` — drag the `Sword` entry (id `026b10bdba9bf1a4`) from `tb2e.weapons` onto the character sheet's inventory tab; programmatic drop via `CharacterSheet#_onDropItem` (module/applications/actor/character-sheet.mjs:2008) with a synthetic `DragEvent` whose target is the inventory section (no `[data-slot-key]` ancestor → unassigned). Asserts the embedded `weapon` Item is created with matching `cost`, `wield`, and `slotOptions` copied from the pack source, lands with `system.slot === ""` / `system.slotIndex === 0` / `system.dropped === false`, and shows up in the unassigned section row. Native Playwright drag-and-drop was tried first but is flaky against AppV2 sheet windows (works for the Actors sidebar in tests/e2e/compendium-drag.spec.mjs, but not reliably for the sheet's drop zone).
- [x] `tests/e2e/compendium/drag-spell-to-magic-tab.spec.mjs` — drag the `Arcane Semblance` entry (id `a1b2c3d4e5f60003`) from `tb2e.spells` onto the character sheet's magic tab; programmatic drop via `CharacterSheet#_onDropItem` (module/applications/actor/character-sheet.mjs:2008) with a synthetic `DragEvent` whose target is `section[data-tab="magic"].active`. The magic tab has no `[data-slot-key]` ancestors, so the override's slot-assignment branch is a no-op for spell drops (`super._onDropItem` creates the embedded Item). The Magic tab is always rendered regardless of class (`#prepareMagicContext` has no class gating) — no need to stage `system.class = "magician"`. Asserts the embedded `spell` Item is created with matching `circle`, `castingType`, `fixedObstacle`, `materials`, `scribeObstacle`, `learnObstacle`, and `factors.length` copied from the pack source; per-character tracking state starts clean (`library/memorized/cast === false`, `spellbookId === ""`); and the Arcane Spells table row for the new id renders on the magic tab. Mirrors drag-weapon-to-inventory.spec.mjs structure (programmatic drop, `pack.render(true)` to bypass sidebar folder nav, entry id not name substring).
- [x] `tests/e2e/compendium/drag-monster-to-scene.spec.mjs` — drag the `Kobold` entry (id `a1b2c3d4e5f60001`) from `tb2e.monsters` onto a freshly created + activated scene (the seed world ships scene-less). Programmatic drop via Foundry core's `TokenLayer#_onDropActorData` (foundry/client/canvas/layers/tokens.mjs:681) with a synthetic `DragEvent` + `{type:"Actor", uuid, x, y}` payload — the same shape the sidebar drag source builds. The handler imports the pack actor to the world (`Actor.implementation.create(actorData, {fromCompendium: true})`, tokens.mjs:697-698), builds the prototype token via `actor.getTokenDocument({}, {parent: canvas.scene})` (tokens.mjs:702 + actor.mjs:301), and persists it with `TokenDocument.create` (tokens.mjs:714). Asserts a new unlinked TokenDocument lands on the scene (`scene.tokens.size` goes 0 → 1), `token.actorLink === false`, `token.name === "Kobold (1)"` (Kobold's prototype has `appendNumber: true`, Kobold_a1b2c3d4e5f60001.yml:75 — handler at actor.mjs:317-321 picks the lowest free N), the synthetic actor exposed via `token.actor` is a `monster` named "Kobold" (per CLAUDE.md §Unlinked Actors — read per-token state via `token.actor`, not `game.actors.get`), and no uncaught page errors fire. Cleanup deletes the scene (cascades tokens) and any world actors tagged via `flags.tb2e.e2eTag`. Canvas drag via Playwright is not feasible (drop target is WebGL, not a DOM element); the handler only reads `.altKey` / `.shiftKey` from the event (tokens.mjs:703, 709), so a synthetic `DragEvent` exercises the identical path.
- [x] `tests/e2e/compendium/drag-relic-to-slot.spec.mjs` — drag the `Pearl` entry (id `b000000000000007`) from `tb2e.theurge-relics` directly into a specific body slot on the character sheet; programmatic drop via `CharacterSheet#_onDropItem` (module/applications/actor/character-sheet.mjs:2008) with a synthetic `DragEvent` whose target is the `.inventory-slot[data-slot-key="pocket"][data-slot-index="0"]` cell so the override's slot-placement branch (character-sheet.mjs:2010 `event.target.closest("[data-slot-key]")` + `#assignSlot` at character-sheet.mjs:1910) writes `system.slot="pocket"` / `system.slotIndex=0` / `system.dropped=false` (character-sheet.mjs:1968). Pearl is a `minor` Lords-of-Life-and-Death relic with `slotOptions: { pocket: 1 }` — picked because `pocket` is a fixed capacity-1 body slot (character-sheet.mjs:1990), making the placement assertion unambiguous. Asserts the embedded `relic` Item is created with `relicTier`/`immortal`/`linkedInvocations`/`slotOptions` copied verbatim from the pack source, lands slotted (not dropped — required for invocation-relic auto-detection per CLAUDE.md §Conflict), and the target slot cell renders occupied (`data-item-id=<new>`, not `.empty`, contains the item name). Unassigned and dropped sections stay absent. Mirrors drag-weapon-to-inventory.spec.mjs structure (programmatic drop, `pack.render(true)` to bypass sidebar folder nav, entry id not name substring).
- [x] `tests/e2e/compendium/search-filter.spec.mjs` — type a name substring into the compendium window's header search input and assert the visible entry rows are reduced to a known matching subset, then cleared back to baseline. Opens `tb2e.monsters` via `pack.render(true)` (same idiom as sibling drag specs), reads the baseline visible row count (40 entries), types `"troll"` (matches `Troll_{Bat,Haunt,Rat}_*.yml` — 3 stable rows), polls via `expect.poll` for the filter to settle below baseline (SearchFilter debounces 200ms — `foundry/client/applications/ux/search-filter.mjs:60`), then asserts filtered count is `>= 3` and `< baseline` and that every visible row's `.entry-name` contains the query (case-insensitive). The filter toggles `element.style.display = "none"` on non-matching rows (`foundry/client/applications/sidebar/document-directory.mjs:678` — `_onMatchSearchEntry`); we target `li.directory-item[data-entry-id]:not([style*="display: none"])` for a deterministic visible-row count (not `:visible`, which depends on viewport). Clearing the input restores the baseline count, exercising the other half of the filter contract. The CompendiumWindow POM gained `searchInput`, `entryRows`, `visibleEntryRows`, `search(query)`, `clearSearch()` — all keyed off the header template's `<search> <input type="search">` (`foundry/templates/sidebar/directory/header.hbs:23`). Sidebar-based open is not duplicated here (covered by open-each-pack.spec.mjs).

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

- [x] `tests/e2e/loot/draw-terminal-table.spec.mjs` — roll a non-recursive loot table (e.g. "Coins"); verify single chat card with terminal result (Coins Subtable 1 `lt00000000000010`; `table.draw()` via `TB2ELootTable` override in `module/documents/loot-table.mjs:83`; scopes by `.loot-card` from `templates/chat/loot-draw.hbs:2` + `flags.tb2e.lootDraw`)
- [x] `tests/e2e/loot/draw-recursive-chain.spec.mjs` — roll a top-level table that chains to a subtable (e.g. "Treasure Type" → "Enchanted Weapon"); verify chain trace shown in single card (Loot Table 1 `lt00000000000001` → Books & Maps Subtable `lt00000000000006`; `CONFIG.Dice.randomUniform = () => 0.999` locks every die to face 1 so 2d6→2→"Books & Maps" and 3d6→3→"Accurate Map (Dungeon Level)"; asserts one chat message, chain length 2, connector count 1, `loot-chain-link--last` only on last link, `flags.core.RollTable` is TOP id per `module/documents/loot-table.mjs:172`; reuses `LootDrawCard` POM unchanged)
- [x] `tests/e2e/loot/draw-max-depth.spec.mjs` — verify recursion stops at depth 5 (guard at `module/documents/loot-table.mjs:27-29` — `if (_depth > 5) throw new Error(...)`, so depths 0..5 permitted and depth 6 throws; pack has no chain 7+ deep so test uses Approach B — constructs 7 synthetic world RollTables `T0..T6` each with one result pointing at the next via world UUID `RollTable.<id>`, `T6` terminal text; fakes loot-table origin via `_stats.compendiumSource = "Compendium.tb2e.loot-tables.RollTable.<id>"` so `isLootTable` at `module/documents/loot-table.mjs:76-81` routes through `_toLootMessage`; asserts `table.draw()` rejects with `/Maximum recursion depth exceeded/`, no loot card posted (the throw propagates out of `draw()` before `_toLootMessage` at line 100 runs), no `pageerror` events; cleans up all 7 tables + sweeps `flags.tb2e.e2eMaxDepth`-tagged stragglers in afterEach)
- [x] `tests/e2e/loot/draw-page-refs.spec.mjs` — verify page references appear in chat card (reuses the recursive-chain draw: top `Loot Table 1` → sub `Books & Maps Subtable` → terminal `Accurate Map (Dungeon Level)` with the `() => 0.999` PRNG stub; asserts top table's YAML `description` — "Scholar's Guide, p. 152" — renders as `.card-subtitle` via `table.pageRef` at `module/documents/loot-table.mjs:156` and template `templates/chat/loot-draw.hbs:7-9`, and the terminal Item's `system.description` — "Scholar's Guide, p. 153" — renders as a single `.loot-drop-page` via `pageRef: linkedDoc?.system?.description` at `module/documents/loot-table.mjs:138` and template `templates/chat/loot-draw.hbs:65-67`; per-chain-link pageRefs are not asserted since the chain template at `templates/chat/loot-draw.hbs:19-28` doesn't render them; extends `LootDrawCard` POM with `dropPageRefs`/`dropPageRefTexts()`)

---

## 10. Grind Tracker

### Agent briefing

**Files:**
- `module/applications/grind-tracker.mjs` — singleton HUD
- Rules: DH p.53 (conditions), p.75 (phases), grind turn counter
- Mailbox: `flags.tb2e.pendingGrindApply` (player → GM condition application)
- Consolidated condition chat card (recent commit)

**Checkboxes:**

- [x] `tests/e2e/grind/advance-turn.spec.mjs` — GM advances turn counter; verify display updates for all clients (state: `game.settings` `tb2e.grindTurn` world-scoped, registered in `tb2e.mjs` L17-19; advance handler at `module/applications/grind-tracker.mjs` L305-360; HUD singleton opened via `GrindTracker.getInstance()` at `module/applications/grind-tracker.mjs` L51-53; Advance button `button.advance-btn[data-action="advanceTurn"]` in `templates/grind-tracker.hbs` L38-41)
- [x] `tests/e2e/grind/set-phase.spec.mjs` — cycle phases; verify dropdown/state (phase enum hard-coded in `module/applications/grind-tracker.mjs` L407 as `["adventure", "camp", "town"]`; `setPhase` handler L406-418 cycles + resets turn on wrap-to-adventure L412-414; UI is a single cycle button `button.phase-btn[data-action="setPhase"]` in `templates/grind-tracker.hbs` L10-13 with label `.phase-btn-label` containing `{{phaseLabel}}` mapped in `_prepareContext` L124; non-adventure phases render `.phase-name-large` instead of the turn/advance block per template L22/L42-44)
- [x] `tests/e2e/grind/apply-condition-mailbox.spec.mjs` — simulates the player-side dual-write at `module/applications/grind-tracker.mjs` L537-543 (`actor.update({ 'system.conditions.<cond>': true, 'flags.tb2e.pendingGrindApply': <messageId> })`) after authoring a consolidated grind ChatMessage with the shape `#postConsolidatedGrindCard` posts (L390-399: `flags.tb2e = { grindCondition: true, turn, entries: [{actorId, condKey, applied: false}] }`). Payload shape for the mailbox is the bare `messageId` string (L541 + L595 `game.messages.get(messageId)`). GM hook dispatches in `tb2e.mjs` L245-246; processor `processGrindApplyMailbox` at `module/applications/grind-tracker.mjs` L595-599 calls `_applyGrindEntry` (L579-587) to flip `entries[i].applied` true then `actor.unsetFlag('tb2e', 'pendingGrindApply')`. Asserts all three observable effects — condition=true, mailbox=null, entry applied=true. Complements sheet/toggle-conditions.spec.mjs L178-217 (bogus-message clear path) by exercising the happy-path apply+clear with a real message
- [x] `tests/e2e/grind/consolidated-card.spec.mjs` — seeds two scene-resident characters with `fresh` baselines, sets `tb2e.grindTurn` to 3, then clicks the HUD Advance button so `#onAdvanceTurn` (module/applications/grind-tracker.mjs L305-360) crosses `cyclePos === maxTurns === 4` (L344) and invokes the grind branch (L345-355). Snapshots `game.messages.contents` before/after to prove EXACTLY ONE `flags.tb2e.grindCondition === true` ChatMessage is posted (regression guard: per-actor posting would show up as 2). Asserts the consolidated shape matches `#postConsolidatedGrindCard` (L390-399): `flags.tb2e = { grindCondition: true, turn: 4, entries: [{ actorId, condKey, applied: false } × 2] }`. Both entries carry `condKey: 'hungry'` — first-missing in GRIND_ORDER (L3) for a fresh character. Also asserts the rendered DOM shape from `templates/chat/grind-consolidated.hbs`: one `.grind-entry[data-actor-id]` per entry (L13), exactly one `[data-action="applyAllGrindConditions"]` affordance (L30-36), and one `[data-action="applyGrindCondition"]` per unapplied entry. Button-click wiring (Apply → condition applied) is deliberately out of scope — covered by apply-condition-mailbox.spec.mjs L326. Scene + two actors + message cleaned up in afterEach alongside grind settings reset
- [x] `tests/e2e/grind/light-extinguish.spec.mjs` — two linked legs of the torch-extinguish flow. (a) End-to-end: seeds a holder character with a lit `supply` + `supplyType: "light"` + `turnsRemaining: 1` in hand-R, plus a scene-resident covered character wired via `flags.tb2e.grindCoveredBy = holderId` with `system.lightLevel = "full"`. Advance via the HUD button crosses turnsRemaining→0, which hits the decrement branch at `module/applications/grind-tracker.mjs` L320-323 (flips `lit: false`, sets `turnsRemaining: 0`) AND L337 (`#postTorchExpiredCard` → `ChatMessage.create` with the `templates/chat/torch-expired.hbs` body — asserts exactly ONE message carrying `.grind-torch-card` class posted). The `updateItem` hook (`tb2e.mjs` L251-271) then runs the GM branch L260-267 and writes `system.lightLevel: "dark"` on the covered actor. (b) Mailbox: bypasses the end-to-end flow and directly simulates the non-GM write at `tb2e.mjs` L269 (`holder.setFlag("tb2e", "pendingLightExtinguish", true)`) — same harness-constraint idiom as `apply-condition-mailbox.spec.mjs` L172-185, because all Playwright sessions authenticate as GM. The `updateActor` hook at L232-243 darkens covered scene actors (L240) and unsets the mailbox (L241). Asserts the three observable effects: flag cleared, covered `lightLevel === "dark"`, baseline sanity `{coveredLight: 'full', mailbox: null}` pre-write. Scene+tokens use `Hooks.once('canvasReady', ...)` gate (same pattern as `compendium/drag-monster-to-scene.spec.mjs` L101-103) so the TokenDocument render pipeline is fully drawn before the actor-update cascade touches `RenderFlags.set`. Cleanup sweeps both mailbox + `grindCoveredBy` flags, all created actors + scene + messages, and resets `grindTurn/Phase/Extreme` in afterEach

---

## 11. Nature Crisis

### Agent briefing

**Files:**
- `module/dice/post-roll.mjs` — nature tax trigger
- `templates/chat/nature-crisis.hbs`
- Rule: DH p.119

**Checkboxes:**

- [x] `tests/e2e/nature/crisis-triggered.spec.mjs` — deep shape of the pending nature-crisis chat card emitted when a post-roll tax drops rating to 0 (`_postNatureCrisis` post-roll.mjs:600-632 / nature-crisis.hbs): flags (`natureCrisis:true`, `actorId`, no `crisisResolved`), DOM (amber card accent, header name + `{name}'s Nature Crumbles` label, crisis text containing DH p.119 rule intent), select listing non-class traits only (class traits filtered by post-roll.mjs:609), placeholder `<option>—</option>`, new-name input, `.nature-crisis-confirm` button; asserts rating=0, max unchanged (resolve path NOT exercised — next checkbox)
- [x] `tests/e2e/nature/recovery.spec.mjs` — resolve path for the nature-crisis chat card. Stages line 343's crisis trigger (Will 2, Nature 1/4, Persona 1, one non-class trait "Curious" L2 beneficial=1; PRNG all-6s → 3D Ob 2 → PASS → tax 1 → rating 0 → `_postNatureCrisis` posts card). Then fills `.crisis-trait-select` + `.crisis-new-name` and clicks `.nature-crisis-confirm`, driving the resolve handler `activateNatureCrisisListeners` (post-roll.mjs L639-708). Asserts the four observable effects of L665-706: (1) `flags.tb2e.crisisResolved` flipped true (L680); (2) nature mutated to `{rating:3, max:3, pass:0, fail:0}` — max decremented (L671), rating reset to newMax (L674), pass/fail zeroed (L675-676), per DH p.119 "Maximum Nature is reduced by 1 and all advancement progress is lost"; (3) trait RENAMED in place (`traitItem.update({ name: newName })` L668) — same itemId, level/beneficial/isClass preserved, trait count unchanged (NOT delete+create); (4) card DOM transitioned to resolved branch (templates/chat/nature-crisis.hbs L10-24) — `.crisis-form` + `.nature-crisis-confirm` gone, `.crisis-resolved` + `.card-banner.banner-amber` "Resolved" present (non-retired since newMax=3), resolved text cites new trait name + "Nature max is now 3" (template L12). Retirement path (newMax=0) explicitly NOT covered; isClass filter covered by L343

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

- [x] `tests/e2e/conflict/setup-create-conflict.spec.mjs` — create a new conflict, assert panel opens on setup tab, tracker appears in sidebar (cites `conflict-tracker.mjs:267-269`, `combat.mjs:20-48`, `conflict-panel.mjs:17,40-41,510-526`, `tb2e.mjs:67`)
- [x] `tests/e2e/conflict/setup-add-combatants.spec.mjs` — add two characters + two monsters via the panel, assert combatant list (cites `conflict-panel.mjs:2127-2158` select-path, `conflict-panel.mjs:2165-2198` drop-path, `conflict-panel.mjs:655-660` availableActors filter, `combat.mjs:20-35` default-groups seed, `panel-setup.hbs:83-136` combatant-list DOM, top-level `combatant._source.group` grouping field)
- [x] `tests/e2e/conflict/setup-assign-captain.spec.mjs` — assign captain per side via the crown button; verify `combat.system.groupDispositions[groupId].captainId` persists, DOM `.is-captain` reflects the choice, "Next" (`canBeginDisposition`) gates on both captains assigned, and reassignment is last-write-wins (cites `panel-setup.hbs:82-113,141` UI, `conflict-panel.mjs:1479-1486` #onSetCaptain + `638-639,646,709-710` context, `combat.mjs:101-106` setCaptain storage)
- [x] `tests/e2e/conflict/setup-assign-boss.spec.mjs` — assign monster boss via the shield button; verify `combatant.system.isBoss` persists, DOM `.setup-boss-btn.active` reflects the state, the button is monster-only (hidden on party rows via `{{#if this.isMonster}}`), and the handler is a per-combatant toggle so multiple monsters can be boss simultaneously and a second click clears (cites `panel-setup.hbs:97-103` UI + `648` isMonster derivation, `conflict-panel.mjs:1494-1501` #onSetBoss + `647` context, `module/data/combat/combatant.mjs:8` schema field)
- [x] `tests/e2e/conflict/setup-select-type.spec.mjs` — cycle all 14 conflict types via the UI select; verify each persists on `combat.system.conflictType`, `combat.getEffectiveConflictConfig()` returns the config.mjs mapping (`dispositionAbility`, `dispositionSkills`, all four `actions`), and the `.setup-manual-config` block is gated on `conflictType === "manual"` (cites `panel-setup.hbs:5-14,38-80` UI, `conflict-panel.mjs:201-207` change handler + `585-589` type-options + `663-707` manual-config context, `combat.mjs:42-48` seed + `70-89` getEffectiveConflictConfig, `config.mjs:188-386` conflictTypes)

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

- [x] `tests/e2e/conflict/disposition-roll-captain.spec.mjs` — GM captain rolls disposition, verify `conflict.hp` set on each combatant (kill conflict, fighter+health; stubs PRNG → 3 successes + 4 health = 7; clicks Finalize → `storeDispositionRoll`; Distribute writes `conflict.hp.{value,max}` on party members; monster side stays at 0 as negative control; cites `conflict-panel.mjs#L1543-1574`, `L1582-1653`, `L1661-1683`, `L791-820`; `combat.mjs#L144-174`, `L201-242`; `post-roll.mjs#L483-504`; `tb2e-roll.mjs#L1659-1739`; `config.mjs#L200-211`)
- [x] `tests/e2e/conflict/disposition-flat-monster.spec.mjs` — monster side uses flat disposition; verify HP set without roll (Bugbear captain + Goblin — both have `Kill` stat-block hp=7; panel computes `isListedConflict=true` and `suggestedDisposition = 7 + 1 = 8` per `conflict-panel.mjs#L736-761`; roll button suppressed by `canRoll` gating at `L838-840`; clicking `setFlatDisposition` button dispatches to `#onSetFlatDisposition` (`L1509-1521`) which calls `combat.storeDispositionRoll` (`combat.mjs#L201-210`) directly — no `rollTest`, no roll dialog, no chat card posted; Distribute writes `conflict.hp.{value,max}=4` on each monster's synthetic token actor via `combat.mjs#L219-242`; party side stays at 0 HP as the negative control; Bugbear stat block at `packs/_source/monsters/Bugbear_a1b2c3d4e5f60005.yml#L23-29`, Goblin at `packs/_source/monsters/Goblin_a1b2c3d4e5f6000c.yml#L23-29`; monster data model at `module/data/actor/monster.mjs#L30-33`)
- [ ] ~~skipped~~ `tests/e2e/conflict/disposition-distribution-player.spec.mjs` — **PRODUCTION BUG**: `module/documents/combat.mjs#L489` clears `system.pendingDistribution` with `combatant.update({ "system.pendingDistribution": {} })`, but Foundry deep-merges the empty object over the `ObjectField` (`module/data/combat/combatant.mjs#L20`), leaving the `{ groupId, distribution }` payload intact. Spec is written and ready behind `test.fixme()`; the write + GM-hook + processing chain otherwise works (HP set on each member via `combat.mjs#L219-242`; `groupDispositions[partyGroup].distributed` flips at `combat.mjs#L236-241`). Same `{}`-over-ObjectField anti-pattern affects the `pendingDisposition` (L475) and `pendingActions` (L516) clears, so a fix should sweep all three. Switch the production handler to the `system.-=pendingDistribution` deletion idiom (or call `combatant.updateSource` to reset the schema field), then remove the fixme. Hook dispatcher: `combat.mjs#L431-462` (picks off `changes.system.pendingDistribution.groupId` at L445-447). Processor: `#processDistribution` at `combat.mjs#L485-490`. Player-side write site: `combat.mjs#L220-225` (payload `{ groupId, distribution }` keyed by combatantId).
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

- [x] `tests/e2e/sheet/monster-open.spec.mjs` — imports Kobold from `tb2e.monsters`, renders sheet, asserts Nature (`templates/actors/monster-body.hbs` line 9), 3 conflict dispositions (`module/data/actor/monster.mjs` lines 30-33), and weapons loadout (monsters have no trait items — `weapons` is the sheet's loadout concept)
- [x] `tests/e2e/sheet/monster-nature-roll.spec.mjs` — click Nature surface on monster-body (`templates/actors/monster-body.hbs` line 7 `data-action="rollNature"` → `MonsterSheet.#onRollNature` at `module/applications/actor/monster-sheet.mjs` line 177); imports Kobold (Nature 2) from `tb2e.monsters`, stubs all-6s, asserts dialog pool = 2, submits default Ob 1, asserts chat card shape (poolSize/baseDice/successes = 2, pass = true) + speaker + `flags.tb2e.roll` metadata + `directNatureTest`/`withinNature` flags (roll-result.hbs "within — no tax" notice), finalizes (no-op for monsters per `_logAdvancement` early-return at `module/dice/tb2e-roll.mjs` line 193), confirms `system.nature` unchanged
- [x] `tests/e2e/sheet/npc-open.spec.mjs` — imports Alchemist from `tb2e.npcs`, opens the sheet, asserts identity (stock/class/goal inputs — `templates/actors/npc-body.hbs` lines 4-17), raw abilities (`system.abilities.nature|will|health.rating` per `module/data/actor/npc.mjs` lines 13-32), might, skill/wise row counts + values, and trait-item row count. Historical ENOENT at `module/applications/actor/npc-sheet.mjs:43` (flagged TEST_PLAN line 66) is no longer present — line 43 now correctly references `templates/actors/npc-body.hbs`. `page.on('pageerror')` guards against regression.
- [x] `tests/e2e/sheet/npc-edit-basics.spec.mjs` — imports Alchemist from `tb2e.npcs`, opens the sheet, and edits the header name input (`templates/actors/npc-header.hbs` line 18), the description textarea (`templates/actors/npc-body.hbs` line 216 → `system.description` "GM notes" per `module/data/actor/npc.mjs` line 75), and the identity strip (stock/class/goal — `npc-body.hbs` lines 4-17 → `npc.mjs` lines 8-10). Persistence model: `NPCSheet.DEFAULT_OPTIONS.form.submitOnChange = true` (`module/applications/actor/npc-sheet.mjs` line 27) — each `.fill()` + blur auto-submits the AppV2 form. Round-trips verified against the world actor AND against the DOM after a close + re-render.

---

## 22. Items (Non-Magic)

### Agent briefing

**Files:**
- `module/data/item/weapon.mjs`, `armor.mjs`, `gear.mjs`, `supply.mjs`, `container.mjs`
- `module/applications/item/gear-sheet.mjs`
- Inventory slots: head, neck, hand-L, hand-R, torso, belt, feet, pocket + custom container slots

**Checkboxes:**

- [x] `tests/e2e/item/weapon-sheet.spec.mjs` — creates a character with an unassigned weapon (`module/data/item/weapon.mjs`), opens the inventory tab (`CharacterSheet.openInventoryTab`), fires the per-row `editItem` action (`templates/actors/tabs/character-inventory.hbs` line 319 → `module/applications/actor/character-sheet.mjs` `#onEditItem` line 1725), and edits weapon-specific fields via the shared `GearSheet` (`module/applications/item/gear-sheet.mjs`, `templates/items/gear-sheet.hbs`). TB2E weapons have no `damage`/`weight` fields (see `weapon.mjs` — only `wield`, `conflictBonuses`, `skillBonuses`, `specialRules` + inventory fields); the spec adapts the checkbox by editing the closest analogs: `system.cost` (slot cost / burden, `_fields.mjs` line 27 — "weight" analog), `system.wield` (1H↔2H, `weapon.mjs` line 15), `system.conflictBonuses.attack.value` ("damage" analog; `weapon.mjs` lines 16-21), and `system.specialRules`. Persistence via `submitOnChange: true` (`gear-sheet.mjs` line 17) — fill + blur round-trips through the data model, and values are re-verified in the DOM after a close + re-render of the item sheet. New POMs at `tests/e2e/pages/ItemSheet.mjs` — `ItemSheet` (shared item-sheet surface: name/cost/damaged/value/quantity/description) sized for reuse by `armor-sheet.spec.mjs` / `container-custom-slots.spec.mjs` / `supply-quality-portions.spec.mjs`, plus a `WeaponItemSheet` subclass for the weapon-only fieldset.
- [x] `tests/e2e/item/armor-sheet.spec.mjs` — creates a character with an unassigned armor item (`module/data/item/armor.mjs`), opens the inventory tab (`CharacterSheet.openInventoryTab`), fires the per-row `editItem` action (`templates/actors/tabs/character-inventory.hbs` line 319 → `character-sheet.mjs` `#onEditItem` line 1725), and edits the armor-only fieldset in the shared `GearSheet` (`templates/items/gear-sheet.hbs` lines 110-132). TB2E armor has no `protection`/`burden` fields — the spec adapts the checkbox by editing the closest analogs: `system.armorType` (leather|chain|plate|helmet|shield; `armor.mjs` lines 10-13, `CONFIG.TB2E.armorTypes` in `module/config.mjs` lines 100-106), `system.absorbs` ("protection" analog per DH p.112 — armor rating of 1s-3s absorbed from attack successes; `armor.mjs` line 14), `system.cost` ("burden" analog from the shared `inventoryFields`, `_fields.mjs` line 27 — Buyer's Guide slot cost DH pp.72-74; slot-assignment mechanics covered by `inventory-slots.spec.mjs`), and `system.specialRules` (`armor.mjs` line 15). Persistence via `submitOnChange: true` (`gear-sheet.mjs` line 17) — fill/selectOption + blur round-trips through the data model, and values are re-verified in the DOM after a close + re-render. Extends `tests/e2e/pages/ItemSheet.mjs` with an `ArmorItemSheet` subclass (armorType/absorbs/specialRules locators) — sibling to the existing `WeaponItemSheet`.
- [x] `tests/e2e/item/container-custom-slots.spec.mjs` — creates a character with an embedded `backpack` container placed in `system.slot: "torso"` (`module/data/item/container.mjs`), then verifies two tiers of the custom-slot contract. (1) Seed-time: the inventory tab renders a dynamic slot group keyed by `system.containerKey` (`templates/actors/tabs/character-inventory.hbs` line 165 → `[data-slot-group]`) with `.container-group` class and exactly `system.containerSlots` empty `.inventory-slot[data-slot-index]` cells — the group + cell-count is assembled by `module/applications/actor/character-sheet.mjs` lines 429-448 from the equipped container whose `system.slot ∈ #FIXED_SLOTS` (line 15), `!dropped`, `!lost`, `quantityMax === 1` (line 432), and non-liquid (line 437). The group header exposes the `dropItem`/`removeFromSlot` buttons keyed by `containerId` (inventory.hbs lines 172-175). (2) Edit-time: the spec opens the container's `GearSheet` (new `ContainerItemSheet` POM in `tests/e2e/pages/ItemSheet.mjs` — targets the `#if isContainer` fieldset at `templates/items/gear-sheet.hbs` lines 135-168: `system.containerType` / `system.containerSlots` / `system.containerKey`), edits `containerSlots` from 5 → 3, blurs (auto-submits via `submitOnChange: true`, `module/applications/item/gear-sheet.mjs` line 17), re-renders the character sheet, and asserts the slot-group cell count updates to match. Final data-model assertion locks in `containerKey` / `containerSlots` / `containerType` / `slot`. Out of scope (per DH pp.71-74 and the briefing): bundle mechanics (`quantityMax > 1` — covered by `inventory-bundle-split.spec.mjs`), liquid containers (don't produce slot groups — `character-sheet.mjs` line 437), and slot-assignment mechanics (covered by `inventory-slots.spec.mjs`).
- [x] `tests/e2e/item/supply-quality-portions.spec.mjs` — covers the **item-sheet edit surface** for supplies (complement to `tests/e2e/sheet/inventory-supplies.spec.mjs` at §2 line 122, which owns the sheet-side `consumePortion` decrement loop and hungry-clear side-effect). Creates a character with an unassigned supply (`module/data/item/supply.mjs`), opens the inventory tab, fires the per-row `editItem` action (`templates/actors/tabs/character-inventory.hbs` line 319 → `module/applications/actor/character-sheet.mjs` `#onEditItem` line 1725), and edits the supply-only fieldset in the shared `GearSheet` (`templates/items/gear-sheet.hbs` lines 197-244). TB2E supplies have no "quality" field — the checkbox wording is adapted to the actual schema: "quality" → `system.supplyType` (food|light|spellMaterial|sacramental|ammunition|other; `supply.mjs` lines 10-13, `CONFIG.TB2E.supplyTypes` in `module/config.mjs` lines 147-154), "portions" → `system.quantity` / `system.quantityMax` (shared `inventoryFields`, `module/data/item/_fields.mjs` lines 30-31; per RAW DH pp.71-72 a supply's portion count is its `quantity`). The spec also round-trips `system.nameSingular` (supply.mjs line 16) and sanity-checks the light-supply inputs (`system.turnsRemaining`, `system.lit` — supply.mjs lines 14-15) render with their seeded values. Persistence via `submitOnChange: true` (`gear-sheet.mjs` line 17) — fill/selectOption + blur round-trips through the data model, and values are re-verified in the DOM after a close + re-render. A second test then seeds a 3/3 food supply directly in the belt slot and fires `consumePortion` once as a smoke check that the edited portion counter is the same field the runtime handler drives (full decrement-to-zero and hungry-clear coverage remains in `inventory-supplies.spec.mjs`). Extends `tests/e2e/pages/ItemSheet.mjs` with a `SupplyItemSheet` subclass (supplyType / turnsRemaining / nameSingular / lit locators) — sibling to `WeaponItemSheet` / `ArmorItemSheet` / `ContainerItemSheet`.

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
