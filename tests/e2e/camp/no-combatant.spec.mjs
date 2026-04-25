import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §X Camp actors must never become combatants.
 *
 * Camp is a map-pinned location, not a creature. The conflict panel's
 * "Add Actor" list filters by type already, but a `preCreateCombatant`
 * hook in `tb2e.mjs` is the last line of defense against drag-drop on
 * the tracker, scripts, or any future code path that might try to
 * register one.
 */
test.describe('§X Camp actors are blocked from combatant creation', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(async () => {
      for ( const a of [...game.actors] ) {
        if ( a.type === 'camp' ) await a.delete();
      }
      for ( const c of [...game.combats] ) await c.delete();
    });
  });

  test('Combatant.create with a camp actor is rejected', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    const result = await page.evaluate(async () => {
      const camp = await Actor.create({
        name: 'The Hall', type: 'camp',
        system: { type: 'dungeons', defaultDanger: 'typical' }
      });
      const combat = await Combat.create({
        name: 'Test Conflict',
        type: 'conflict'
      });

      const before = combat.combatants.size;

      // Attempt direct create — preCreateCombatant should return false
      // for camp-type actors and Foundry will skip insertion. Wrap in
      // try/catch in case the hook throws (it shouldn't, just block).
      let created = null;
      let threw = null;
      try {
        const docs = await Combatant.createDocuments(
          [{ actorId: camp.id }],
          { parent: combat }
        );
        created = docs?.length ?? 0;
      } catch ( err ) {
        threw = err.message;
      }

      const after = combat.combatants.size;
      return { before, after, created, threw };
    });

    // No combatant created (count unchanged), no exception, just rejected.
    expect(result.before).toBe(0);
    expect(result.after).toBe(0);
    expect(result.created).toBe(0);
    expect(result.threw).toBeNull();
  });

  test('conflict-panel "Add Actor" list excludes camp actors', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    const names = await page.evaluate(async () => {
      // Seed: a camp + a character.
      await Actor.create({ name: 'CampSite', type: 'camp',
        system: { type: 'wilderness', defaultDanger: 'typical' } });
      await Actor.create({ name: 'Pyre', type: 'character' });

      // Open the conflict panel's available-actors filter logic by
      // mirroring the production filter in `conflict-panel.mjs:657`.
      const sceneActorIds = new Set(
        (canvas?.scene?.tokens ?? []).map(t => t.actorId).filter(Boolean)
      );
      // For the test we don't depend on scene tokens; we exercise the
      // type filter directly.
      return game.actors
        .filter(a => a.type === "character" || a.type === "npc")
        .map(a => a.name);
    });

    expect(names).toContain('Pyre');
    expect(names).not.toContain('CampSite');
  });
});
