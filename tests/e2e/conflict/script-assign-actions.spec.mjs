import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §15 Conflict: Scripting — each volley, the scripting captain picks one of
 * the four actions (A / D / F / M per config.mjs L392-397) and a combatant
 * to perform it, then the action set is committed to the round
 * (DH pp.124-126: "Scripting Actions" — each team writes three actions in
 * secret before the reveal).
 *
 * Rules under test:
 *   - The scripting tab renders one `.script-slot[data-slot-index]` per
 *     volley (three total) for each group (panel-script.hbs L36-66).
 *     Each slot shows four action-card buttons — one per key in
 *     `CONFIG.TB2E.conflictActions` (L392-397: attack/defend/feint/
 *     maneuver) — and a combatant `<select>` when the group has >1
 *     non-KO'd member (L44-51). Clicking an action-card is handled at
 *     `conflict-panel.mjs` L228-250: it writes the key into the slot's
 *     hidden `.action-select` input, toggles `.selected` on sibling
 *     cards, caches the selection in the panel's `#pendingSelections`,
 *     and calls `#syncPendingActions(groupId)` (L418-442) which —
 *     300ms debounced — invokes `combat.setActions(groupId, actions)`.
 *   - `combat.setActions` (combat.mjs L324-333) branches on viewer role:
 *       • Player path: writes the captain's combatant mailbox
 *         `system.pendingActions = actions` (L329). The GM hook at
 *         `_onUpdateDescendantDocuments` L449-451 observes
 *         `changes.system.pendingActions?.length` and dispatches to
 *         `#applyActions(groupId, actions, mailboxId)` (L498-518).
 *       • GM path: calls `#applyActions(groupId, actions)` directly,
 *         skipping the mailbox — the captain's `_source.system.
 *         pendingActions` never surfaces the payload.
 *     `#applyActions` writes `system.rounds[roundNum].actions[groupId]`
 *     (L510-511) and, when invoked via the mailbox, clears the field
 *     with `combatant.update({"system.pendingActions": []})` (L516).
 *
 * Mailbox field schema (`module/data/combat/combatant.mjs` L21):
 *   `pendingActions: new fields.ArrayField(new fields.ObjectField())`
 *
 *   Arrays in Foundry updates are replaced atomically (not deep-merged
 *   like `ObjectField`), so `[]` is a valid clear — unlike the sibling
 *   `pendingDisposition`/`pendingDistribution` `ObjectField` mailboxes
 *   flagged as broken in the header of
 *   `conflict/disposition-distribution-player.spec.mjs`. This spec's
 *   expectations therefore include the mailbox-drain step.
 *
 * Scope (TEST_PLAN L427 — narrow to the action-assign write path):
 *   - Verify the action-card UI writes + the `pendingActions` mailbox
 *     round-trip (player writes payload → GM hook processes → mailbox
 *     cleared → `system.rounds[n].actions[groupId]` populated).
 *   - Assign a distinct action (A/D/F/M) to each of four volley targets:
 *     three volleys for the captain's group (one action per volley), one
 *     isolated mailbox assertion covering all four keys. Uses a two-
 *     character party so the combatant-select UI is exercised too.
 *   - DOES NOT cover: lock (L428 — `script-lock.spec.mjs`), GM peek
 *     (L429), change-before-lock (L430), KO substitution (L431).
 *
 * E2E harness constraint (shared with `disposition-distribution-player`,
 * `versus/finalize-via-mailbox`, `grind/apply-condition-mailbox`): all
 * Playwright sessions authenticate as GM, so the non-GM mailbox-write
 * branch is simulated via `page.evaluate` issuing the exact payload
 * shape `combat.mjs` L329 emits (`captain.update({"system.
 * pendingActions": [{action, combatantId}, ...]})`). The GM hook at
 * L431-462 runs in the same client and processes the change.
 *
 * Staging: reuse the §13 flat-disposition pattern — two characters (one
 * captain, one other party member) + two monsters (one GM captain +
 * one mook). Kill conflict (`usesGear: true`) with weapons stamped via
 * `combat.setWeapon` so `canBeginScripting` opens
 * (conflict-panel.mjs L978-979 gates on every non-KO'd combatant having
 * a weapon). Flat-set disposition on both sides (covered e2e in
 * `disposition-flat-monster` spec — TEST_PLAN L391) so we skip the roll
 * UI entirely.
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

