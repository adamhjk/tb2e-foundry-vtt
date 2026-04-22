import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §15 Conflict: Scripting — Lock Actions (TEST_PLAN L428).
 *
 * Once a team's three volleys are scripted, the captain (or GM on their
 * team's behalf) "locks in" the script. Per DH p.126 ("Lock In Your
 * Actions") the locked script is committed for the round and cannot be
 * changed. Mechanically this flips `system.rounds[n].locked[groupId]`
 * from `false` to `true`; the scripting UI drops the editable slots in
 * favour of the card-back / read-only view, and the lock button
 * disappears.
 *
 * Rules under test:
 *   - `ConflictPanel.#onLockActions` (conflict-panel.mjs L1735-1774)
 *     reads the three slots' form state, calls `combat.setActions` then
 *     `combat.lockActions(groupId)`. All-slot validation at L1762-1766
 *     blocks the lock if any slot is missing an action or a combatant
 *     (teamSize>1) — we pre-seed complete actions so the path runs
 *     clean.
 *   - `combat.lockActions` (combat.mjs L341-350) branches on viewer:
 *       • Player path — writes the captain's mailbox
 *         `captain.update({"system.pendingActionsLocked": true})`
 *         (L346). The GM hook at `_onUpdateDescendantDocuments` L452-454
 *         observes `pendingActionsLocked` and dispatches to
 *         `#applyLockActions(groupId, mailboxId)` (L525-546).
 *       • GM path — calls `#applyLockActions(groupId)` directly (L349).
 *   - `#applyLockActions` (L525-546) re-validates all three slots are
 *     filled (L532-536), sets `round.locked[groupId] = true` (L538), and
 *     — when invoked via the mailbox — clears the captain's mailbox with
 *     `combatant.update({"system.pendingActionsLocked": false})` (L544).
 *     Because `pendingActionsLocked` is a `BooleanField`
 *     (data/combat/combatant.mjs L22), the `false` clear is an atomic
 *     scalar assignment — unlike the `ObjectField` mailboxes
 *     (`pendingDisposition`, `pendingDistribution`) whose `{}` clear
 *     deep-merges (flagged in `disposition-distribution-player.spec.mjs`).
 *
 * UI reflection (panel-script.hbs):
 *   - Before lock: the group header has no `.script-locked-badge` (L9
 *     is gated on `this.isLocked`), the interactive `.script-slots` is
 *     rendered at L36 (inside `{{#unless this.isLocked}}`), and the
 *     "Lock In" button at L69-71 is rendered because `canLock` is
 *     `canScript && !isLocked` (conflict-panel.mjs L1152).
 *   - After lock: `.script-locked-badge` appears (L10-14), the editable
 *     slots disappear, and the read-only card-back view `.script-slots
 *     .locked` (L107) replaces them. The lock button is gone because
 *     `canLock` flipped false.
 *
 * Scope (TEST_PLAN L428 — narrow to the lock write path):
 *   - Assert `round.locked[groupId]` flips `false → true` via both paths
 *     (GM UI click + simulated player-side mailbox write).
 *   - Assert the mailbox drains via the player-path (`_source.system.
 *     pendingActionsLocked` back to `false`).
 *   - Assert DOM signals: locked badge visible, lock button gone,
 *     read-only slots container rendered.
 *   - Assert post-lock clicks on the old action-card DOM (the locked
 *     read-only cards carry no `action-card` buttons at all — L108-126
 *     emits `.script-card-flip` faces only — so the post-lock interactive
 *     surface is simply absent from the DOM).
 *   - DOES NOT cover: GM peek (L429 — `script-peek-gm.spec.mjs`),
 *     change-before-lock (L430), KO substitution (L431).
 *
 * Staging: identical to `script-assign-actions.spec.mjs` (L427). The
 * scripting tab is reached via flat-disposition + direct `combat.setWeapon`
 * writes so the non-lock UI paths stay off the critical path. Two
 * characters (captain + other) + two monsters (GM captain + mook); the
 * party group is used for lock assertions, the GM group for a second
 * round-trip that exercises the monster/GM captain path.
 *
 * E2E harness constraint: the Playwright session is GM. The player path
 * of `combat.lockActions` (L342-347) is covered by a direct
 * `captain.update({"system.pendingActionsLocked": true})` — the exact
 * payload shape combat.mjs L346 emits. The GM hook runs in the same
 * client because our user is the GM.
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

