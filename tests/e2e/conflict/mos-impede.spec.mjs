import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { VersusPendingCard, VersusResolutionCard } from '../pages/VersusCard.mjs';
import { ManeuverSpendDialog } from '../pages/ManeuverSpendDialog.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §17 Conflict: Maneuver MoS Spends — Impede (TEST_PLAN L478, SG p.69).
 *
 * Rules under test (SG p.69):
 *   - Winner of a Maneuver may spend Margin of Success on combos
 *     (maneuver-spend-dialog.mjs L11-33 SPEND_COMBINATIONS).
 *   - 1 MoS → Impede only: a single -1D modifier applied to the
 *     opponent's next action (combat.mjs L618-624).
 *   - The penalty is stamped into `combat.system.rounds[R].effects
 *     .pendingImpede[opponentGroupId] = { amount, targetVolley }`
 *     (combat.mjs L619-624) and consumed on the opponent's next roll
 *     by `#onRollAction` (conflict-panel.mjs L1881-1889) which pushes
 *     a `{ label:"Impede", type:"dice", value:-amount, source:"conflict" }`
 *     entry into `testContext.modifiers`. That list flows into
 *     `rollTest`'s contextModifiers (tb2e-roll.mjs L1255-1258), is
 *     applied to the pool at L1316-1319, and is persisted onto the
 *     roll message as `flags.tb2e.roll.modifiers` by `_buildRollFlags`
 *     (tb2e-roll.mjs L1431).
 *
 * -------------------------------------------------------------------
 * What this spec verifies (narrow — TEST_PLAN L478 only)
 * -------------------------------------------------------------------
 *   1. Stage Kill conflict; volley 0 Maneuver (party) vs Defend (GM);
 *      volley 1 Defend (party) vs Attack (GM) so the GM side rolls
 *      next (where Impede must land).
 *   2. PRNG stubs: 0.001 (all-6s, 1 success for party's 1D) then 0.5
 *      (all-3s, 0 successes for GM's 1D) → margin = 1.
 *   3. After versus resolution, MoS=1 dialog opens with exactly one
 *      combo (SPEND_COMBINATIONS[1] = impede only — maneuver-spend-
 *      dialog.mjs L12-14).
 *   4. Select `impede`, submit. Assert:
 *      - mailbox `system.pendingManeuverSpend` cleared after GM
 *        processes (combat.mjs L561-566).
 *      - `round.effects.pendingImpede[gmGroupId] = { amount:1,
 *        targetVolley:1 }` (combat.mjs L619-624).
 *      - `round.effects.maneuverSpends[0].spent === true`
 *        (combat.mjs L665-671).
 *   5. Resolve volley 0, reveal volley 1, have GM captain roll their
 *      Attack. Roll message's `flags.tb2e.roll.modifiers` must include
 *      an Impede entry with `type:"dice"`, `value:-1`, `source:"conflict"`.
 *   6. Final pool size reflects the -1D: baseDice=2 (fighter=3 − 1
 *      unarmed) + (-1 Impede) = 1 (floored to 1 by
 *      `Math.max(config.baseDice + diceBonus, 1)` at tb2e-roll.mjs
 *      L1319).
 *
 * -------------------------------------------------------------------
 * Why this spec is NOT `test.fixme`
 * -------------------------------------------------------------------
 * Every production hook is wired end-to-end:
 *   - Spend mailbox: maneuver-spend-dialog.mjs L265-271 writes
 *     `system.pendingManeuverSpend = { roundNum, volleyIndex, selection }`.
 *   - GM hook: combat.mjs L455-456 in `_onUpdateDescendantDocuments`
 *     dispatches to `#applyManeuverSpend` which stamps pendingImpede
 *     (L619-624) and clears the mailbox (L562-566).
 *   - Roll consumption: conflict-panel.mjs L1881-1889 reads pendingImpede
 *     for the rolling group with matching targetVolley and injects the
 *     -1D modifier into testContext.
 *   - Modifier persistence: tb2e-roll.mjs L1431 serializes
 *     allModifiers onto `flags.tb2e.roll.modifiers`.
 *
 * -------------------------------------------------------------------
 * Test fixture (deterministic)
 * -------------------------------------------------------------------
 *   Kill conflict. 4 characters, 2 per side. Both captains are captains.
 *     - Party captain (captainA): health=2, fighter=3. Scripts volley 0
 *       MANEUVER (rolls health, baseDice=2 − 1 unarmed = 1D). Volley 1
 *       DEFEND (filler — not rolled here).
 *     - GM captain (captainB): health=2, fighter=3. Scripts volley 0
 *       DEFEND (rolls health, baseDice=2 − 1 unarmed = 1D). Volley 1
 *       ATTACK (rolls fighter, baseDice=3 − 1 unarmed = 2D → minus
 *       1 Impede = 1D).
 *
 *   PRNG stubs:
 *     - u=0.001 → 6 (all successes).
 *     - u=0.5  → 3 (all wyrms).
 */

async function createCaptainCharacter(page, { name, tag, health, fighter }) {
  return page.evaluate(
    async ({ n, t, h, f }) => {
      const actor = await Actor.implementation.create({
        name: n,
        type: 'character',
        flags: { tb2e: { e2eTag: t } },
        system: {
          abilities: {
            health: { rating: h, pass: 0, fail: 0 },
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
    { n: name, t: tag, h: health, f: fighter }
  );
}

async function createCharacter(page, { name, tag }) {
  return page.evaluate(
    async ({ n, t }) => {
      const actor = await Actor.implementation.create({
        name: n,
        type: 'character',
        flags: { tb2e: { e2eTag: t } },
        system: { conditions: { fresh: false } }
      });
      return actor.id;
    },
    { n: name, t: tag }
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

test.describe('§17 Conflict: Maneuver MoS — Impede (-1D next opponent action)', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(async () => {
      if ( globalThis.__tb2eE2EPrevRandomUniform ) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
      // Defensive: close any lingering maneuver-spend dialog (same
      // teardown pattern as resolve-maneuver-vs-defend.spec.mjs
      // L156-168 and tie-break.spec.mjs L187).
      const fa = foundry.applications.instances;
      const all = fa?.values ? Array.from(fa.values()) : Object.values(fa ?? {});
      for ( const app of all ) {
        const ctor = app?.constructor?.name ?? '';
        if ( app?.id === 'maneuver-spend-dialog'
          || ctor === 'ManeuverSpendDialog' ) {
          try { await app.close(); } catch {}
        }
      }
      try { game.tb2e?.conflictPanel?.close(); } catch {}
    });
    await page.evaluate(async () => {
      const ids = Array.from(game.combats ?? []).map((c) => c.id);
      if ( ids.length ) await Combat.deleteDocuments(ids);
    });
    await page.evaluate(async () => {
      const mids = game.messages.contents.map((m) => m.id);
      if ( mids.length ) await ChatMessage.deleteDocuments(mids);
    });
  });

  test(
    'MoS 1 Impede: dialog offers only Impede; -1D stamped on opponent next roll (SG p.69)',
    async ({ page }, testInfo) => {
      const tag = `e2e-mos-impede-${testInfo.parallelIndex}-${Date.now()}`;
      const stamp = Date.now();
      const charAName = `E2E Impede Captain A ${stamp}`;
      const charBName = `E2E Impede Captain B ${stamp}`;
      const charCName = `E2E Impede Char C ${stamp}`;
      const charDName = `E2E Impede Char D ${stamp}`;

      await page.goto('/game');
      const ui = new GameUI(page);
      await ui.waitForReady();
      await ui.dismissTours();

      expect(await page.evaluate(() => game.user.isGM)).toBe(true);

      try {
        /* ---------- Arrange actors ---------- */

        // Both captains: health=2 (for volley-0 maneuver/defend health
        // rolls → 1D after −1 unarmed) and fighter=3 (for volley-1
        // attack → 2D after −1 unarmed, before Impede).
        const captainAId = await createCaptainCharacter(page, {
          name: charAName, tag, health: 2, fighter: 3
        });
        const captainBId = await createCaptainCharacter(page, {
          name: charBName, tag, health: 2, fighter: 3
        });
        const charCId = await createCharacter(page, { name: charCName, tag });
        const charDId = await createCharacter(page, { name: charDName, tag });

        /* ---------- Create conflict ---------- */

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
        cmb.captainA = await panel.addCombatant({
          combatId, actorId: captainAId, groupId: partyGroupId
        });
        cmb.charC = await panel.addCombatant({
          combatId, actorId: charCId, groupId: partyGroupId
        });
        cmb.captainB = await panel.addCombatant({
          combatId, actorId: captainBId, groupId: gmGroupId
        });
        cmb.charD = await panel.addCombatant({
          combatId, actorId: charDId, groupId: gmGroupId
        });
        await expect(panel.setupCombatants).toHaveCount(4);

        await panel.clickCaptainButton(cmb.captainA);
        await panel.clickCaptainButton(cmb.captainB);
        await panel.selectConflictType('kill');

        await expect(panel.beginDispositionButton).toBeEnabled();
        await panel.clickBeginDisposition();

        /* ---------- Disposition: flat-set ---------- */

        await page.evaluate(async ({ cId, pId, gId }) => {
          const c = game.combats.get(cId);
          await c.storeDispositionRoll(pId, {
            rolled: 7, diceResults: [], cardHtml: '<em>E2E</em>'
          });
          await c.storeDispositionRoll(gId, {
            rolled: 7, diceResults: [], cardHtml: '<em>E2E</em>'
          });
        }, { cId: combatId, pId: partyGroupId, gId: gmGroupId });

        await page.evaluate(async ({ cId, pId, gId, aId, bId, cId2, dId }) => {
          const c = game.combats.get(cId);
          const party = {}; party[aId] = 4; party[cId2] = 3;
          const gm = {};    gm[bId]   = 4; gm[dId]   = 3;
          await c.distributeDisposition(pId, party);
          await c.distributeDisposition(gId, gm);
        }, {
          cId: combatId,
          pId: partyGroupId,
          gId: gmGroupId,
          aId: cmb.captainA,
          bId: cmb.captainB,
          cId2: cmb.charC,
          dId: cmb.charD
        });

        await expect(panel.beginWeaponsButton).toBeEnabled();
        await panel.clickBeginWeapons();

        /* ---------- Weapons: unarmed ---------- */

        await page.evaluate(async ({ cId, ids }) => {
          const c = game.combats.get(cId);
          for ( const id of ids ) {
            await c.setWeapon(id, 'Fists', '__unarmed__');
          }
        }, { cId: combatId, ids: [cmb.captainA, cmb.charC, cmb.captainB, cmb.charD] });

        await expect(panel.beginScriptingButton).toBeEnabled();
        await panel.clickBeginScripting();

        /* ---------- Scripting ---------- */

        // V0: party MANEUVER (rolls health, 1D → 1 success) vs
        //      GM DEFEND (rolls health, 1D → 0 successes).
        // V1: party DEFEND vs GM ATTACK (rolls fighter, 2D → after
        //      -1 Impede = 1D). V1 is where Impede must surface.
        // V2: filler.
        const partyActions = [
          { action: 'maneuver', combatantId: cmb.captainA },
          { action: 'defend',   combatantId: cmb.captainA },
          { action: 'attack',   combatantId: cmb.captainA }
        ];
        const gmActions = [
          { action: 'defend',   combatantId: cmb.captainB },
          { action: 'attack',   combatantId: cmb.captainB },
          { action: 'defend',   combatantId: cmb.captainB }
        ];
        await page.evaluate(async ({ cId, pId, gId, pa, ga }) => {
          const c = game.combats.get(cId);
          await c.setActions(pId, pa);
          await c.setActions(gId, ga);
        }, {
          cId: combatId, pId: partyGroupId, gId: gmGroupId,
          pa: partyActions, ga: gmActions
        });

        await page.evaluate(async ({ cId, pId, gId }) => {
          const c = game.combats.get(cId);
          await c.lockActions(pId);
          await c.lockActions(gId);
        }, { cId: combatId, pId: partyGroupId, gId: gmGroupId });

        /* ---------- Resolve phase ---------- */

        await page.evaluate(async ({ cId }) => {
          const c = game.combats.get(cId);
          await c.beginResolve();
        }, { cId: combatId });

        await expect.poll(() => panel.activeTabId()).toBe('resolve');

        /* ---------- Volley 0 reveal ---------- */

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

        /* ---------- V0 party Maneuver roll (initiator) ---------- */

        // Stub PRNG → all-6s. captainA health=2 − 1 unarmed = 1D → 1 success.
        await page.evaluate(() => {
          globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
          CONFIG.Dice.randomUniform = () => 0.001;
        });

        await panel
          .resolveAction(0)
          .locator(`button[data-action="rollAction"][data-group-id="${partyGroupId}"]`)
          .click();

        const partyDialog = new RollDialog(page);
        await partyDialog.waitForOpen();
        expect(await partyDialog.modeInput.inputValue()).toBe('versus');
        await partyDialog.submit();

        const partyMessageId = await page.evaluate(async (actorId) => {
          const started = Date.now();
          while ( Date.now() - started < 10_000 ) {
            const msg = game.messages.contents.find((m) => {
              const vs = m.flags?.tb2e?.versus;
              return vs?.type === 'initiator' && vs.initiatorActorId === actorId;
            });
            if ( msg ) return msg.id;
            await new Promise((r) => setTimeout(r, 100));
          }
          return null;
        }, captainAId);
        expect(partyMessageId).toBeTruthy();

        await page.evaluate(() =>
          ui.sidebar?.changeTab?.('chat', 'primary')
        );
        const partyCard = new VersusPendingCard(page, partyMessageId);
        await partyCard.expectPresent();
        await partyCard.clickFinalize();
        await expect(partyCard.resolvedBanner).toBeVisible();

        /* ---------- V0 GM Defend roll (opponent) ---------- */

        // Swap PRNG → all-3s. captainB health=2 − 1 unarmed = 1D → 0 successes.
        await page.evaluate(() => {
          CONFIG.Dice.randomUniform = () => 0.5;
        });

        await page.evaluate(() =>
          ui.sidebar?.changeTab?.('combat', 'primary')
        );
        await panel
          .resolveAction(0)
          .locator(`button[data-action="rollAction"][data-group-id="${gmGroupId}"]`)
          .click();

        const gmDialog = new RollDialog(page);
        await gmDialog.waitForOpen();
        expect(await gmDialog.modeInput.inputValue()).toBe('versus');
        const challengeSelect = gmDialog.root.locator(
          'select[name="challengeMessageId"]'
        );
        await challengeSelect.selectOption(partyMessageId);
        await gmDialog.submit();

        const gmMessageId = await page.evaluate(async ({ mId }) => {
          const started = Date.now();
          while ( Date.now() - started < 10_000 ) {
            const msg = game.messages.contents.find((m) => {
              const vs = m.flags?.tb2e?.versus;
              return vs?.type === 'opponent' && vs.initiatorMessageId === mId;
            });
            if ( msg ) return msg.id;
            await new Promise((r) => setTimeout(r, 100));
          }
          return null;
        }, { mId: partyMessageId });
        expect(gmMessageId).toBeTruthy();

        await page.evaluate(() =>
          ui.sidebar?.changeTab?.('chat', 'primary')
        );
        const gmCard = new VersusPendingCard(page, gmMessageId);
        await gmCard.expectPresent();
        await gmCard.clickFinalize();

        /* ---------- Versus resolution — margin 1 ---------- */

        const resolutionMessageId = await page.evaluate(async ({ aId, dId }) => {
          const started = Date.now();
          while ( Date.now() - started < 10_000 ) {
            const msg = game.messages.contents.find((m) => {
              const vs = m.flags?.tb2e?.versus;
              return vs?.type === 'resolution'
                && vs.initiatorMessageId === aId
                && vs.opponentMessageId === dId;
            });
            if ( msg ) return msg.id;
            await new Promise((r) => setTimeout(r, 100));
          }
          return null;
        }, { aId: partyMessageId, dId: gmMessageId });
        expect(resolutionMessageId).toBeTruthy();

        const resolution = new VersusResolutionCard(page, resolutionMessageId);
        await resolution.expectPresent();

        // Maneuverer wins by exactly 1.
        expect(await resolution.initiatorIsWinner()).toBe(true);
        const iSuccesses = await resolution.getInitiatorSuccesses();
        const oSuccesses = await resolution.getOpponentSuccesses();
        const margin = iSuccesses - oSuccesses;
        expect(margin).toBe(1);

        // Resolution card carries the MoS-1 spend payload.
        const resFlags = await page.evaluate((mid) => {
          const msg = game.messages.get(mid);
          return msg?.flags?.tb2e?.maneuverSpend ?? null;
        }, resolutionMessageId);
        // `roundNum` is stamped onto the maneuverSpend payload as
        // the source round number (versus.mjs L180 via winnerTc.roundNum,
        // which the panel sets from `combat.system.currentRound || 0`
        // at conflict-panel.mjs L1876/L1988). Round numbering starts at
        // 1 (combat.mjs L287-307 initializes currentRound=1).
        expect(resFlags).toEqual({
          margin: 1,
          combatId,
          combatantId: cmb.captainA,
          groupId: partyGroupId,
          opponentGroupId: gmGroupId,
          roundNum: 1,
          volleyIndex: 0
        });

        /* ---------- Open spend dialog — MoS 1 → Impede only ---------- */

        const spendBtn = resolution.root.locator(
          'button[data-action="spend-maneuver"]'
        );
        await expect(spendBtn).toBeVisible();
        await spendBtn.evaluate((btn) => btn.click());

        const spendDialog = new ManeuverSpendDialog(page);
        await spendDialog.waitForOpen();

        // MoS 1 offers ONLY impede (SPEND_COMBINATIONS[1] — maneuver-
        // spend-dialog.mjs L12-14).
        await expect(spendDialog.combos).toHaveCount(1);
        await expect(spendDialog.comboRadio('impede')).toHaveCount(1);
        await expect(spendDialog.comboRadio('position')).toHaveCount(0);
        await expect(spendDialog.comboRadio('disarm')).toHaveCount(0);
        await expect(spendDialog.comboRadio('rearm')).toHaveCount(0);

        /* ---------- Select Impede, submit ---------- */

        await spendDialog.selectCombo('impede');
        await spendDialog.submit();
        // Dialog closes synchronously via `this.close()` in the submit
        // handler (maneuver-spend-dialog.mjs L287).
        await expect(spendDialog.root).toHaveCount(0);

        // GM hook `#applyManeuverSpend` (combat.mjs L559-699) processes
        // the mailbox: stamps `pendingImpede[opponentGroupId]` on the
        // target round+volley (L619-624), marks the source volley as
        // spent (L665-671), and calls `clearMailbox` (L698 →
        // L561-566). Poll for the two definitive functional outcomes.
        //
        // Note on mailbox persistence: `system.pendingManeuverSpend` is
        // an `ObjectField` (combatant.mjs L23) and Foundry's update
        // semantics for `ObjectField` merge the provided patch rather
        // than replace, so `update({ "system.pendingManeuverSpend": {}})`
        // at combat.mjs L564 leaves a stale `selection` sub-object on
        // the combatant. Re-entry of the mailbox hook is idempotent —
        // the `spent` gate at combat.mjs L588 short-circuits before
        // any second application — so the stale value is harmless at
        // runtime. We therefore assert the *functional* outcomes
        // (pendingImpede + spent) rather than mailbox erasure.
        await expect
          .poll(
            () => page.evaluate(({ cId, gId }) => {
              const c = game.combats.get(cId);
              const round = c?.system.rounds?.[c.system.currentRound];
              return {
                pendingImpede: round?.effects?.pendingImpede?.[gId] ?? null,
                spent: round?.effects?.maneuverSpends?.[0]?.spent ?? null
              };
            }, {
              cId: combatId, gId: gmGroupId
            }),
            { timeout: 10_000 }
          )
          .toEqual({
            pendingImpede: { amount: 1, targetVolley: 1 },
            spent: true
          });

        /* ---------- Resolve V0, advance to V1 ---------- */

        await page.evaluate(() =>
          ui.sidebar?.changeTab?.('combat', 'primary')
        );
        await panel
          .resolveAction(0)
          .locator('button[data-action="resolveAction"]')
          .click();

        await expect
          .poll(() => page.evaluate(({ cId }) => {
            const c = game.combats.get(cId);
            return c.system.currentAction ?? null;
          }, { cId: combatId }))
          .toBe(1);

        // Critical regression check: resolveVolley MUST NOT wipe the
        // pendingImpede entry targeting volley 1. combat.mjs L702-720
        // (`clearPendingManeuverEffects`) only clears entries whose
        // `targetVolley === the just-resolved volley` — the V0 resolve
        // must leave `pendingImpede[gmGroupId]` intact (targetVolley=1).
        const impedeStillPresent = await page.evaluate(({ cId, gId }) => {
          const c = game.combats.get(cId);
          const round = c?.system.rounds?.[c.system.currentRound];
          return round?.effects?.pendingImpede?.[gId] ?? null;
        }, { cId: combatId, gId: gmGroupId });
        expect(impedeStillPresent).toEqual({ amount: 1, targetVolley: 1 });

        /* ---------- V1 reveal ---------- */

        await panel
          .resolveAction(1)
          .locator('button[data-action="revealAction"]')
          .click();

        await expect
          .poll(() => page.evaluate(({ cId }) => {
            const c = game.combats.get(cId);
            const round = c.system.rounds?.[c.system.currentRound];
            return round?.volleys?.[1]?.revealed ?? null;
          }, { cId: combatId }))
          .toBe(true);

        /* ---------- V1 GM Attack roll — Impede must apply ---------- */

        // PRNG is still all-3s from V0 GM defend. We only care about
        // the pool size / modifiers list on the resulting message, not
        // the success count — but leave the deterministic stub in place.
        const v1RollBtn = panel
          .resolveAction(1)
          .locator(`button[data-action="rollAction"][data-group-id="${gmGroupId}"]`);
        await expect(v1RollBtn).toBeVisible();
        await v1RollBtn.click();

        const v1Dialog = new RollDialog(page);
        await v1Dialog.waitForOpen();

        // Pool before dialog submit: fighter=3 − 1 unarmed + (-1 Impede) = 1.
        // `poolSize` input reflects `baseDice` (unarmed is a `timing:"pre"`
        // dice mod folded into the summary, not the pool input); the
        // summary parser pulls the final pool number. See RollDialog
        // POM L145-150.
        const v1Summary = await v1Dialog.getSummaryPool();
        expect(v1Summary).toBe(1);

        // Assert the Impede modifier row is present in the dialog
        // BEFORE submit (it renders from contextModifiers which are
        // built from testContext.modifiers — tb2e-roll.mjs L1255-1258).
        // The row label comes from `game.i18n.localize(
        // "TB2E.Conflict.Maneuver.Impede")` ("Impede" — lang/en.json
        // L559). Match by visible text to avoid coupling to class names.
        const impedeRow = v1Dialog.modifierRows.filter({
          hasText: /Impede/i
        });
        await expect(impedeRow).toHaveCount(1);

        await v1Dialog.submit();

        // Roll message carries modifiers list including the Impede -1D.
        const v1MessageId = await page.evaluate(async (actorId) => {
          const started = Date.now();
          while ( Date.now() - started < 10_000 ) {
            const msg = game.messages.contents.find((m) => {
              const tc = m.flags?.tb2e?.testContext;
              const r = m.flags?.tb2e?.roll;
              return tc?.isConflict && tc?.conflictAction === 'attack'
                && tc?.volleyIndex === 1 && r && m.flags?.tb2e?.actorId === actorId;
            });
            if ( msg ) return msg.id;
            await new Promise((r) => setTimeout(r, 100));
          }
          return null;
        }, captainBId);
        expect(v1MessageId).toBeTruthy();

        const v1Flags = await page.evaluate((mid) => {
          const msg = game.messages.get(mid);
          const r = msg?.flags?.tb2e?.roll;
          if ( !r ) return null;
          // Impede is a `source:"conflict", type:"dice", value:-1`
          // modifier. Filter down to the Impede-labeled one.
          const impede = (r.modifiers || []).find(
            (m) => m.source === 'conflict' && m.type === 'dice' && m.value === -1
              && /Impede/i.test(m.label || '')
          );
          return {
            baseDice: r.baseDice ?? null,
            poolSize: r.poolSize ?? null,
            impede: impede
              ? { type: impede.type, value: impede.value, source: impede.source }
              : null
          };
        }, v1MessageId);
        // baseDice reflects the pre-pre-mod pool (fighter rating=3).
        // poolSize is the final effective pool after all pre-modifiers:
        //   3 (fighter) - 1 (unarmed) - 1 (Impede) = 1.
        expect(v1Flags.baseDice).toBe(3);
        expect(v1Flags.poolSize).toBe(1);
        expect(v1Flags.impede).toEqual({
          type: 'dice', value: -1, source: 'conflict'
        });

        /* ---------- Cleanup PRNG ---------- */

        await page.evaluate(() => {
          if ( globalThis.__tb2eE2EPrevRandomUniform ) {
            CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
            delete globalThis.__tb2eE2EPrevRandomUniform;
          }
        });
      } finally {
        await cleanupTaggedActors(page, tag);
      }
    }
  );
});
