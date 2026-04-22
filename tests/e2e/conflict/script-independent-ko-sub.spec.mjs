import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §15 Conflict: Scripting — KO substitution (TEST_PLAN L431).
 *
 * Per DH pp.125-127 scripted actions are locked-in before volleys
 * resolve, but individual combatants may be knocked out mid-round. The
 * GM must re-route the KO'd combatant's remaining scripted volleys to
 * a still-standing teammate on the same side. The data model handles
 * this with `TB2ECombat.swapActionCombatant(actionIndex, groupId,
 * newCombatantId)` (combat.mjs L413-424), which rewrites
 * `system.rounds[roundNum].actions[groupId][actionIndex].combatantId`
 * atomically via `this.update({"system.rounds": <clone>})` (L417-423).
 * Only GMs can call it (L414).
 *
 * DOM surface (design note): although TEST_PLAN L431 describes this as
 * "scripting UI handles substitution", the actual swap affordance is
 * rendered on the **resolve** tab's pre-reveal block, not the script
 * tab. The `needsSwap` / `swapCandidates` fields (conflict-panel.mjs
 * L1212-1222) are computed only for the current, not-yet-revealed
 * volley, and `panel-resolve.hbs` L36-53 emits `.resolve-pre-swap` +
 * `select.resolve-swap-select` only inside
 * `.resolve-action.current` + `!isRevealed`. The scripting tab itself
 * (panel-script.hbs) does NOT emit a swap control — once a group is
 * locked, panel-script.hbs L107-126 renders a read-only card view with
 * no swap UI. This spec therefore drives the flow through to the
 * resolve tab. The `.resolve-swap-select` change handler at
 * `conflict-panel.mjs` L363-373 is the sole entry point into
 * `swapActionCombatant`.
 *
 * Rules under test:
 *   - `needsSwap` detection (conflict-panel.mjs L1212-1214): a side
 *     flags `needsSwap` iff the volley is `isCurrent`, `!volley.result`,
 *     AND (`actor.system.conflict.hp.value <= 0` OR
 *     `combatant.system.knockedOut`). Our HP mutation drops the scripted
 *     captain's `system.conflict.hp.value` from 4 to 0 — the
 *     `actorHp <= 0` clause — so `needsSwap` flips true. CLAUDE.md
 *     §Unlinked Actors is observed: `combatant.actor` resolves to the
 *     underlying actor document and its HP update is what the resolve
 *     context reads (L1213).
 *   - `swapCandidates` population (L1215-1222): when `needsSwap` is
 *     true AND the viewer is GM OR actor owner (L1216), the candidate
 *     list is every other same-group combatant with `!knockedOut` AND
 *     `hp.value > 0` (L1218-1221). The alive teammate (`charB`) is
 *     in-list; the KO'd `captain` is excluded; the opposing team's
 *     combatants are excluded by the `group === group.id` filter
 *     (L1217).
 *   - `swapActionCombatant` (combat.mjs L413-424): the change handler
 *     at `conflict-panel.mjs` L363-373 reads `combat.system.currentAction`
 *     (L367) and the `data-group-id` / option `value` from the select,
 *     then calls `combat.swapActionCombatant(actionIndex, groupId,
 *     newCombatantId)`. The method (L413-424) gates on
 *     `game.user.isGM` (L414) — our session is GM, so it proceeds —
 *     deep-clones `system.rounds`, mutates
 *     `round.actions[groupId][actionIndex].combatantId` in place
 *     (L422), and commits with `this.update({"system.rounds": rounds})`
 *     (L423). The other two volleys for that group are untouched.
 *   - Lock invariant (combat.mjs L503): `#applyActions` gates on
 *     `round.locked?.[groupId]`, so without `swapActionCombatant` a
 *     player could not re-script the combatantId after lock — the swap
 *     is the **only** supported post-lock re-route. This spec captures
 *     `round.locked[partyGroupId] === true` before AND after the swap
 *     to prove the lock invariant is preserved.
 *
 * Scope (TEST_PLAN L431 — narrow to the KO substitution write path):
 *   - Stage through setup / disposition / weapons / scripting via the
 *     same direct-writes shortcut as L427/L428/L430 (action-assign /
 *     lock / weapon UIs covered elsewhere).
 *   - Lock both groups via `combat.lockActions` direct writes, then
 *     `combat.beginResolve()` to flip `phase === "resolve"` and
 *     `currentAction === 0`. This is the earliest point at which the
 *     resolve-tab pre-swap DOM appears.
 *   - Simulate a KO: `captain.actor.update({"system.conflict.hp.value":
 *     0})`. The panel's `updateActor` hook (conflict-panel.mjs
 *     L126-129) re-renders, and the next-frame render picks up
 *     `needsSwap` / `swapCandidates`. Assert the skull warning + swap
 *     select + expected option list land on the party group's side of
 *     the current volley.
 *   - Perform the swap via the `.resolve-swap-select` `change` event —
 *     select `charB` as the replacement. Poll
 *     `round.actions[partyGroupId][0].combatantId === cmb.charB`.
 *     Assert volleys 1 + 2 are untouched (only currentAction gets
 *     swapped), and that `round.locked[partyGroupId]` remained true
 *     throughout (the whole point of swap is a post-lock re-route).
 *   - DOES NOT cover: resolve-phase reveal/roll/mark-resolved (§16
 *     L459+), deep HP damage mechanics (§18), the automatic re-route
 *     on damage (no such path exists — swap is a manual GM action per
 *     the change-handler requirement L414 `isGM` gate).
 *
 * E2E harness constraint: all Playwright sessions authenticate as GM
 * (auth.setup.mjs L14-35). The swap handler's isGM gate (combat.mjs
 * L414) requires this — a non-GM client cannot drive the change
 * handler anyway because the select is only emitted to GM or actor
 * owner viewers (L1216). The "GM-side" path is therefore the only
 * meaningful path to exercise, and this spec exercises it both via the
 * DOM `.resolve-swap-select` and via a direct `swapActionCombatant`
 * call for the mid-volley sanity check that the lock invariant
 * survives a second swap (round.locked stays true while combatantId
 * changes again).
 *
 * Staging: two characters (captain + charB) + two monsters (GM captain
 * mon + mook) on a Kill conflict, walked through flat-disposition +
 * `combat.setWeapon` + `combat.setActions` + `combat.lockActions`
 * direct writes.
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

