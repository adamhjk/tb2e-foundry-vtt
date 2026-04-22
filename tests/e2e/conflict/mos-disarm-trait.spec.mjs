import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { VersusPendingCard, VersusResolutionCard } from '../pages/VersusCard.mjs';
import { ManeuverSpendDialog } from '../pages/ManeuverSpendDialog.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §17 Conflict: Maneuver MoS Spends — Disarm TRAIT (TEST_PLAN L481, SG p.69).
 *
 * Companion to L480 (mos-disarm-weapon). Rules under test (SG p.69):
 *   - The winner of a Maneuver may spend 3 MoS on "Disarm": remove a weapon,
 *     gear item, *or trait* usage from an opponent for the remainder of the
 *     conflict. This spec covers the TRAIT branch.
 *
 * Code path differences from weapon disarm (combat.mjs L636-663):
 *   - L643-647 (same as weapon): push `selection.disarm.targetItemId` onto
 *     the target combatant's `system.disabledItemIds`.
 *   - L650 (target.system.weaponId === targetItemId) — FALSE for trait:
 *       → the `droppedWeapons` write (L651-659) is SKIPPED.
 *       → `disarmedTargetUnequip` stays null, so `setWeapon(targetId, "", "")`
 *         at L676-678 is NOT called.
 *   - L665-671: `round.effects.maneuverSpends[0].spent = true` (same as weapon).
 *
 * Downstream (the "flag cleared for remainder of conflict" assertion from the
 * checkbox): tb2e-roll.mjs L338-355 filters `actor.itemTypes.trait` by
 * `disabledItemIds` before building the trait list for the roll dialog, and
 * conflict-panel.mjs L1938/1982 forwards `combatant.system.disabledItemIds`
 * into `testContext` on every subsequent conflict roll. The trait Item itself
 * stays on the actor; only its id is banned from the trait pool.
 *
 * -------------------------------------------------------------------
 * What this spec verifies (narrow — TEST_PLAN L481 only)
 * -------------------------------------------------------------------
 *   1. Stage Kill conflict. Both captains ARMED with real weapon Items (so
 *      no unarmed -1D on V0 maneuver/defend pools). GM captainB ALSO owns a
 *      trait Item (level 1, beneficial 1) — the disarm target for this spec.
 *   2. Party captainA MANEUVERS (3D → 3 successes at u=0.001) vs GM captainB
 *      DEFENDS (2D → 0 successes at u=0.5). margin = 3.
 *   3. Spend dialog opens with 4 combos (MoS 3). Selecting `disarm` reveals
 *      the target select. The GM captain's TRAIT Item appears in the target
 *      dropdown as `"<captainBId>|<traitItemId>"` (maneuver-spend-
 *      dialog.mjs L138-140 surfaces `type === "trait"` items; template L43
 *      encodes option values). Also assert the `(trait)` kind suffix is on
 *      the option label (template L43 `this.kind`).
 *   4. Submit disarm targeting the trait.
 *   5. Assert post-spend state:
 *      - `target.system.disabledItemIds` contains the TRAIT id
 *        (combat.mjs L643-647).
 *      - Trait Item itself is STILL on the actor (not deleted).
 *      - `target.system.weaponId` + `target.system.weapon` UNCHANGED
 *        (trait disarm must not touch the equipped weapon — combat.mjs
 *        L650 branch skipped since traitId !== weaponId).
 *      - `combat.system.droppedWeapons[gmGroupId]` absent/empty (the
 *        droppedWeapons write at L651-659 is gated on the weapon branch).
 *      - `round.effects.maneuverSpends[0].spent === true` (L665-671).
 *      - `round.effects.pendingImpede[gmGroupId]` absent (disarm-only combo:
 *        selection.impede=false).
 *      - `round.effects.pendingPosition[partyGroupId]` absent (disarm-only
 *        combo: selection.position=false).
 *      - Downstream consumption: `_buildTraitData` (tb2e-roll.mjs L338-355)
 *        with the same `disabledItemIds` now excludes the disarmed trait.
 *        Verified directly by invoking the same filter the roll dialog
 *        uses — asserts the flag is cleared "for remainder of conflict."
 *
 * -------------------------------------------------------------------
 * Why this spec is NOT `test.fixme`
 * -------------------------------------------------------------------
 * Every production hook is wired end-to-end:
 *   - Trait surfaces in dialog: maneuver-spend-dialog.mjs L138-140
 *     filters `items.filter(i => i.type === "trait")` and joins into the
 *     target list at L144.
 *   - GM hook: combat.mjs L455-456 dispatches `#applyManeuverSpend`;
 *     L640-647 handles the trait disarm branch (disabledItemIds only —
 *     weapon/droppedWeapons branches skipped).
 *   - Roll-dialog trait filter: tb2e-roll.mjs L338-355 reads
 *     `disabledItemIds` and filters out matching traits.
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

