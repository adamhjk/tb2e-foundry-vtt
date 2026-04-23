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
 * §17 Conflict: Maneuver MoS Spends — Rearm (TEST_PLAN L482, SG p.69).
 *
 * Rules under test (SG p.69):
 *   - Winner of a Maneuver may spend 4 MoS on "Rearm": recover a weapon
 *     for the spender. `SPEND_COMBINATIONS[4]` (maneuver-spend-dialog.mjs
 *     L25-32) includes `{ key:"rearm", cost:4, rearm:true }` alongside
 *     `impedeDisarm`, `disarm`, `impedePosition`, `position`, `impede`
 *     — 6 combos total at MoS 4.
 *   - Rearm pool (maneuver-spend-dialog.mjs L151-160): spender's own
 *     carried weapons (minus currently-equipped) PLUS
 *     `combat.system.droppedWeapons[this.#args.groupId]` — i.e. weapons
 *     dropped for the spender's OWN team's pool. Options are encoded as
 *     `"<itemId>|dropped"` or `"<itemId>|own"` in the template
 *     (maneuver-spend-dialog.hbs L66, L73).
 *   - On submit, the dialog writes `selection.rearm = { itemId,
 *     fromDropped }` (maneuver-spend-dialog.mjs L256-261) into the
 *     combatant mailbox `system.pendingManeuverSpend`.
 *   - GM hook `#applyManeuverSpend` (combat.mjs L559-699) rearm branch
 *     (L679-696):
 *       1. Resolves the item by id on the SPENDER's actor
 *          (`spender.actor?.items?.get(selection.rearm.itemId)`).
 *       2. Calls `setWeapon(spender.id, name, itemId)` (combat.mjs L268-
 *          274) — which sets both `system.weapon`/`weaponId` on the
 *          combatant AND the actor mirror `system.conflict.weapon`/
 *          `weaponId`.
 *       3. If `fromDropped`, splices the chosen itemId out of
 *          `combat.system.droppedWeapons[groupId]` (L685-694).
 *       4. Stamps `round.effects.maneuverSpends[volleyIndex].spent = true`
 *          (L665-671).
 *
 * -------------------------------------------------------------------
 * What this spec verifies (narrow — TEST_PLAN L482 only)
 * -------------------------------------------------------------------
 *   1. Stage Kill conflict. Party captainA is ARMED with weapon X
 *      ("E2E Placeholder Blade") and ALSO owns weapon Y
 *      ("E2E Dropped Blade") which is NOT equipped.
 *   2. Pre-populate `combat.system.droppedWeapons[partyGroupId]` with a
 *      single entry for weapon Y — simulating a prior disarm's drop
 *      (the disarm→drop pipeline is already covered in mos-disarm-weapon
 *      L480; this spec narrows to the rearm consumption side).
 *   3. captainA MANEUVERS (rolls health=4, armed → 4D) vs GM captainB
 *      DEFENDS (rolls health=2, armed → 2D). PRNG 0.001 then 0.5 → 4 vs
 *      0 successes → margin=4.
 *   4. Spend dialog opens. MoS 4 → 6 combos (SPEND_COMBINATIONS[4]
 *      includes rearm + impedeDisarm alongside the lower-MoS combos).
 *   5. Select `rearm`, pick weapon Y from the dropped-weapons optgroup
 *      (value=`${yId}|dropped`), submit.
 *   6. Assert post-spend state:
 *      - captainA's `system.weaponId === weaponYId`
 *      - captainA's `system.weapon === weaponYName`
 *      - Actor mirror `system.conflict.weaponId`/`weapon` both set
 *        (setWeapon path, combat.mjs L273).
 *      - `combat.system.droppedWeapons[partyGroupId]` no longer contains
 *        weapon Y (spliced out at L688-692).
 *      - `round.effects.maneuverSpends[0].spent === true` (L665-671).
 *      - `round.effects.pendingImpede[gmGroupId]` absent (rearm-only
 *        combo: selection.impede=false).
 *      - `round.effects.pendingPosition[partyGroupId]` absent (rearm-
 *        only combo: selection.position=false).
 *
 * -------------------------------------------------------------------
 * Why this spec is NOT `test.fixme`
 * -------------------------------------------------------------------
 * Every production hook is wired end-to-end:
 *   - Mailbox write: maneuver-spend-dialog.mjs L256-261 emits
 *     `selection.rearm` alongside `impede:false, position:false`.
 *   - GM hook: combat.mjs L455-456 dispatches `#applyManeuverSpend`;
 *     L679-696 handles the rearm branch (setWeapon + dropped splice).
 *   - Dropped-pool surface: the pool is already exposed by
 *     `_prepareContext` at maneuver-spend-dialog.mjs L157-160 and
 *     rendered as `<option value="<id>|dropped">` by hbs L66.
 *
 * -------------------------------------------------------------------
 * Test fixture (deterministic)
 * -------------------------------------------------------------------
 *   Kill conflict. 4 characters, 2 per side. captainA holds the
 *   placeholder weapon X; the party group's droppedWeapons pool is
 *   pre-seeded with weapon Y (also owned by captainA, not equipped) as
 *   a proxy for a prior disarm.
 *     - Party captainA: health=4, fighter=3. V0 MANEUVER armed → 4D →
 *       4 successes at u=0.001.
 *     - GM captainB: health=2, fighter=3, armed with weapon Z. V0
 *       DEFEND armed → 2D → 0 successes at u=0.5.
 *     - Party charC / GM charD: filler placeholders (unarmed, not
 *       rolled).
 *
 *   PRNG stubs:
 *     - u=0.001 → 6 (all successes).
 *     - u=0.5  → 3 (all wyrms).
 */

