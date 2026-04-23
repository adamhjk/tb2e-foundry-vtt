import { test, expect } from '../test.mjs';
import { scriptAndLockActions } from '../helpers/conflict-scripting.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { VersusPendingCard, VersusResolutionCard } from '../pages/VersusCard.mjs';
import { ManeuverSpendDialog } from '../pages/ManeuverSpendDialog.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §17 Conflict: Maneuver MoS Spends — Position (TEST_PLAN L479, SG p.69).
 *
 * Rules under test (SG p.69):
 *   - Winner of a Maneuver may spend 2 MoS on "Gain Position": +2D to their
 *     team's next action (maneuver-spend-dialog.mjs L15-18 SPEND_COMBINATIONS[2]).
 *   - The +2D is stamped into `combat.system.rounds[R].effects.pendingPosition
 *     [winnerGroupId] = { amount, targetVolley }` (combat.mjs L627-633) —
 *     keyed on the winner's OWN groupId (not the opponent's), which is how
 *     the rule's "team's next action" is realized: any member of that group
 *     rolling the targeted volley consumes it.
 *   - Consumed by `#onRollAction` (conflict-panel.mjs L1890-1898) which pushes
 *     a `{ label:"Position", type:"dice", value:+amount, source:"conflict" }`
 *     entry into `testContext.modifiers`. That flows into `rollTest`'s
 *     contextModifiers (tb2e-roll.mjs L1255-1258) and is applied to the pool
 *     (L1316-1319); persisted onto the roll message as
 *     `flags.tb2e.roll.modifiers` by `_buildRollFlags` (tb2e-roll.mjs L1431).
 *
 * -------------------------------------------------------------------
 * What this spec verifies (narrow — TEST_PLAN L479 only)
 * -------------------------------------------------------------------
 *   1. Stage Kill conflict; volley 0 Maneuver (party captainA) vs Defend
 *      (GM captainB); volley 1 Attack (party charB, via per-volley
 *      `combatantId` override) vs Defend (GM captainB). V1 is rolled by
 *      a NON-captain party member to prove Position keys on groupId, not
 *      combatantId.
 *   2. PRNG stubs: 0.001 (all-6s) then 0.5 (all-3s) → captainA 2-success
 *      maneuver vs captainB 0-success defend → margin = 2.
 *   3. After versus resolution, MoS=2 dialog opens with exactly two combos
 *      (SPEND_COMBINATIONS[2] — maneuver-spend-dialog.mjs L15-18): impede
 *      and position. disarm/rearm/impedePosition radios all absent.
 *   4. Select `position`, submit. Assert:
 *      - `round.effects.pendingPosition[partyGroupId] = { amount:2,
 *        targetVolley:1 }` (combat.mjs L627-633).
 *      - `round.effects.pendingImpede` for the party group is NOT stamped
 *        (position-only combo).
 *      - `round.effects.maneuverSpends[0].spent === true` (L665-671).
 *   5. Resolve V0, reveal V1, roll charB's Attack. Roll message's
 *      `flags.tb2e.roll.modifiers` must include a Position entry with
 *      `type:"dice"`, `value:+2`, `source:"conflict"`.
 *   6. Final pool size reflects the +2D: baseDice=3 (fighter) + (-1 unarmed)
 *      + (+2 Position) = 4.
 *
 * -------------------------------------------------------------------
 * Why this spec is NOT `test.fixme`
 * -------------------------------------------------------------------
 * Every production hook is wired end-to-end:
 *   - Spend mailbox: maneuver-spend-dialog.mjs L265-271 writes
 *     `system.pendingManeuverSpend = { roundNum, volleyIndex, selection }`
 *     where selection.position=true for combo "position".
 *   - GM hook: combat.mjs L455-456 dispatches to `#applyManeuverSpend`
 *     which stamps `pendingPosition[groupId]` (L627-633) and clears the
 *     mailbox (L562-566).
 *   - Roll consumption: conflict-panel.mjs L1890-1898 reads pendingPosition
 *     for the ROLLING group (not the opponent's) with matching targetVolley
 *     and injects the +2D modifier into testContext.
 *   - Modifier persistence: tb2e-roll.mjs L1431 serializes allModifiers
 *     onto `flags.tb2e.roll.modifiers`.
 *
 * -------------------------------------------------------------------
 * Test fixture (deterministic)
 * -------------------------------------------------------------------
 *   Kill conflict. 4 characters, 2 per side.
 *     - Party captainA: health=3, fighter=3. V0 MANEUVER (rolls health,
 *       3 − 1 unarmed = 2D → 2 successes at u=0.001). V1 DEFEND (filler,
 *       not rolled — charB is the scripted combatant on V1).
 *     - Party charB: fighter=3. V1 scripted combatant for ATTACK (rolls
 *       fighter, 3 − 1 unarmed + 2 Position = 4D). V0 filler.
 *     - GM captainB: health=2, fighter=3. V0 DEFEND (rolls health,
 *       2 − 1 unarmed = 1D → 0 successes at u=0.5). V1 DEFEND filler.
 *     - GM charD: filler.
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

async function createFighterCharacter(page, { name, tag, fighter }) {
  return page.evaluate(
    async ({ n, t, f }) => {
      const actor = await Actor.implementation.create({
        name: n,
        type: 'character',
        flags: { tb2e: { e2eTag: t } },
        system: {
          abilities: {
            health: { rating: 2, pass: 0, fail: 0 },
            will:   { rating: 3, pass: 0, fail: 0 },
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

test.describe('§17 Conflict: Maneuver MoS — Position (+2D team next action)', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(async () => {
      if ( globalThis.__tb2eE2EPrevRandomUniform ) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
      // Defensive: close any lingering maneuver-spend dialog (same teardown
      // pattern as mos-impede.spec.mjs L144-156).
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
    'MoS 2 Position: dialog offers impede+position; +2D stamped on team next roll (SG p.69)',
    async ({ page }, testInfo) => {
      const tag = `e2e-mos-position-${testInfo.parallelIndex}-${Date.now()}`;
      const stamp = Date.now();
      const charAName = `E2E Position Captain A ${stamp}`;
      const charBName = `E2E Position Char B ${stamp}`;
      const charCName = `E2E Position Captain C ${stamp}`;
      const charDName = `E2E Position Char D ${stamp}`;

      await page.goto('/game');
      const ui = new GameUI(page);
      await ui.waitForReady();
      await ui.dismissTours();

      expect(await page.evaluate(() => game.user.isGM)).toBe(true);

      try {
        /* ---------- Arrange actors ---------- */

        // Party captainA (maneuverer): health=3 (for V0 maneuver: 3 − 1
        // unarmed = 2D → 2 successes at u=0.001).
        const captainAId = await createCaptainCharacter(page, {
          name: charAName, tag, health: 3, fighter: 3
        });
        // Party charB (V1 attacker — non-captain): fighter=3 (for V1 attack:
        // 3 − 1 unarmed + 2 Position = 4D). The point of rolling via charB
        // is to prove Position is team-wide: pendingPosition is keyed on
        // partyGroupId, so ANY party member rolling V1 consumes +2D —
        // including one who did not personally win the maneuver.
        const charBId = await createFighterCharacter(page, {
          name: charBName, tag, fighter: 3
        });
        // GM captainB: health=2 for V0 defend (2 − 1 unarmed = 1D → 0 at u=0.5).
        const captainBId = await createCaptainCharacter(page, {
          name: charCName, tag, health: 2, fighter: 3
        });
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
        cmb.charB = await panel.addCombatant({
          combatId, actorId: charBId, groupId: partyGroupId
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
          cId2: cmb.charB,
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
        }, { cId: combatId, ids: [cmb.captainA, cmb.charB, cmb.captainB, cmb.charD] });

        await expect(panel.beginScriptingButton).toBeEnabled();
        await panel.clickBeginScripting();

        /* ---------- Scripting ---------- */

        // V0: party MANEUVER by captainA (1D after −1 unarmed → 2 successes
        //      via health=3) vs GM DEFEND by captainB (1D → 0 successes).
        // V1: party ATTACK by CHARB (non-captain, to prove team-wide
        //      Position: fighter=3 → 3 − 1 unarmed + 2 Position = 4D) vs
        //      GM DEFEND by captainB (filler — this spec does not roll the
        //      GM side on V1).
        // V2: filler.
        const partyActions = [
          { action: 'maneuver', combatantId: cmb.captainA },
          { action: 'attack',   combatantId: cmb.charB },
          { action: 'defend',   combatantId: cmb.captainA }
        ];
        const gmActions = [
          { action: 'defend',   combatantId: cmb.captainB },
          { action: 'defend',   combatantId: cmb.captainB },
          { action: 'defend',   combatantId: cmb.captainB }
        ];
        /* ---------- Script + lock + resolve ---------- */

        await scriptAndLockActions(page, {
          combatId, partyGroupId, gmGroupId, partyActions, gmActions
        });

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

        /* ---------- V0 party Maneuver roll (captainA, initiator) ---------- */

        // Stub PRNG → all-6s. captainA health=3 − 1 unarmed = 2D → 2 successes.
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

        /* ---------- Versus resolution — margin 2 ---------- */

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

        // Maneuverer wins by exactly 2.
        expect(await resolution.initiatorIsWinner()).toBe(true);
        const iSuccesses = await resolution.getInitiatorSuccesses();
        const oSuccesses = await resolution.getOpponentSuccesses();
        const margin = iSuccesses - oSuccesses;
        expect(margin).toBe(2);

        // Resolution card carries the MoS-2 spend payload.
        const resFlags = await page.evaluate((mid) => {
          const msg = game.messages.get(mid);
          return msg?.flags?.tb2e?.maneuverSpend ?? null;
        }, resolutionMessageId);
        expect(resFlags).toEqual({
          margin: 2,
          combatId,
          combatantId: cmb.captainA,
          groupId: partyGroupId,
          opponentGroupId: gmGroupId,
          roundNum: 1,
          volleyIndex: 0
        });

        /* ---------- Open spend dialog — MoS 2 → impede OR position ---------- */

        const spendBtn = resolution.root.locator(
          'button[data-action="spend-maneuver"]'
        );
        await expect(spendBtn).toBeVisible();
        await spendBtn.evaluate((btn) => btn.click());

        const spendDialog = new ManeuverSpendDialog(page);
        await spendDialog.waitForOpen();

        // MoS 2 offers impede OR position (SPEND_COMBINATIONS[2] — maneuver-
        // spend-dialog.mjs L15-18). No disarm/rearm/impedePosition at MoS=2.
        await expect(spendDialog.combos).toHaveCount(2);
        await expect(spendDialog.comboRadio('impede')).toHaveCount(1);
        await expect(spendDialog.comboRadio('position')).toHaveCount(1);
        await expect(spendDialog.comboRadio('disarm')).toHaveCount(0);
        await expect(spendDialog.comboRadio('rearm')).toHaveCount(0);
        await expect(spendDialog.comboRadio('impedePosition')).toHaveCount(0);

        /* ---------- Select Position, submit ---------- */

        await spendDialog.selectCombo('position');
        await spendDialog.submit();
        // Dialog closes synchronously via `this.close()` in the submit
        // handler (maneuver-spend-dialog.mjs L287).
        await expect(spendDialog.root).toHaveCount(0);

        // GM hook `#applyManeuverSpend` (combat.mjs L559-699) processes the
        // mailbox: stamps `pendingPosition[groupId]` (keyed on the winner's
        // OWN group — combat.mjs L627-633), marks the source volley as spent
        // (L665-671). Note: impede is NOT stamped for position-only combo
        // (selection.impede=false → L619-625 branch skipped).
        //
        // Mailbox quirk — see mos-impede.spec.mjs L512-522: ObjectField merge
        // semantics leave a stale `selection` on `system.pendingManeuverSpend`
        // after clear, but the `spent` gate (combat.mjs L588) makes re-entry
        // idempotent. Assert on the functional outcomes.
        await expect
          .poll(
            () => page.evaluate(({ cId, pId, gId }) => {
              const c = game.combats.get(cId);
              const round = c?.system.rounds?.[c.system.currentRound];
              return {
                pendingPosition: round?.effects?.pendingPosition?.[pId] ?? null,
                pendingImpedeOnGm: round?.effects?.pendingImpede?.[gId] ?? null,
                spent: round?.effects?.maneuverSpends?.[0]?.spent ?? null
              };
            }, {
              cId: combatId, pId: partyGroupId, gId: gmGroupId
            }),
            { timeout: 10_000 }
          )
          .toEqual({
            pendingPosition: { amount: 2, targetVolley: 1 },
            pendingImpedeOnGm: null,
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
        // pendingPosition entry targeting volley 1. `consumeResolvedManeuver-
        // Effects` (combat.mjs L707-720) only clears entries whose
        // `targetVolley === just-resolved volleyIndex` — V0 resolve must
        // leave `pendingPosition[partyGroupId]` intact (targetVolley=1).
        const positionStillPresent = await page.evaluate(({ cId, pId }) => {
          const c = game.combats.get(cId);
          const round = c?.system.rounds?.[c.system.currentRound];
          return round?.effects?.pendingPosition?.[pId] ?? null;
        }, { cId: combatId, pId: partyGroupId });
        expect(positionStillPresent).toEqual({ amount: 2, targetVolley: 1 });

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

        /* ---------- V1 Party Attack roll (charB) — Position must apply ---------- */

        // PRNG stays stubbed; we only care about the pool size / modifiers
        // list on the resulting message. The V1 roll button is the party
        // group's button (data-group-id=partyGroupId) — the template renders
        // it wired to the scripted combatant (charB) via `data-combatant-id`
        // (panel-resolve.hbs L103-108).
        const v1RollBtn = panel
          .resolveAction(1)
          .locator(`button[data-action="rollAction"][data-group-id="${partyGroupId}"]`);
        await expect(v1RollBtn).toBeVisible();
        // Sanity: the rolling combatant for V1 is charB, not captainA — this
        // is what proves "team-wide" Position (pendingPosition keyed on
        // partyGroupId applies to any member of that group).
        expect(await v1RollBtn.getAttribute('data-combatant-id')).toBe(cmb.charB);
        await v1RollBtn.click();

        const v1Dialog = new RollDialog(page);
        await v1Dialog.waitForOpen();

        // Pool before dialog submit: fighter=3 − 1 unarmed + 2 Position = 4.
        // `poolSize` input reflects `baseDice` (unarmed is `timing:"pre"`);
        // the summary parser pulls the final pool number. See RollDialog POM
        // L145-150.
        const v1Summary = await v1Dialog.getSummaryPool();
        expect(v1Summary).toBe(4);

        // Assert the Position modifier row is present in the dialog BEFORE
        // submit (rendered from testContext.modifiers — tb2e-roll.mjs
        // L1255-1258). Label from `TB2E.Conflict.Maneuver.Position` in
        // lang/en.json (matches the localize call at conflict-panel.mjs
        // L1893).
        const positionRow = v1Dialog.modifierRows.filter({
          hasText: /Position/i
        });
        await expect(positionRow).toHaveCount(1);

        await v1Dialog.submit();

        // Roll message carries modifiers list including the Position +2D.
        // V1 is party ATTACK vs GM DEFEND → versus interaction → charB's
        // roll is an initiator versus message (versus/testContext flags).
        // Filter by conflictAction=attack + volleyIndex=1 + charB's actorId
        // to avoid races with the V0 versus cards still on the board.
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
        }, charBId);
        expect(v1MessageId).toBeTruthy();

        const v1Flags = await page.evaluate((mid) => {
          const msg = game.messages.get(mid);
          const r = msg?.flags?.tb2e?.roll;
          if ( !r ) return null;
          // Position is a `source:"conflict", type:"dice", value:+2` modifier.
          const position = (r.modifiers || []).find(
            (m) => m.source === 'conflict' && m.type === 'dice' && m.value === 2
              && /Position/i.test(m.label || '')
          );
          return {
            baseDice: r.baseDice ?? null,
            poolSize: r.poolSize ?? null,
            position: position
              ? { type: position.type, value: position.value, source: position.source }
              : null
          };
        }, v1MessageId);
        // baseDice reflects the pre-pre-mod pool (fighter rating=3).
        // poolSize is the final effective pool:
        //   3 (fighter) − 1 (unarmed) + 2 (Position) = 4.
        expect(v1Flags.baseDice).toBe(3);
        expect(v1Flags.poolSize).toBe(4);
        expect(v1Flags.position).toEqual({
          type: 'dice', value: 2, source: 'conflict'
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