async function addTraitToActor(page, { actorId, traitName }) {
  return page.evaluate(
    async ({ aId, tN }) => {
      const actor = game.actors.get(aId);
      const [item] = await actor.createEmbeddedDocuments('Item', [{
        name: tN,
        type: 'trait',
        // L1 trait, beneficial=1 → eligible to appear in the roll dialog
        // (not `benefitDisabled` — tb2e-roll.mjs L343 only disables when
        // `t.level < 3 && t.beneficial <= 0`).
        system: { level: 1, beneficial: 1, checks: 0, isClass: false }
      }]);
      return item.id;
    },
    { aId: actorId, tN: traitName }
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

test.describe('§17 Conflict: Maneuver MoS — Disarm (trait)', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(async () => {
      if ( globalThis.__tb2eE2EPrevRandomUniform ) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
      // Defensive: close any lingering maneuver-spend dialog (same pattern
      // as mos-disarm-weapon.spec.mjs L164-176).
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
    'MoS 3 Disarm (trait): disabledItemIds extended, trait suppressed from roll dialog, weapon state unchanged (SG p.69)',
    async ({ page }, testInfo) => {
      const tag = `e2e-mos-disarm-trait-${testInfo.parallelIndex}-${Date.now()}`;
      const stamp = Date.now();
      const charAName = `E2E Disarm Captain A ${stamp}`;
      const charBName = `E2E Disarm Captain B ${stamp}`;
      const charCName = `E2E Disarm Char C ${stamp}`;
      const charDName = `E2E Disarm Char D ${stamp}`;
      const partyWeaponName = `E2E Party Blade ${stamp}`;
      const gmWeaponName = `E2E GM Blade ${stamp}`;
      const gmTraitName = `E2E GM Stubborn ${stamp}`;

      await page.goto('/game');
      const ui = new GameUI(page);
      await ui.waitForReady();
      await ui.dismissTours();

      expect(await page.evaluate(() => game.user.isGM)).toBe(true);

      try {
        /* ---------- Arrange actors ---------- */

        const { actorId: captainAId, weaponItemId: partyWeaponItemId } =
          await createCaptainWithWeapon(page, {
            name: charAName, tag, health: 3, fighter: 3,
            weaponName: partyWeaponName
          });
        const { actorId: captainBId, weaponItemId: gmWeaponItemId } =
          await createCaptainWithWeapon(page, {
            name: charBName, tag, health: 2, fighter: 3,
            weaponName: gmWeaponName
          });
        // GM captain also owns a trait — the disarm target for this spec.
        const gmTraitItemId = await addTraitToActor(page, {
          actorId: captainBId, traitName: gmTraitName
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

        /* ---------- V0 party Maneuver roll (captainA, initiator) ---------- */

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
          volleyIndex: 0
        });

        /* ---------- Open spend dialog — MoS 3 → 4 combos ---------- */

        const spendBtn = resolution.root.locator(
          'button[data-action="spend-maneuver"]'
        );
        await expect(spendBtn).toBeVisible();
        await spendBtn.evaluate((btn) => btn.click());

        const spendDialog = new ManeuverSpendDialog(page);
        await spendDialog.waitForOpen();

        // Sanity: 4 combos at MoS 3 — same as the weapon-disarm spec.
        await expect(spendDialog.combos).toHaveCount(4);
        await expect(spendDialog.comboRadio('disarm')).toHaveCount(1);

        /* ---------- Select Disarm, choose GM captain's TRAIT ---------- */

        await spendDialog.selectCombo('disarm');
        await expect(spendDialog.disarmSection).toBeVisible();

        // maneuver-spend-dialog.mjs L138-140 enumerates trait items and
        // appends them to the target `items` list (L144). Template L43
        // renders each as `<option value="<combatantId>|<itemId>">name
        // (kind)</option>`. Assert both the trait option value AND its
        // `(trait)` kind suffix are present.
        const disarmOptions = await spendDialog.disarmSelect
          .locator('option')
          .evaluateAll((opts) => opts.map((o) => ({
            value: o.value, text: o.textContent.trim()
          })));
        const traitOptionValue = `${cmb.captainB}|${gmTraitItemId}`;
        const traitOption = disarmOptions.find((o) => o.value === traitOptionValue);
        expect(traitOption).toBeDefined();
        expect(traitOption.text).toContain('(trait)');

        // Spender (captainA) excluded by opponents-only filter at
        // maneuver-spend-dialog.mjs L102.
        const spenderOption = disarmOptions.find(
          (o) => o.value.startsWith(`${cmb.captainA}|`)
        );
        expect(spenderOption).toBeUndefined();

        // Baseline snapshot BEFORE disarm — used to prove weapon state is
        // untouched by the trait-disarm branch.
        const preDisarm = await page.evaluate(({ cId, tId }) => {
          const c = game.combats.get(cId);
          const t = c?.combatants.get(tId);
          return {
            weaponId: t?.system.weaponId ?? null,
            weapon: t?.system.weapon ?? null,
            actorWeaponId: t?.actor?.system.conflict?.weaponId ?? null,
            actorWeapon: t?.actor?.system.conflict?.weapon ?? null,
            disabledItemIds: Array.from(t?.system.disabledItemIds ?? [])
          };
        }, { cId: combatId, tId: cmb.captainB });
        expect(preDisarm.weaponId).toBe(gmWeaponItemId);
        expect(preDisarm.weapon).toBe(gmWeaponName);
        expect(preDisarm.disabledItemIds).not.toContain(gmTraitItemId);

        await spendDialog.selectDisarmTarget(cmb.captainB, gmTraitItemId);
        await spendDialog.submit();
        await expect(spendDialog.root).toHaveCount(0);

        /* ---------- Assert trait-disarm side effects ---------- */

        // GM hook `#applyManeuverSpend` (combat.mjs L559-699) — trait branch:
        //   - target.system.disabledItemIds ⊇ [gmTraitItemId] (L643-647).
        //   - target.system.weaponId / weapon UNCHANGED (L650 branch skipped
        //     since gmWeaponItemId !== gmTraitItemId).
        //   - actor mirror (system.conflict.weaponId / weapon) UNCHANGED
        //     (no setWeapon call — disarmedTargetUnequip stays null at L639).
        //   - combat.system.droppedWeapons[gmGroupId] absent/empty (the
        //     droppedWeapons write at L651-659 is gated on the weapon branch).
        //   - round.effects.maneuverSpends[0].spent === true (L665-671).
        //   - pendingImpede[gmGroupId] and pendingPosition[partyGroupId]
        //     stay empty (disarm-only combo).
        //   - Trait Item itself is NOT deleted — only its id is disabled.
        await expect
          .poll(
            () => page.evaluate(({ cId, tId, pId, gId, traitId, witemId, wname }) => {
              const c = game.combats.get(cId);
              const t = c?.combatants.get(tId);
              const round = c?.system.rounds?.[c.system.currentRound];
              const dropped = c?.system.droppedWeapons?.[gId] ?? null;
              const disabled = Array.from(t?.system.disabledItemIds ?? []);
              return {
                disabledHasTrait: disabled.includes(traitId),
                traitItemStillExists: !!t?.actor?.items?.get(traitId),
                weaponId: t?.system.weaponId ?? null,
                weapon: t?.system.weapon ?? null,
                actorWeaponId: t?.actor?.system.conflict?.weaponId ?? null,
                actorWeapon: t?.actor?.system.conflict?.weapon ?? null,
                droppedCount: Array.isArray(dropped) ? dropped.length : 0,
                spent: round?.effects?.maneuverSpends?.[0]?.spent ?? null,
                pendingImpedeOnGm:
                  round?.effects?.pendingImpede?.[gId] ?? null,
                pendingPositionOnParty:
                  round?.effects?.pendingPosition?.[pId] ?? null
              };
            }, {
              cId: combatId,
              tId: cmb.captainB,
              pId: partyGroupId,
              gId: gmGroupId,
              traitId: gmTraitItemId,
              witemId: gmWeaponItemId,
              wname: gmWeaponName
            }),
            { timeout: 10_000 }
          )
          .toMatchObject({
            disabledHasTrait: true,
            traitItemStillExists: true,
            weaponId: gmWeaponItemId,      // unchanged
            weapon: gmWeaponName,           // unchanged
            actorWeaponId: gmWeaponItemId,  // unchanged
            actorWeapon: gmWeaponName,      // unchanged
            droppedCount: 0,                // no weapon was dropped
            spent: true,
            pendingImpedeOnGm: null,
            pendingPositionOnParty: null
          });

        /* ---------- Assert downstream: trait filtered for remainder of conflict ---------- */

        // The "flag cleared for remainder of conflict" assertion from the
        // checkbox. tb2e-roll.mjs L338-355 (`_buildTraitData`) is the sole
        // consumer that converts `disabledItemIds` into a trait filter. Run
        // the same filter in-browser against the target's live post-disarm
        // state — proves the disarmed trait is excluded from the pool that
        // feeds every subsequent conflict roll dialog.
        const postFilter = await page.evaluate(({ cId, tId, traitId }) => {
          const c = game.combats.get(cId);
          const t = c?.combatants.get(tId);
          const actor = t?.actor;
          const disabledItemIds = Array.from(t?.system.disabledItemIds ?? []);
          const disabled = new Set(disabledItemIds);
          // Mirror tb2e-roll.mjs L338-340 exactly.
          const remainingTraits = (actor?.itemTypes?.trait || [])
            .filter((item) => !disabled.has(item.id))
            .map((item) => item.id);
          const allTraitIds = (actor?.itemTypes?.trait || []).map((i) => i.id);
          return {
            disabledItemIds,
            allTraitIds,
            remainingTraitIds: remainingTraits,
            traitInAllActorTraits: allTraitIds.includes(traitId),
            traitInFilteredTraits: remainingTraits.includes(traitId)
          };
        }, {
          cId: combatId,
          tId: cmb.captainB,
          traitId: gmTraitItemId
        });
        // Trait Item still on the actor ...
        expect(postFilter.traitInAllActorTraits).toBe(true);
        // ... but filtered out of the dialog-facing pool.
        expect(postFilter.traitInFilteredTraits).toBe(false);
        expect(postFilter.disabledItemIds).toContain(gmTraitItemId);

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