test.describe('§15 Conflict: Scripting — lock actions', () => {
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
    'lock flips round.locked[groupId], UI shows locked state, mailbox drains (DH p.126)',
    async ({ page }, testInfo) => {
      const tag = `e2e-script-lock-${testInfo.parallelIndex}-${Date.now()}`;
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

        /* ---------- Disposition: flat-set both sides ---------- */

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

        /* ---------- Weapons: stamp weapons directly ---------- */

        await page.evaluate(async ({ cId, ids }) => {
          const c = game.combats.get(cId);
          for ( const id of ids ) {
            await c.setWeapon(id, 'Fists', '__unarmed__');
          }
        }, { cId: combatId, ids: [cmb.captain, cmb.charB, cmb.monA, cmb.monB] });

        await expect(panel.beginScriptingButton).toBeEnabled();
        await panel.clickBeginScripting();

        /* ---------- Scripting: pre-seed both groups' actions ---------- */

        // `#applyLockActions` (combat.mjs L532-536) refuses to lock
        // unless all three slots are filled. Skip the UI click path —
        // we write directly via `combat.setActions` (GM branch writes
        // straight through, combat.mjs L332). Pre-seeding both groups so
        // we can exercise both lock paths (UI click on the party side,
        // simulated mailbox write on the GM side).
        const partyActions = [
          { action: 'attack',   combatantId: cmb.captain },
          { action: 'defend',   combatantId: cmb.charB },
          { action: 'feint',    combatantId: cmb.captain }
        ];
        const gmActions = [
          { action: 'maneuver', combatantId: cmb.monA },
          { action: 'attack',   combatantId: cmb.monB },
          { action: 'defend',   combatantId: cmb.monA }
        ];
        await page.evaluate(async ({ cId, pId, gId, pa, ga }) => {
          const c = game.combats.get(cId);
          await c.setActions(pId, pa);
          await c.setActions(gId, ga);
        }, {
          cId: combatId,
          pId: partyGroupId,
          gId: gmGroupId,
          pa: partyActions,
          ga: gmActions
        });

        await expect
          .poll(() => page.evaluate(({ cId, pId, gId }) => {
            const c = game.combats.get(cId);
            const round = c.system.rounds?.[c.system.currentRound];
            return {
              party: (round?.actions?.[pId] ?? []).map((e) => e?.action ?? null),
              gm: (round?.actions?.[gId] ?? []).map((e) => e?.action ?? null)
            };
          }, { cId: combatId, pId: partyGroupId, gId: gmGroupId }))
          .toEqual({
            party: ['attack', 'defend', 'feint'],
            gm: ['maneuver', 'attack', 'defend']
          });

        /* ---------- Precondition: nothing locked, mailbox clear ---------- */

        const pre = await page.evaluate(({ cId, capId, monAid, pId, gId }) => {
          const c = game.combats.get(cId);
          const captain = c.combatants.get(capId);
          const mon = c.combatants.get(monAid);
          const round = c.system.rounds?.[c.system.currentRound];
          return {
            partyLocked: round?.locked?.[pId] ?? null,
            gmLocked:    round?.locked?.[gId] ?? null,
            captainMailbox: captain?._source.system?.pendingActionsLocked ?? null,
            monMailbox:     mon?._source.system?.pendingActionsLocked ?? null
          };
        }, {
          cId: combatId,
          capId: cmb.captain,
          monAid: cmb.monA,
          pId: partyGroupId,
          gId: gmGroupId
        });
        expect(pre).toEqual({
          partyLocked: false,
          gmLocked: false,
          captainMailbox: false,
          monMailbox: false
        });

        // DOM precondition on the party group: no locked badge, no
        // read-only slots container, lock button visible.
        await expect(panel.scriptLockedBadge(partyGroupId)).toHaveCount(0);
        await expect(panel.scriptSlotsLocked(partyGroupId)).toHaveCount(0);
        await expect(panel.lockActionsButton(partyGroupId)).toBeVisible();

        /* ---------- Act 1: GM UI click on the party lock button ---------- */

        await panel.lockActionsButton(partyGroupId).click();

        // GM path — `combat.lockActions` (L342-350) calls
        // `#applyLockActions(groupId)` directly (L349). No mailbox write
        // expected. The re-render is driven by the combat.update at L539.
        await expect
          .poll(() => page.evaluate(({ cId, pId }) => {
            const c = game.combats.get(cId);
            return c.system.rounds?.[c.system.currentRound]?.locked?.[pId] ?? null;
          }, { cId: combatId, pId: partyGroupId }), { timeout: 10_000 })
          .toBe(true);

        // Captain's mailbox was never written on the GM path.
        expect(await page.evaluate(({ cId, capId }) => {
          return game.combats.get(cId)?.combatants.get(capId)
            ?._source.system?.pendingActionsLocked ?? null;
        }, { cId: combatId, capId: cmb.captain })).toBe(false);

        // DOM: locked badge now visible, lock button gone, read-only
        // slots container rendered. panel-script.hbs L9-16 emits the
        // badge inside the group header, L21 `{{#unless this.isLocked}}`
        // drops the editable slots + lock button, L107 emits the
        // `.script-slots.locked` container.
        await expect(panel.scriptLockedBadge(partyGroupId)).toBeVisible();
        await expect(panel.lockActionsButton(partyGroupId)).toHaveCount(0);
        await expect(panel.scriptSlotsLocked(partyGroupId)).toBeVisible();

        // Post-lock the editable `.action-card` buttons are removed
        // entirely from the party group (the read-only view at
        // panel-script.hbs L108-126 uses `.script-card-flip` faces,
        // no `.action-card`). Confirms re-clicking an old card is
        // structurally impossible, not just gated.
        await expect(
          panel.scriptGroup(partyGroupId).locator('button.action-card')
        ).toHaveCount(0);

        /* ---------- Act 2: simulated player-path mailbox write ---------- */

        // Exercise the non-GM branch of `combat.lockActions` (L342-347)
        // by issuing the exact payload it emits: a direct
        // `captain.update({"system.pendingActionsLocked": true})` on the
        // GM group's captain. Our session is GM, so the GM hook
        // (combat.mjs L452-454) picks up the change in the same client
        // and dispatches to `#applyLockActions` with `mailboxId`.
        await page.evaluate(async ({ cId, monAid }) => {
          const c = game.combats.get(cId);
          const mon = c.combatants.get(monAid);
          await mon.update({ 'system.pendingActionsLocked': true });
        }, { cId: combatId, monAid: cmb.monA });

        // Assert 1: hook processed, `round.locked[gmGroupId] === true`.
        await expect
          .poll(() => page.evaluate(({ cId, gId }) => {
            const c = game.combats.get(cId);
            return c.system.rounds?.[c.system.currentRound]?.locked?.[gId] ?? null;
          }, { cId: combatId, gId: gmGroupId }), { timeout: 10_000 })
          .toBe(true);

        // Assert 2: mailbox drained back to `false` (combat.mjs L544).
        // `pendingActionsLocked` is a `BooleanField`
        // (data/combat/combatant.mjs L22), so the scalar `false` write
        // replaces atomically — no deep-merge hazard.
        await expect
          .poll(
            () => page.evaluate(
              ({ cId, monAid }) => {
                const mon = game.combats.get(cId)?.combatants.get(monAid);
                return mon?._source.system?.pendingActionsLocked ?? null;
              },
              { cId: combatId, monAid: cmb.monA }
            ),
            { timeout: 10_000, message: 'pendingActionsLocked should be drained by GM hook' }
          )
          .toBe(false);

        // Assert 3: actions survived the lock — the lock path only
        // flips `locked[groupId]`, it does NOT mutate
        // `rounds[n].actions[groupId]`. Confirms the two mailbox writes
        // are orthogonal (pendingActions vs pendingActionsLocked).
        const postGmActions = await page.evaluate(({ cId, gId }) => {
          const c = game.combats.get(cId);
          return foundry.utils.deepClone(
            c.system.rounds?.[c.system.currentRound]?.actions?.[gId] ?? []
          );
        }, { cId: combatId, gId: gmGroupId });
        expect(postGmActions).toEqual(gmActions);

        // Assert 4: both sides locked → `canBeginResolve` is true
        // (conflict-panel.mjs L1169-1171 → panel-script.hbs L167-172).
        // The "Begin Resolution" button is enabled once all groups are
        // locked; surfaces the downstream effect of the lock flag.
        await expect(
          panel.scriptContent.locator('button[data-action="beginResolve"]')
        ).toBeEnabled();
      } finally {
        await cleanupTaggedActors(page, tag);
      }
    }
  );
});
