import { test, expect } from '../test.mjs';
import { scriptAndLockActions } from '../helpers/conflict-scripting.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §18 Conflict: HP & KO — KO'd teammate is filtered out of the helper pool
 * surfaced inside the **conflict roll dialog** (TEST_PLAN L504).
 *
 * ---------------------------------------------------------------------------
 * Surface distinction vs §3 L160 (tests/e2e/roll/help-blocked-when-ko.spec.mjs)
 * ---------------------------------------------------------------------------
 * Both surfaces exercise the SAME predicate — `isBlockedFromHelping` at
 * module/dice/help.mjs L53-59 — where the KO disjunct is line 57:
 *     `conflictHP?.max > 0 && conflictHP.value <= 0`.
 *
 * What differs is how the helper pool is BUILT before that predicate runs
 * (`getEligibleHelpers` in help.mjs L76-150):
 *
 *   - §3 surface (standalone skill/ability test): no `candidates` override.
 *     `getEligibleHelpers` walks `canvas.scene.tokens` (L91-101) and filters
 *     by conflict team (L100). Reaches L129 `isBlockedFromHelping`.
 *
 *   - §18 surface (THIS spec, conflict action roll): `conflict-panel.mjs`
 *     L1970-1980 provides `testContext.candidates = memberCombatants` to
 *     `rollTest` — the list of same-group Combatants (filtered by
 *     `c._source.group === groupId` and `c.id !== combatantId`). That
 *     shortcuts the scene-token walk (help.mjs L84-85 `if ( candidates )
 *     pool = candidates`). The Combatant objects are then normalized to
 *     actors via `raw.actor ?? raw` at help.mjs L121 before reaching the
 *     same `isBlockedFromHelping` call at L129.
 *
 * Why both specs exist:
 *   - §3 L160 proves the scene-token pool honors the KO gate.
 *   - §18 L504 proves the conflict-group-Combatant pool honors the same gate
 *     despite the different entry path (`candidates` override at help.mjs
 *     L84-85, which bypasses the scene-token filter entirely). If a future
 *     refactor moves the KO check to the scene-token loop or to
 *     `_findBestHelpPath`, §3 would still pass but THIS spec would fail —
 *     catching the regression on the conflict surface specifically.
 *
 * ---------------------------------------------------------------------------
 * KO mechanism — routes through the `pendingConflictHP` mailbox
 * ---------------------------------------------------------------------------
 * Matches the L501/L503 idiom: the KO'd teammate's HP is driven to 0 via
 * `actor.update({"flags.tb2e.pendingConflictHP": { newValue: 0 }})`. The GM
 * hook at tb2e.mjs L193-204 clamps to [0, max], writes
 * `system.conflict.hp.value = 0`, and clears the mailbox. The
 * `isBlockedFromHelping` predicate at help.mjs L57 gates on HP only
 * (`conflictHP?.max > 0 && conflictHP.value <= 0`) — it does NOT read
 * `combatant.system.knockedOut` — so this spec can go GREEN without the
 * L502 production gap being fixed (L502: `knockedOut` has zero writers in
 * `module/`).
 *
 * `max` is seeded to a positive value via `distributeDisposition` before the
 * mailbox write. The hook's clamp at tb2e.mjs L198-199 would silently pin
 * `newValue` to 0 if `max === 0`, which is the KO case we want here — BUT
 * the help.mjs L57 predicate ALSO requires `max > 0`, so we need max>0 to
 * exercise the KO branch rather than the "not in conflict yet" branch.
 *
 * ---------------------------------------------------------------------------
 * Staging
 * ---------------------------------------------------------------------------
 *   - Kill conflict (Kill attack→skill:fighter per config.mjs L206).
 *   - Party side: captain (fighter=3, the ROLLER) + alt (fighter=2, the
 *     would-be HELPER). Alt's fighter=2>0 satisfies the same-skill help
 *     path at help.mjs L281-289 — without the KO gate, alt would qualify.
 *   - GM side: two unlinked monsters (Bugbear + Goblin) — NOT candidates
 *     because they're on a different group (help.mjs L84-85 + conflict-
 *     panel.mjs L1970 filter: `c._source.group === groupId`).
 *   - Unarmed (`__unarmed__`) for everyone. Attack scripted V0 on party,
 *     defend on GM — interaction is "versus" per config.mjs L409, so the
 *     roll button is emitted for the attacker on volley 0 (panel-resolve
 *     .hbs L103-108, `canRoll` && `sideInteraction !== "none"`).
 *   - Mailbox write: alt's `pendingConflictHP = { newValue: 0 }` with
 *     max=3 (seeded by distributeDisposition at combat.mjs L231). Hook
 *     clamps to 0, writes hp.value=0, clears flag.
 *
 * Act:
 *   - Reveal V0 (panel-resolve.hbs L56 → `#onRevealAction` conflict-panel
 *     .mjs L1796+).
 *   - Click the party-side roll-action button (panel-resolve.hbs L103-108
 *     → `#onRollAction` conflict-panel.mjs L1847+). This flows into
 *     `rollTest` at L1974 with `testContext.candidates = [altCombatant]`
 *     (the only party-side non-roller combatant with `.actor`), which is
 *     the conflict-specific surface under test.
 *   - Assert, in the opened RollDialog, that:
 *       a) The helper toggle for alt's actor id has count 0 —
 *          `isBlockedFromHelping(alt.actor)` returned `blocked: true` at
 *          help.mjs L129 so alt was NEVER pushed into `results` (L136).
 *       b) The entire `.roll-dialog-helpers` section has count 0 —
 *          `hasHelpers` is false at tb2e-roll.mjs L418 (both PC and NPC
 *          helper arrays empty), and the `{{#if hasHelpers}}` guard at
 *          roll-dialog.hbs suppresses the section. This proves alt was
 *          filtered OUT of the pool, not just visually hidden.
 *   - Cancel the dialog (no roll needed — the assertion fires on dialog
 *     contents pre-submission, same discipline as §3 L160).
 *
 * ---------------------------------------------------------------------------
 * Control (vs false negatives)
 * ---------------------------------------------------------------------------
 * To rule out "no helper toggle renders because `candidates` is empty or
 * the conflict-roll path never offers help at all", we FIRST verify alt
 * was a candidate before the KO: `getEligibleHelpers` called directly via
 * `page.evaluate` with the same `candidates: memberCombatants` that
 * `#onRollAction` builds (conflict-panel.mjs L1970-1972) should return one
 * entry with `id === altActorId` BEFORE the mailbox write, and zero
 * entries AFTER. This separates the KO-filter assertion from any
 * candidate-list wiring issues.
 *
 * ---------------------------------------------------------------------------
 * Explicit non-scope
 * ---------------------------------------------------------------------------
 *   - Captain-writes-for-teammate mailbox `targetActorId` branch — L501.
 *   - Mid-volley swap on KO — L503.
 *   - `combatant.system.knockedOut` flag flip — L502 (fixmed, prod gap).
 *   - Synthetic-token HP parity (unlinked monster HP writes) — L505.
 *   - Auto-damage from resolve pipeline driving HP→0 — L500 (fixmed).
 *
 * All Playwright sessions authenticate as GM (auth.setup.mjs). The mailbox
 * drain is GM-gated at tb2e.mjs L186 — our harness fires it synchronously
 * in-session.
 */

