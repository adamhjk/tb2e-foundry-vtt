import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §15 Conflict: Scripting — Change Action Before Lock (TEST_PLAN L430).
 *
 * Per DH pp.124-126 a team may freely revise its scripted actions up
 * until it "Locks In" — re-clicking a different action-card for the
 * same volley replaces the previous choice. Mechanically the re-click
 * replays the same `#onActionCardClick` → `#syncPendingActions` →
 * `combat.setActions` round-trip described in the §15 L427 spec, but
 * with a **fresh payload**; the round's stored
 * `system.rounds[n].actions[groupId]` must reflect the last click, the
 * previous action must no longer appear, and `pendingActionsLocked`
 * must stay `false` the entire time.
 *
 * Rules under test (conflict-panel.mjs / combat.mjs):
 *   - `#onActionCardClick` (conflict-panel.mjs L228-250): clicking a
 *     second action on the same slot updates the hidden
 *     `.action-select` input (L237), toggles `.selected` OFF the prior
 *     card and ON the new one (L239-241), overwrites the cached
 *     pending selection (L246 → `#cachePendingSelection` L406-411 uses
 *     `Object.assign`), and re-kicks `#syncPendingActions(groupId)`
 *     (L247).
 *   - `#syncPendingActions` (L418-442) is debounced by 300ms: a second
 *     call within the window clears the pending timeout (L419) and
 *     replaces it with a fresh one — so two rapid clicks result in a
 *     **single** `combat.setActions` call carrying the second click's
 *     payload. A subsequent click that lands AFTER the first timer has
 *     already fired schedules a **second** `combat.setActions` call
 *     that replaces the first.
 *   - `combat.setActions` (combat.mjs L324-333) branches on viewer
 *     role; the stored array at `system.rounds[n].actions[groupId]`
 *     is replaced atomically either way (GM path: L332 →
 *     `#applyActions` L510 assigns; player path: L329 writes
 *     `captain.update({"system.pendingActions": <new array>})` which
 *     the GM hook at L449-451 hands to `#applyActions`).
 *   - `#applyActions` (L498-518) gates on `round.locked?.[groupId]`
 *     (L503): once locked, further action writes silently no-op —
 *     so the "change before lock" assertion is meaningful ONLY while
 *     `locked[groupId]` is false, which this spec verifies before
 *     every mutation.
 *
 * Mailbox schema (data/combat/combatant.mjs):
 *   - `pendingActions: ArrayField(ObjectField())` (L21) — atomic `[]`
 *     clear at combat.mjs L516.
 *   - `pendingActionsLocked: BooleanField` (L22) — atomic `false`
 *     scalar assignment; never touched by this spec (lock is orthogonal,
 *     covered by L428 `script-lock.spec.mjs`).
 *   The sibling `ObjectField` mailboxes (`pendingDisposition`,
 *   `pendingDistribution`) have the `{}`-clear deep-merge bug flagged
 *   in `conflict/disposition-distribution-player.spec.mjs` (L392); the
 *   `ArrayField` used here is immune because array updates replace
 *   atomically.
 *
 * Scope (TEST_PLAN L430 — narrow to the "change" write path):
 *   - UI path: pick action A (attack) for volley 0 on the captain,
 *     wait for the server-side write to land, then change the SAME
 *     volley to action B (defend) without locking. Assert combat
 *     reflects B (not A), DOM has `.selected` on B (not A),
 *     `pendingActionsLocked` is still false, and the lock button is
 *     still visible / lockable.
 *   - Mailbox path: simulate the non-GM captain.update write twice in
 *     succession — once with action C (feint), once with action D
 *     (maneuver) — verifying the hook re-processes each write and the
 *     stored action ends on D, with the mailbox drained each time.
 *   - DOES NOT cover: lock itself (L428), GM peek (L429), KO
 *     substitution (L431). Does NOT deep-test debounce semantics —
 *     the only debounce property asserted is "second click wins", via
 *     a post-settle poll rather than timing assumptions.
 *
 * E2E harness constraint (shared with all §13/§15 specs): all
 * Playwright sessions authenticate as GM, so the player branch of
 * `combat.setActions` is exercised by a direct
 * `captain.update({"system.pendingActions": actions})` — the exact
 * payload combat.mjs L329 emits. The GM hook runs in the same client
 * because `game.user.isGM` is true.
 *
 * Staging: mirrors L427/L428 — two characters (captain + other) + two
 * monsters (GM captain + mook) on a Kill conflict, walked through
 * flat-disposition + direct `combat.setWeapon` writes to the scripting
 * tab. All four A/D/F/M keys (config.mjs L392-397) are touched across
 * the two paths.
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

