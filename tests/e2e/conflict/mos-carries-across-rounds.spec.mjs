import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { VersusPendingCard, VersusResolutionCard } from '../pages/VersusCard.mjs';
import { ManeuverSpendDialog } from '../pages/ManeuverSpendDialog.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §17 Conflict: Maneuver MoS Spends — Cross-round persistence
 * (TEST_PLAN L484, SG p.69).
 *
 * Rules under test (SG p.69):
 *   - A Maneuver spent on the LAST volley (V2) of a round applies to
 *     the "next action" — which is V0 of the following round.
 *   - `#applyManeuverSpend` (combat.mjs L559-699) handles this via the
 *     `isBoundary` path: when `volleyIndex === 2` the target is
 *     `(roundNum+1, 0)`. If the next round does NOT yet exist (the
 *     common case — player spends before GM clicks "New Round"), the
 *     effect is stashed on the SOURCE round's `effects.carryImpede` /
 *     `effects.carryPosition` bags (combat.mjs L602-613, comment at
 *     L575-580).
 *   - `advanceRound()` (combat.mjs L810-878) then drains those carry
 *     bags and stamps `pendingImpede[gid] = { amount, targetVolley: 0 }`
 *     / `pendingPosition[gid] = { amount, targetVolley: 0 }` on the new
 *     round's `effects` (combat.mjs L859-871).
 *   - The new round's V0 roll then consumes those entries exactly as
 *     in-round effects do (conflict-panel.mjs L1881-1898, gated by
 *     `targetVolley === currentAction` — currentAction resets to 0 at
 *     L844-853 of `advanceRound` because the new round is built fresh
 *     and `beginResolve` re-enters; but in practice `advanceRound` does
 *     NOT reset `currentAction` itself — see note below).
 *
 * -------------------------------------------------------------------
 * What this spec verifies (narrow — TEST_PLAN L484 only)
 * -------------------------------------------------------------------
 *   1. Stage a Kill conflict and fast-forward past V0/V1 by directly
 *      updating `system.rounds[1].volleys[0..1]` to `revealed:true` +
 *      stub results and bumping `system.currentAction` to 2. This
 *      isolates the V2 spend path without rolling V0/V1 (independent
 *      attack:attack that would otherwise require 4 rolls).
 *   2. On V2: party MANEUVER vs GM DEFEND (versus). PRNG 0.001 then
 *      0.5 → party 3-success (health=4 − 1 unarmed = 3D all-6s) vs GM
 *      0-success (health=2 − 1 unarmed = 1D all-3s). Margin = 3.
 *   3. Spend dialog (MoS=3) offers the `impedePosition` combo
 *      (SPEND_COMBINATIONS[3] — maneuver-spend-dialog.mjs L19-24, cost
 *      3, `impede:true, position:true`). Select it + submit.
 *   4. Assert the SOURCE round picked the `useCarry` branch
 *      (combat.mjs L602-613):
 *        - `round1.effects.carryImpede[gmGroupId] === 1`
 *        - `round1.effects.carryPosition[partyGroupId] === 2`
 *        - `round1.effects.pendingImpede[gmGroupId]` is UNSET
 *          (not the in-round path)
 *        - `round1.effects.pendingPosition[partyGroupId]` is UNSET
 *        - `round1.effects.maneuverSpends[2].spent === true`
 *   5. Call `combat.advanceRound()` directly (same as the panel's
 *      "New Round" button — conflict-panel.mjs L2245). Assert the NEW
 *      round (round 2) has:
 *        - `round2.effects.pendingImpede[gmGroupId] = { amount:1,
 *          targetVolley:0 }`   (combat.mjs L862-865)
 *        - `round2.effects.pendingPosition[partyGroupId] = { amount:2,
 *          targetVolley:0 }`   (combat.mjs L867-870)
 *        - `round2.volleys[0].revealed === false` (fresh — L848)
 *        - `round2.actions[*]` are all `[null, null, null]` (L840-842)
 *   6. Cleanup (PRNG restore, dialog close, combats + messages purge).
 *
 * -------------------------------------------------------------------
 * Why this spec is NOT `test.fixme`
 * -------------------------------------------------------------------
 * The production plumbing is fully wired:
 *   - `isBoundary` + `useCarry` detection at combat.mjs L581-602.
 *   - Carry-bag writes at combat.mjs L606-613.
 *   - `advanceRound` drains carry bags into the new round's pending
 *     effects (combat.mjs L859-871).
 *   - Panel's `#onNextRound` (conflict-panel.mjs L2239-2248) is a thin
 *     wrapper around `combat.advanceRound()` — calling the document
 *     method directly matches the production path.
 *   - The mailbox + ObjectField quirks documented in mos-impede.spec.mjs
 *     L512-522 apply identically here (spec asserts functional outcomes,
 *     not mailbox erasure).
 *
 * -------------------------------------------------------------------
 * Test fixture (deterministic)
 * -------------------------------------------------------------------
 *   Kill conflict. 4 characters, 2 per side. Captains only roll.
 *     - Party captainA: health=4, fighter=3. V2 MANEUVER (rolls
 *       health, 4 − 1 unarmed = 3D → 3 successes at u=0.001).
 *     - GM captainB: health=2, fighter=3. V2 DEFEND (rolls health,
 *       2 − 1 unarmed = 1D → 0 successes at u=0.5).
 *     - charC (party), charD (GM): fillers. Never roll.
 *
 *   PRNG stubs: u=0.001 → 6 (all successes); u=0.5 → 3 (all wyrms).
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

