import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §X Help-pool regression — camp actors must not crash rollTest.
 *
 * The bug: `isBlockedFromHelping` reads `actor.system.conditions.dead`,
 * which is undefined for camp-type actors (no `conditions` schema). Any
 * skill/ability roll that walked over a camp actor in the helper pool
 * would crash with "Cannot read properties of undefined (reading 'dead')".
 *
 * Fix: `isBlockedFromHelping` blocks any actor type that isn't in
 * `HELPER_ACTOR_TYPES` (character / monster / npc), and the candidate
 * pool filters by the same set so camp actors don't appear as helpers.
 */
test.describe('§X help pool ignores camp actors', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(async () => {
      for ( const a of [...game.actors] ) {
        if ( a.type === 'camp' || a.type === 'character' ) await a.delete();
      }
    });
  });

  test('isBlockedFromHelping returns blocked (no throw) for a camp actor', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    const result = await page.evaluate(async () => {
      const camp = await Actor.create({ name: 'Hall', type: 'camp',
        system: { type: 'dungeons', defaultDanger: 'typical' } });
      const help = await import('/systems/tb2e/module/dice/help.mjs');
      try {
        const r = help.isBlockedFromHelping(camp);
        return { ok: true, blocked: r.blocked };
      } catch ( err ) {
        return { ok: false, err: err.message };
      }
    });

    expect(result.ok).toBe(true);
    expect(result.blocked).toBe(true);   // camp actors can never help
  });

  test('getEligibleHelpers does not list camp actors as helpers', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    const helpers = await page.evaluate(async () => {
      const pc = await Actor.create({ name: 'Thrar', type: 'character', system: { checks: 1 } });
      await Actor.create({ name: 'Hall', type: 'camp',
        system: { type: 'dungeons', defaultDanger: 'typical' } });
      const help = await import('/systems/tb2e/module/dice/help.mjs');
      // Build a pool from game.actors (no scene tokens here).
      const allActorsAsCandidates = game.actors.filter(a => a.id !== pc.id);
      return help.getEligibleHelpers({
        actor: pc,
        type: "skill",
        key: "scout",
        candidates: allActorsAsCandidates
      }).map(h => h.name);
    });

    // No camp actor in the helpers list. (Even when a non-character is in
    // the pool, isBlockedFromHelping filters it out.)
    expect(helpers).not.toContain('Hall');
  });
});
