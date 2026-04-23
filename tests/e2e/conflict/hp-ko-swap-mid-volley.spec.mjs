import { test, expect } from '../test.mjs';
import { scriptAndLockActions } from '../helpers/conflict-scripting.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §18 Conflict: HP & KO — panel-resolve "swap" replaces KO'd combatant
 * mid-volley after HP is driven to zero via the `pendingConflictHP`
 * mailbox (TEST_PLAN L503).
 *
 * Overlaps and scope distinction vs TEST_PLAN L431
 * (tests/e2e/conflict/script-independent-ko-sub.spec.mjs, §15):
 *   - L431 drives the KO by a direct world-actor write
 *     (`actor.update({"system.conflict.hp.value": 0})`) BEFORE the
 *     resolve tab reads `needsSwap`. That spec's focus is the scripting/
 *     resolve transition surface and `swapActionCombatant` as a write
 *     path.
 *   - L503's focus (this spec): the KO arrives MID-VOLLEY through the
 *     `flags.tb2e.pendingConflictHP` mailbox — the canonical non-GM HP
 *     edit path per CLAUDE.md §Mailbox Pattern. We stage a fully
 *     scripted/locked resolve-phase volley where the captain starts at
 *     full HP and is alive, THEN write the mailbox to drive HP to 0, and
 *     verify the panel's `needsSwap` surface reacts and a subsequent
 *     DOM-driven swap invokes `combat.swapActionCombatant` correctly.
 *
 * Implementation map (re-derived from current source):
 *   - Mailbox drain (GM-guarded): tb2e.mjs L185-204.
 *     `changes.flags.tb2e.pendingConflictHP = { newValue, targetActorId? }`
 *     → resolves target (defaults to `actor` writer), clamps newValue
 *     into `[0, max]` (L198-199), `targetActor.update({"system.conflict
 *     .hp.value": newVal})` (L200), then unsetFlag on the writer (L201).
 *   - `needsSwap` computation: conflict-panel.mjs L1213-1214:
 *       const actorHp = actor?.system.conflict?.hp?.value ?? 1;
 *       const needsSwap = isCurrent && !volley.result
 *         && (actorHp <= 0 || combatant?.system.knockedOut);
 *     The `actorHp <= 0` disjunct is the paper-over path for the
 *     production gap flagged at TEST_PLAN L502 — `combatant.system
 *     .knockedOut` has zero writers in `module/`, but because the
 *     predicate is OR'd, HP→0 alone suffices to flip `needsSwap` true.
 *     This spec therefore goes GREEN (not fixme) — the paper-over
 *     predicate is exactly the scope of L503.
 *   - `swapCandidates` population: conflict-panel.mjs L1215-1222 — same
 *     side only (`c._source.group === group.id`, L1217), excludes the
 *     KO'd entry (`c.id !== entry.combatantId`, L1219), excludes any
 *     same-side teammate that is also KO'd (`!c.system.knockedOut`,
 *     L1219) or at 0 HP (`hp.value > 0`, L1220). Gated on GM OR actor
 *     owner at L1216.
 *   - DOM → call pipeline: panel-resolve.hbs L40-49 renders
 *     `<select class="resolve-swap-select" data-group-id="…">` inside
 *     `.resolve-pre-swap` only when `needsSwap` is true. The change
 *     listener at conflict-panel.mjs L363-373 reads
 *     `combat.system.currentAction` (L367), `event.target.dataset.groupId`
 *     (L368), and `event.target.value` (L369) and calls
 *     `combat.swapActionCombatant(actionIndex, groupId, newCombatantId)`
 *     (L371). That method (combat.mjs L413-424) deep-clones
 *     `system.rounds`, mutates `actions[groupId][actionIndex]
 *     .combatantId` (L422), and persists via `this.update(...)` (L423).
 *   - CLAUDE.md §Unlinked Actors: the panel reads HP via
 *     `combatant.actor` (L1196/L1213). For linked-character combatants
 *     (this spec), `combatant.actor` === world actor, so a
 *     `game.actors.get(id).update({...})` from inside the mailbox hook
 *     is observed by the resolve predicate. The parity edge for
 *     unlinked synthetic-token combatants is TEST_PLAN L505's scope.
 *
 * Verifying the `swapActionCombatant` call:
 *   - Same idiom as L431: there is no other code path in `module/` that
 *     mutates `round.actions[groupId][actionIndex].combatantId` post-
 *     lock (combat.mjs L503 `#applyActions` gates on `round.locked`, so
 *     `setActions` is a no-op on a locked group). Observing the
 *     combatantId flip via `expect.poll` therefore constitutes proof of
 *     the call — no spy needed. Additionally we assert the
 *     one-entry-changed invariant (volleys 1 and 2 untouched) to prove
 *     the method's `actionIndex` scoping (combat.mjs L420-422).
 *
 * Staging (matches L431 — direct writes bypass the action-assign / lock
 * UIs, which are covered by TEST_PLAN L427/L430):
 *   - Two characters (captain + alt) on the party side, two monsters
 *     (GM captain + mook) on the GM side.
 *   - Kill conflict, flat-dispose HP, weapons stamped as __unarmed__
 *     (panel gates permit the transition).
 *   - Party volley 0 scripted to captain, volley 1 to alt, volley 2 to
 *     captain (mirror L431's pattern). Both sides locked. Resolve phase
 *     entered. Everyone at full HP — precondition: no swap UI visible.
 *   - Mailbox write: `captainActor.update({"flags.tb2e.pendingConflictHP":
 *     { newValue: 0 }})`. GM hook fires synchronously in our session,
 *     clamps to [0, max=4], writes HP=0, clears flag.
 *   - Assert: `needsSwap` flipped, `.resolve-pre-swap` + KO warning +
 *     swap select all land on the party side of volley 0, swap
 *     candidates = [alt] only.
 *   - Drive the DOM swap via `selectResolveSwap(0, partyGroupId, alt)`;
 *     poll `round.actions[partyGroupId][0].combatantId === alt`.
 *     Verify volleys 1+2 untouched and GM-side actions untouched
 *     (actionIndex/groupId scoping of `swapActionCombatant`).
 *   - Post-swap: the swap UI retracts (volley 0 now points at an alive
 *     combatant). Mailbox flag stays cleared on the writer.
 *
 * Explicit non-scope (owned by other checkboxes):
 *   - Self-write / targetActorId split of the mailbox — TEST_PLAN L501.
 *   - HP auto-damage from resolve pipeline — TEST_PLAN L500 (fixmed).
 *   - `combatant.system.knockedOut` flag flip — TEST_PLAN L502 (fixmed,
 *     production gap). This spec deliberately exercises only the
 *     paper-over branch (`actorHp <= 0`) so it can go green without
 *     depending on that fix.
 *   - Synthetic-token HP parity (unlinked monster HP writes) —
 *     TEST_PLAN L505.
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

test.describe('§18 Conflict: HP & KO — swap after mid-volley mailbox KO', () => {
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
    "pendingConflictHP mailbox drives HP to 0 mid-volley → resolve-swap select re-routes the scripted combatant (TEST_PLAN L503)",
    async ({ page }, testInfo) => {
      const tag = `e2e-hp-ko-swap-${testInfo.parallelIndex}-${Date.now()}`;
      const stamp = Date.now();
      const captainName = `E2E KO Swap Captain ${stamp}`;
      const altName = `E2E KO Swap Alt ${stamp}`;
      const monsterAName = `E2E KO Swap Bugbear ${stamp}`;
      const monsterBName = `E2E KO Swap Goblin ${stamp}`;

      await page.goto('/game');
      const ui = new GameUI(page);
      await ui.waitForReady();
      await ui.dismissTours();

      // Resolve swap handler is GM-gated (combat.mjs L414) and the
      // mailbox drain is GM-gated (tb2e.mjs L186). Our harness IS GM.
      expect(await page.evaluate(() => game.user.isGM)).toBe(true);

      try {
        /* ---------- Arrange actors ---------- */

        const captainId = await createCharacter(page, {
          name: captainName, tag
        });
        const altId = await createCharacter(page, { name: altName, tag });
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
        cmb.alt = await panel.addCombatant({
          combatId, actorId: altId, groupId: partyGroupId
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

        // Captain seeded to HP=4, alt to HP=3 (teammate candidate must
        // have hp.value > 0 to survive the swapCandidates filter at
        // conflict-panel.mjs L1220). Monsters at 4 each.
        await page.evaluate(async ({ cId, pId, gId }) => {
          const c = game.combats.get(cId);
          await c.storeDispositionRoll(pId, {
            rolled: 7, diceResults: [], cardHtml: '<em>E2E</em>'
          });
          await c.storeDispositionRoll(gId, {
            rolled: 8, diceResults: [], cardHtml: '<em>E2E</em>'
          });
        }, { cId: combatId, pId: partyGroupId, gId: gmGroupId });

        await page.evaluate(async ({ cId, pId, gId, capId, aId, mAId, mBId }) => {
          const c = game.combats.get(cId);
          const party = {}; party[capId] = 4; party[aId] = 3;
          const gm = {};    gm[mAId]   = 4; gm[mBId]   = 4;
          await c.distributeDisposition(pId, party);
          await c.distributeDisposition(gId, gm);
        }, {
          cId: combatId,
          pId: partyGroupId,
          gId: gmGroupId,
          capId: cmb.captain,
          aId: cmb.alt,
          mAId: cmb.monA,
          mBId: cmb.monB
        });

        // Sanity: disposition distribution seeded actor HP via
        // combat.mjs L231. Captain actor hp.max must be non-zero or the
        // mailbox clamp at tb2e.mjs L198-199 would pin newValue to 0
        // silently (the KO case we WANT here, but we need max>0 to
        // distinguish a successful write from a clamp side effect on
        // later re-writes).
        expect(await page.evaluate((id) => {
          const a = game.actors.get(id);
          return {
            value: a?.system.conflict?.hp?.value ?? null,
            max: a?.system.conflict?.hp?.max ?? null
          };
        }, captainId)).toEqual({ value: 4, max: 4 });

        await expect(panel.beginWeaponsButton).toBeEnabled();
        await panel.clickBeginWeapons();

        /* ---------- Weapons: stamp __unarmed__ directly ---------- */

        await page.evaluate(async ({ cId, ids }) => {
          const c = game.combats.get(cId);
          for ( const id of ids ) {
            await c.setWeapon(id, 'Fists', '__unarmed__');
          }
        }, {
          cId: combatId,
          ids: [cmb.captain, cmb.alt, cmb.monA, cmb.monB]
        });

        await expect(panel.beginScriptingButton).toBeEnabled();
        await panel.clickBeginScripting();

        /* ---------- Scripting: pre-seed + lock both sides ---------- */

        // Captain scripted for V0 and V2; alt for V1. Swap target for
        // V0's KO is alt (the only same-side, non-captain combatant).
        // V2's captain slot is left alone to exercise the actionIndex-
        // scoping of `swapActionCombatant` (combat.mjs L420-422 mutates
        // ONE slot only).
        const partyActions = [
          { action: 'attack',   combatantId: cmb.captain },
          { action: 'defend',   combatantId: cmb.alt },
          { action: 'feint',    combatantId: cmb.captain }
        ];
        const gmActions = [
          { action: 'maneuver', combatantId: cmb.monA },
          { action: 'attack',   combatantId: cmb.monB },
          { action: 'defend',   combatantId: cmb.monA }
        ];
        /* ---------- Script + lock + resolve ---------- */

        await scriptAndLockActions(page, {
          combatId, partyGroupId, gmGroupId, partyActions, gmActions
        });

        await expect.poll(() => panel.activeTabId()).toBe('resolve');
        expect(await page.evaluate(({ cId }) => {
          const c = game.combats.get(cId);
          return { phase: c.system.phase, currentAction: c.system.currentAction };
        }, { cId: combatId })).toEqual({ phase: 'resolve', currentAction: 0 });

        /* ---------- Precondition: no swap UI, no mailbox flag ---------- */

        // Full HP → `needsSwap` false (conflict-panel.mjs L1214) → no
        // `.resolve-pre-swap` / `.resolve-ko-warning` / swap select on
        // either side for volley 0.
        await expect(panel.resolveKoWarning(0)).toHaveCount(0);
        await expect(panel.resolveSwapSelect(0, partyGroupId)).toHaveCount(0);
        await expect(panel.resolveSwapSelect(0, gmGroupId)).toHaveCount(0);

        // Mailbox flag absent on the captain actor.
        expect(await page.evaluate((id) => {
          return game.actors.get(id)?.getFlag('tb2e', 'pendingConflictHP') ?? null;
        }, captainId)).toBeNull();

        /* ---------- Act: mid-volley mailbox KO ---------- */

        // Player-side write simulated (we're GM; hook fires synchronously
        // in-session). Bundled `update()` matches the grind/
        // apply-condition-mailbox.spec.mjs L179-185 idiom and the sibling
        // hp-player-mailbox.spec.mjs L162 idiom — a single update()
        // carries the mailbox payload so the `changes` diff visible to
        // the updateActor hook (tb2e.mjs L193) contains the
        // `flags.tb2e.pendingConflictHP` key.
        await page.evaluate(async (id) => {
          const captain = game.actors.get(id);
          await captain.update({
            'flags.tb2e.pendingConflictHP': { newValue: 0 }
          });
        }, captainId);

        // 1. Mailbox-drain: HP clamped into [0, max=4] and written to 0
        //    (tb2e.mjs L198-200). Poll — the target update resolves
        //    async off the hook's `.then()` chain.
        await expect
          .poll(
            () => page.evaluate(
              (id) => game.actors.get(id)?.system.conflict?.hp?.value ?? null,
              captainId
            ),
            { timeout: 10_000, message: 'mailbox newValue=0 should clamp/write hp.value=0' }
          )
          .toBe(0);

        // 2. Mailbox flag cleared on the writer (tb2e.mjs L201 —
        //    `actor.unsetFlag` chained off target update's .then()).
        await expect
          .poll(
            () => page.evaluate(
              (id) => game.actors.get(id)?.getFlag('tb2e', 'pendingConflictHP') ?? null,
              captainId
            ),
            { timeout: 10_000, message: 'mailbox flag should be cleared by GM hook' }
          )
          .toBeNull();

        /* ---------- Assert: swap UI surfaces on party side V0 ---------- */

        // `needsSwap` computation (conflict-panel.mjs L1213-1214) now
        // sees `actorHp === 0` so the disjunct `actorHp <= 0` fires —
        // this is the paper-over path that lets this spec go green
        // without the L502 `knockedOut` writer fix.
        await expect(panel.resolveKoWarning(0)).toBeVisible();
        await expect(panel.resolveSwapSelect(0, partyGroupId)).toBeVisible();

        // Swap candidates: alt is the only same-side, non-KO,
        // hp.value > 0 teammate (conflict-panel.mjs L1217-1221). Captain
        // self-excluded at L1219. GM-side combatants excluded by the
        // `group === group.id` filter at L1217. Plus the empty
        // placeholder option at panel-resolve.hbs L44.
        const partyCandidates = await panel
          .resolveSwapSelect(0, partyGroupId)
          .locator('option')
          .evaluateAll((opts) => opts.map((o) => o.value));
        expect(partyCandidates).toEqual(['', cmb.alt]);

        // GM side is unaffected — monster HP untouched, their
        // `needsSwap` stays false for V0.
        await expect(panel.resolveSwapSelect(0, gmGroupId)).toHaveCount(0);

        // Lock invariant held through the HP mutation —
        // `pendingConflictHP` touches only `system.conflict.hp.value`
        // on the Actor, not the Combat document.
        expect(await page.evaluate(({ cId, pId, gId }) => {
          const c = game.combats.get(cId);
          const round = c.system.rounds?.[c.system.currentRound];
          return {
            p: round?.locked?.[pId] ?? null,
            g: round?.locked?.[gId] ?? null
          };
        }, { cId: combatId, pId: partyGroupId, gId: gmGroupId }))
          .toEqual({ p: true, g: true });

        /* ---------- Act: DOM-driven swap via resolve-swap-select ---------- */

        // Fires the change handler at conflict-panel.mjs L363-373,
        // which reads `combat.system.currentAction` (=0), the group id
        // from data-group-id, and the selected option value, then calls
        // `combat.swapActionCombatant(0, partyGroupId, cmb.alt)`. That
        // method (combat.mjs L413-424) mutates
        // `round.actions[partyGroupId][0].combatantId` and persists via
        // `this.update({"system.rounds": rounds})`. The POM helper
        // polls that write and returns when the combatantId flip lands
        // — observing the flip constitutes proof of the method call
        // (no other code path mutates `actions[…][…].combatantId` on a
        // locked round — combat.mjs L503 gates `#applyActions`).
        await panel.selectResolveSwap(0, partyGroupId, cmb.alt);

        // Full party-actions snapshot: only V0 changed. V1's defend/alt
        // and V2's feint/captain are untouched (actionIndex scoping at
        // combat.mjs L420-422). Action keys preserved on every slot.
        const afterSwapParty = await page.evaluate(({ cId, pId }) => {
          const c = game.combats.get(cId);
          const round = c.system.rounds?.[c.system.currentRound];
          return foundry.utils.deepClone(round?.actions?.[pId] ?? null);
        }, { cId: combatId, pId: partyGroupId });
        expect(afterSwapParty).toEqual([
          { action: 'attack', combatantId: cmb.alt },     // swapped
          { action: 'defend', combatantId: cmb.alt },     // untouched
          { action: 'feint',  combatantId: cmb.captain }  // untouched
        ]);

        // GM side actions completely untouched — swap is scoped to the
        // single `(groupId, actionIndex)` pair (combat.mjs L420).
        const afterSwapGm = await page.evaluate(({ cId, gId }) => {
          const c = game.combats.get(cId);
          return foundry.utils.deepClone(
            c.system.rounds?.[c.system.currentRound]?.actions?.[gId] ?? null
          );
        }, { cId: combatId, gId: gmGroupId });
        expect(afterSwapGm).toEqual(gmActions);

        // Lock invariant STILL holds — `swapActionCombatant` writes
        // only `system.rounds` (with mutated `actions`) and preserves
        // the sibling `locked` map.
        expect(await page.evaluate(({ cId, pId, gId }) => {
          const c = game.combats.get(cId);
          const round = c.system.rounds?.[c.system.currentRound];
          return {
            p: round?.locked?.[pId] ?? null,
            g: round?.locked?.[gId] ?? null
          };
        }, { cId: combatId, pId: partyGroupId, gId: gmGroupId }))
          .toEqual({ p: true, g: true });

        /* ---------- Assert: swap UI retracts post-swap ---------- */

        // V0's combatantId now points at alt (alive, hp.value=3). The
        // `needsSwap` predicate for V0's party side re-evaluates false
        // — actor read at conflict-panel.mjs L1196 resolves to alt's
        // actor at L1213. Warning + select disappear.
        await expect(panel.resolveKoWarning(0)).toHaveCount(0);
        await expect(panel.resolveSwapSelect(0, partyGroupId)).toHaveCount(0);

        // Mailbox flag remains cleared (the swap doesn't touch it).
        expect(await page.evaluate((id) => {
          return game.actors.get(id)?.getFlag('tb2e', 'pendingConflictHP') ?? null;
        }, captainId)).toBeNull();

        // Captain's HP remains 0 — the swap is a combatant re-route;
        // it does not restore HP on the KO'd combatant (no such path
        // exists in module/, and SG p.69 treats KO as persistent until
        // the conflict resolves or HP is explicitly restored).
        expect(await page.evaluate((id) => {
          return game.actors.get(id)?.system.conflict?.hp?.value ?? null;
        }, captainId)).toBe(0);
      } finally {
        await cleanupTaggedActors(page, tag);
      }
    }
  );
});