test.describe('§15 Conflict: Scripting — change action before lock', () => {
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
    'changing an action before locking updates the mailbox (DH pp.124-126)',
    async ({ page }, testInfo) => {
      const tag = `e2e-script-change-${testInfo.parallelIndex}-${Date.now()}`;
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

        /* ---------- Precondition: scripting tab, nothing assigned ---------- */

        expect(await page.evaluate((cId) => {
          return game.combats.get(cId)?.system.phase ?? null;
        }, combatId)).toBe('scripting');

        await expect(panel.scriptSlot(partyGroupId, 0)).toBeVisible();
        const pre = await page.evaluate(({ cId, capId, pId }) => {
          const c = game.combats.get(cId);
          const captain = c.combatants.get(capId);
          const round = c.system.rounds?.[c.system.currentRound];
          return {
            pendingActions: foundry.utils.deepClone(
              captain?._source.system?.pendingActions ?? null
            ),
            pendingActionsLocked: captain?._source.system?.pendingActionsLocked ?? null,
            actions: foundry.utils.deepClone(round?.actions?.[pId] ?? null),
            locked: round?.locked?.[pId] ?? null
          };
        }, { cId: combatId, capId: cmb.captain, pId: partyGroupId });
        expect(pre).toEqual({
          pendingActions: [],
          pendingActionsLocked: false,
          actions: [null, null, null],
          locked: false
        });

        /* ---------- Act (UI path): assign A, then change to B ---------- */

        // Step 1: pick attack on volley 0 for the captain. The
        // combatant-select has to be set first because `.script-slots`
        // validates a combatantId per slot in `#syncPendingActions`
        // (conflict-panel.mjs L435-437).
        await panel.selectSlotCombatant(partyGroupId, 0, cmb.captain);
        await panel.clickAction(partyGroupId, 0, 'attack');

        // Wait for the debounced `#syncPendingActions` (300ms,
        // conflict-panel.mjs L420) → `combat.setActions` → GM-path
        // `#applyActions` (combat.mjs L510-511) to commit "attack".
        await expect
          .poll(() => page.evaluate(({ cId, pId }) => {
            const c = game.combats.get(cId);
            const round = c.system.rounds?.[c.system.currentRound];
            const entry = round?.actions?.[pId]?.[0];
            return entry?.action ?? null;
          }, { cId: combatId, pId: partyGroupId }), { timeout: 5_000 })
          .toBe('attack');

        // Sanity: lock flag is still false — the whole point of this
        // spec is that we're editing BEFORE lock.
        expect(await page.evaluate(({ cId, pId }) => {
          const c = game.combats.get(cId);
          return c.system.rounds?.[c.system.currentRound]?.locked?.[pId] ?? null;
        }, { cId: combatId, pId: partyGroupId })).toBe(false);

        // Step 2: change the SAME slot to defend. No lock in between.
        // This exercises `#onActionCardClick` (conflict-panel.mjs
        // L228-250) on an already-populated slot — the hidden
        // `.action-select` input must update, `.selected` must migrate
        // from attack to defend, and a fresh `#syncPendingActions`
        // must re-fire and overwrite the stored action.
        await panel.clickAction(partyGroupId, 0, 'defend');

        // Poll for the second `combat.setActions` to land — stored
        // action now reflects "defend" (not "attack").
        await expect
          .poll(() => page.evaluate(({ cId, pId }) => {
            const c = game.combats.get(cId);
            const round = c.system.rounds?.[c.system.currentRound];
            const entry = round?.actions?.[pId]?.[0];
            return entry?.action ?? null;
          }, { cId: combatId, pId: partyGroupId }), { timeout: 5_000 })
          .toBe('defend');

        // Full stored volley-0 entry is the new selection.
        const storedAfterChange = await page.evaluate(({ cId, pId }) => {
          const c = game.combats.get(cId);
          const round = c.system.rounds?.[c.system.currentRound];
          return foundry.utils.deepClone(round?.actions?.[pId]?.[0] ?? null);
        }, { cId: combatId, pId: partyGroupId });
        expect(storedAfterChange).toEqual({
          action: 'defend',
          combatantId: cmb.captain
        });

        // DOM reflects the change: defend has `.selected`, attack does
        // NOT (`#onActionCardClick` L239-241 toggles `.selected` such
        // that only the clicked card has it).
        await expect(panel.actionCard(partyGroupId, 0, 'defend'))
          .toHaveClass(/\bselected\b/);
        await expect(panel.actionCard(partyGroupId, 0, 'attack'))
          .not.toHaveClass(/\bselected\b/);

        // Lock state is STILL false — "before lock" means
        // `pendingActionsLocked` was never touched by either click.
        const postUi = await page.evaluate(({ cId, capId, pId }) => {
          const c = game.combats.get(cId);
          const captain = c.combatants.get(capId);
          const round = c.system.rounds?.[c.system.currentRound];
          return {
            pendingActionsLocked: captain?._source.system?.pendingActionsLocked ?? null,
            locked: round?.locked?.[pId] ?? null
          };
        }, { cId: combatId, capId: cmb.captain, pId: partyGroupId });
        expect(postUi).toEqual({ pendingActionsLocked: false, locked: false });

        // Lock button is still rendered (canLock is true while
        // unlocked — conflict-panel.mjs L1152), confirming the
        // editable phase is ongoing.
        await expect(panel.lockActionsButton(partyGroupId)).toBeVisible();
        await expect(panel.scriptLockedBadge(partyGroupId)).toHaveCount(0);

        /* ---------- Act (mailbox path): simulate player write, then change ---------- */

        // Exercise the non-GM branch of `combat.setActions` (combat.mjs
        // L325-331) by issuing the exact payload it emits — a direct
        // `captain.update({"system.pendingActions": <new array>})`.
        // The GM hook (combat.mjs L449-451) picks it up in the same
        // client and hands off to `#applyActions` (L498-518). We write
        // TWICE to prove "change before lock" also works via the
        // mailbox path.
        //
        // Write 1 — all-feint payload (covers feint). The payload
        // shape is the three-entry array `combat.mjs` L329 emits for a
        // full script; a full array is required because
        // `#applyLockActions` (L534) validates `length < 3`, but even
        // for the non-lock path `#applyActions` writes whatever it
        // receives so we keep the payload aligned with the UI's shape.
        const feintPayload = [
          { action: 'feint', combatantId: cmb.captain },
          { action: 'feint', combatantId: cmb.charB },
          { action: 'feint', combatantId: cmb.captain }
        ];
        await page.evaluate(
          async ({ cId, capId, actions }) => {
            const c = game.combats.get(cId);
            const captain = c.combatants.get(capId);
            await captain.update({ 'system.pendingActions': actions });
          },
          { cId: combatId, capId: cmb.captain, actions: feintPayload }
        );

        // Assert GM hook processed write 1 — stored volley-0 is feint
        // and the mailbox is drained (combat.mjs L516).
        await expect
          .poll(() => page.evaluate(({ cId, pId }) => {
            const c = game.combats.get(cId);
            const round = c.system.rounds?.[c.system.currentRound];
            return (round?.actions?.[pId] ?? []).map((e) => e?.action ?? null);
          }, { cId: combatId, pId: partyGroupId }), { timeout: 10_000 })
          .toEqual(['feint', 'feint', 'feint']);
        await expect
          .poll(() => page.evaluate(({ cId, capId }) => {
            const captain = game.combats.get(cId)?.combatants.get(capId);
            return foundry.utils.deepClone(
              captain?._source.system?.pendingActions ?? null
            );
          }, { cId: combatId, capId: cmb.captain }), { timeout: 10_000 })
          .toEqual([]);

        // Still NOT locked.
        expect(await page.evaluate(({ cId, capId, pId }) => {
          const c = game.combats.get(cId);
          return {
            locked: c.system.rounds?.[c.system.currentRound]?.locked?.[pId] ?? null,
            pendingActionsLocked:
              c.combatants.get(capId)?._source.system?.pendingActionsLocked ?? null
          };
        }, { cId: combatId, capId: cmb.captain, pId: partyGroupId }))
          .toEqual({ locked: false, pendingActionsLocked: false });

        // Write 2 — "change" to an all-maneuver payload. This
        // exercises the re-entrant mailbox path: the captain writes
        // `pendingActions` a second time before any lock, and the hook
        // re-processes. `#applyActions` gates on
        // `round.locked?.[groupId]` (combat.mjs L503) — since lock is
        // still false, the new payload overwrites the old one.
        const maneuverPayload = [
          { action: 'maneuver', combatantId: cmb.captain },
          { action: 'maneuver', combatantId: cmb.charB },
          { action: 'maneuver', combatantId: cmb.captain }
        ];
        await page.evaluate(
          async ({ cId, capId, actions }) => {
            const c = game.combats.get(cId);
            const captain = c.combatants.get(capId);
            await captain.update({ 'system.pendingActions': actions });
          },
          { cId: combatId, capId: cmb.captain, actions: maneuverPayload }
        );

        // Assert: stored actions now reflect maneuver (the LATEST
        // write), NOT feint. Mailbox drained again.
        await expect
          .poll(() => page.evaluate(({ cId, pId }) => {
            const c = game.combats.get(cId);
            const round = c.system.rounds?.[c.system.currentRound];
            return foundry.utils.deepClone(round?.actions?.[pId] ?? null);
          }, { cId: combatId, pId: partyGroupId }), { timeout: 10_000 })
          .toEqual(maneuverPayload);
        await expect
          .poll(() => page.evaluate(({ cId, capId }) => {
            const captain = game.combats.get(cId)?.combatants.get(capId);
            return foundry.utils.deepClone(
              captain?._source.system?.pendingActions ?? null
            );
          }, { cId: combatId, capId: cmb.captain }), { timeout: 10_000 })
          .toEqual([]);

        // Assert: lock flag remains false throughout — the whole
        // "before lock" invariant holds across four write events
        // (UI attack, UI defend, mailbox feint, mailbox maneuver).
        const postMailbox = await page.evaluate(({ cId, capId, pId }) => {
          const c = game.combats.get(cId);
          const captain = c.combatants.get(capId);
          return {
            pendingActionsLocked: captain?._source.system?.pendingActionsLocked ?? null,
            locked: c.system.rounds?.[c.system.currentRound]?.locked?.[pId] ?? null
          };
        }, { cId: combatId, capId: cmb.captain, pId: partyGroupId });
        expect(postMailbox).toEqual({
          pendingActionsLocked: false,
          locked: false
        });

        // Lock button is STILL rendered (never locked). The read-only
        // `.script-slots.locked` container at panel-script.hbs L107 is
        // NOT present because `isLocked` is false (L21 `{{#unless
        // this.isLocked}}` keeps the editable slots).
        await expect(panel.lockActionsButton(partyGroupId)).toBeVisible();
        await expect(panel.scriptSlotsLocked(partyGroupId)).toHaveCount(0);

        // Sanity: re-clicking a third action on the UI still works
        // — the mailbox-path writes didn't wedge the DOM's
        // `#pendingSelections` cache. Click attack on volley 1 to
        // confirm the editable surface remains live AFTER two mailbox
        // rewrites to volley 0. Then confirm it lands via the GM-path
        // `#applyActions` (our session is GM — L332).
        await panel.selectSlotCombatant(partyGroupId, 1, cmb.charB);
        await panel.clickAction(partyGroupId, 1, 'attack');
        await expect
          .poll(() => page.evaluate(({ cId, pId }) => {
            const c = game.combats.get(cId);
            const round = c.system.rounds?.[c.system.currentRound];
            return round?.actions?.[pId]?.[1]?.action ?? null;
          }, { cId: combatId, pId: partyGroupId }), { timeout: 5_000 })
          .toBe('attack');
      } finally {
        await cleanupTaggedActors(page, tag);
      }
    }
  );
});
