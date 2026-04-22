import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { VersusPendingCard, VersusResolutionCard } from '../pages/VersusCard.mjs';
import { ManeuverSpendDialog } from '../pages/ManeuverSpendDialog.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §17 Conflict: Maneuver MoS Spends — Disarm (TEST_PLAN L480, SG p.69).
 *
 * Rules under test (SG p.69):
 *   - Winner of a Maneuver may spend 3 MoS on "Disarm": remove a weapon,
 *     gear item, or trait usage from an opponent for the remainder of the
 *     conflict (maneuver-spend-dialog.mjs L19-24 SPEND_COMBINATIONS[3]
 *     includes `{ key:"disarm", cost:3, disarm:true }`).
 *   - For weapon disarm (this spec), if the chosen target item is the
 *     opponent's currently-equipped weapon, `#applyManeuverSpend`
 *     (combat.mjs L640-663) does two things:
 *       1. Pushes the item id onto `target.system.disabledItemIds` (L643-647)
 *          — this is what prevents weapon bonuses from applying on later
 *          rolls and what Rearm/resume checks against.
 *       2. Because weaponId === targetItemId, also:
 *            a. Pushes the weapon onto
 *               `combat.system.droppedWeapons[opponentGroupId]` as
 *               `{ itemId, itemName, sourceCombatantId }` (L650-659).
 *            b. Unequips the target by calling `setWeapon(targetId, "", "")`
 *               post-update (L676-678 → L268-274) — clearing both the
 *               combatant's `system.weapon`/`weaponId` and the actor
 *               mirror `system.conflict.weapon`/`weaponId`.
 *
 * -------------------------------------------------------------------
 * What this spec verifies (narrow — TEST_PLAN L480 only)
 * -------------------------------------------------------------------
 *   1. Stage Kill conflict. Both captains ARMED with real weapon Items
 *      (the party captain's weapon is meaningful only to enable margin=3
 *      rolls without the unarmed -1D penalty; the GM captain's weapon is
 *      the disarm target).
 *   2. Party captainA MANEUVERS (rolls health=3, armed → 3D) vs GM
 *      captainB DEFENDS (rolls health=2, armed → 2D). PRNG 0.001 then 0.5
 *      → 3 vs 0 successes → margin=3.
 *   3. Spend dialog opens with 4 combos (SPEND_COMBINATIONS[3] — impede,
 *      position, impedePosition, disarm). rearm/impedeDisarm absent.
 *   4. Select `disarm`, pick the GM captain's weapon from the target
 *      dropdown, submit.
 *   5. Assert post-spend state:
 *      - `target.system.disabledItemIds` contains the disarmed weapon id
 *        (combat.mjs L643-647).
 *      - `target.system.weaponId` + `target.system.weapon` cleared on the
 *        combatant (via setWeapon at L676-678).
 *      - Actor mirror `system.conflict.weaponId`/`weapon` cleared on the
 *        target's actor (same setWeapon path L268-274).
 *      - `combat.system.droppedWeapons[gmGroupId]` contains an entry with
 *        `{ itemId, itemName, sourceCombatantId: targetCombatantId }`
 *        (combat.mjs L650-659).
 *      - `round.effects.maneuverSpends[0].spent === true` (L665-671).
 *      - `round.effects.pendingImpede[gmGroupId]` absent (disarm-only
 *        combo: selection.impede=false).
 *      - `round.effects.pendingPosition[partyGroupId]` absent (disarm-
 *        only combo: selection.position=false).
 *
 * -------------------------------------------------------------------
 * Why this spec is NOT `test.fixme`
 * -------------------------------------------------------------------
 * Every production hook is wired end-to-end:
 *   - Spend mailbox: maneuver-spend-dialog.mjs L250-255 writes
 *     `selection.disarm = { targetCombatantId, targetItemId }` alongside
 *     `impede:false, position:false` for the disarm-only combo.
 *   - GM hook: combat.mjs L455-456 dispatches `#applyManeuverSpend`;
 *     L640-663 handles the disarm branch (disabledItemIds +
 *     droppedWeapons + unequip).
 *   - Weapon-disarmed flag consumption: conflict-panel.mjs L1938-1942
 *     reads `disabledItemIds` and suppresses the weapon bonus block when
 *     `weaponId && disabledItemIds.includes(weaponId)` — but since
 *     `setWeapon` clears weaponId to "" as part of the disarm, the more
 *     visible post-condition is the cleared weaponId itself (this spec
 *     asserts that directly).
 *
 * -------------------------------------------------------------------
 * Test fixture (deterministic)
 * -------------------------------------------------------------------
 *   Kill conflict. 4 characters, 2 per side. Captains are the active
 *   rollers; the other two are filler.
 *     - Party captainA: health=3, fighter=3. Holds weapon "E2E Party Blade".
 *       V0 MANEUVER rolls health, armed → 3D → 3 successes at u=0.001.
 *       V1+ filler (not rolled here).
 *     - GM captainB: health=2, fighter=3. Holds weapon "E2E GM Blade" —
 *       this is the disarm target. V0 DEFEND rolls health, armed → 2D →
 *       0 successes at u=0.5.
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