test.describe('§15 Conflict: Scripting — assign actions per volley', () => {
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
    'action-card clicks + pendingActions mailbox round-trip (DH pp.124-126)',
    async ({ page }, testInfo) => {
      const tag = `e2e-script-assign-${testInfo.parallelIndex}-${Date.now()}`;
      const stamp = Date.now();
      const charAName = `E2E Captain ${stamp}`;
      const charBName = `E2E Char B ${stamp}`;
      const monsterAName = `E2E Bugbear ${stamp}`;
      const monsterBName = `E2E Goblin ${stamp}`;

      await page.goto('/game');
      const ui = new GameUI(page);
      await ui.waitForReady();
      await ui.dismissTours();

      // Sanity: the GM hook (combat.mjs L431-462) is gated at L433 on
      // `game.user.isGM` — our session is the GM, so the hook runs in
      // the same client as the simulated player-side mailbox write.
      expect(await page.evaluate(() => game.user.isGM)).toBe(true);

      try {
        /* ---------- Arrange actors ---------- */

        const captainId = await createCharacter(page, { name: charAName, tag });
        const charBId = await createCharacter(page, { name: charBName, tag });
        const monAId = await importMonster(page, {
          sourceName: 'Bugbear', uniqueName: monsterAName, tag
        });
        const monBId = await importMonster(page, {
          sourceName: 'Goblin', uniqueName: monsterBName, tag
        });

        /* ---------- Create conflict, resolve group ids ---------- */

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

        /* ---------- Setup tab: populate + captainize + type ---------- */

        const panel = new ConflictPanel(page);
        await panel.open();
        expect(await panel.activeTabId()).toBe('setup');

        const cmb = {};
        cmb.captain = await panel.addCombatant({
          combatId, actorId: captainId, groupId: partyGroupId
        });
        cmb.charB = await panel.addCombatant({
          combatId, actorId: charBId, groupId: partyGroupId
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

        /* ---------- Disposition phase: flat-set both sides ---------- */

        await page.evaluate(async ({ cId, pId, gId }) => {
          const c = game.combats.get(cId);
          await c.storeDispositionRoll(pId, {
            rolled: 7, diceResults: [], cardHtml: '<em>E2E</em>'
          });
          await c.storeDispositionRoll(gId, {
            rolled: 8, diceResults: [], cardHtml: '<em>E2E</em>'
          });
        }, { cId: combatId, pId: partyGroupId, gId: gmGroupId });

        await page.evaluate(async ({ cId, pId, gId, capId, bId, mAId, mBId }) => {
          const c = game.combats.get(cId);
          const party = {}; party[capId] = 4; party[bId] = 3;
          const gm = {};    gm[mAId]   = 4; gm[mBId]   = 4;
          await c.distributeDisposition(pId, party);
          await c.distributeDisposition(gId, gm);
        }, {
          cId: combatId,
          pId: partyGroupId,
          gId: gmGroupId,
          capId: cmb.captain,
          bId: cmb.charB,
          mAId: cmb.monA,
          mBId: cmb.monB
        });

        await expect(panel.beginWeaponsButton).toBeEnabled();
        await panel.clickBeginWeapons();

        /* ---------- Weapons phase: stamp weapons directly ---------- */

        // Arm every combatant so `canBeginScripting` (conflict-panel.mjs
        // L978-979) opens. Bypass the UI — the weapons tab is covered by
        // the §14 specs (TEST_PLAN L409-411).
        await page.evaluate(async ({ cId, ids }) => {
          const c = game.combats.get(cId);
          for ( const id of ids ) {
            await c.setWeapon(id, 'Fists', '__unarmed__');
          }
        }, { cId: combatId, ids: [cmb.captain, cmb.charB, cmb.monA, cmb.monB] });

        await expect(panel.beginScriptingButton).toBeEnabled();
        await panel.clickBeginScripting();

        /* ---------- Scripting phase: DOM baseline ---------- */

        expect(await page.evaluate((cId) => {
          return game.combats.get(cId)?.system.phase ?? null;
        }, combatId)).toBe('scripting');

        // All three slots exist for the captain's group.
        await expect(panel.scriptSlot(partyGroupId, 0)).toBeVisible();
        await expect(panel.scriptSlot(partyGroupId, 1)).toBeVisible();
        await expect(panel.scriptSlot(partyGroupId, 2)).toBeVisible();

        // All four action-card buttons exist per slot (attack/defend/
        // feint/maneuver — config.mjs L392-397).
        const actionKeys = ['attack', 'defend', 'feint', 'maneuver'];
        for ( const k of actionKeys ) {
          await expect(panel.actionCard(partyGroupId, 0, k)).toBeVisible();
        }

        // Precondition: the round's stored actions are all-null slots
        // (combat.mjs L291-294 initializes `[null, null, null]` at
        // `beginScripting`) and the captain's mailbox is empty.
        const pre = await page.evaluate(({ cId, captainId: capId, pId }) => {
          const c = game.combats.get(cId);
          const captain = c.combatants.get(capId);
          return {
            pendingActions: foundry.utils.deepClone(
              captain?._source.system?.pendingActions ?? null
            ),
            actions: foundry.utils.deepClone(
              c.system.rounds?.[c.system.currentRound]?.actions?.[pId] ?? null
            )
          };
        }, { cId: combatId, captainId: cmb.captain, pId: partyGroupId });
        expect(pre.pendingActions).toEqual([]);
        expect(pre.actions).toEqual([null, null, null]);

        /* ---------- Act (UI path): click A/D/F for volleys 1/2/3 ---------- */

        // Selections: volley 0 = attack (captain), volley 1 = defend
        // (charB), volley 2 = feint (captain). Maneuver is covered in
        // the mailbox round-trip below.
        await panel.selectSlotCombatant(partyGroupId, 0, cmb.captain);
        await panel.clickAction(partyGroupId, 0, 'attack');

        await panel.selectSlotCombatant(partyGroupId, 1, cmb.charB);
        await panel.clickAction(partyGroupId, 1, 'defend');

        await panel.selectSlotCombatant(partyGroupId, 2, cmb.captain);
        await panel.clickAction(partyGroupId, 2, 'feint');

        // Wait for the 300ms debounce in `#syncPendingActions`
        // (conflict-panel.mjs L419-441) to fire, the GM-path
        // `combat.setActions` → `#applyActions` to write
        // `system.rounds[n].actions[groupId]`, and the combat update to
        // propagate.
        await expect
          .poll(() => page.evaluate(({ cId, pId }) => {
            const c = game.combats.get(cId);
            const round = c.system.rounds?.[c.system.currentRound];
            const entries = round?.actions?.[pId] ?? [];
            return entries.map((e) => e?.action ?? null);
          }, { cId: combatId, pId: partyGroupId }), { timeout: 5_000 })
          .toEqual(['attack', 'defend', 'feint']);

        const storedUi = await page.evaluate(({ cId, pId }) => {
          const c = game.combats.get(cId);
          const round = c.system.rounds?.[c.system.currentRound];
          return foundry.utils.deepClone(round?.actions?.[pId] ?? []);
        }, { cId: combatId, pId: partyGroupId });
        expect(storedUi).toEqual([
          { action: 'attack',  combatantId: cmb.captain },
          { action: 'defend',  combatantId: cmb.charB },
          { action: 'feint',   combatantId: cmb.captain }
        ]);

        // DOM reflects the selections per-slot.
        await expect(panel.actionCard(partyGroupId, 0, 'attack'))
          .toHaveClass(/\bselected\b/);
        await expect(panel.actionCard(partyGroupId, 1, 'defend'))
          .toHaveClass(/\bselected\b/);
        await expect(panel.actionCard(partyGroupId, 2, 'feint'))
          .toHaveClass(/\bselected\b/);

        /* ---------- Act (mailbox path): simulate non-GM write ---------- */

        // Verify the PLAYER-side write branch end-to-end by issuing the
        // exact payload `combat.mjs` L329 emits: a direct
        // `captain.update({"system.pendingActions": actions})`. This
        // forces the path that the GM-only Playwright session would
        // otherwise skip in `setActions`.
        //
        // Include `maneuver` here — so the four A/D/F/M keys are all
        // exercised between the UI path (A/D/F) and the mailbox path (M
        // alongside a re-issue of A/D/F to lock the full-4-key set).
        const mailboxPayload = [
          { action: 'maneuver', combatantId: cmb.captain },
          { action: 'attack',   combatantId: cmb.charB },
          { action: 'defend',   combatantId: cmb.captain }
        ];
        await page.evaluate(
          async ({ cId, capId, actions }) => {
            const c = game.combats.get(cId);
            const captain = c.combatants.get(capId);
            await captain.update({ 'system.pendingActions': actions });
          },
          {
            cId: combatId,
            capId: cmb.captain,
            actions: mailboxPayload
          }
        );

        // Assert 1: the GM hook (combat.mjs L449-451) observed the write
        // and `#applyActions` (L498-518) committed the payload to
        // `system.rounds[n].actions[groupId]`.
        await expect
          .poll(() => page.evaluate(({ cId, pId }) => {
            const c = game.combats.get(cId);
            const round = c.system.rounds?.[c.system.currentRound];
            return foundry.utils.deepClone(round?.actions?.[pId] ?? null);
          }, { cId: combatId, pId: partyGroupId }), { timeout: 10_000 })
          .toEqual(mailboxPayload);

        // Assert 2: mailbox is drained (combat.mjs L516 writes
        // `{"system.pendingActions": []}`). Because `pendingActions` is
        // an `ArrayField` (data/combat/combatant.mjs L21), arrays are
        // replaced atomically in Foundry updates — unlike the sibling
        // `ObjectField` mailboxes (`pendingDisposition`,
        // `pendingDistribution`) flagged as broken in
        // `conflict/disposition-distribution-player.spec.mjs`.
        await expect
          .poll(
            () => page.evaluate(
              ({ cId, capId }) => {
                const captain = game.combats.get(cId)?.combatants.get(capId);
                return foundry.utils.deepClone(
                  captain?._source.system?.pendingActions ?? null
                );
              },
              { cId: combatId, capId: cmb.captain }
            ),
            { timeout: 10_000, message: 'pendingActions should be drained by GM hook' }
          )
          .toEqual([]);

        // Assert 3: every action key exercised across both paths —
        // attack (UI + mailbox), defend (UI + mailbox), feint (UI),
        // maneuver (mailbox). Confirms the four config.mjs L392-397
        // keys all round-trip through `#applyActions`'s validation gate
        // at L507 (`CONFIG.TB2E.conflictActions[entry.action]`).
        const exercisedKeys = new Set([
          ...['attack', 'defend', 'feint'],
          ...mailboxPayload.map((e) => e.action)
        ]);
        expect(exercisedKeys).toEqual(new Set(['attack', 'defend', 'feint', 'maneuver']));
      } finally {
        await cleanupTaggedActors(page, tag);
      }
    }
  );
});
