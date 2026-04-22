import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §14 Conflict: Weapons — assign a weapon per combatant via the weapons-tab
 * dropdown and verify state persists through the transition into the
 * scripting tab (DH pp.122 "Fists and Weapons" — every combatant declares
 * their weapon before scripting actions).
 *
 * Rules under test:
 *   - The weapons tab shows one dropdown per combatant (panel-weapons.hbs
 *     L16-23). Option contents are built by
 *     `ConflictPanel.#prepareWeaponsContext` (conflict-panel.mjs L879-980):
 *       • monsters: `__unarmed__` + one `__monster_{N}__` per embedded
 *         `actor.system.weapons[N]` (L931-938)
 *       • characters on a `usesGear` conflict: `__unarmed__` + weapon items
 *         + spell choices + `__improvised__` + conflict-weapon list (L939-951)
 *     "kill" is `usesGear: true` with no `conflictWeapons`
 *     (`config.mjs` L200-211), so the character dropdown here is
 *     `__unarmed__` + the character's own weapon items + `__improvised__`.
 *   - Selecting an option triggers the `.weapon-select` change listener at
 *     `conflict-panel.mjs` L146-167, which calls
 *     `combat.setWeapon(combatantId, name, weaponId)` (combat.mjs L268-274).
 *     That writes `system.weapon` + `system.weaponId` on the combatant AND
 *     mirrors `system.conflict.weapon` + `system.conflict.weaponId` onto
 *     the backing actor — which for monsters is the synthetic token actor
 *     (CLAUDE.md "unlinked actors"), so we assert via `combatant.actor`.
 *   - State persists across the weapons → scripting phase transition
 *     (`#onBeginScripting` → `combat.beginScripting` — combat.mjs
 *     L282-312 only touches `system.phase`, `system.currentRound`, and
 *     `system.rounds`, never the per-combatant weapon fields).
 *
 * Scope (per agent briefing, TEST_PLAN.md L409):
 *   - Dropdown assignment + DOM reflection + storage + phase-transition
 *     persistence. Narrow-focus single test.
 *   - Improvised-weapon custom name input is a SEPARATE checkbox
 *     (weapons-improvised.spec.mjs — TEST_PLAN.md L410).
 *   - Assignable conflict-weapon bonuses (e.g. Blackmail) are a SEPARATE
 *     checkbox (weapons-assignable-bonus.spec.mjs — TEST_PLAN.md L411).
 *     That path renders an additional `.weapon-assignment-select` (L30-37
 *     of panel-weapons.hbs) which we don't exercise here.
 *
 * Implementation map (file:line refs verified against current source):
 *   - `beginWeapons` transition: `#onBeginWeapons` (conflict-panel.mjs
 *     L1691-1697) → `combat.beginWeapons()` (combat.mjs L249-255), which
 *     gates on `allDistributed` and flips `system.phase = "weapons"`.
 *     Phase-to-tab sync at conflict-panel.mjs L490-499 advances the panel
 *     active tab on the next render.
 *   - `setWeapon` persistence: combat.mjs L268-274 — combatant.update then
 *     actor.update. The combatant data model declares the fields as plain
 *     `StringField({ blank: true })` at `module/data/combat/combatant.mjs`
 *     L5-6, so there's no transform — what we select is what we store.
 *   - `beginScripting` transition: `#onBeginScripting` (conflict-panel.mjs
 *     L1720-1726) → `combat.beginScripting()` (combat.mjs L282-312). Only
 *     touches `system.phase` + round-1 scaffolding; weapon state is not
 *     referenced and therefore untouched. The `canBeginScripting` gate at
 *     conflict-panel.mjs L978-979 requires every non-KO'd combatant to
 *     have a non-blank `system.weapon`.
 *
 * Staging: reuse the §13 disposition-roll-captain staging pattern — two
 * characters + two monsters, GM-owned captains, Kill conflict (`usesGear`
 * with no conflictWeapons / no assignable bonuses — the minimum-surface
 * path for "plain weapon dropdown"). Character A gets a weapon item
 * attached (so the party dropdown has a concrete item id option, not just
 * `__unarmed__`/`__improvised__`); monster combatants use their embedded
 * `__monster_0__` weapon. Disposition is rolled for the party side (all-6s
 * PRNG → 3s + 4h = 7) and flat-set for the monster side (Bugbear Kill
 * hp=7 + 1 Goblin help = 8), then both groups distribute before advancing
 * to weapons — the minimum precondition `beginWeapons` demands.
 *
 * Cleanup: PRNG stub restored; all tagged actors, created weapon items,
 * and the combat are removed in the finally block so sibling specs on
 * the same worker start with a clean world.
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

