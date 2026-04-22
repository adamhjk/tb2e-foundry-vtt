import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §14 Conflict: Weapons — assignable conflict weapons grant a bonus to
 * the combatant's chosen target action.
 *
 * Rules under test:
 *   - `CONFIG.TB2E.conflictTypes.convince.conflictWeapons[0]` is Blackmail
 *     (config.mjs L278): `{ id: "blackmail", label: "TB2E.Weapon.Blackmail",
 *     bonuses: [{ type: "dice", value: 1, assignable: true }],
 *     assignable: true }`. Unlike a static-action bonus (e.g. Deception
 *     `feint`, Evidence `attack`), the assignable bonus has no fixed
 *     `action` on its bonus entry and the weapon config itself carries
 *     `assignable: true` — the target action is chosen per-combatant at
 *     weapons time (Scholar's Guide p.89 "Argument": the "Blackmail" weapon
 *     shows +1D and the player assigns it when declaring scripts).
 *
 *   - At weapons-tab render, `#prepareWeaponsContext` derives
 *     `isAssignable = conflictWeapons.find(w => w.id === weaponId)?.assignable`
 *     (conflict-panel.mjs L894) and sets `showAssignment: isAssignable`
 *     (L905). The template gates the extra `<select class=
 *     "weapon-assignment-select">` on `{{#if this.showAssignment}}`
 *     (panel-weapons.hbs L30-37).
 *
 *   - Change handler at conflict-panel.mjs L170-178 writes the choice to
 *     `combatant.system.weaponAssignment` (schema: CombatantData field at
 *     `module/data/combat/combatant.mjs` L12 — `StringField({ blank: true })`).
 *
 *   - Bonus application at conflict-panel.mjs L1953:
 *     `targetAction = bonus.assignable ? resolvedCombatant.system.weaponAssignment : bonus.action;`
 *     Immediately below (L1954) `if ( targetAction !== actionKey ) continue`,
 *     then pushes a `{ label: <weapon label>, type: "dice", value: 1 }`
 *     modifier. This is the contract we assert: the same weapon, same
 *     combatant, same config — switching `actionKey` between the assigned
 *     action and a different one produces a modifier exactly in the first
 *     case and not the second.
 *
 * Test strategy (per briefing: "bypass scripting/resolve … verify the
 * bonus would apply via pre-flight"):
 *   - Drive the UI through setup → disposition → weapons so the user-facing
 *     surface (weapon select, bonus summary option text, assignment select)
 *     is exercised for real.
 *   - Assert stored state on combatant + actor mirror matches the chosen
 *     weapon + assignment.
 *   - Replay the bonus-computation logic from `#onRollAction` L1935-1965
 *     inline via `page.evaluate`, using `combat.getEffectiveConflictConfig()`
 *     + the stored combatant state, for two action keys — the assigned one
 *     (`attack`) and a different one (`defend`). Assert the Blackmail +1D
 *     dice modifier appears for the first and not the second.
 *
 *   This keeps the spec's scope pinned to §14 (weapons tab + bonus
 *   resolution), without entering scripting/resolve territory (§15-§16).
 *
 * Out of scope (covered elsewhere):
 *   - Dropdown assignment of non-assignable weapons per combatant:
 *     weapons-assign-per-combatant.spec.mjs (TEST_PLAN.md L409).
 *   - Improvised weapon custom names:
 *     weapons-improvised.spec.mjs (TEST_PLAN.md L410).
 *   - Full scripting lockActions / peekActions (§15) and volley-by-volley
 *     resolution (§16).
 *
 * Staging: party side has two characters (captain + one other to satisfy
 * `distributeDisposition` two-way split); GM side has one Bugbear
 * captain. Convince (non-`usesGear`, `conflictWeapons.length > 0`) so the
 * character dropdown renders the assignable Blackmail option on the
 * `conflictWeapons.length` branch at conflict-panel.mjs L952-962.
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
            persuader: { rating: 3, pass: 0, fail: 0 }
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

