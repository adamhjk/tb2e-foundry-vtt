import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §X Camp mailbox — Phase L.
 *
 * Rules citation — this test enforces the mailbox pattern (CLAUDE.md):
 * players cannot write to world settings or other players' actors, so
 * player intent routes through `flags.tb2e.pendingCampAction` on the PC's
 * own actor, and the GM client processes it (deducts the check, writes
 * session log, etc.) then clears the flag.
 *
 * These tests simulate player writes by writing the flag with
 * `actor.update()` (the GM client is logged in; in production, a player
 * client with ownership of its own actor performs the same write).
 */

async function resetWorld(page) {
  await page.evaluate(async () => {
    const { defaultCampState } = await import('/systems/tb2e/module/data/camp/state.mjs');
    await game.settings.set('tb2e', 'campState', defaultCampState());
    for ( const a of [...game.actors] ) {
      if ( a.type === 'camp' || a.type === 'character' ) await a.delete();
    }
  });
}

test.describe('§X Camp mailbox (Phase L)', () => {
  test.afterEach(async ({ page }) => { await resetWorld(page); });

  test('spend-check mailbox deducts + logs + clears flag', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);

    const pcId = await page.evaluate(async () => {
      const s = await import('/systems/tb2e/module/data/camp/state.mjs');
      const pc = await Actor.create({ name: 'Thrar', type: 'character', system: { checks: 2 } });
      const camp = await Actor.create({
        name: 'Cave', type: 'camp',
        system: { type: 'natural-caves', defaultDanger: 'typical' }
      });
      await s.beginCamp(camp.id);
      // Simulate the player write.
      await pc.setFlag('tb2e', 'pendingCampAction', {
        kind: 'spend-check',
        payload: { purpose: 'recover' }
      });
      return pc.id;
    });

    // Poll for mailbox processing: flag cleared + check deducted.
    await expect
      .poll(() => page.evaluate((id) => game.actors.get(id).system.checks, pcId))
      .toBe(1);
    await expect
      .poll(() => page.evaluate((id) => game.actors.get(id).getFlag('tb2e', 'pendingCampAction') == null, pcId))
      .toBe(true);
    const log = await page.evaluate(() => game.settings.get('tb2e', 'campState').log);
    expect(log).toHaveLength(1);
    expect(log[0].kind).toBe('recover');
  });

  test('share-check mailbox transfers 1 check to another actor', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);

    const ids = await page.evaluate(async () => {
      const s = await import('/systems/tb2e/module/data/camp/state.mjs');
      const giver = await Actor.create({ name: 'Giver', type: 'character', system: { checks: 3 } });
      const taker = await Actor.create({ name: 'Taker', type: 'character', system: { checks: 0 } });
      const camp = await Actor.create({
        name: 'Cave', type: 'camp',
        system: { type: 'natural-caves', defaultDanger: 'typical' }
      });
      await s.beginCamp(camp.id);
      await giver.setFlag('tb2e', 'pendingCampAction', {
        kind: 'share-check',
        payload: { toActorId: taker.id }
      });
      return { giverId: giver.id, takerId: taker.id };
    });

    await expect
      .poll(() => page.evaluate((id) => game.actors.get(id).system.checks, ids.giverId))
      .toBe(2);
    await expect
      .poll(() => page.evaluate((id) => game.actors.get(id).system.checks, ids.takerId))
      .toBe(1);
    await expect
      .poll(() => page.evaluate((id) => game.actors.get(id).getFlag('tb2e', 'pendingCampAction') == null, ids.giverId))
      .toBe(true);
  });

  test('memorize mailbox enforces once-per-camp (second write is a no-op)', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);

    const pcId = await page.evaluate(async () => {
      const s = await import('/systems/tb2e/module/data/camp/state.mjs');
      const pc = await Actor.create({ name: 'Pyre', type: 'character', system: { checks: 3 } });
      const camp = await Actor.create({
        name: 'Cave', type: 'camp',
        system: { type: 'natural-caves', defaultDanger: 'typical' }
      });
      await s.beginCamp(camp.id);
      await pc.setFlag('tb2e', 'pendingCampAction', { kind: 'memorize' });
      return pc.id;
    });

    // First memorize: 3 → 2 checks, memorizedBy contains the actor.
    await expect
      .poll(() => page.evaluate((id) => game.actors.get(id).system.checks, pcId))
      .toBe(2);
    await expect
      .poll(() => page.evaluate(() => game.settings.get('tb2e', 'campState').memorizedBy.length))
      .toBe(1);

    // Second memorize is a no-op per SG p. 95. Flag write is processed, but
    // the dispatcher returns early (already in memorizedBy), unsetting the flag.
    await page.evaluate((id) => game.actors.get(id).setFlag('tb2e', 'pendingCampAction', { kind: 'memorize' }), pcId);
    await expect
      .poll(() => page.evaluate((id) => game.actors.get(id).getFlag('tb2e', 'pendingCampAction') == null, pcId))
      .toBe(true);
    // Checks unchanged.
    const finalChecks = await page.evaluate((id) => game.actors.get(id).system.checks, pcId);
    expect(finalChecks).toBe(2);
  });
});
