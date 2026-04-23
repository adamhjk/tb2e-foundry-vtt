import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §13 Conflict: Disposition — player-captain distribution routes through the
 * `system.pendingDistribution` mailbox on the captain's Combatant (CLAUDE.md
 * §Mailbox Pattern). The GM's `_onUpdateDescendantDocuments` hook observes
 * the write, processes it via `distributeDisposition`, and is expected to
 * clear the mailbox field.
 *
 * **STATUS: test.fixme — production bug in the mailbox clear step.**
 *
 * Investigation:
 *   - The mailbox WRITE path works: non-GM `distributeDisposition` branch
 *     at `module/documents/combat.mjs` L220-225 writes
 *     `combatant.update({ "system.pendingDistribution": { groupId, distribution } })`.
 *   - The GM HOOK dispatch works: `_onUpdateDescendantDocuments` at
 *     `combat.mjs` L431-462 picks off `changes.system.pendingDistribution`
 *     with a truthy `groupId` (L445-448) and calls `#processDistribution`
 *     (L485-490).
 *   - The PROCESS step works: `#processDistribution` awaits
 *     `distributeDisposition(groupId, distribution)` (L486), which — now
 *     on the GM branch — applies `system.conflict.hp.{value,max}` to each
 *     member's actor (L231) and flips `groupDispositions[groupId].distributed
 *     = true` (L236-241). Confirmed via a direct diagnostic run: HP is set,
 *     `distributed` flips, and panel DOM re-renders with the "Distributed"
 *     badge.
 *   - The CLEAR step does NOT work: `combat.mjs` L489 attempts
 *     `combatant.update({ "system.pendingDistribution": {} })` to drain
 *     the mailbox. Because `pendingDistribution` is a
 *     `foundry.data.fields.ObjectField()` (data/combat/combatant.mjs L20),
 *     Foundry's update deep-merges the empty object into the existing
 *     `{ groupId, distribution }` payload — leaving every existing key in
 *     place. Diagnostic run showed `_source.system.pendingDistribution`
 *     retained the full `{ groupId, distribution: { … } }` payload AFTER
 *     processing completed. The same clear idiom is used for
 *     `pendingDisposition` (L475) and `pendingActions` (L516), so this is
 *     a class-wide mailbox-drain gap, not a single-field anomaly.
 *   - The intended production fix is likely either
 *     `combatant.update({ "system.-=pendingDistribution": null })` (Foundry's
 *     deletion idiom) or explicit field reset via the schema default. Until
 *     that lands, THIS spec is `test.fixme` because the full mailbox
 *     contract ("processes AND clears") can't be satisfied.
 *
 * Rules under test (DH pp.120-122) — retained so the assertions exercise
 * the full contract once the clear step is fixed:
 *   - Captain splits the rolled disposition total across team members;
 *     each member's `system.conflict.hp.{value,max}` is set to their share.
 *   - Player-side non-GM branch writes
 *     `system.pendingDistribution = { groupId, distribution }` on the
 *     captain's combatant (combat.mjs L223).
 *   - GM hook processes the payload and THEN clears the mailbox
 *     (combat.mjs L485-490, current buggy implementation).
 *
 * Payload shape (verified against combat.mjs L223 + L445-447):
 *   `system.pendingDistribution = { groupId, distribution }` where
 *   `distribution` is `Object<combatantId, number>`.
 *
 * E2E harness constraint (shared with versus/finalize-via-mailbox.spec.mjs
 * and grind/apply-condition-mailbox.spec.mjs): all Playwright sessions
 * authenticate as GM, so we simulate the non-GM branch via `page.evaluate`
 * writing the exact payload combat.mjs L223 emits. The in-browser GM hook
 * fires in the same client.
 *
 * Scope (narrow per briefing TEST_PLAN L392):
 *   - Mailbox round-trip only. GM-path distribution is TEST_PLAN L390;
 *     flat-monster is L391; order-of-might / precedence L393-394.
 *   - Disposition roll itself is bypassed: we stamp a known `rolled=7`
 *     onto `groupDispositions[partyGroupId]` via a direct
 *     `storeDispositionRoll` call so the mailbox contract is the only
 *     thing under test.
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

test.describe('§13 Conflict: Disposition — player-captain distribution mailbox', () => {
  test.afterEach(async ({ page }) => {
    // Close the panel (unhooks updateCombat/updateCombatant listeners) and
    // drop any combat the test left behind. Matches the cleanup idiom in
    // the sibling §13 specs.
    await page.evaluate(() => {
      try { game.tb2e?.conflictPanel?.close(); } catch {}
    });
    await page.evaluate(async () => {
      const ids = Array.from(game.combats ?? []).map((c) => c.id);
      if ( ids.length ) await Combat.deleteDocuments(ids);
    });
  });

  // BLOCKED — see the describe-level header above. `#processDistribution`
  // (combat.mjs L485-490) clears `system.pendingDistribution` using the
  // `==` force-replace idiom: `combatant.update({ system: {
  // "==pendingDistribution": {} } })`. Foundry's `==` prefix
  // (helpers.mjs:957-960) replaces the whole field value rather than
  // deep-merging, which is what ObjectField otherwise does. The bug fix
  // also applies to siblings `pendingDisposition` (L475) and
  // `pendingManeuverSpend` (L564).
  test(
    'player-side pendingDistribution write triggers GM hook, HP distributed, mailbox cleared (DH pp.120-122)',
    async ({ page }, testInfo) => {
      const tag = `e2e-disp-dist-player-${testInfo.parallelIndex}-${Date.now()}`;
      const stamp = Date.now();
      const charAName = `E2E Captain ${stamp}`;
      const charBName = `E2E Char B ${stamp}`;
      const monsterAName = `E2E Kobold ${stamp}`;
      const monsterBName = `E2E Bugbear ${stamp}`;

      await page.goto('/game');
      const ui = new GameUI(page);
      await ui.waitForReady();
      await ui.dismissTours();

      // Sanity: the in-browser GM-side hook (combat.mjs L431-462) is gated
      // at L433 — only fires in the GM's client. Our session is GM, so
      // the hook will run in the same client as the mailbox write.
      expect(await page.evaluate(() => game.user.isGM)).toBe(true);

      try {
        // Arrange — 2 characters + 2 monsters. The captain's ratings don't
        // matter here because we skip the disposition roll and stamp a
        // known `rolled` total directly.
        const captainId = await createCharacter(page, { name: charAName, tag });
        const charBId = await createCharacter(page, { name: charBName, tag });
        const monAId = await importMonster(page, {
          sourceName: 'Kobold', uniqueName: monsterAName, tag
        });
        const monBId = await importMonster(page, {
          sourceName: 'Bugbear', uniqueName: monsterBName, tag
        });

        // Create conflict + resolve group ids.
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

        // Populate, captainize, select a conflict type.
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

        // Precondition: no party HP set, captain mailbox is default empty.
        const pre = await page.evaluate(
          ({ cId, captainCombatantId, ids }) => {
            const c = game.combats.get(cId);
            const captain = c.combatants.get(captainCombatantId);
            return {
              pendingDistribution: foundry.utils.deepClone(
                captain?._source.system?.pendingDistribution ?? null
              ),
              partyHp: ids.map((id) => ({
                id,
                hp: c.combatants.get(id)?.actor?.system.conflict?.hp?.value ?? null,
                max: c.combatants.get(id)?.actor?.system.conflict?.hp?.max ?? null
              }))
            };
          },
          { cId: combatId, captainCombatantId: cmb.captain, ids: [cmb.captain, cmb.charB] }
        );
        expect(pre.pendingDistribution).toEqual({});
        for ( const row of pre.partyHp ) {
          expect(row.hp, `initial hp for ${row.id}`).toBe(0);
          expect(row.max, `initial max for ${row.id}`).toBe(0);
        }

        // Stamp a known disposition total onto the party group. The roll
        // path is covered by TEST_PLAN L390; bypassing it here isolates
        // the mailbox contract. Total=7 mirrors disposition-roll-captain
        // (fighter 3 + health 4 = 7) so the expected 4/3 split matches.
        await page.evaluate(
          async ({ cId, gId }) => {
            const c = game.combats.get(cId);
            await c.storeDispositionRoll(gId, {
              rolled: 7,
              diceResults: [],
              cardHtml: '<em>E2E stamped disposition</em>'
            });
          },
          { cId: combatId, gId: partyGroupId }
        );
        await expect
          .poll(() => page.evaluate(({ cId, gId }) => {
            return game.combats.get(cId)?.system.groupDispositions?.[gId]?.rolled ?? null;
          }, { cId: combatId, gId: partyGroupId }), { timeout: 5_000 })
          .toBe(7);

        // Act — simulate the non-GM distribute branch by writing the
        // payload combat.mjs L223 emits, verbatim. This is a single
        // `combatant.update(...)` with the mailbox field; the GM hook at
        // combat.mjs L431-462 observes `changes.system.pendingDistribution`
        // and dispatches to `#processDistribution` (L485-490).
        //
        // Distribution: captain=4, charB=3. Keyed by combatantId per
        // combat.mjs L227.
        const distribution = { [cmb.captain]: 4, [cmb.charB]: 3 };
        await page.evaluate(
          async ({ cId, captainCombatantId, gId, dist }) => {
            const c = game.combats.get(cId);
            const captain = c.combatants.get(captainCombatantId);
            await captain.update({
              'system.pendingDistribution': { groupId: gId, distribution: dist }
            });
          },
          {
            cId: combatId,
            captainCombatantId: cmb.captain,
            gId: partyGroupId,
            dist: distribution
          }
        );

        /* ---------- Assert GM hook processed + cleared ---------- */

        // 1. Cardinal contract: mailbox is drained. After the fix, combat.mjs
        //    L489 uses `{system: {"==pendingDistribution": {}}}` — Foundry's
        //    force-replace idiom — so `_source.system.pendingDistribution`
        //    ends up as exactly `{}` (payload keys gone).
        await expect
          .poll(
            () => page.evaluate(
              ({ cId, captainCombatantId }) => {
                const captain = game.combats.get(cId)?.combatants.get(captainCombatantId);
                return foundry.utils.deepClone(
                  captain?._source.system?.pendingDistribution ?? null
                );
              },
              { cId: combatId, captainCombatantId: cmb.captain }
            ),
            { timeout: 10_000, message: 'pendingDistribution should be cleared by GM hook' }
          )
          .toEqual({});

        // 2. HP was applied to each party member (combat.mjs L231 writes
        //    both `value` and `max`).
        await expect
          .poll(
            () => page.evaluate(
              ({ cId, ids }) => {
                const c = game.combats.get(cId);
                return ids.every((id) => {
                  const max = c?.combatants.get(id)?.actor?.system.conflict?.hp?.max ?? 0;
                  return max > 0;
                });
              },
              { cId: combatId, ids: [cmb.captain, cmb.charB] }
            ),
            { timeout: 10_000 }
          )
          .toBe(true);

        const hpAfter = await page.evaluate(({ cId }) => {
          const c = game.combats.get(cId);
          return Array.from(c.combatants).map((co) => ({
            id: co.id,
            name: co.name,
            groupId: co._source.group,
            // CLAUDE.md §Unlinked Actors: read HP via `combatant.actor`.
            hp: co.actor?.system.conflict?.hp?.value ?? null,
            max: co.actor?.system.conflict?.hp?.max ?? null
          }));
        }, { cId: combatId });

        const party = hpAfter.filter((x) => x.groupId === partyGroupId);
        const monsters = hpAfter.filter((x) => x.groupId === gmGroupId);

        // Party HP matches the payload — proves the GM processor routed
        // the distribution map through the GM-side `distributeDisposition`.
        const partyById = Object.fromEntries(party.map((r) => [r.id, r]));
        expect(partyById[cmb.captain].hp).toBe(4);
        expect(partyById[cmb.captain].max).toBe(4);
        expect(partyById[cmb.charB].hp).toBe(3);
        expect(partyById[cmb.charB].max).toBe(3);
        for ( const row of party ) {
          expect(row.max, `max mirrors hp on ${row.name}`).toBe(row.hp);
        }

        // Monster side is the negative control — no mailbox write for
        // the gm group, no processing, no HP.
        for ( const row of monsters ) {
          expect(row.hp, `monster hp for ${row.name}`).toBe(0);
          expect(row.max, `monster max for ${row.name}`).toBe(0);
        }

        // 3. groupDispositions storage flag flipped (combat.mjs L236-241).
        const gdAfter = await page.evaluate(
          ({ cId }) => {
            const c = game.combats.get(cId);
            return foundry.utils.deepClone(c.system.groupDispositions || {});
          },
          { cId: combatId }
        );
        expect(gdAfter[partyGroupId]?.distributed).toBe(true);
        expect(gdAfter[partyGroupId]?.rolled).toBe(7);
        expect(gdAfter[gmGroupId]?.distributed ?? false).toBe(false);

        // Panel DOM echoes the storage state.
        await expect(panel.dispositionDistributedBadge(partyGroupId)).toBeVisible();
        await expect(panel.distributionSection(partyGroupId)).toHaveCount(0);
      } finally {
        await cleanupTaggedActors(page, tag);
      }
    }
  );
});