async function createCaptainWithWeapons(page, { name, tag, health, fighter, weaponNames }) {
  return page.evaluate(
    async ({ n, t, h, f, wns }) => {
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
      const items = await actor.createEmbeddedDocuments(
        'Item',
        wns.map((wn) => ({
          name: wn,
          type: 'weapon',
          system: {
            slot: '',
            slotIndex: 0,
            slotOptions: { wornHand: 1, carried: 1 }
          }
        }))
      );
      return {
        actorId: actor.id,
        weaponItemIds: items.map((i) => ({ id: i.id, name: i.name }))
      };
    },
    { n: name, t: tag, h: health, f: fighter, wns: weaponNames }
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

test.describe('§17 Conflict: Maneuver MoS — Rearm (dropped weapon)', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(async () => {
      if ( globalThis.__tb2eE2EPrevRandomUniform ) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
      // Defensive: close any lingering maneuver-spend dialog (same pattern
      // as mos-disarm-weapon.spec.mjs L159-174).
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
    'MoS 4 Rearm (dropped): weapon re-equipped on spender, dropped pool spliced (SG p.69)',
    async ({ page }, testInfo) => {
      const tag = `e2e-mos-rearm-${testInfo.parallelIndex}-${Date.now()}`;
      const stamp = Date.now();
      const charAName = `E2E Rearm Captain A ${stamp}`;
      const charBName = `E2E Rearm Captain B ${stamp}`;
      const charCName = `E2E Rearm Char C ${stamp}`;
      const charDName = `E2E Rearm Char D ${stamp}`;
      const placeholderWeaponName = `E2E Placeholder Blade ${stamp}`;
      const droppedWeaponName = `E2E Dropped Blade ${stamp}`;
      const gmWeaponName = `E2E GM Blade ${stamp}`;

      await page.goto('/game');
      const ui = new GameUI(page);
      await ui.waitForReady();
      await ui.dismissTours();

      expect(await page.evaluate(() => game.user.isGM)).toBe(true);

      try {
        /* ---------- Arrange actors ---------- */

        // Party captainA: owns TWO weapon Items — a "placeholder" that will
        // be equipped (so no -1D unarmed penalty on the maneuver roll) and
        // a second "dropped" weapon that will be pre-seeded into the
        // party's droppedWeapons pool as the rearm target.
        //
        // health=4 so armed → 4D maneuver pool → 4 successes at u=0.001,
        // which is the exact MoS needed for the rearm combo (cost 4).
        const {
          actorId: captainAId,
          weaponItemIds: partyItems
        } = await createCaptainWithWeapons(page, {
          name: charAName, tag, health: 4, fighter: 3,
          weaponNames: [placeholderWeaponName, droppedWeaponName]
        });
        const placeholderWeaponItemId = partyItems.find(
          (w) => w.name === placeholderWeaponName
        ).id;
        const droppedWeaponItemId = partyItems.find(
          (w) => w.name === droppedWeaponName
        ).id;

        // GM captainB: armed (so their DEFEND pool is unpenalized).
        // health=2 → 2D → 0 successes at u=0.5.
        const {
          actorId: captainBId,
          weaponItemIds: gmItems
        } = await createCaptainWithWeapons(page, {
          name: charBName, tag, health: 2, fighter: 3,
          weaponNames: [gmWeaponName]
        });
        const gmWeaponItemId = gmItems[0].id;

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

        // captainA equips the PLACEHOLDER weapon — NOT the dropped one.
        // The dropped weapon is specifically the one we want the rearm to
        // pick up; having it un-equipped also means the rearm pool's
        // `ownWeapons` filter (maneuver-spend-dialog.mjs L154-156 —
        // `i.id !== currentWeaponId`) would include it, but we drop it
        // into the team pool so it appears in the dropped optgroup
        // instead (and — as an explicit assertion — in BOTH).
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
            {
              id: cmb.captainA,
              name: placeholderWeaponName,
              wid: placeholderWeaponItemId
            },
            {
              id: cmb.captainB,
              name: gmWeaponName,
              wid: gmWeaponItemId
            }
          ],
          fillers: [cmb.charC, cmb.charD]
        });

        await expect(panel.beginScriptingButton).toBeEnabled();
        await panel.clickBeginScripting();

        /* ---------- Pre-seed droppedWeapons pool ---------- */

        // Simulate a prior disarm that dropped captainA's second weapon
        // into the party group's pool. The shape matches combat.mjs L654-
        // 658 exactly: `{ itemId, itemName, sourceCombatantId }`. Using
        // captainA as sourceCombatantId mirrors the disarm path's bias
        // (the dropped weapon is keyed on the victim's group and tagged
        // with the victim's combatant id).
        await page.evaluate(async ({ cId, pId, aId, widId, widName }) => {
          const c = game.combats.get(cId);
          const dropped = foundry.utils.deepClone(c.system.droppedWeapons || {});
          dropped[pId] = [
            { itemId: widId, itemName: widName, sourceCombatantId: aId }
          ];
          await c.update({ 'system.droppedWeapons': dropped });
        }, {
          cId: combatId,
          pId: partyGroupId,
          aId: cmb.captainA,
          widId: droppedWeaponItemId,
          widName: droppedWeaponName
        });

        /* ---------- Scripting ---------- */

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

        // Maneuverer wins by exactly 4 — enough for the rearm combo.
        expect(await resolution.initiatorIsWinner()).toBe(true);
        const iSuccesses = await resolution.getInitiatorSuccesses();
        const oSuccesses = await resolution.getOpponentSuccesses();
        const margin = iSuccesses - oSuccesses;
        expect(margin).toBe(4);

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

        /* ---------- Select Rearm, pick dropped weapon ---------- */

        await spendDialog.selectCombo('rearm');
        await expect(spendDialog.rearmSection).toBeVisible();

        // Rearm `<select>` options are encoded `"<itemId>|dropped"` from
        // the template (hbs L66) for the droppedWeapons pool. Assert the
        // dropped weapon appears. The currently-equipped placeholder is
        // excluded by the ownWeapons filter (L154-156 —
        // `i.id !== currentWeaponId`).
        const rearmOptionValues = await spendDialog.rearmSelect
          .locator('option')
          .evaluateAll((opts) => opts.map((o) => o.value));
        expect(rearmOptionValues).toContain(`${droppedWeaponItemId}|dropped`);
        // Placeholder is currently equipped — must NOT appear as an own-
        // weapon option (but it's not in the dropped pool either, so it
        // simply shouldn't appear at all).
        const placeholderOption = rearmOptionValues.find(
          (v) => v.startsWith(`${placeholderWeaponItemId}|`)
        );
        expect(placeholderOption).toBeUndefined();

        await spendDialog.selectRearmTarget(droppedWeaponItemId, 'dropped');
        await spendDialog.submit();
        // Dialog closes synchronously via `this.close()` in the submit
        // handler (maneuver-spend-dialog.mjs L287).
        await expect(spendDialog.root).toHaveCount(0);

        /* ---------- Assert rearm side effects ---------- */

        // GM hook `#applyManeuverSpend` (combat.mjs L559-699) processes
        // the mailbox. Poll for the full rearm post-state:
        //   - captainA.system.weaponId === droppedWeaponItemId +
        //     weapon === droppedWeaponName (setWeapon, L271).
        //   - actor mirror system.conflict.weaponId / weapon same values
        //     (setWeapon, L273).
        //   - combat.system.droppedWeapons[partyGroupId] no longer
        //     contains droppedWeaponItemId (spliced at L688-692).
        //   - round.effects.maneuverSpends[0].spent === true (L665-671).
        //   - pendingImpede[gmGroupId] and pendingPosition[partyGroupId]
        //     stay empty (rearm-only combo: selection.impede=false,
        //     selection.position=false → L619-633 branches skipped).
        await expect
          .poll(
            () => page.evaluate(({ cId, sId, pId, gId, widId }) => {
              const c = game.combats.get(cId);
              const s = c?.combatants.get(sId);
              const round = c?.system.rounds?.[c.system.currentRound];
              const dropped = c?.system.droppedWeapons?.[pId] ?? null;
              return {
                weaponId: s?.system.weaponId ?? null,
                weapon: s?.system.weapon ?? null,
                actorWeaponId: s?.actor?.system.conflict?.weaponId ?? null,
                actorWeapon: s?.actor?.system.conflict?.weapon ?? null,
                droppedCount: Array.isArray(dropped) ? dropped.length : 0,
                droppedHasEntry: Array.isArray(dropped)
                  ? dropped.some((d) => d.itemId === widId)
                  : false,
                spent: round?.effects?.maneuverSpends?.[0]?.spent ?? null,
                pendingImpedeOnGm:
                  round?.effects?.pendingImpede?.[gId] ?? null,
                pendingPositionOnParty:
                  round?.effects?.pendingPosition?.[pId] ?? null
              };
            }, {
              cId: combatId,
              sId: cmb.captainA,
              pId: partyGroupId,
              gId: gmGroupId,
              widId: droppedWeaponItemId
            }),
            { timeout: 10_000 }
          )
          .toMatchObject({
            weaponId: droppedWeaponItemId,
            weapon: droppedWeaponName,
            actorWeaponId: droppedWeaponItemId,
            actorWeapon: droppedWeaponName,
            droppedCount: 0,
            droppedHasEntry: false,
            spent: true,
            pendingImpedeOnGm: null,
            pendingPositionOnParty: null
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