const MONSTER_PACK_ID = 'tb2e.monsters';

async function importMonster(page, { sourceName, uniqueName, tag }) {
  return page.evaluate(
    async ({ pId, src, name, t }) => {
      const pack = game.packs.get(pId);
      if ( !pack ) throw new Error(`Pack not found: ${pId}`);
      const docs = await pack.getDocuments();
      const source = docs.find((d) => d.name === src);
      if ( !source ) throw new Error(`Source "${src}" not in pack ${pId}`);
      const data = source.toObject();
      data.name = name;
      data.flags = {
        ...(data.flags ?? {}),
        tb2e: { ...(data.flags?.tb2e ?? {}), e2eTag: t }
      };
      const created = await Actor.implementation.create(data);
      return created.id;
    },
    { pId: MONSTER_PACK_ID, src: sourceName, name: uniqueName, t: tag }
  );
}

async function createCaptainCharacter(page, { name, tag, fighter }) {
  return page.evaluate(
    async ({ n, t, f }) => {
      const actor = await Actor.implementation.create({
        name: n,
        type: 'character',
        flags: { tb2e: { e2eTag: t } },
        system: {
          abilities: {
            health: { rating: 4, pass: 0, fail: 0 },
            will:   { rating: 4, pass: 0, fail: 0 },
            nature: { rating: 3, max: 3, pass: 0, fail: 0 }
          },
          skills: {
            fighter: { rating: f, pass: 0, fail: 0 }
          },
          conditions: { fresh: false }
        }
      });
      return actor.id;
    },
    { n: name, t: tag, f: fighter }
  );
}

