import { test, expect } from '../test.mjs';
import { scriptAndLockActions } from '../helpers/conflict-scripting.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { VersusPendingCard, VersusResolutionCard } from '../pages/VersusCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §18 Conflict: HP & KO — HP damage reduces loser by margin
 * (TEST_PLAN L500, DH pp.120-127, SG p.69).
 *
 * Rules under test:
 *   - DH pp.120-127: resolving a versus Attack vs Defend, the winner
 *     deals damage equal to margin of success. The loser's disposition
 *     pool (tracked as `combatant.actor.system.conflict.hp.value` per
 *     combatant — CLAUDE.md §Unlinked Actors gotcha: always read from
 *     `combatant.actor`) is reduced by that margin.
 *   - `resolveActionEffect` (module/dice/conflict-roll.mjs L155-178)
 *     already returns `{ type: "damage", amount: margin }` for attack
 *     and feint actions, and `{ type: "restore", amount: margin }` for
 *     a versus-winning defend.
 *   - Checkbox (TEST_PLAN L500): "losing action reduces HP by margin;
 *     `combatant.actor.system.conflict.hp.value` updated".
 *
 * -------------------------------------------------------------------
 * Production gap — why this spec is `test.fixme`
 * -------------------------------------------------------------------
 * This is the canonical HP-auto-write checkbox. The gap was first
 * identified by TEST_PLAN L453 (resolve-attack-vs-defend.spec.mjs)
 * and re-evidenced at L455/L456/L457: the resolve pipeline (reveal →
 * roll versus → finalize → mark resolved) is fully wired, but
 * **nothing auto-applies damage to the loser's HP**. The diagnostic
 * verbatim from L453 (still current as of this spec):
 *
 *   > `resolveActionEffect` (conflict-roll.mjs L155-178) correctly
 *   > computes `{type:"damage", amount:margin}` for attacks but is
 *   > imported as dead code at `conflict-panel.mjs:3` — no call site
 *   > consumes it. HP writes only happen via manual GM roster input
 *   > (conflict-panel.mjs L341-360), `pendingConflictHP` mailbox
 *   > (tb2e.mjs L193-204), or initial distribution
 *   > (combat.mjs L219-242).
 *
 * Re-confirmed on this spec's writing pass:
 *   - conflict-panel.mjs L1-5: `resolveActionEffect` imported, unused.
 *   - versus.mjs `_executeVersusResolution` (L137-267): posts
 *     resolution card with `winnerId`/margin but does not write HP.
 *   - conflict-panel.mjs `#onResolveAction` (L2003-2096): writes
 *     `round.volleys[i].result` via `combat.resolveVolley`, reads
 *     current HP for the round-summary card at L2067-2077 (telling:
 *     it assumes HP already reflects the volley outcome), but never
 *     mutates HP itself.
 *
 * **Scope of this spec vs L453:** L453 asserts the resolve pipeline
 * mechanics (reveal card, roll-card metadata, resolution-card winner
 * id, auto-advance) AND duplicates the HP-reduction assertion under
 * the same fixme. This spec (§18 L500) owns the HP-reduction
 * assertion exclusively — it is the canonical place to flip to green
 * when the gap closes. L453 remains fixmed in parallel until then.
 *
 * -------------------------------------------------------------------
 * Fix shape (same as L453 header)
 * -------------------------------------------------------------------
 * Natural hook: end of `_executeVersusResolution` (versus.mjs) — both
 * paired roll messages carry conflict testContext (isConflict,
 * conflictAction, combatId, combatantId, groupId, opponentGroupId
 * per conflict-panel.mjs L1983-1993). Walk combatants on the
 * loser-group (for attack/feint damage) or winner-group (for
 * defend-restore, SG p.69 "restore MoS"), call `resolveActionEffect`
 * with the winner's action + margin, and apply via the
 * `pendingConflictHP` mailbox (CLAUDE.md §Mailbox Pattern) so
 * non-GM writers work. Alternately wire in `#onResolveAction`
 * (conflict-panel.mjs L2003+) by reading the paired resolution-card
 * flag.
 *
 * When that lands:
 *   - Drop `test.fixme` here AND at L453.
 *   - Flip TEST_PLAN L500 + L453 to `- [x]` with citations.
 *
 * -------------------------------------------------------------------
 * Test fixture (deterministic, narrower than L453)
 * -------------------------------------------------------------------
 *   Kill conflict (config.mjs L205-211 — attack=skill:fighter,
 *   defend=ability:health). Two characters per side, all unarmed.
 *
 *   Party captain: fighter=3, health=4. Scripts ATTACK on volley 0.
 *   GM captain: fighter=2, health=2. Scripts DEFEND on volley 0.
 *     (Both sides are characters here — not a monster — so both roll
 *      their configured ability/skill, unmarried from monster Nature
 *      override (conflict-roll.mjs L49-53). This keeps the pool math
 *      explicit: GM captain rolls health=2, not Nature.)
 *
 *   Disposition distribution: party captain HP=4, GM captain HP=4.
 *   This is the "before" snapshot — the auto-write should drop GM
 *   captain to HP=2 (4 − margin 2).
 *
 *   PRNG stubs:
 *     - u=0.001 → Math.ceil((1-u)*6) = 6 — all successes.
 *     - u=0.5  → Math.ceil((1-u)*6) = 3 — all wyrms (0 successes).
 *
 *   Sequence for volley 0 (attack vs defend, versus):
 *     1. Stub PRNG → all-6s. Party captain rolls Attack (fighter=3
 *        − 1 unarmed = 2D → 2 successes).
 *     2. Finalize initiator card.
 *     3. Stub PRNG → all-3s. GM captain rolls Defend (health=2 − 1
 *        unarmed = 1D → 0 successes).
 *     4. Finalize opponent card → `_executeVersusResolution` posts
 *        resolution card: winner = party captain, margin = 2.
 *     5. **EXPECTED (fixme):** GM captain's
 *        `combatant.actor.system.conflict.hp.value` drops from 4 to
 *        2 (i.e. 4 − margin).
 *     6. **EXPECTED (fixme):** party captain's HP untouched at 4
 *        (no cascade — attack vs defend damage is one-directional
 *        per SG p.69 / DH p.123).
 *
 * Scope (narrow — TEST_PLAN L500 only):
 *   - Only asserts the HP-write half. Pipeline mechanics (reveal
 *     card, winnerId, auto-advance) are L453's scope.
 *   - Only one volley. Mailbox variant (player-side write) is L501.
 *     KO-at-zero is L502. Synthetic-token parity is L505.
 *
 * All Playwright sessions authenticate as GM (auth.setup.mjs L14-35).
 */

