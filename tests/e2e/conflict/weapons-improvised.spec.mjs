import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §14 Conflict: Weapons — improvised weapon with custom name.
 *
 * Rules under test:
 *   - The weapons-tab dropdown for a `usesGear` conflict includes an
 *     `__improvised__` sentinel option (conflict-panel.mjs L945 for
 *     the Kill/gear branch; mirrored in the conflict-specific
 *     (L960) and generic (L968) branches). Choosing it surfaces the
 *     sibling `input.weapon-improvised-input` (panel-weapons.hbs
 *     L24-29) — the input's `hidden` class is toggled by the select's
 *     change listener at `conflict-panel.mjs` L152-160.
 *   - On change of the input, the handler at `conflict-panel.mjs`
 *     L181-189 calls `combat.setWeapon(combatantId, name,
 *     "__improvised__")` (combat.mjs L268-274), which persists:
 *       • `combatant.system.weapon`   = trimmed custom name
 *       • `combatant.system.weaponId` = "__improvised__"
 *       • `actor.system.conflict.weapon` / `.weaponId` (character
 *         only — monster.mjs L46-52 drops the mirror).
 *   - Empty / whitespace-only input falls back to the localized
 *     "Improvised" label (conflict-panel.mjs L157, L186).
 *   - Custom name persists through the weapons → scripting phase
 *     transition (combat.mjs L282-312 touches only `phase`,
 *     `currentRound`, and `rounds`; per-combatant weapon state is
 *     untouched).
 *
 * Scope (per TEST_PLAN.md L410):
 *   - Improvised path only — one character picks `__improvised__`
 *     and types a custom name; we verify storage + DOM echo +
 *     persistence across scripting. Standard-weapon dropdown path is
 *     covered by weapons-assign-per-combatant.spec.mjs (L409).
 *     Assignable conflict-weapon bonuses are a separate checkbox
 *     (L411).
 *
 * Staging minimizes to the `beginWeapons` precondition: two
 * characters on the party (so captain + one other can distribute
 * disposition 4/3) and one monster-as-captain on the GM side. Kill
 * is `usesGear: true` with no `conflictWeapons` (config.mjs L200-211),
 * so the character-side dropdown is the minimum-surface
 * `__unarmed__` / `__improvised__` pair — ideal for this surface.
 * Flat-set disposition on both sides bypasses the roll UI (covered
 * by disposition-flat-monster spec L391).
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

