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
 * §17 Conflict: Maneuver MoS Spends — Impede+Disarm combo (TEST_PLAN L483,
 * SG p.69).
 *
 * Rules under test (SG p.69):
 *   - Winner of a Maneuver may spend 4 MoS on the combined "Impede and
 *     Disarm" effect (maneuver-spend-dialog.mjs L25-32 SPEND_COMBINATIONS[4]
 *     → `{ key:"impedeDisarm", cost:4, impede:true, disarm:true }` at L30).
 *   - This is a single spend that applies BOTH effects: -1D on the opponent's
 *     next action (the Impede half) AND removal of a weapon/gear/trait item
 *     (the Disarm half). Position is NOT part of this combo.
 *
 * `#applyManeuverSpend` (combat.mjs L559-699) has no dedicated `impedeDisarm`
 * branch — it simply evaluates `selection.impede` and `selection.disarm`
 * independently, so with both truthy it runs both application branches in
 * sequence:
 *   - Impede → stamps `round.effects.pendingImpede[opponentGroupId] =
 *     { amount:1, targetVolley }` (combat.mjs L619-624).
 *   - Disarm (weapon) → pushes onto `target.system.disabledItemIds`
 *     (L643-647), drops into `combat.system.droppedWeapons[opponentGroupId]`
 *     if weaponId matches (L650-659), calls `setWeapon(targetId, "", "")`
 *     post-update (L676-678 → L268-274) to clear both the combatant's
 *     `system.weapon`/`weaponId` and the actor mirror
 *     `system.conflict.weapon`/`weaponId`.
 *   - `round.effects.maneuverSpends[0].spent = true` (L665-671).
 *   - Position branch skipped (`selection.position` is undefined/false) so
 *     `pendingPosition[groupId]` stays absent.
 *
 * -------------------------------------------------------------------
 * What this spec verifies (narrow — TEST_PLAN L483 only)
 * -------------------------------------------------------------------
 *   1. Stage Kill conflict. Both captains ARMED with real weapon Items:
 *      party captainA so the 4D maneuver pool has no unarmed -1D penalty,
 *      GM captainB because its weapon is the disarm target.
 *   2. Party captainA MANEUVERS (rolls health=4, armed → 4D → 4 successes
 *      at u=0.001) vs GM captainB DEFENDS (rolls health=2, armed → 2D → 0
 *      successes at u=0.5). margin = 4.
 *   3. Spend dialog opens with 6 combos (SPEND_COMBINATIONS[4] at maneuver-
 *      spend-dialog.mjs L25-32): impede, position, impedePosition, disarm,
 *      impedeDisarm, rearm. Assert `impedeDisarm` is present.
 *   4. Select `impedeDisarm`. Dialog reveals the disarm-target `<select>`
 *      (radio-change listener at maneuver-spend-dialog.mjs L200-206 toggles
 *      `[data-combo-section="disarm"]` via the `combo.disarm` flag) — the
 *      rearm section stays hidden (this combo doesn't include rearm).
 *   5. Pick the GM captain's weapon from the dropdown, submit.
 *   6. Assert BOTH effects applied in a single post-spend poll:
 *      - Impede: `round.effects.pendingImpede[gmGroupId] = { amount:1,
 *        targetVolley:1 }` (combat.mjs L619-624).
 *      - Disarm: `target.system.disabledItemIds` contains `gmWeaponItemId`,
 *        `target.system.weaponId`/`weapon` cleared, actor mirror
 *        `system.conflict.weaponId`/`weapon` cleared, and
 *        `combat.system.droppedWeapons[gmGroupId]` contains an entry with
 *        `{ itemId, itemName, sourceCombatantId: captainB }`
 *        (combat.mjs L650-659).
 *      - `round.effects.maneuverSpends[0].spent === true` (L665-671).
 *      - Position NOT applied: `pendingPosition[partyGroupId]` absent
 *        (combo is impede+disarm, not position).
 *
 * -------------------------------------------------------------------
 * Why this spec is NOT `test.fixme`
 * -------------------------------------------------------------------
 * Every production hook is wired end-to-end — this spec is the compositional
 * product of mos-impede.spec.mjs (L478) and mos-disarm-weapon.spec.mjs
 * (L480). Both individual specs are green; #applyManeuverSpend's non-
 * branched selection evaluation guarantees their composition works.
 *
 * -------------------------------------------------------------------
 * Test fixture (deterministic)
 * -------------------------------------------------------------------
 *   Kill conflict. 4 characters, 2 per side.
 *     - Party captainA: health=4, fighter=3. Holds weapon "E2E Party Blade".
 *       V0 MANEUVER rolls health, armed → 4D → 4 successes at u=0.001.
 *     - GM captainB: health=2, fighter=3. Holds weapon "E2E GM Blade" —
 *       disarm target. V0 DEFEND rolls health, armed → 2D → 0 successes
 *       at u=0.5.
 *     - Party charC, GM charD: filler (unarmed placeholders).
 *
 *   PRNG stubs:
 *     - u=0.001 → 6 (all successes).
 *     - u=0.5  → 3 (all wyrms).
 */

async function createCaptainWithWeapon(page, { name, tag, health, fighter, weaponName }) {
  return page.evaluate(
    async ({ n, t, h, f, wn }) => {
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
      const [item] = await actor.createEmbeddedDocuments('Item', [{
        name: wn,
        type: 'weapon',
        system: {
          slot: '',
          slotIndex: 0,
          slotOptions: { wornHand: 1, carried: 1 }
        }
      }]);
      return { actorId: actor.id, weaponItemId: item.id };
    },
    { n: name, t: tag, h: health, f: fighter, wn: weaponName }
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

test.describe('§17 Conflict: Maneuver MoS — Impede+Disarm combo (4 MoS)', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(async () => {
      if ( globalThis.__tb2eE2EPrevRandomUniform ) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
      // Defensive: close any lingering maneuver-spend dialog (same teardown
      // pattern as mos-impede.spec.mjs L144-156 / mos-disarm-weapon.spec.mjs
      // L164-175).
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
    'MoS 4 Impede+Disarm: both effects applied in a single spend (SG p.69)',
    async ({ page }, testInfo) => {
      const tag = `e2e-mos-impede-disarm-${testInfo.parallelIndex}-${Date.now()}`;
      const stamp = Date.now();
      const charAName = `E2E ImpedeDisarm Captain A ${stamp}`;
      const charBName = `E2E ImpedeDisarm Captain B ${stamp}`;
      const charCName = `E2E ImpedeDisarm Char C ${stamp}`;
      const charDName = `E2E ImpedeDisarm Char D ${stamp}`;
      const partyWeaponName = `E2E Party Blade ${stamp}`;
      const gmWeaponName = `E2E GM Blade ${stamp}`;

      await page.goto('/game');
      const ui = new GameUI(page);
      await ui.waitForReady();
      await ui.dismissTours();

      expect(await page.evaluate(() => game.user.isGM)).toBe(true);

      try {
        /* ---------- Arrange actors ---------- */

        // Party captainA: armed (so no unarmed -1D). health=4 → 4D maneuver
        // pool → 4 successes at u=0.001. We need exactly margin=4 (not more,
        // not less) to surface the impedeDisarm combo on SPEND_COMBINATIONS[4].
        const { actorId: captainAId, weaponItemId: partyWeaponItemId } =
          await createCaptainWithWeapon(page, {
            name: charAName, tag, health: 4, fighter: 3,
            weaponName: partyWeaponName
          });
        // GM captainB: armed — the weapon we disarm. health=2 → 2D defend
        // pool → 0 successes at u=0.5.
        const { actorId: captainBId, weaponItemId: gmWeaponItemId } =
          await createCaptainWithWeapon(page, {
            name: charBName, tag, health: 2, fighter: 3,
            weaponName: gmWeaponName
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

        /* ---------- Weapons: captains armed, filler unarmed ---------- */

        await page.evaluate(async ({ cId, caps, fillers }) => {
          const c = game.combats.get(cId);
          for ( const { id, name, wid } of caps ) {
            await c.setWeapon(id, name, wid);
          }
          for ( const id of fillers ) {
            await c.setWeapon(id, 'Fists', '__unarmed__');
          }
        }, {
          cId: combatId,
          caps: [
            { id: cmb.captainA, name: partyWeaponName, wid: partyWeaponItemId },
            { id: cmb.captainB, name: gmWeaponName,    wid: gmWeaponItemId }
          ],
          fillers: [cmb.charC, cmb.charD]
        });

        await expect(panel.beginScriptingButton).toBeEnabled();
        await panel.clickBeginScripting();

        /* ---------- Scripting ---------- */

        // V0: party MANEUVER by captainA (health=4 armed → 4D → 4 successes)
        //     vs GM DEFEND by captainB (health=2 armed → 2D → 0 successes).
        // V1/V2: filler DEFEND on both sides — not rolled in this spec.
        const partyActions = [
          { action: 'maneuver', combatantId: cmb.captainA },
          { action: 'defend',   combatantId: cmb.captainA },
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

        // Stub PRNG → all-6s. captainA armed → 4D → 4 successes.
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

        // Swap PRNG → all-3s. captainB armed → 2D → 0 successes.
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

        /* ---------- Versus resolution — margin 4 ---------- */

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

        // Maneuverer wins by exactly 4 — the cost of the impedeDisarm combo.
        expect(await resolution.initiatorIsWinner()).toBe(true);
        const iSuccesses = await resolution.getInitiatorSuccesses();
        const oSuccesses = await resolution.getOpponentSuccesses();
        const margin = iSuccesses - oSuccesses;
        expect(margin).toBe(4);

        // Resolution card carries the MoS-4 spend payload (versus.mjs L174-182).
        const resFlags = await page.evaluate((mid) => {
          const msg = game.messages.get(mid);
          return msg?.flags?.tb2e?.maneuverSpend ?? null;
        }, resolutionMessageId);
        expect(resFlags).toEqual({
          margin: 4,
          combatId,
          combatantId: cmb.captainA,
          groupId: partyGroupId,
          opponentGroupId: gmGroupId,
          roundNum: 1,
          volleyIndex: 0
        });

        /* ---------- Open spend dialog — MoS 4 → 6 combos ---------- */

        const spendBtn = resolution.root.locator(
          'button[data-action="spend-maneuver"]'
        );
        await expect(spendBtn).toBeVisible();
        await spendBtn.evaluate((btn) => btn.click());

        const spendDialog = new ManeuverSpendDialog(page);
        await spendDialog.waitForOpen();

        // MoS 4 offers all 6 combos (SPEND_COMBINATIONS[4] — maneuver-spend-
        // dialog.mjs L25-32): impede, position, impedePosition, disarm,
        // impedeDisarm, rearm.
        await expect(spendDialog.combos).toHaveCount(6);
        await expect(spendDialog.comboRadio('impede')).toHaveCount(1);
        await expect(spendDialog.comboRadio('position')).toHaveCount(1);
        await expect(spendDialog.comboRadio('impedePosition')).toHaveCount(1);
        await expect(spendDialog.comboRadio('disarm')).toHaveCount(1);
        await expect(spendDialog.comboRadio('impedeDisarm')).toHaveCount(1);
        await expect(spendDialog.comboRadio('rearm')).toHaveCount(1);

        /* ---------- Select impedeDisarm, choose GM captain's weapon ---------- */

        // impedeDisarm sets `combo.disarm=true` (maneuver-spend-dialog.mjs
        // L30) so the radio-change listener at L200-206 unhides the
        // `[data-combo-section="disarm"]` block (L192). rearm section stays
        // hidden because `combo.rearm` is falsy.
        await spendDialog.selectCombo('impedeDisarm');
        await expect(spendDialog.disarmSection).toBeVisible();
        await expect(spendDialog.rearmSection).toBeHidden();

        // Sanity: GM captain's weapon option is present; spender (captainA)
        // is excluded by the opponents-only filter (maneuver-spend-
        // dialog.mjs L101-103).
        const disarmOptionValues = await spendDialog.disarmSelect
          .locator('option')
          .evaluateAll((opts) => opts.map((o) => o.value));
        expect(disarmOptionValues).toContain(`${cmb.captainB}|${gmWeaponItemId}`);
        const spenderOption = disarmOptionValues.find(
          (v) => v.startsWith(`${cmb.captainA}|`)
        );
        expect(spenderOption).toBeUndefined();

        await spendDialog.selectDisarmTarget(cmb.captainB, gmWeaponItemId);
        await spendDialog.submit();
        // Dialog closes synchronously via `this.close()` in the submit
        // handler (maneuver-spend-dialog.mjs L287).
        await expect(spendDialog.root).toHaveCount(0);

        /* ---------- Assert BOTH effects applied ---------- */

        // GM hook `#applyManeuverSpend` (combat.mjs L559-699) processes the
        // mailbox. Because `selection.impede` AND `selection.disarm` are both
        // truthy, BOTH application branches run:
        //   - Impede: pendingImpede[gmGroupId] stamped (L619-624).
        //   - Disarm: disabledItemIds updated (L643-647), weapon dropped
        //     (L650-659), setWeapon clears equip slot post-update (L676-678
        //     → L268-274).
        //   - maneuverSpends[0].spent = true (L665-671).
        //   - Position NOT applied (selection.position is falsy for
        //     impedeDisarm — the combo definition at maneuver-spend-
        //     dialog.mjs L30 sets only impede+disarm).
        //
        // Mailbox quirk — see mos-impede.spec.mjs L512-522: ObjectField merge
        // semantics leave a stale `selection` on `system.pendingManeuverSpend`
        // after the `{}` clear, but the `spent` gate (combat.mjs L588) makes
        // re-entry idempotent. Assert functional outcomes instead.
        await expect
          .poll(
            () => page.evaluate(({ cId, tId, pId, gId, witemId }) => {
              const c = game.combats.get(cId);
              const t = c?.combatants.get(tId);
              const round = c?.system.rounds?.[c.system.currentRound];
              const dropped = c?.system.droppedWeapons?.[gId] ?? null;
              return {
                pendingImpede: round?.effects?.pendingImpede?.[gId] ?? null,
                pendingPositionOnParty:
                  round?.effects?.pendingPosition?.[pId] ?? null,
                weaponId: t?.system.weaponId ?? null,
                weapon: t?.system.weapon ?? null,
                actorWeaponId: t?.actor?.system.conflict?.weaponId ?? null,
                actorWeapon: t?.actor?.system.conflict?.weapon ?? null,
                droppedCount: Array.isArray(dropped) ? dropped.length : 0,
                spent: round?.effects?.maneuverSpends?.[0]?.spent ?? null
              };
            }, {
              cId: combatId,
              tId: cmb.captainB,
              pId: partyGroupId,
              gId: gmGroupId,
              witemId: gmWeaponItemId
            }),
            { timeout: 10_000 }
          )
          .toEqual({
            pendingImpede: { amount: 1, targetVolley: 1 },
            pendingPositionOnParty: null,
            weaponId: '',
            weapon: '',
            actorWeaponId: '',
            actorWeapon: '',
            droppedCount: 1,
            spent: true
          });

        // Deep assertions on the two array/object payloads (toEqual above
        // doesn't dig into array membership for disabledItemIds/droppedEntry).
        const post = await page.evaluate(({ cId, tId, gId, witemId }) => {
          const c = game.combats.get(cId);
          const t = c?.combatants.get(tId);
          const dropped = c?.system.droppedWeapons?.[gId] ?? [];
          return {
            disabledItemIds: t?.system.disabledItemIds ?? [],
            droppedEntry: dropped.find((d) => d.itemId === witemId) ?? null
          };
        }, {
          cId: combatId,
          tId: cmb.captainB,
          gId: gmGroupId,
          witemId: gmWeaponItemId
        });
        // disabledItemIds can be a live ArrayField proxy — coerce to a plain
        // array before membership check (same pattern as mos-disarm-
        // weapon.spec.mjs L641-642).
        expect(Array.from(post.disabledItemIds)).toContain(gmWeaponItemId);
        expect(post.droppedEntry).toEqual({
          itemId: gmWeaponItemId,
          itemName: gmWeaponName,
          sourceCombatantId: cmb.captainB
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