async function createCharacter(page, { name, tag, fighter, health }) {
  return page.evaluate(
    async ({ n, t, f, h }) => {
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
    { n: name, t: tag, f: fighter, h: health }
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

test.describe('§18 Conflict: HP & KO — damage reduces loser HP', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => {
      if ( globalThis.__tb2eE2EPrevRandomUniform ) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
      try { game.tb2e?.conflictPanel?.close(); } catch {}
    });
    await page.evaluate(async () => {
      const ids = Array.from(game.combats ?? []).map((c) => c.id);
      if ( ids.length ) await Combat.deleteDocuments(ids);
    });
  });

  test(
    'Attack vs Defend: loser HP reduced by margin of success (DH pp.120-127, SG p.69)',
    async ({ page }, testInfo) => {
      const tag = `e2e-hp-damage-${testInfo.parallelIndex}-${Date.now()}`;
      const stamp = Date.now();
      const partyCaptainName = `E2E HP Party Captain ${stamp}`;
      const partyCharBName = `E2E HP Party B ${stamp}`;
      const gmCaptainName = `E2E HP GM Captain ${stamp}`;
      const gmCharBName = `E2E HP GM B ${stamp}`;

      await page.goto('/game');
      const ui = new GameUI(page);
      await ui.waitForReady();
      await ui.dismissTours();

      // Reveal/roll/resolve handlers gate on isGM (conflict-panel.mjs
      // L1796/L1847/L2003); harness is GM-only per auth.setup.mjs
      // L14-35.
      expect(await page.evaluate(() => game.user.isGM)).toBe(true);

      try {
        /* ---------- Arrange actors ---------- */

        const partyCaptainId = await createCharacter(page, {
          name: partyCaptainName, tag, fighter: 3, health: 4
        });
        const partyCharBId = await createCharacter(page, {
          name: partyCharBName, tag, fighter: 2, health: 3
        });
        const gmCaptainId = await createCharacter(page, {
          name: gmCaptainName, tag, fighter: 2, health: 2
        });
        const gmCharBId = await createCharacter(page, {
          name: gmCharBName, tag, fighter: 2, health: 3
        });

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
        cmb.partyCaptain = await panel.addCombatant({
          combatId, actorId: partyCaptainId, groupId: partyGroupId
        });
        cmb.partyCharB = await panel.addCombatant({
          combatId, actorId: partyCharBId, groupId: partyGroupId
        });
        cmb.gmCaptain = await panel.addCombatant({
          combatId, actorId: gmCaptainId, groupId: gmGroupId
        });
        cmb.gmCharB = await panel.addCombatant({
          combatId, actorId: gmCharBId, groupId: gmGroupId
        });
        await expect(panel.setupCombatants).toHaveCount(4);

        await panel.clickCaptainButton(cmb.partyCaptain);
        await panel.clickCaptainButton(cmb.gmCaptain);
        await panel.selectConflictType('kill');

        await expect(panel.beginDispositionButton).toBeEnabled();
        await panel.clickBeginDisposition();

        /* ---------- Disposition: flat-set both sides ---------- */

        await page.evaluate(async ({ cId, pId, gId }) => {
          const c = game.combats.get(cId);
          await c.storeDispositionRoll(pId, {
            rolled: 7, diceResults: [], cardHtml: '<em>E2E</em>'
          });
          await c.storeDispositionRoll(gId, {
            rolled: 6, diceResults: [], cardHtml: '<em>E2E</em>'
          });
        }, { cId: combatId, pId: partyGroupId, gId: gmGroupId });

        // distributeDisposition writes
        // `combatant.actor.system.conflict.hp = { value, max }` per
        // combatant (combat.mjs L219-242). This is the field the
        // auto-write under test must mutate.
        await page.evaluate(async ({ cId, pId, gId, pCapId, pBId, gCapId, gBId }) => {
          const c = game.combats.get(cId);
          const party = {}; party[pCapId] = 4; party[pBId] = 3;
          const gm = {};    gm[gCapId]   = 4; gm[gBId]    = 2;
          await c.distributeDisposition(pId, party);
          await c.distributeDisposition(gId, gm);
        }, {
          cId: combatId,
          pId: partyGroupId,
          gId: gmGroupId,
          pCapId: cmb.partyCaptain,
          pBId: cmb.partyCharB,
          gCapId: cmb.gmCaptain,
          gBId: cmb.gmCharB
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
          ids: [cmb.partyCaptain, cmb.partyCharB, cmb.gmCaptain, cmb.gmCharB]
        });

        await expect(panel.beginScriptingButton).toBeEnabled();
        await panel.clickBeginScripting();

        /* ---------- Scripting: attack vs defend on volley 0 ---------- */

        const partyActions = [
          { action: 'attack', combatantId: cmb.partyCaptain },
          { action: 'defend', combatantId: cmb.partyCharB  },
          { action: 'feint',  combatantId: cmb.partyCaptain }
        ];
        const gmActions = [
          { action: 'defend', combatantId: cmb.gmCaptain },
          { action: 'attack', combatantId: cmb.gmCharB  },
          { action: 'defend', combatantId: cmb.gmCaptain }
        ];
        /* ---------- Script + lock + resolve ---------- */

        await scriptAndLockActions(page, {
          combatId, partyGroupId, gmGroupId, partyActions, gmActions
        });

        expect(await page.evaluate(({ cId }) => {
          const c = game.combats.get(cId);
          return c.getVolleyInteraction(0);
        }, { cId: combatId })).toBe('versus');

        await expect.poll(() => panel.activeTabId()).toBe('resolve');

        // Pre-resolve HP snapshot — read off `combatant.actor`
        // (CLAUDE.md §Unlinked Actors: always use combatant.actor, not
        // game.actors.get(combatant.actorId); characters here are
        // linked actors but the rule holds uniformly).
        const hpBefore = await page.evaluate(({ cId, pCapCmbId, gCapCmbId }) => {
          const c = game.combats.get(cId);
          const pc = c.combatants.get(pCapCmbId);
          const gc = c.combatants.get(gCapCmbId);
          return {
            partyCaptain: pc?.actor?.system.conflict?.hp?.value ?? null,
            gmCaptain:    gc?.actor?.system.conflict?.hp?.value ?? null
          };
        }, {
          cId: combatId,
          pCapCmbId: cmb.partyCaptain,
          gCapCmbId: cmb.gmCaptain
        });
        expect(hpBefore).toEqual({ partyCaptain: 4, gmCaptain: 4 });

        /* ---------- Reveal volley 0 ---------- */

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

        /* ---------- Roll party Attack (initiator) ---------- */

        // PRNG all-6s. fighter=3, -1 unarmed = 2D → 2 successes.
        await page.evaluate(() => {
          globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
          CONFIG.Dice.randomUniform = () => 0.001;
        });

        const attackRollBtn = panel
          .resolveAction(0)
          .locator(`button[data-action="rollAction"][data-group-id="${partyGroupId}"]`);
        await expect(attackRollBtn).toBeVisible();
        await attackRollBtn.click();

        const attackDialog = new RollDialog(page);
        await attackDialog.waitForOpen();
        expect(await attackDialog.modeInput.inputValue()).toBe('versus');
        await attackDialog.submit();

        const attackMessageId = await page.evaluate(async (actorId) => {
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
        }, partyCaptainId);
        expect(attackMessageId).toBeTruthy();

        await page.evaluate(() =>
          ui.sidebar?.changeTab?.('chat', 'primary')
        );
        const attackCard = new VersusPendingCard(page, attackMessageId);
        await attackCard.expectPresent();
        await attackCard.clickFinalize();
        await expect(attackCard.resolvedBanner).toBeVisible();

        /* ---------- Roll GM Defend (opponent) ---------- */

        // PRNG all-3s (all wyrms). health=2 − 1 unarmed = 1D → 0
        // successes.
        await page.evaluate(() => {
          CONFIG.Dice.randomUniform = () => 0.5;
        });

        await page.evaluate(() =>
          ui.sidebar?.changeTab?.('combat', 'primary')
        );
        const defendRollBtn = panel
          .resolveAction(0)
          .locator(`button[data-action="rollAction"][data-group-id="${gmGroupId}"]`);
        await expect(defendRollBtn).toBeVisible();
        await defendRollBtn.click();

        const defendDialog = new RollDialog(page);
        await defendDialog.waitForOpen();
        expect(await defendDialog.modeInput.inputValue()).toBe('versus');

        const challengeSelect = defendDialog.root.locator(
          'select[name="challengeMessageId"]'
        );
        await expect(challengeSelect).toHaveCount(1);
        await expect(
          challengeSelect.locator(`option[value="${attackMessageId}"]`)
        ).toHaveCount(1);
        await challengeSelect.selectOption(attackMessageId);
        await defendDialog.submit();

        const defendMessageId = await page.evaluate(async ({ mId }) => {
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
        }, { mId: attackMessageId });
        expect(defendMessageId).toBeTruthy();

        await page.evaluate(() =>
          ui.sidebar?.changeTab?.('chat', 'primary')
        );
        const defendCard = new VersusPendingCard(page, defendMessageId);
        await defendCard.expectPresent();
        await defendCard.clickFinalize();

        /* ---------- Resolution: attacker wins, margin = 2 ---------- */

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
        }, { aId: attackMessageId, dId: defendMessageId });
        expect(resolutionMessageId).toBeTruthy();

        const resolution = new VersusResolutionCard(page, resolutionMessageId);
        await resolution.expectPresent();
        expect(await resolution.initiatorIsWinner()).toBe(true);
        expect(await resolution.getWinnerName()).toBe(partyCaptainName);

        const iSuccesses = await resolution.getInitiatorSuccesses();
        const oSuccesses = await resolution.getOpponentSuccesses();
        expect(iSuccesses).toBeGreaterThan(oSuccesses);
        const margin = iSuccesses - oSuccesses;
        expect(margin).toBe(2);

        /* ---------- EXPECTED (fixme) HP ASSERTIONS ---------- */

        // This is the canonical HP-auto-write checkbox (TEST_PLAN
        // L500). Once the production gap (see header "Production gap")
        // is closed, the following assertions should pass: the loser's
        // combatant.actor.system.conflict.hp.value is reduced by
        // exactly `margin`, and the winner's is untouched (attack vs
        // defend damage is one-directional per SG p.69 / DH p.123).
        const hpAfter = await page.evaluate(({ cId, pCapCmbId, gCapCmbId }) => {
          const c = game.combats.get(cId);
          const pc = c.combatants.get(pCapCmbId);
          const gc = c.combatants.get(gCapCmbId);
          return {
            partyCaptain: pc?.actor?.system.conflict?.hp?.value ?? null,
            gmCaptain:    gc?.actor?.system.conflict?.hp?.value ?? null
          };
        }, {
          cId: combatId,
          pCapCmbId: cmb.partyCaptain,
          gCapCmbId: cmb.gmCaptain
        });

        // Attacker HP untouched by a versus Attack vs Defend (only
        // the defender — the loser — takes damage; SG p.69 /
        // DH p.123). No cascade.
        expect(hpAfter.partyCaptain).toBe(4);

        // Defender (loser) HP reduced by margin — the checkbox's
        // literal requirement. 4 − 2 = 2.
        expect(hpAfter.gmCaptain).toBe(hpBefore.gmCaptain - margin);
        expect(hpAfter.gmCaptain).toBe(2);

        // Clean up PRNG before afterEach runs.
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
