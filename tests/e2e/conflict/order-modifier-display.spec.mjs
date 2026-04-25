import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §X computeOrderModifier returns a `display` string.
 *
 * Bug: the roll-dialog modifier list reads `m.display` directly into the
 * DOM (`tb2e-roll.mjs:525`). When the order modifier was returned without
 * a `display` field the cell rendered the literal word "undefined" — fixed
 * by adding `display: "+{n}s"` to the return object so it matches what
 * `createModifier` emits for ordinary success modifiers.
 */
test.describe('§X Order of Might modifier display', () => {
  test('the modifier shape carries a "+Xs" display string', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    const result = await page.evaluate(async () => {
      // Stub a minimal `combat` interface — `getTeamMight` walks
      // combatants via `_groupCombatants`. We don't need a real conflict,
      // just enough to drive the function past the membership lookup.
      const monster = await Actor.create({
        name: '__OrderTestMonster', type: 'monster',
        system: { nature: 5, might: 4 }
      });
      const character = await Actor.create({
        name: '__OrderTestChar', type: 'character'
      });
      const stubCombat = {
        combatants: [
          { actorId: monster.id, actor: monster, _source: { group: 'g-monster' }, group: 'g-monster' },
          { actorId: character.id, actor: character, _source: { group: 'g-party' }, group: 'g-party' }
        ]
      };

      const { computeOrderModifier } = await import('/systems/tb2e/module/dice/conflict-roll.mjs');
      const mod = computeOrderModifier({
        conflictType: 'kill',
        ourGroupId: 'g-monster',
        opponentGroupId: 'g-party',
        combat: stubCombat
      });

      await monster.delete();
      await character.delete();
      return mod;
    });

    expect(result).not.toBeNull();
    expect(result.value).toBe(1);                 // Might 4 vs adventurer 3 → +1
    expect(result.display).toBe('+1s');           // <-- the bug fix
    expect(result.display).not.toContain('undefined');
    expect(result.timing).toBe('post');
    expect(result.type).toBe('success');
  });
});