test.describe('§14 Conflict: Weapons — assignable conflict-weapon bonus', () => {
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
    'assignable conflict weapon (Blackmail) grants +1D to the chosen target action',
    async ({ page }, testInfo) => {
      const tag = `e2e-weapons-assignable-${testInfo.parallelIndex}-${Date.now()}`;
      const stamp = Date.now();
      const charAName = `E2E Captain ${stamp}`;
      const charBName = `E2E Char B ${stamp}`;
      const monAName = `E2E Bugbear ${stamp}`;

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
        // Convince is non-usesGear with a conflictWeapons list including the
        // assignable Blackmail entry (config.mjs L275-293).
        await panel.selectConflictType('convince');

        await expect(panel.beginDispositionButton).toBeEnabled();
        await panel.clickBeginDisposition();

        // Flat-set disposition on both sides (the disposition roll UI is
        // covered by disposition-roll-captain / disposition-flat-monster
        // specs). Values are arbitrary — we just need `distributed: true`
        // so `beginWeapons` unlocks (combat.mjs L249-255).
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

        // Verify the conflict config has the expected assignable weapon
        // entry so the test is self-validating against future config drift.
        const cfg = await page.evaluate((cId) => {
          const c = game.combats.get(cId);
          const k = c.getEffectiveConflictConfig();
          const bm = (k?.conflictWeapons || []).find(w => w.id === 'blackmail');
          return {
            usesGear: !!k?.usesGear,
            conflictType: c.system.conflictType,
            blackmail: bm ? {
              id: bm.id, label: bm.label, assignable: !!bm.assignable,
              bonuses: bm.bonuses
            } : null
          };
        }, combatId);
        expect(cfg.conflictType).toBe('convince');
        expect(cfg.usesGear).toBe(false);
        expect(cfg.blackmail).not.toBeNull();
        expect(cfg.blackmail.assignable).toBe(true);
        expect(cfg.blackmail.bonuses).toEqual([
          { type: 'dice', value: 1, assignable: true }
        ]);

        // Character dropdown on a convince conflict goes into the
        // conflict-panel.mjs L952-962 branch → `conflictWeapons` entries
        // first, then `__improvised__`, then `__unarmed__`. Blackmail must
        // be present.
        const charAOptions = await panel.weaponOptionValues(cmb.charA);
        expect(charAOptions).toContain('blackmail');

        // Assignment select is only rendered after a weapon with
        // `assignable: true` is selected (panel-weapons.hbs L30).
        await expect(panel.weaponAssignmentSelect(cmb.charA)).toHaveCount(0);

        // Act 1 — pick Blackmail. `#buildBonusSummary` renders the option
        // text with ` — +1D` appended (conflict-panel.mjs L994) but
        // `data-clean-name` is the bare localized weapon label, which is
        // what `setWeapon` writes to `system.weapon` (handler at
        // conflict-panel.mjs L161-164 — `selectedOption.dataset.cleanName`).
        await panel.selectWeapon(cmb.charA, 'blackmail');

        const blackmailLabel = await page.evaluate(() =>
          game.i18n.localize('TB2E.Weapon.Blackmail')
        );

        const afterWeapon = await page.evaluate(({ cId, id }) => {
          const co = game.combats.get(cId).combatants.get(id);
          return {
            weapon: co.system.weapon,
            weaponId: co.system.weaponId,
            weaponAssignment: co.system.weaponAssignment || '',
            actorWeapon: co.actor?.system.conflict?.weapon ?? null,
            actorWeaponId: co.actor?.system.conflict?.weaponId ?? null
          };
        }, { cId: combatId, id: cmb.charA });
        expect(afterWeapon.weaponId).toBe('blackmail');
        expect(afterWeapon.weapon).toBe(blackmailLabel);
        expect(afterWeapon.actorWeaponId).toBe('blackmail');
        expect(afterWeapon.actorWeapon).toBe(blackmailLabel);
        // Assignment hasn't been made yet — the field is blank.
        expect(afterWeapon.weaponAssignment).toBe('');

        // Assignment select is now rendered (showAssignment === true via
        // conflict-panel.mjs L894/L905 after the re-render).
        await expect(panel.weaponAssignmentSelect(cmb.charA)).toHaveCount(1);

        // Act 2 — assign the bonus to Attack. The change handler at
        // conflict-panel.mjs L170-178 writes
        // `system.weaponAssignment = "attack"` on the combatant.
        await panel.selectWeaponAssignment(cmb.charA, 'attack');

        const afterAssign = await page.evaluate(({ cId, id }) => {
          const co = game.combats.get(cId).combatants.get(id);
          return {
            weapon: co.system.weapon,
            weaponId: co.system.weaponId,
            weaponAssignment: co.system.weaponAssignment
          };
        }, { cId: combatId, id: cmb.charA });
        expect(afterAssign.weaponId).toBe('blackmail');
        expect(afterAssign.weapon).toBe(blackmailLabel);
        expect(afterAssign.weaponAssignment).toBe('attack');

        // DOM reflects the selection (template re-rendered with
        // `selected: c.system.weaponAssignment === "attack"` at
        // conflict-panel.mjs L907).
        await expect(panel.weaponAssignmentSelect(cmb.charA)).toHaveValue('attack');

        // Act 3 — replay the bonus-resolution logic from
        // #onRollAction (conflict-panel.mjs L1935-1965) for two action
        // keys: "attack" (should surface the Blackmail +1D modifier) and
        // "defend" (should not, since the assignment is "attack").
        // This is the rule under test: `targetAction = bonus.assignable ?
        // resolvedCombatant.system.weaponAssignment : bonus.action` then
        // `if (targetAction !== actionKey) continue;`.
        const bonusForAttack = await page.evaluate(({ cId, id, actionKey }) => {
          const combat = game.combats.get(cId);
          const co = combat.combatants.get(id);
          const cfg = combat.getEffectiveConflictConfig();
          const weaponId = co.system.weaponId;
          const disabledItemIds = co.system.disabledItemIds || [];
          const weaponDisarmed = weaponId && disabledItemIds.includes(weaponId);
          const cfgWeapons = cfg?.conflictWeapons || [];
          const modifiers = [];
          if ( weaponId === '__unarmed__' ) {
            modifiers.push({ source: 'conflict', type: 'dice', value: -1,
              label: game.i18n.localize('TB2E.Conflict.WeaponUnarmed') });
          } else if ( !weaponDisarmed ) {
            const w = cfgWeapons.find(x => x.id === weaponId);
            if ( w?.bonuses ) {
              for ( const bonus of w.bonuses ) {
                const targetAction = bonus.assignable
                  ? co.system.weaponAssignment : bonus.action;
                if ( targetAction !== actionKey ) continue;
                modifiers.push({
                  label: game.i18n.localize(w.label),
                  type: bonus.type, value: bonus.value, source: 'conflict'
                });
              }
            }
          }
          return modifiers;
        }, { cId: combatId, id: cmb.charA, actionKey: 'attack' });

        expect(bonusForAttack).toHaveLength(1);
        expect(bonusForAttack[0]).toMatchObject({
          label: blackmailLabel,
          type: 'dice',
          value: 1,
          source: 'conflict'
        });

        const bonusForDefend = await page.evaluate(({ cId, id, actionKey }) => {
          const combat = game.combats.get(cId);
          const co = combat.combatants.get(id);
          const cfg = combat.getEffectiveConflictConfig();
          const weaponId = co.system.weaponId;
          const disabledItemIds = co.system.disabledItemIds || [];
          const weaponDisarmed = weaponId && disabledItemIds.includes(weaponId);
          const cfgWeapons = cfg?.conflictWeapons || [];
          const modifiers = [];
          if ( weaponId === '__unarmed__' ) {
            modifiers.push({ source: 'conflict', type: 'dice', value: -1 });
          } else if ( !weaponDisarmed ) {
            const w = cfgWeapons.find(x => x.id === weaponId);
            if ( w?.bonuses ) {
              for ( const bonus of w.bonuses ) {
                const targetAction = bonus.assignable
                  ? co.system.weaponAssignment : bonus.action;
                if ( targetAction !== actionKey ) continue;
                modifiers.push({
                  label: game.i18n.localize(w.label),
                  type: bonus.type, value: bonus.value, source: 'conflict'
                });
              }
            }
          }
          return modifiers;
        }, { cId: combatId, id: cmb.charA, actionKey: 'defend' });

        // Bonus must NOT apply to a non-assigned action — `continue` branch
        // at conflict-panel.mjs L1954.
        expect(bonusForDefend).toHaveLength(0);

        // Act 4 — reassign to a different action (defend) and re-verify
        // the modifier now follows the new assignment. This guards against
        // the bonus accidentally being pinned to the originally-selected
        // action in the persisted state.
        await panel.selectWeaponAssignment(cmb.charA, 'defend');

        const reassign = await page.evaluate(({ cId, id }) => {
          const co = game.combats.get(cId).combatants.get(id);
          return co.system.weaponAssignment;
        }, { cId: combatId, id: cmb.charA });
        expect(reassign).toBe('defend');

        const bonusNowForDefend = await page.evaluate(({ cId, id, actionKey }) => {
          const combat = game.combats.get(cId);
          const co = combat.combatants.get(id);
          const cfg = combat.getEffectiveConflictConfig();
          const cfgWeapons = cfg?.conflictWeapons || [];
          const w = cfgWeapons.find(x => x.id === co.system.weaponId);
          const modifiers = [];
          if ( w?.bonuses ) {
            for ( const bonus of w.bonuses ) {
              const targetAction = bonus.assignable
                ? co.system.weaponAssignment : bonus.action;
              if ( targetAction !== actionKey ) continue;
              modifiers.push({
                label: game.i18n.localize(w.label),
                type: bonus.type, value: bonus.value, source: 'conflict'
              });
            }
          }
          return modifiers;
        }, { cId: combatId, id: cmb.charA, actionKey: 'defend' });

        expect(bonusNowForDefend).toHaveLength(1);
        expect(bonusNowForDefend[0]).toMatchObject({
          label: blackmailLabel,
          type: 'dice',
          value: 1
        });

        const bonusNowForAttack = await page.evaluate(({ cId, id, actionKey }) => {
          const combat = game.combats.get(cId);
          const co = combat.combatants.get(id);
          const cfg = combat.getEffectiveConflictConfig();
          const cfgWeapons = cfg?.conflictWeapons || [];
          const w = cfgWeapons.find(x => x.id === co.system.weaponId);
          const modifiers = [];
          if ( w?.bonuses ) {
            for ( const bonus of w.bonuses ) {
              const targetAction = bonus.assignable
                ? co.system.weaponAssignment : bonus.action;
              if ( targetAction !== actionKey ) continue;
              modifiers.push(bonus);
            }
          }
          return modifiers;
        }, { cId: combatId, id: cmb.charA, actionKey: 'attack' });
        expect(bonusNowForAttack).toHaveLength(0);
      } finally {
        await cleanupTaggedActors(page, tag);
      }
    }
  );
});