test.describe('§17 Conflict: Maneuver MoS — Disarm (weapon)', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(async () => {
      if ( globalThis.__tb2eE2EPrevRandomUniform ) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
      // Defensive: close any lingering maneuver-spend dialog (same pattern
      // as mos-impede.spec.mjs L144-156 / mos-position.spec.mjs L171-180).
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
    'MoS 3 Disarm (weapon): target disabledItemIds updated, weapon unequipped, dropped pool recorded (SG p.69)',
    async ({ page }, testInfo) => {
      const tag = `e2e-mos-disarm-weapon-${testInfo.parallelIndex}-${Date.now()}`;
      const stamp = Date.now();
      const charAName = `E2E Disarm Captain A ${stamp}`;
      const charBName = `E2E Disarm Captain B ${stamp}`;
      const charCName = `E2E Disarm Char C ${stamp}`;
      const charDName = `E2E Disarm Char D ${stamp}`;
      const partyWeaponName = `E2E Party Blade ${stamp}`;
      const gmWeaponName = `E2E GM Blade ${stamp}`;

      await page.goto('/game');
      const ui = new GameUI(page);
      await ui.waitForReady();
      await ui.dismissTours();

      expect(await page.evaluate(() => game.user.isGM)).toBe(true);

      try {
        /* ---------- Arrange actors ---------- */

        // Party captainA: armed (so no unarmed -1D penalty). health=3 → 3D
        // maneuver pool → 3 successes at u=0.001.
        const { actorId: captainAId, weaponItemId: partyWeaponItemId } =
          await createCaptainWithWeapon(page, {
            name: charAName, tag, health: 3, fighter: 3,
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

        // Captains hold their real weapon Items (so no unarmed -1D), filler
        // characters carry `__unarmed__` so the scripting gate opens.
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

        // V0: party MANEUVER by captainA (health=3 armed → 3D → 3 successes)
        //     vs GM DEFEND by captainB (health=2 armed → 2D → 0 successes).
        // V1/V2: filler DEFEND on both sides — not rolled here.
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

        // Stub PRNG → all-6s. captainA armed → 3D → 3 successes.
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

        // Maneuverer wins by exactly 3.
        expect(await resolution.initiatorIsWinner()).toBe(true);
        const iSuccesses = await resolution.getInitiatorSuccesses();
        const oSuccesses = await resolution.getOpponentSuccesses();
        const margin = iSuccesses - oSuccesses;
        expect(margin).toBe(3);

        // Resolution card carries the MoS-3 spend payload.
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

        // MoS 3 offers 4 combos (SPEND_COMBINATIONS[3] — maneuver-spend-
        // dialog.mjs L19-24): impede, position, impedePosition, disarm.
        // rearm (cost 4) and impedeDisarm (cost 4) are NOT available at
        // MoS=3.
        await expect(spendDialog.combos).toHaveCount(4);
        await expect(spendDialog.comboRadio('impede')).toHaveCount(1);
        await expect(spendDialog.comboRadio('position')).toHaveCount(1);
        await expect(spendDialog.comboRadio('impedePosition')).toHaveCount(1);
        await expect(spendDialog.comboRadio('disarm')).toHaveCount(1);
        await expect(spendDialog.comboRadio('rearm')).toHaveCount(0);
        await expect(spendDialog.comboRadio('impedeDisarm')).toHaveCount(0);

        /* ---------- Select Disarm, choose GM captain's weapon ---------- */

        // Disarm section starts `hidden` (template L34) and the radio
        // change listener at maneuver-spend-dialog.mjs L200-206 toggles
        // visibility. Select disarm first → the target `<select>` becomes
        // visible → pick the GM captain + their weapon item id.
        await spendDialog.selectCombo('disarm');
        await expect(spendDialog.disarmSection).toBeVisible();

        // The disarm target `<select>` option values are encoded as
        // `"<combatantId>|<itemId>"` (template L43). Assert the GM
        // captain's weapon option exists; the filler characters have no
        // items and should not appear as option groups (hbs L36-46
        // wraps optgroups in `{{#if this.hasItems}}`).
        const disarmOptionValues = await spendDialog.disarmSelect
          .locator('option')
          .evaluateAll((opts) => opts.map((o) => o.value));
        expect(disarmOptionValues).toContain(`${cmb.captainB}|${gmWeaponItemId}`);
        // captainA is the spender; opponents-only filter at maneuver-
        // spend-dialog.mjs L102 excludes them from the target pool.
        const spenderOption = disarmOptionValues.find(
          (v) => v.startsWith(`${cmb.captainA}|`)
        );
        expect(spenderOption).toBeUndefined();

        await spendDialog.selectDisarmTarget(cmb.captainB, gmWeaponItemId);
        await spendDialog.submit();
        // Dialog closes synchronously via `this.close()` in the submit
        // handler (maneuver-spend-dialog.mjs L287).
        await expect(spendDialog.root).toHaveCount(0);

        /* ---------- Assert disarm side effects ---------- */

        // GM hook `#applyManeuverSpend` (combat.mjs L559-699) processes
        // the mailbox. Poll for the full disarm post-state:
        //   - target.system.disabledItemIds ⊇ [gmWeaponItemId] (L643-647).
        //   - target.system.weaponId / weapon cleared by setWeapon
        //     (L676-678 → L268-274).
        //   - target actor mirror (system.conflict.weaponId / weapon) also
        //     cleared by setWeapon (L273).
        //   - combat.system.droppedWeapons[gmGroupId] contains the
        //     disarmed weapon (L650-659) keyed on the OPPONENT'S group
        //     (victim's team).
        //   - round.effects.maneuverSpends[0].spent === true (L665-671).
        //   - pendingImpede[gmGroupId] and pendingPosition[partyGroupId]
        //     stay empty (disarm-only combo: selection.impede=false,
        //     selection.position=false → L619-633 branches skipped).
        await expect
          .poll(
            () => page.evaluate(({ cId, tId, pId, gId, witemId }) => {
              const c = game.combats.get(cId);
              const t = c?.combatants.get(tId);
              const round = c?.system.rounds?.[c.system.currentRound];
              const dropped = c?.system.droppedWeapons?.[gId] ?? null;
              return {
                disabledItemIds: t?.system.disabledItemIds ?? null,
                weaponId: t?.system.weaponId ?? null,
                weapon: t?.system.weapon ?? null,
                actorWeaponId: t?.actor?.system.conflict?.weaponId ?? null,
                actorWeapon: t?.actor?.system.conflict?.weapon ?? null,
                droppedCount: Array.isArray(dropped) ? dropped.length : 0,
                droppedEntry: Array.isArray(dropped)
                  ? dropped.find((d) => d.itemId === witemId) ?? null
                  : null,
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
              witemId: gmWeaponItemId
            }),
            { timeout: 10_000 }
          )
          .toMatchObject({
            weaponId: '',
            weapon: '',
            actorWeaponId: '',
            actorWeapon: '',
            droppedCount: 1,
            spent: true,
            pendingImpedeOnGm: null,
            pendingPositionOnParty: null
          });

        // Deep assertions on the two array/object payloads (toMatchObject
        // doesn't dig into array membership).
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
        // disabledItemIds can be a live ArrayField proxy — coerce to a
        // plain array before membership check.
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