test.describe('§17 Conflict: Maneuver MoS — Cross-round carryover (SG p.69)', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(async () => {
      if ( globalThis.__tb2eE2EPrevRandomUniform ) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
      // Defensive: close any lingering maneuver-spend dialog (same
      // teardown pattern as mos-impede.spec.mjs L144-156).
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
    'V2 Impede+Position spend stashes carryImpede/carryPosition; advanceRound propagates to round 2 V0',
    async ({ page }, testInfo) => {
      const tag = `e2e-mos-carries-${testInfo.parallelIndex}-${Date.now()}`;
      const stamp = Date.now();
      const charAName = `E2E Carries Captain A ${stamp}`;
      const charBName = `E2E Carries Captain B ${stamp}`;
      const charCName = `E2E Carries Char C ${stamp}`;
      const charDName = `E2E Carries Char D ${stamp}`;

      await page.goto('/game');
      const ui = new GameUI(page);
      await ui.waitForReady();
      await ui.dismissTours();

      expect(await page.evaluate(() => game.user.isGM)).toBe(true);

      try {
        /* ---------- Arrange actors ---------- */

        // Party captainA: health=4 (V2 maneuver: 4 − 1 unarmed = 3D).
        const captainAId = await createCaptainCharacter(page, {
          name: charAName, tag, health: 4, fighter: 3
        });
        // GM captainB: health=2 (V2 defend: 2 − 1 unarmed = 1D).
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

        // V0, V1: filler attack/defend (never resolved via rolls — we
        // fast-forward). V2: party MANEUVER vs GM DEFEND (versus, the
        // spend trigger). Scripting an action for all three slots is
        // required by `beginResolve` (combat.mjs pre-req) and by the
        // `lockActions` validation.
        const partyActions = [
          { action: 'attack',   combatantId: cmb.captainA },
          { action: 'attack',   combatantId: cmb.captainA },
          { action: 'maneuver', combatantId: cmb.captainA }
        ];
        const gmActions = [
          { action: 'defend', combatantId: cmb.captainB },
          { action: 'defend', combatantId: cmb.captainB },
          { action: 'defend', combatantId: cmb.captainB }
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

        /* ---------- Fast-forward V0 and V1 ---------- */

        // Bypass V0/V1 rolls — not in scope. Mark both as revealed +
        // pseudo-resolved (result set so the roll buttons/reveal UI
        // don't re-activate), and bump `currentAction` to 2 so the V2
        // roll buttons become visible (panel-resolve.hbs L31
        // `this.isCurrent` branch, driven by conflict-panel.mjs
        // L1186-1189 which derives isCurrent from currentAction).
        await page.evaluate(async ({ cId }) => {
          const c = game.combats.get(cId);
          const rounds = foundry.utils.deepClone(c.system.rounds);
          const r = rounds[c.system.currentRound];
          r.volleys[0].revealed = true;
          r.volleys[0].result = { filler: true };
          r.volleys[1].revealed = true;
          r.volleys[1].result = { filler: true };
          await c.update({
            'system.rounds': rounds,
            'system.currentAction': 2
          });
        }, { cId: combatId });

        await expect
          .poll(() => page.evaluate(({ cId }) => {
            const c = game.combats.get(cId);
            return c.system.currentAction ?? null;
          }, { cId: combatId }))
          .toBe(2);

        /* ---------- V2 reveal ---------- */

        await panel
          .resolveAction(2)
          .locator('button[data-action="revealAction"]')
          .click();

        await expect
          .poll(() => page.evaluate(({ cId }) => {
            const c = game.combats.get(cId);
            const round = c.system.rounds?.[c.system.currentRound];
            return round?.volleys?.[2]?.revealed ?? null;
          }, { cId: combatId }))
          .toBe(true);

        /* ---------- V2 party Maneuver roll (initiator) ---------- */

        // Stub PRNG → all-6s. captainA health=4 − 1 unarmed = 3D → 3 successes.
        await page.evaluate(() => {
          globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
          CONFIG.Dice.randomUniform = () => 0.001;
        });

        await panel
          .resolveAction(2)
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

        /* ---------- V2 GM Defend roll (opponent) ---------- */

        // Swap PRNG → all-3s. captainB health=2 − 1 unarmed = 1D → 0 successes.
        await page.evaluate(() => {
          CONFIG.Dice.randomUniform = () => 0.5;
        });

        await page.evaluate(() =>
          ui.sidebar?.changeTab?.('combat', 'primary')
        );
        await panel
          .resolveAction(2)
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

        /* ---------- Versus resolution — margin 3 ---------- */

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

        expect(await resolution.initiatorIsWinner()).toBe(true);
        const iSuccesses = await resolution.getInitiatorSuccesses();
        const oSuccesses = await resolution.getOpponentSuccesses();
        const margin = iSuccesses - oSuccesses;
        expect(margin).toBe(3);

        // Resolution card carries the MoS-3 spend payload. roundNum=1
        // (round numbering starts at 1 — combat.mjs L287-307) and
        // volleyIndex=2 (the last volley of round 1 — this is the
        // boundary spend that exercises the useCarry branch).
        const resFlags = await page.evaluate((mid) => {
          const msg = game.messages.get(mid);
          return msg?.flags?.tb2e?.maneuverSpend ?? null;
        }, resolutionMessageId);
        expect(resFlags).toEqual({
          margin: 3,
          combatId,
          combatantId: cmb.captainA,
          groupId: partyGroupId,
          opponentGroupId: gmGroupId,
          roundNum: 1,
          volleyIndex: 2
        });

        /* ---------- Open spend dialog — MoS 3 → ImpedePosition combo ---------- */

        const spendBtn = resolution.root.locator(
          'button[data-action="spend-maneuver"]'
        );
        await expect(spendBtn).toBeVisible();
        await spendBtn.evaluate((btn) => btn.click());

        const spendDialog = new ManeuverSpendDialog(page);
        await spendDialog.waitForOpen();

        // MoS 3 offers impede, position, impedePosition, disarm (SPEND_
        // COMBINATIONS[3] — maneuver-spend-dialog.mjs L19-24). No
        // rearm/impedeDisarm at MoS=3.
        await expect(spendDialog.combos).toHaveCount(4);
        await expect(spendDialog.comboRadio('impede')).toHaveCount(1);
        await expect(spendDialog.comboRadio('position')).toHaveCount(1);
        await expect(spendDialog.comboRadio('impedePosition')).toHaveCount(1);
        await expect(spendDialog.comboRadio('disarm')).toHaveCount(1);
        await expect(spendDialog.comboRadio('rearm')).toHaveCount(0);
        await expect(spendDialog.comboRadio('impedeDisarm')).toHaveCount(0);

        /* ---------- Select ImpedePosition, submit ---------- */

        await spendDialog.selectCombo('impedePosition');
        await spendDialog.submit();
        await expect(spendDialog.root).toHaveCount(0);

        // GM hook `#applyManeuverSpend` (combat.mjs L559-699) takes the
        // `useCarry` branch because `isBoundary && !targetRoundData`
        // (L602): the next round doesn't exist yet. The impedePosition
        // combo has both `impede:true` and `position:true`
        // (SPEND_COMBINATIONS[3] L22), so BOTH carry bags get stamped:
        //   - `carryImpede[gmGroupId] = 1`      (L606-609)
        //   - `carryPosition[partyGroupId] = 2` (L610-613)
        // The in-round `pendingImpede` / `pendingPosition` bags stay
        // UNSET — the useCarry branch skips L616-633 entirely.
        // Mailbox ObjectField quirk: same as mos-impede.spec.mjs
        // L512-522 — re-entry is idempotent via the `spent` gate
        // (L588), so assert on functional outcomes, not mailbox
        // erasure.
        await expect
          .poll(
            () => page.evaluate(({ cId, pId, gId }) => {
              const c = game.combats.get(cId);
              const round = c?.system.rounds?.[c.system.currentRound];
              const eff = round?.effects;
              return {
                carryImpede: eff?.carryImpede?.[gId] ?? null,
                carryPosition: eff?.carryPosition?.[pId] ?? null,
                pendingImpedeOnGm: eff?.pendingImpede?.[gId] ?? null,
                pendingPositionOnParty: eff?.pendingPosition?.[pId] ?? null,
                spent: eff?.maneuverSpends?.[2]?.spent ?? null
              };
            }, {
              cId: combatId, pId: partyGroupId, gId: gmGroupId
            }),
            { timeout: 10_000 }
          )
          .toEqual({
            carryImpede: 1,
            carryPosition: 2,
            pendingImpedeOnGm: null,
            pendingPositionOnParty: null,
            spent: true
          });

        /* ---------- Advance round ---------- */

        // `combat.advanceRound()` is the same entry point the panel
        // "New Round" button uses (conflict-panel.mjs L2239-2248).
        // Drives the carry → pending propagation at combat.mjs
        // L859-871.
        await page.evaluate(async ({ cId }) => {
          const c = game.combats.get(cId);
          await c.advanceRound();
        }, { cId: combatId });

        await expect
          .poll(() => page.evaluate(({ cId }) => {
            const c = game.combats.get(cId);
            return c.system.currentRound ?? null;
          }, { cId: combatId }))
          .toBe(2);

        /* ---------- Assert carryover on new round ---------- */

        // Round 2 was freshly built (combat.mjs L844-853): volleys all
        // unrevealed, actions all null, effects seeded empty. Then the
        // carry loops at L862-871 drained carryImpede[gmGroupId]=1 and
        // carryPosition[partyGroupId]=2 into the new round's pending
        // bags, keyed with `targetVolley: 0` (the new round's V0).
        const round2State = await page.evaluate(({ cId, pId, gId }) => {
          const c = game.combats.get(cId);
          const r = c?.system.rounds?.[c.system.currentRound];
          if ( !r ) return null;
          return {
            currentRound: c.system.currentRound,
            v0Revealed: r.volleys?.[0]?.revealed ?? null,
            v0Result: r.volleys?.[0]?.result ?? null,
            actionsPartyAllNull: (r.actions?.[pId] || [])
              .every((a) => a == null),
            actionsGmAllNull: (r.actions?.[gId] || [])
              .every((a) => a == null),
            pendingImpede: r.effects?.pendingImpede?.[gId] ?? null,
            pendingPosition: r.effects?.pendingPosition?.[pId] ?? null
          };
        }, { cId: combatId, pId: partyGroupId, gId: gmGroupId });

        expect(round2State).toEqual({
          currentRound: 2,
          v0Revealed: false,
          v0Result: null,
          actionsPartyAllNull: true,
          actionsGmAllNull: true,
          // SG p.69: impede (-1D) and position (+2D) both land on the
          // opponent's / team's next action, which at round boundary is
          // volley 0 of the new round.
          pendingImpede: { amount: 1, targetVolley: 0 },
          pendingPosition: { amount: 2, targetVolley: 0 }
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