async function createCharacter(page, { name, tag, rating }) {
  return page.evaluate(
    async ({ n, t, r }) => {
      const actor = await Actor.implementation.create({
        name: n,
        type: 'character',
        flags: { tb2e: { e2eTag: t } },
        system: {
          abilities: {
            health: { rating: r, pass: 0, fail: 0 },
            will:   { rating: r, pass: 0, fail: 0 },
            nature: { rating: 3, max: 3, pass: 0, fail: 0 }
          },
          skills: {
            fighter: { rating: 3, pass: 0, fail: 0 }
          },
          conditions: { fresh: false }
        }
      });
      return actor.id;
    },
    { n: name, t: tag, r: rating ?? 4 }
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

test.describe('§14 Conflict: Weapons — improvised custom name', () => {
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
    'improvised weapon custom name is stored on combatant + actor, displayed, and persists through scripting',
    async ({ page }, testInfo) => {
      const tag = `e2e-weapons-improvised-${testInfo.parallelIndex}-${Date.now()}`;
      const stamp = Date.now();
      const charAName = `E2E Captain ${stamp}`;
      const charBName = `E2E Char B ${stamp}`;
      const monAName = `E2E Bugbear ${stamp}`;
      // Arbitrary, non-trivial custom label — whitespace is intentional
      // to exercise the trim() branch in the change handler
      // (conflict-panel.mjs L186).
      const improvisedName = '  Broken Chair Leg  ';
      const expectedName = 'Broken Chair Leg';

      await page.goto('/game');
      const ui = new GameUI(page);
      await ui.waitForReady();
      await ui.dismissTours();

      try {
        const charAId = await createCharacter(page, {
          name: charAName, tag, rating: 4
        });
        const charBId = await createCharacter(page, {
          name: charBName, tag, rating: 4
        });
        const monAId = await importMonster(page, {
          sourceName: 'Bugbear', uniqueName: monAName, tag
        });

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
        cmb.charA = await panel.addCombatant({
          combatId, actorId: charAId, groupId: partyGroupId
        });
        cmb.charB = await panel.addCombatant({
          combatId, actorId: charBId, groupId: partyGroupId
        });
        cmb.monA = await panel.addCombatant({
          combatId, actorId: monAId, groupId: gmGroupId
        });
        await expect(panel.setupCombatants).toHaveCount(3);

        await panel.clickCaptainButton(cmb.charA);
        await panel.clickCaptainButton(cmb.monA);
        await panel.selectConflictType('kill');

        await expect(panel.beginDispositionButton).toBeEnabled();
        await panel.clickBeginDisposition();

        // Flat-set disposition on both sides (roll UI is covered by
        // disposition-roll-captain / disposition-flat-monster specs).
        await page.evaluate(async ({ cId, pId, gId }) => {
          const c = game.combats.get(cId);
          await c.storeDispositionRoll(pId, {
            rolled: 7, diceResults: [], cardHtml: '<em>E2E</em>'
          });
          await c.storeDispositionRoll(gId, {
            rolled: 6, diceResults: [], cardHtml: '<em>E2E</em>'
          });
        }, { cId: combatId, pId: partyGroupId, gId: gmGroupId });

        await page.evaluate(async ({ cId, pId, gId, aId, bId, mId }) => {
          const c = game.combats.get(cId);
          const party = {}; party[aId] = 4; party[bId] = 3;
          const gm = {};    gm[mId] = 6;
          await c.distributeDisposition(pId, party);
          await c.distributeDisposition(gId, gm);
        }, {
          cId: combatId, pId: partyGroupId, gId: gmGroupId,
          aId: cmb.charA, bId: cmb.charB, mId: cmb.monA
        });

        await expect(panel.beginWeaponsButton).toBeEnabled();
        await panel.clickBeginWeapons();

        // Precondition: usesGear === true for Kill (config.mjs
        // L200-211) → character rows should have an `__improvised__`
        // option (conflict-panel.mjs L945).
        expect(await page.evaluate((cId) => {
          return game.combats.get(cId)?.getEffectiveConflictConfig()?.usesGear ?? null;
        }, combatId)).toBe(true);

        const charAOptions = await panel.weaponOptionValues(cmb.charA);
        expect(charAOptions).toContain('__improvised__');

        // Improvised input starts hidden for this row (template L25
        // applies `hidden` unless `isImprovised`).
        await expect(panel.improvisedInput(cmb.charA))
          .toHaveClass(/\bhidden\b/);

        // Act 1 — select the `__improvised__` sentinel. The change
        // handler at conflict-panel.mjs L155-158 fires
        // `combat.setWeapon(id, "Improvised", "__improvised__")`
        // (using the localized fallback since the input is empty)
        // and removes the `hidden` class from the input.
        await panel.selectWeapon(cmb.charA, '__improvised__');

        const improvisedLabel = await page.evaluate(() =>
          game.i18n.localize('TB2E.Conflict.WeaponImprovised')
        );

        // Default-name state (before the user types a custom name):
        // weapon === localized "Improvised" label; weaponId sentinel.
        const afterSelect = await page.evaluate(({ cId, id }) => {
          const co = game.combats.get(cId).combatants.get(id);
          return {
            weapon: co.system.weapon,
            weaponId: co.system.weaponId,
            actorWeapon: co.actor?.system.conflict?.weapon ?? null,
            actorWeaponId: co.actor?.system.conflict?.weaponId ?? null
          };
        }, { cId: combatId, id: cmb.charA });
        expect(afterSelect.weaponId).toBe('__improvised__');
        expect(afterSelect.weapon).toBe(improvisedLabel);
        expect(afterSelect.actorWeaponId).toBe('__improvised__');
        expect(afterSelect.actorWeapon).toBe(improvisedLabel);

        // The input is now visible (change handler removed `hidden`).
        await expect(panel.improvisedInput(cmb.charA))
          .not.toHaveClass(/\bhidden\b/);

        // Act 2 — type a custom name. The change handler at
        // conflict-panel.mjs L181-189 calls
        // `combat.setWeapon(id, trimmed, "__improvised__")`, so the
        // leading/trailing whitespace in the input should be stripped.
        await panel.setImprovisedName(cmb.charA, improvisedName);

        // Assert combatant + actor-mirror storage of the custom name.
        const stored = await page.evaluate(({ cId, id }) => {
          const co = game.combats.get(cId).combatants.get(id);
          return {
            weapon: co.system.weapon,
            weaponId: co.system.weaponId,
            actorWeapon: co.actor?.system.conflict?.weapon ?? null,
            actorWeaponId: co.actor?.system.conflict?.weaponId ?? null,
            actorType: co.actor?.type ?? null
          };
        }, { cId: combatId, id: cmb.charA });
        expect(stored.actorType).toBe('character');
        expect(stored.weaponId).toBe('__improvised__');
        expect(stored.weapon).toBe(expectedName);
        expect(stored.actorWeaponId).toBe('__improvised__');
        expect(stored.actorWeapon).toBe(expectedName);

        // DOM display: re-render has preserved the improvised
        // dropdown selection and rehydrated the input's `value`
        // attribute from `weapon` (panel-weapons.hbs L26).
        await expect(panel.weaponSelect(cmb.charA))
          .toHaveValue('__improvised__');
        await expect(panel.improvisedInput(cmb.charA))
          .toHaveValue(expectedName);
        await expect(panel.improvisedInput(cmb.charA))
          .not.toHaveClass(/\bhidden\b/);

        // Arm the remaining two combatants so the scripting gate
        // opens (conflict-panel.mjs L978-979 requires every non-KO'd
        // combatant to have a non-blank `system.weapon`). charB
        // picks `__unarmed__`; monster picks `__monster_0__` — both
        // covered by the assign-per-combatant spec, used here purely
        // to unblock the phase transition.
        await panel.selectWeapon(cmb.charB, '__unarmed__');
        await panel.selectWeapon(cmb.monA, '__monster_0__');
        await expect(panel.beginScriptingButton).toBeEnabled();

        // Act 3 — advance to scripting. `beginScripting` touches
        // only phase/round scaffolding (combat.mjs L282-312), so the
        // custom improvised name must survive untouched.
        await panel.clickBeginScripting();
        expect(await page.evaluate((cId) => {
          return game.combats.get(cId)?.system.phase ?? null;
        }, combatId)).toBe('scripting');

        const afterScripting = await page.evaluate(({ cId, id }) => {
          const co = game.combats.get(cId).combatants.get(id);
          return {
            weapon: co.system.weapon,
            weaponId: co.system.weaponId,
            actorWeapon: co.actor?.system.conflict?.weapon ?? null,
            actorWeaponId: co.actor?.system.conflict?.weaponId ?? null
          };
        }, { cId: combatId, id: cmb.charA });
        expect(afterScripting.weaponId).toBe('__improvised__');
        expect(afterScripting.weapon).toBe(expectedName);
        expect(afterScripting.actorWeaponId).toBe('__improvised__');
        expect(afterScripting.actorWeapon).toBe(expectedName);
      } finally {
        await cleanupTaggedActors(page, tag);
      }
    }
  );
});