async function createHelperCharacter(page, { name, tag, fighter }) {
  return page.evaluate(
    async ({ n, t, f }) => {
      // Explicit `conditions.dead = false` and `conditions.afraid = false`
      // so the EARLIER branches of isBlockedFromHelping (help.mjs L54-55)
      // don't fire — isolates the KO gate (L57) as the sole reason for
      // exclusion in this spec.
      const actor = await Actor.implementation.create({
        name: n,
        type: 'character',
        flags: { tb2e: { e2eTag: t } },
        system: {
          abilities: {
            health: { rating: 3, pass: 0, fail: 0 },
            will:   { rating: 3, pass: 0, fail: 0 },
            nature: { rating: 3, max: 3, pass: 0, fail: 0 }
          },
          skills: {
            fighter: { rating: f, pass: 0, fail: 0 }
          },
          conditions: { fresh: false, afraid: false, dead: false }
        }
      });
      return actor.id;
    },
    { n: name, t: tag, f: fighter }
  );
}

async function cleanupTaggedActors(page, tag) {
  await page.evaluate(async (t) => {
    const ids = game.actors
      .filter((a) => a.getFlag?.('tb2e', 'e2eTag') === t)
      .map((a) => a.id);
    if ( ids.length ) await Actor.implementation.deleteDocuments(ids);
  }, tag);
}