/**
 * Create a character actor with deterministic fighter+health ratings so
 * the all-6s disposition pool yields a known total (3s + 4h = 7). Also
 * attach one weapon item so the party-side dropdown has a real item id
 * option alongside the `__unarmed__`/`__improvised__` sentinels.
 *
 * Returns `{ actorId, weaponItemId }` so the spec can reference the
 * item id directly when selecting from the dropdown (without relying on
 * name-to-id lookups at assertion time).
 */
async function createCaptainWithWeapon(page, { name, tag, weaponName }) {
  return page.evaluate(
    async ({ n, t, wn }) => {
      const actor = await Actor.implementation.create({
        name: n,
        type: 'character',
        flags: { tb2e: { e2eTag: t } },
        system: {
          abilities: {
            health: { rating: 4, pass: 0, fail: 0 },
            will:   { rating: 4, pass: 0, fail: 0 },
            nature: { rating: 3, max: 3, pass: 0, fail: 0 }
          },
          skills: {
            fighter: { rating: 3, pass: 0, fail: 0 }
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
    { n: name, t: tag, wn: weaponName }
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

test.describe('§14 Conflict: Weapons — assign per combatant', () => {
  test.afterEach(async ({ page }) => {
    // Defensive PRNG restore in case a mid-test failure skipped the
    // inline one. Same pattern as disposition-roll-captain.spec.mjs.
    await page.evaluate(() => {
      if ( globalThis.__tb2eE2EPrevRandomUniform ) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
      try { game.tb2e?.conflictPanel?.close(); } catch {}
    });
    await page.evaluate(async () => {
      const ids = Array.from(game.combats ?? []).map((c) => c.id);
      if ( ids.length ) await Combat.deleteDocuments(ids);
    });
  });

  test(
    'dropdown assignment writes combatant + actor state; persists into scripting',
    async ({ page }, testInfo) => {
      const tag = `e2e-weapons-assign-${testInfo.parallelIndex}-${Date.now()}`;
      const stamp = Date.now();
      const charAName = `E2E Captain ${stamp}`;
      const charBName = `E2E Char B ${stamp}`;
      const monsterAName = `E2E Bugbear ${stamp}`;
      const monsterBName = `E2E Goblin ${stamp}`;
      const weaponName = `E2E Blade ${stamp}`;

      await page.goto('/game');
      const ui = new GameUI(page);
      await ui.waitForReady();
      await ui.dismissTours();

      try {
        // Arrange — two characters + two monsters. Party captain carries
        // one weapon item so its dropdown has a concrete item id option
        // beyond the `__unarmed__`/`__improvised__` sentinels.
        const { actorId: captainId, weaponItemId } = await createCaptainWithWeapon(
          page, { name: charAName, tag, weaponName }
        );
        const charBId = await createCharacter(page, { name: charBName, tag });
        const monAId = await importMonster(page, {
          sourceName: 'Bugbear', uniqueName: monsterAName, tag
        });
        const monBId = await importMonster(page, {
          sourceName: 'Goblin', uniqueName: monsterBName, tag
        });

        // Create conflict + resolve group ids — same staging as the §13
        // disposition specs.
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

        // Skip the roll UI — we don't need its chat card for the weapons
        // surface we're actually testing. Stamp disposition + HP via the
        // GM-path flat handler on both groups, which mirrors what the
        // flat-monster spec (TEST_PLAN.md L391) already verifies end-to-
        // end. This test's focus is strictly the weapons tab.
        await page.evaluate(async ({ cId, pId, gId }) => {
          const c = game.combats.get(cId);
          await c.storeDispositionRoll(pId, {
            rolled: 7, diceResults: [], cardHtml: '<em>E2E</em>'
          });
          await c.storeDispositionRoll(gId, {
            rolled: 8, diceResults: [], cardHtml: '<em>E2E</em>'
          });
        }, { cId: combatId, pId: partyGroupId, gId: gmGroupId });

        // Distribute party = [4, 3] (captain ceil, charB floor) and
        // monster = [4, 4]. `distributeDisposition` writes
        // `conflict.hp.{value,max}` on each actor and flips
        // `groupDispositions[*].distributed = true`.
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

        // Panel updates are driven by updateCombat/updateCombatant hooks
        // (conflict-panel.mjs L120-129) — wait for the "Next → Weapons"
        // button to go enabled before clicking it.
        await expect(panel.beginWeaponsButton).toBeEnabled();
        await panel.clickBeginWeapons();

        // Phase should now be "weapons" on the combat document.
        expect(await page.evaluate((cId) => {
          return game.combats.get(cId)?.system.phase ?? null;
        }, combatId)).toBe('weapons');

        // Each combatant renders a `.weapon-select` dropdown (GM sees all
        // four — `canEdit = isGM || actor?.isOwner` at conflict-panel.mjs
        // L892).
        await expect(panel.weaponSelect(cmb.captain)).toBeVisible();
        await expect(panel.weaponSelect(cmb.charB)).toBeVisible();
        await expect(panel.weaponSelect(cmb.monA)).toBeVisible();
        await expect(panel.weaponSelect(cmb.monB)).toBeVisible();

        // Captain's dropdown (usesGear, no conflictWeapons on Kill):
        // `__unarmed__` + the weapon item id + `__improvised__`
        // (conflict-panel.mjs L941-951; no spellChoices on this actor).
        const captainOptions = await panel.weaponOptionValues(cmb.captain);
        expect(captainOptions).toEqual([
          '',             // placeholder `TB2E.Conflict.WeaponChoose`
          '__unarmed__',
          weaponItemId,
          '__improvised__'
        ]);

        // Monster (Bugbear) dropdown: `__unarmed__` + one
        // `__monster_{N}__` entry per embedded stat-block weapon. Bugbear
        // has at least one weapon in its stat block — we just assert the
        // first sentinel is present and is valid to select.
        const monsterOptions = await panel.weaponOptionValues(cmb.monA);
        expect(monsterOptions[0]).toBe('');
        expect(monsterOptions).toContain('__unarmed__');
        expect(monsterOptions).toContain('__monster_0__');

        // Preconditions — no combatant has a weapon yet; the weapons tab
        // gates scripting on every non-KO'd combatant being armed
        // (conflict-panel.mjs L978-979), so the "Next → Script" button
        // starts disabled.
        const weaponsBefore = await page.evaluate(({ cId, ids }) => {
          const c = game.combats.get(cId);
          return ids.map((id) => {
            const co = c.combatants.get(id);
            return {
              id,
              weapon: co?.system.weapon ?? null,
              weaponId: co?.system.weaponId ?? null,
              actorWeapon: co?.actor?.system.conflict?.weapon ?? null,
              actorWeaponId: co?.actor?.system.conflict?.weaponId ?? null
            };
          });
        }, {
          cId: combatId,
          ids: [cmb.captain, cmb.charB, cmb.monA, cmb.monB]
        });
        for ( const row of weaponsBefore ) {
          // StringField({ blank: true }) reads back as either '' or null
          // depending on whether the field was ever assigned — treat
          // both as "unarmed" for the precondition.
          expect(row.weapon || '', `initial weapon for ${row.id}`).toBe('');
          expect(row.weaponId || '', `initial weaponId for ${row.id}`).toBe('');
        }
        await expect(panel.beginScriptingButton).toBeDisabled();

        // Act — assign a weapon per combatant via the dropdown UI.
        //   captain  → weapon item id (real Item on the actor)
        //   charB    → `__unarmed__`   (sentinel)
        //   monA     → `__monster_0__` (Bugbear first stat-block weapon)
        //   monB     → `__unarmed__`   (sentinel)
        // These four cover: item-id write, two distinct sentinels, and
        // the monster-specific indexed sentinel — the four shapes the
        // dropdown can yield.
        await panel.selectWeapon(cmb.captain, weaponItemId);
        await panel.selectWeapon(cmb.charB, '__unarmed__');
        await panel.selectWeapon(cmb.monA, '__monster_0__');
        await panel.selectWeapon(cmb.monB, '__unarmed__');

        // Assert combatant storage. `setWeapon` (combat.mjs L268-274)
        // writes to the combatant AND attempts to mirror onto the actor.
        // The actor mirror only lands for actor types whose data model
        // declares `system.conflict.{weapon,weaponId}` — characters do
        // (`character.mjs` L161-168) but monsters don't (`monster.mjs`
        // L46-52, only `conflict.hp` + `conflict.team`), so the
        // monster-side mirror is silently dropped by the schema. We
        // assert the combatant write for everyone and the actor mirror
        // only for character-actor combatants.
        // Per CLAUDE.md: read state via `combatant.actor` (synthetic
        // token) not `game.actors.get(combatant.actorId)`.
        const stored = await page.evaluate(({ cId, ids }) => {
          const c = game.combats.get(cId);
          return ids.map((id) => {
            const co = c.combatants.get(id);
            return {
              id,
              weapon: co.system.weapon,
              weaponId: co.system.weaponId,
              actorType: co.actor?.type ?? null,
              actorWeapon: co.actor?.system.conflict?.weapon ?? null,
              actorWeaponId: co.actor?.system.conflict?.weaponId ?? null
            };
          });
        }, {
          cId: combatId,
          ids: [cmb.captain, cmb.charB, cmb.monA, cmb.monB]
        });
        const byId = Object.fromEntries(stored.map((r) => [r.id, r]));

        // Captain picked the item id — combat.setWeapon passes the
        // option's `data-clean-name` (the item's display name) as the
        // stored weapon name (conflict-panel.mjs L161-164).
        expect(byId[cmb.captain].weaponId).toBe(weaponItemId);
        expect(byId[cmb.captain].weapon).toBe(weaponName);
        expect(byId[cmb.captain].actorWeaponId).toBe(weaponItemId);
        expect(byId[cmb.captain].actorWeapon).toBe(weaponName);

        // charB picked `__unarmed__` — the localized label is stored as
        // the display name on both combatant and actor.
        const unarmedLabel = await page.evaluate(() =>
          game.i18n.localize('TB2E.Conflict.WeaponUnarmed')
        );
        expect(byId[cmb.charB].weaponId).toBe('__unarmed__');
        expect(byId[cmb.charB].weapon).toBe(unarmedLabel);
        expect(byId[cmb.charB].actorWeaponId).toBe('__unarmed__');
        expect(byId[cmb.charB].actorWeapon).toBe(unarmedLabel);

        // monB (Goblin) picked `__unarmed__` — only the combatant write
        // surface should reflect this; the actor mirror is dropped by
        // the monster schema (monster.mjs L46-52).
        expect(byId[cmb.monB].actorType).toBe('monster');
        expect(byId[cmb.monB].weaponId).toBe('__unarmed__');
        expect(byId[cmb.monB].weapon).toBe(unarmedLabel);

        // monA (Bugbear) picked `__monster_0__` — stored name is the
        // monster's embedded weapon name from the stat block (or a
        // "Weapon N" fallback per conflict-panel.mjs L936; in practice
        // Bugbear has a named weapon).
        expect(byId[cmb.monA].actorType).toBe('monster');
        expect(byId[cmb.monA].weaponId).toBe('__monster_0__');
        expect(byId[cmb.monA].weapon).not.toBe('');
        expect(byId[cmb.monA].weapon).not.toBe(unarmedLabel);

        // Dropdown DOM reflects the selections (the re-render pulls
        // `selected` from `weaponId === choice.id` at conflict-panel.mjs
        // L943 / L935 / L942).
        await expect(panel.weaponSelect(cmb.captain)).toHaveValue(weaponItemId);
        await expect(panel.weaponSelect(cmb.charB)).toHaveValue('__unarmed__');
        await expect(panel.weaponSelect(cmb.monA)).toHaveValue('__monster_0__');
        await expect(panel.weaponSelect(cmb.monB)).toHaveValue('__unarmed__');

        // All combatants armed → scripting gate opens.
        await expect(panel.beginScriptingButton).toBeEnabled();

        // Act — advance to the scripting phase. `beginScripting` touches
        // `system.phase` + `system.currentRound` + `system.rounds` only
        // (combat.mjs L282-312); per-combatant weapon state should carry
        // through untouched.
        await panel.clickBeginScripting();

        expect(await page.evaluate((cId) => {
          return game.combats.get(cId)?.system.phase ?? null;
        }, combatId)).toBe('scripting');

        // Assert — weapons survive the phase transition.
        const afterScripting = await page.evaluate(({ cId, ids }) => {
          const c = game.combats.get(cId);
          return ids.map((id) => {
            const co = c.combatants.get(id);
            return {
              id,
              weapon: co.system.weapon,
              weaponId: co.system.weaponId,
              actorWeapon: co.actor?.system.conflict?.weapon ?? null,
              actorWeaponId: co.actor?.system.conflict?.weaponId ?? null
            };
          });
        }, {
          cId: combatId,
          ids: [cmb.captain, cmb.charB, cmb.monA, cmb.monB]
        });
        const afterById = Object.fromEntries(
          afterScripting.map((r) => [r.id, r])
        );

        // Each combatant retains the same weaponId + weapon name on the
        // combatant after the phase transition.
        for ( const id of [cmb.captain, cmb.charB, cmb.monA, cmb.monB] ) {
          expect(afterById[id].weaponId, `weaponId persisted ${id}`)
            .toBe(byId[id].weaponId);
          expect(afterById[id].weapon, `weapon persisted ${id}`)
            .toBe(byId[id].weapon);
        }
        // Character-actor mirror also survives the transition. (Monster
        // actors carry no `system.conflict.weaponId` field, so we don't
        // assert one — see the storage-block comment above for refs.)
        for ( const id of [cmb.captain, cmb.charB] ) {
          expect(afterById[id].actorWeaponId, `actorWeaponId persisted ${id}`)
            .toBe(byId[id].actorWeaponId);
          expect(afterById[id].actorWeapon, `actorWeapon persisted ${id}`)
            .toBe(byId[id].actorWeapon);
        }
      } finally {
        await cleanupTaggedActors(page, tag);
      }
    }
  );
});