test.describe('§15 Conflict: Scripting — KO substitution', () => {
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
    "KO'd combatant mid-round: swap scripted action to alive teammate (DH pp.125-127)",
    async ({ page }, testInfo) => {
      const tag = `e2e-script-ko-${testInfo.parallelIndex}-${Date.now()}`;
      const stamp = Date.now();
      const charAName = `E2E Captain ${stamp}`;
      const charBName = `E2E Char B ${stamp}`;
      const monsterAName = `E2E Bugbear ${stamp}`;
      const monsterBName = `E2E Goblin ${stamp}`;

      await page.goto('/game');
      const ui = new GameUI(page);
      await ui.waitForReady();
      await ui.dismissTours();

      // Swap handler is GM-gated (combat.mjs L414) — our session must
      // be GM for the change listener to produce any effect.
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

        /* ---------- Setup tab ---------- */

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

        /* ---------- Weapons: stamp directly ---------- */

        await page.evaluate(async ({ cId, ids }) => {
          const c = game.combats.get(cId);
          for ( const id of ids ) {
            await c.setWeapon(id, 'Fists', '__unarmed__');
          }
        }, { cId: combatId, ids: [cmb.captain, cmb.charB, cmb.monA, cmb.monB] });

        await expect(panel.beginScriptingButton).toBeEnabled();
        await panel.clickBeginScripting();

        /* ---------- Scripting: pre-seed + lock both sides ---------- */

        // Captain is scripted for volleys 0 AND 2; charB for volley 1.
        // When the captain is KO'd at currentAction=0 the pre-reveal
        // swap UI must surface a swap control that re-routes volley 0
        // to charB. Volley 2's assignment to captain is left untouched
        // to verify `swapActionCombatant`'s actionIndex scope (L420
        // mutates only the single entry).
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

        // Lock both sides via direct writes (GM branch — combat.mjs
        // L349 calls `#applyLockActions` inline).
        await page.evaluate(async ({ cId, pId, gId }) => {
          const c = game.combats.get(cId);
          await c.lockActions(pId);
          await c.lockActions(gId);
        }, { cId: combatId, pId: partyGroupId, gId: gmGroupId });

        await expect
          .poll(() => page.evaluate(({ cId, pId, gId }) => {
            const c = game.combats.get(cId);
            const round = c.system.rounds?.[c.system.currentRound];
            return {
              p: round?.locked?.[pId] ?? null,
              g: round?.locked?.[gId] ?? null
            };
          }, { cId: combatId, pId: partyGroupId, gId: gmGroupId }))
          .toEqual({ p: true, g: true });

        /* ---------- Transition to resolve phase ---------- */

        // `combat.beginResolve` (combat.mjs L357-373) sets
        // `phase = "resolve"` + `currentAction = 0`. The phase-to-tab
        // sync at conflict-panel.mjs L490-499 advances the active tab
        // to "resolve" on the next render.
        await page.evaluate(async ({ cId }) => {
          const c = game.combats.get(cId);
          await c.beginResolve();
        }, { cId: combatId });

        await expect.poll(() => panel.activeTabId()).toBe('resolve');
        expect(await page.evaluate(({ cId }) => {
          const c = game.combats.get(cId);
          return { phase: c.system.phase, currentAction: c.system.currentAction };
        }, { cId: combatId })).toEqual({ phase: 'resolve', currentAction: 0 });

        /* ---------- Precondition: no swap UI before KO ---------- */

        // With everyone at full HP, `needsSwap` is false for every side
        // (conflict-panel.mjs L1214 — `actorHp > 0` AND
        // `!knockedOut`), so `.resolve-pre-swap` is not emitted
        // (panel-resolve.hbs L39 `{{#if this.needsSwap}}` gate).
        await expect(panel.resolveKoWarning(0)).toHaveCount(0);
        await expect(panel.resolveSwapSelect(0, partyGroupId)).toHaveCount(0);

        // Sanity: captain's actor HP is the distributed value (4).
        expect(await page.evaluate((capActorId) => {
          return game.actors.get(capActorId)?.system.conflict?.hp?.value ?? null;
        }, captainId)).toBe(4);

        /* ---------- Act 1: KO captain, swap UI surfaces ---------- */

        // Drive HP to 0 on the captain's actor. The panel's
        // `updateActor` hook (conflict-panel.mjs L126-129) re-renders
        // because a conflict combatant references this actor.
        // CLAUDE.md §Unlinked Actors: non-token combatants resolve
        // `combatant.actor` to the world actor, so writing to
        // `game.actors.get(captainId)` is equivalent to the synthetic
        // actor path used by the code at conflict-panel.mjs L1213.
        await page.evaluate(async (capActorId) => {
          const actor = game.actors.get(capActorId);
          await actor.update({ 'system.conflict.hp.value': 0 });
        }, captainId);

        // Assert: KO warning + swap select now visible for volley 0 on
        // the party group (panel-resolve.hbs L36-53, gated on
        // `needsSwap` + `isGM` + `swapCandidates.length`).
        await expect(panel.resolveKoWarning(0)).toBeVisible();
        await expect(panel.resolveSwapSelect(0, partyGroupId)).toBeVisible();

        // Swap candidates: charB is listed (alive teammate), captain
        // is excluded (self-reference at L1219), monA / monB excluded
        // (different group at L1217). Plus the leading empty
        // placeholder option from panel-resolve.hbs L44.
        const candidateValues = await panel
          .resolveSwapSelect(0, partyGroupId)
          .locator('option')
          .evaluateAll((opts) => opts.map((o) => o.value));
        expect(candidateValues).toEqual(['', cmb.charB]);

        // GM group side is unaffected (captain's KO is scoped to the
        // party group — monster HPs are untouched).
        await expect(panel.resolveSwapSelect(0, gmGroupId)).toHaveCount(0);

        // Lock invariant holds — the swap is a post-lock re-route.
        expect(await page.evaluate(({ cId, pId }) => {
          const c = game.combats.get(cId);
          return c.system.rounds?.[c.system.currentRound]?.locked?.[pId] ?? null;
        }, { cId: combatId, pId: partyGroupId })).toBe(true);

        /* ---------- Act 2: perform swap via DOM dropdown ---------- */

        // The POM helper polls for
        // `round.actions[partyGroupId][0].combatantId === cmb.charB` —
        // this is the primary assertion: `swapActionCombatant`
        // (combat.mjs L413-424) wrote the rounds clone back into the
        // combat document.
        await panel.selectResolveSwap(0, partyGroupId, cmb.charB);

        // Full-structure assertion: only volley 0's combatantId
        // changed. Volleys 1 + 2 are unchanged (charB / captain
        // respectively — `swapActionCombatant` L420-422 only touches
        // `round.actions[groupId][actionIndex]`). The action keys
        // (A/D/F) are preserved on every slot.
        const afterSwap = await page.evaluate(({ cId, pId }) => {
          const c = game.combats.get(cId);
          const round = c.system.rounds?.[c.system.currentRound];
          return foundry.utils.deepClone(round?.actions?.[pId] ?? null);
        }, { cId: combatId, pId: partyGroupId });
        expect(afterSwap).toEqual([
          { action: 'attack', combatantId: cmb.charB },    // swapped
          { action: 'defend', combatantId: cmb.charB },    // untouched
          { action: 'feint',  combatantId: cmb.captain }   // untouched
        ]);

        // Lock invariant STILL holds — the swap did not touch
        // `round.locked` (it only writes `system.rounds` with the
        // mutated `actions` nested object, preserving the sibling
        // `locked` map).
        expect(await page.evaluate(({ cId, pId, gId }) => {
          const c = game.combats.get(cId);
          const round = c.system.rounds?.[c.system.currentRound];
          return {
            p: round?.locked?.[pId] ?? null,
            g: round?.locked?.[gId] ?? null
          };
        }, { cId: combatId, pId: partyGroupId, gId: gmGroupId }))
          .toEqual({ p: true, g: true });

        // GM group's actions are also untouched — the swap is scoped
        // to a single `(groupId, actionIndex)` pair (combat.mjs L420).
        const afterSwapGm = await page.evaluate(({ cId, gId }) => {
          const c = game.combats.get(cId);
          return foundry.utils.deepClone(
            c.system.rounds?.[c.system.currentRound]?.actions?.[gId] ?? null
          );
        }, { cId: combatId, gId: gmGroupId });
        expect(afterSwapGm).toEqual(gmActions);

        /* ---------- Act 3: after swap the swap UI retracts ---------- */

        // Now that volley 0's combatantId points at charB (alive, full
        // HP), the side's `needsSwap` re-computes to false on the next
        // render (conflict-panel.mjs L1213 reads HP from the NEW
        // combatant's actor at L1196). The skull warning + select
        // disappear.
        await expect(panel.resolveKoWarning(0)).toHaveCount(0);
        await expect(panel.resolveSwapSelect(0, partyGroupId)).toHaveCount(0);

        /* ---------- Act 4: direct-call swap survives lock ---------- */

        // Exercise `swapActionCombatant` outside the DOM path — the
        // lock invariant must hold for the programmatic entry point
        // too (the resolve change handler at conflict-panel.mjs
        // L363-373 calls the same method). Re-point volley 0 back to
        // the captain via direct call — the method does NOT re-check
        // lock state (combat.mjs L413-424 only gates on isGM + round
        // existence), which is intentional: swap is the post-lock
        // re-route path.
        await page.evaluate(async ({ cId, pId, capId }) => {
          const c = game.combats.get(cId);
          await c.swapActionCombatant(0, pId, capId);
        }, { cId: combatId, pId: partyGroupId, capId: cmb.captain });

        await expect
          .poll(() => page.evaluate(({ cId, pId }) => {
            const c = game.combats.get(cId);
            const round = c.system.rounds?.[c.system.currentRound];
            return round?.actions?.[pId]?.[0]?.combatantId ?? null;
          }, { cId: combatId, pId: partyGroupId }))
          .toBe(cmb.captain);

        // Lock state remains true. The captain's HP is still 0 so the
        // swap UI re-appears (same `needsSwap` branch as Act 1).
        expect(await page.evaluate(({ cId, pId }) => {
          const c = game.combats.get(cId);
          return c.system.rounds?.[c.system.currentRound]?.locked?.[pId] ?? null;
        }, { cId: combatId, pId: partyGroupId })).toBe(true);
        await expect(panel.resolveKoWarning(0)).toBeVisible();
        await expect(panel.resolveSwapSelect(0, partyGroupId)).toBeVisible();
      } finally {
        await cleanupTaggedActors(page, tag);
      }
    }
  );
});