test.describe('§18 Conflict: HP & KO — KO\'d teammate filtered from conflict-roll helper pool', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => {
      try { game.tb2e?.conflictPanel?.close(); } catch {}
    });
    await page.evaluate(async () => {
      const ids = Array.from(game.combats ?? []).map((c) => c.id);
      if ( ids.length ) await Combat.deleteDocuments(ids);
    });
  });

  test(
    "conflict action roll dialog: KO'd teammate is filtered from candidates via isBlockedFromHelping (help.mjs L57, TEST_PLAN L504)",
    async ({ page }, testInfo) => {
      const tag = `e2e-hp-help-ko-${testInfo.parallelIndex}-${Date.now()}`;
      const stamp = Date.now();
      const captainName = `E2E HelpKO Captain ${stamp}`;
      const altName = `E2E HelpKO Alt ${stamp}`;
      const monAName = `E2E HelpKO Bugbear ${stamp}`;
      const monBName = `E2E HelpKO Goblin ${stamp}`;

      await page.goto('/game');
      const ui = new GameUI(page);
      await ui.waitForReady();
      await ui.dismissTours();

      // Mailbox drain + reveal + rollAction handlers all gate on
      // isGM/owner. Harness is GM (auth.setup.mjs).
      expect(await page.evaluate(() => game.user.isGM)).toBe(true);

      try {
        /* ---------- Arrange actors ---------- */

        const captainId = await createCaptainCharacter(page, {
          name: captainName, tag, fighter: 3
        });
        const altId = await createHelperCharacter(page, {
          name: altName, tag, fighter: 2
        });
        const monAId = await importMonster(page, {
          sourceName: 'Bugbear', uniqueName: monAName, tag
        });
        const monBId = await importMonster(page, {
          sourceName: 'Goblin', uniqueName: monBName, tag
        });

        /* ---------- Create conflict + resolve group ids ---------- */

        const tracker = new ConflictTracker(page);
        await tracker.open();
        await tracker.clickCreateConflict();
        await expect
          .poll(
            () => page.evaluate(() => {
              const c = game.combats.find((x) => x.isConflict);
              return c ? c.groups.size : 0;
            }),
            { timeout: 10_000 }
          )
          .toBe(2);
        const { combatId, partyGroupId, gmGroupId } = await page.evaluate(() => {
          const c = game.combats.find((x) => x.isConflict);
          const g = Array.from(c.groups);
          return { combatId: c.id, partyGroupId: g[0].id, gmGroupId: g[1].id };
        });

        /* ---------- Setup tab ---------- */

        const panel = new ConflictPanel(page);
        await panel.open();
        expect(await panel.activeTabId()).toBe('setup');

        const cmb = {};
        cmb.captain = await panel.addCombatant({
          combatId, actorId: captainId, groupId: partyGroupId
        });
        cmb.alt = await panel.addCombatant({
          combatId, actorId: altId, groupId: partyGroupId
        });
        cmb.monA = await panel.addCombatant({
          combatId, actorId: monAId, groupId: gmGroupId
        });
        cmb.monB = await panel.addCombatant({
          combatId, actorId: monBId, groupId: gmGroupId
        });
        await expect(panel.setupCombatants).toHaveCount(4);

        await panel.clickCaptainButton(cmb.captain);
        await panel.clickCaptainButton(cmb.monA);
        await panel.selectConflictType('kill');

        await expect(panel.beginDispositionButton).toBeEnabled();
        await panel.clickBeginDisposition();

        /* ---------- Disposition: flat-set both sides ---------- */

        // distributeDisposition (combat.mjs L219-242) seeds hp.max on
        // each combatant's actor. The mailbox write later relies on
        // `max > 0` for two reasons:
        //   1. Clamp at tb2e.mjs L198-199: with max=0, newValue would be
        //      clamped to 0 (harmless here — we WANT 0) but we couldn't
        //      distinguish a successful write from a no-op clamp.
        //   2. Help gate at help.mjs L57 requires `conflictHP?.max > 0`
        //      — a teammate who has never entered conflict (max=0) is
        //      NOT considered KO'd; the predicate would fall through and
        //      `_findBestHelpPath` would still match. So we MUST seed
        //      max>0 to exercise the actual KO branch.
        await page.evaluate(async ({ cId, pId, gId }) => {
          const c = game.combats.get(cId);
          await c.storeDispositionRoll(pId, {
            rolled: 7, diceResults: [], cardHtml: '<em>E2E</em>'
          });
          await c.storeDispositionRoll(gId, {
            rolled: 8, diceResults: [], cardHtml: '<em>E2E</em>'
          });
        }, { cId: combatId, pId: partyGroupId, gId: gmGroupId });

        await page.evaluate(async ({ cId, pId, gId, capId, aId, mAId, mBId }) => {
          const c = game.combats.get(cId);
          const party = {}; party[capId] = 4; party[aId] = 3;
          const gm = {};    gm[mAId]   = 4; gm[mBId]   = 4;
          await c.distributeDisposition(pId, party);
          await c.distributeDisposition(gId, gm);
        }, {
          cId: combatId,
          pId: partyGroupId,
          gId: gmGroupId,
          capId: cmb.captain,
          aId: cmb.alt,
          mAId: cmb.monA,
          mBId: cmb.monB
        });

        // Verify HP seeded as expected before the mailbox step.
        expect(await page.evaluate(({ cap, alt }) => ({
          captain: {
            value: game.actors.get(cap)?.system.conflict?.hp?.value ?? null,
            max: game.actors.get(cap)?.system.conflict?.hp?.max ?? null
          },
          alt: {
            value: game.actors.get(alt)?.system.conflict?.hp?.value ?? null,
            max: game.actors.get(alt)?.system.conflict?.hp?.max ?? null
          }
        }), { cap: captainId, alt: altId })).toEqual({
          captain: { value: 4, max: 4 },
          alt: { value: 3, max: 3 }
        });

        await expect(panel.beginWeaponsButton).toBeEnabled();
        await panel.clickBeginWeapons();

        /* ---------- Weapons: unarmed for everyone ---------- */

        await page.evaluate(async ({ cId, ids }) => {
          const c = game.combats.get(cId);
          for ( const id of ids ) {
            await c.setWeapon(id, 'Fists', '__unarmed__');
          }
        }, {
          cId: combatId,
          ids: [cmb.captain, cmb.alt, cmb.monA, cmb.monB]
        });

        await expect(panel.beginScriptingButton).toBeEnabled();
        await panel.clickBeginScripting();

        /* ---------- Scripting: captain ATTACKS V0 ---------- */

        // Party V0=attack/captain so the roll button on V0's party side
        // is the captain's fighter roll — the exact entry point into
        // `#onRollAction` with party as the rolling group, which builds
        // `memberCombatants` (conflict-panel.mjs L1970-1972) as alt-only
        // (captain excluded by `c.id !== combatantId` at L1972). V1/V2
        // filler so lockActions gate opens.
        const partyActions = [
          { action: 'attack',   combatantId: cmb.captain },
          { action: 'defend',   combatantId: cmb.alt },
          { action: 'feint',    combatantId: cmb.captain }
        ];
        const gmActions = [
          { action: 'defend',   combatantId: cmb.monA },
          { action: 'attack',   combatantId: cmb.monB },
          { action: 'defend',   combatantId: cmb.monA }
        ];
        /* ---------- Script + lock (resolve deferred for pre-KO check) ---------- */

        await scriptAndLockActions(page, {
          combatId, partyGroupId, gmGroupId, partyActions, gmActions,
          beginResolve: false
        });

        /* ---------- Control: alt IS a candidate before KO ---------- */

        // Before driving alt's HP to 0, verify the conflict-specific
        // candidate pipeline produces alt as a valid helper. We call
        // `getEligibleHelpers` directly with the same candidates array
        // that `#onRollAction` would build (conflict-panel.mjs L1970-
        // 1972). This pins the pre-KO pool shape so the post-KO
        // assertion isolates the KO gate as the filter reason.
        const preKoPool = await page.evaluate(
          async ({ cId, pId, capId }) => {
            const { getEligibleHelpers } = await import(
              '/systems/tb2e/module/dice/help.mjs'
            );
            const combat = game.combats.get(cId);
            const rollerActor = game.actors.get(capId);
            // Mirror conflict-panel.mjs L1970-1972.
            const candidates = combat.combatants
              .filter((c) => c._source.group === pId)
              .filter((c) => c.actor && c.actor.id !== rollerActor.id);
            const helpers = getEligibleHelpers({
              actor: rollerActor,
              type: 'skill',
              key: 'fighter',
              testContext: { isConflict: true, candidates },
              candidates
            });
            return helpers.map((h) => ({ id: h.id, helpVia: h.helpVia }));
          },
          { cId: combatId, pId: partyGroupId, capId: captainId }
        );
        expect(preKoPool).toEqual([{ id: altId, helpVia: 'fighter' }]);

        /* ---------- Transition to resolve phase ---------- */

        await page.evaluate(async ({ cId }) => {
          const c = game.combats.get(cId);
          await c.beginResolve();
        }, { cId: combatId });

        await expect.poll(() => panel.activeTabId()).toBe('resolve');
        expect(await page.evaluate(({ cId }) => {
          const c = game.combats.get(cId);
          return { phase: c.system.phase, currentAction: c.system.currentAction };
        }, { cId: combatId })).toEqual({ phase: 'resolve', currentAction: 0 });

        /* ---------- Act 1: Mailbox KO on the alt (teammate helper) ---------- */

        await page.evaluate(async (id) => {
          const actor = game.actors.get(id);
          await actor.update({
            'flags.tb2e.pendingConflictHP': { newValue: 0 }
          });
        }, altId);

        // 1. Mailbox-drain: HP clamped into [0, max=3] and written to 0.
        await expect
          .poll(
            () => page.evaluate(
              (id) => game.actors.get(id)?.system.conflict?.hp?.value ?? null,
              altId
            ),
            { timeout: 10_000, message: 'mailbox newValue=0 should land as hp.value=0' }
          )
          .toBe(0);

        // 2. Mailbox flag cleared (tb2e.mjs L201).
        await expect
          .poll(
            () => page.evaluate(
              (id) => game.actors.get(id)?.getFlag('tb2e', 'pendingConflictHP') ?? null,
              altId
            ),
            { timeout: 10_000, message: 'mailbox flag should be cleared by GM hook' }
          )
          .toBeNull();

        // Sanity: `isBlockedFromHelping(alt.actor)` now returns
        // `blocked: true` with reason `TB2E.Help.BlockedConflictKO`
        // (help.mjs L57). This is the in-process predicate check — the
        // DOM-level assertion further down is the contract under test.
        const altBlock = await page.evaluate(async (id) => {
          const { isBlockedFromHelping } = await import(
            '/systems/tb2e/module/dice/help.mjs'
          );
          return isBlockedFromHelping(game.actors.get(id));
        }, altId);
        expect(altBlock).toEqual({
          blocked: true,
          reason: 'TB2E.Help.BlockedConflictKO'
        });

        /* ---------- Act 2: Control post-KO — same pool now empty ---------- */

        // The direct `getEligibleHelpers` call with the same candidates
        // now returns zero entries — alt is filtered at help.mjs L129
        // before reaching `_findBestHelpPath`. This pins the pool shape
        // INSIDE the help module, independent of the dialog template.
        const postKoPool = await page.evaluate(
          async ({ cId, pId, capId }) => {
            const { getEligibleHelpers } = await import(
              '/systems/tb2e/module/dice/help.mjs'
            );
            const combat = game.combats.get(cId);
            const rollerActor = game.actors.get(capId);
            const candidates = combat.combatants
              .filter((c) => c._source.group === pId)
              .filter((c) => c.actor && c.actor.id !== rollerActor.id);
            const helpers = getEligibleHelpers({
              actor: rollerActor,
              type: 'skill',
              key: 'fighter',
              testContext: { isConflict: true, candidates },
              candidates
            });
            return helpers.map((h) => ({ id: h.id, helpVia: h.helpVia }));
          },
          { cId: combatId, pId: partyGroupId, capId: captainId }
        );
        expect(postKoPool).toEqual([]);

        /* ---------- Act 3: Reveal V0 + click roll-action ---------- */

        // Reveal V0 (panel-resolve.hbs L56 → `#onRevealAction`).
        await panel
          .resolveAction(0)
          .locator('button[data-action="revealAction"]')
          .click();

        await expect
          .poll(() => page.evaluate(({ cId }) => {
            const c = game.combats.get(cId);
            const round = c.system.rounds?.[c.system.currentRound];
            return round?.volleys?.[0]?.revealed ?? null;
          }, { cId: combatId }))
          .toBe(true);

        // Click the party-side roll button. This dispatches to
        // `#onRollAction` (conflict-panel.mjs L1847+), which builds
        // `memberCombatants` (L1970-1972) — in our staging that's
        // `[altCombatant]` — and calls `rollTest` with
        // `testContext.candidates = [altCombatant]`, `isConflict: true`,
        // `isVersus: true` (attack:defend matrix at config.mjs L409).
        const attackRollBtn = panel
          .resolveAction(0)
          .locator(`button[data-action="rollAction"][data-group-id="${partyGroupId}"]`);
        await expect(attackRollBtn).toBeVisible();
        await attackRollBtn.click();

        /* ---------- Act 4: Dialog assertions — the CORE test ---------- */

        const dialog = new RollDialog(page);
        await dialog.waitForOpen();

        // (a) Helper toggle for the KO'd alt is NOT rendered. The
        //     `helperToggle(id)` locator scopes to `.roll-dialog-helpers
        //     .helper-toggle[data-helper-id="<altActorId>"]` — count 0
        //     covers both "helpers section missing entirely" and
        //     "section present but alt filtered out".
        await expect(dialog.helperToggle(altId)).toHaveCount(0);

        // (b) Since alt was the only party-side, non-roller candidate,
        //     `availableHelpers` is empty → `hasHelpers: false` at
        //     tb2e-roll.mjs L418 → the entire `.roll-dialog-helpers`
        //     section is suppressed by the `{{#if hasHelpers}}` guard
        //     (templates/dice/roll-dialog.hbs). This asserts alt was
        //     FILTERED OUT of the conflict candidate pool — not just
        //     visually hidden inside a rendered block.
        await expect(dialog.helpersSection).toHaveCount(0);

        // Sanity: pool reflects the fighter-skill roll with the
        // unarmed -1D penalty (fighter=3, -1D = 2 baseline pool). We
        // read the live summary pool, which accounts for dialog-side
        // modifier math (conditions, weapons, etc.). With no helpers
        // added, this is the "no help landed" pool size.
        expect(await dialog.getSummaryPool()).toBe(2);

        /* ---------- Cleanup: cancel dialog ---------- */

        await dialog.cancel();
      } finally {
        await cleanupTaggedActors(page, tag);
      }
    }
  );
});
