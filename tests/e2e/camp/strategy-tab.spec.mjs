import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CampPanel } from '../pages/CampPanel.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §X Camp Panel — Strategy tab (Phase H).
 *
 * Rules citations:
 *   - SG p. 94 — each test/conflict in camp costs 1 check.
 *   - SG p. 95 — memorize spells once per camp; purify burden once per camp;
 *     watchers cannot recover, memorize, or purify.
 *   - SG p. 95 — instincts in camp are free UNLESS adventurer is exhausted.
 *   - DH p. 81 — players may share checks peer-to-peer.
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

async function seedStrategyCamp(page, opts = {}) {
  return page.evaluate(async (opts) => {
    const s = await import('/systems/tb2e/module/data/camp/state.mjs');
    const pcIds = {};
    for ( const p of opts.pcs ?? [] ) {
      const a = await Actor.create({
        name: p.name, type: 'character',
        system: {
          checks: p.checks ?? 2,
          conditions: p.conditions ?? {}
        }
      });
      pcIds[p.name] = a.id;
    }
    const camp = await Actor.create({
      name: 'Cave', type: 'camp',
      system: { type: 'natural-caves', defaultDanger: 'typical' }
    });
    await s.beginCamp(camp.id);
    await s.setPhase('strategy');
    if ( opts.watchers ) {
      for ( const name of opts.watchers ) {
        if ( pcIds[name] ) await s.toggleWatcher(pcIds[name]);
      }
    }
    return { campId: camp.id, pcIds };
  }, opts);
}

test.describe('§X Camp Panel — Strategy tab (Phase H)', () => {
  test.afterEach(async ({ page }) => { await resetWorld(page); });

  test('spending a check deducts from actor and appends to camp log (SG p. 94)', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);
    const { pcIds } = await seedStrategyCamp(page, { pcs: [{ name: 'Thrar', checks: 2 }] });

    const panel = new CampPanel(page);
    await panel.clickToolbarButton();
    await expect(panel.root).toBeVisible();

    const tab = panel.root.locator('.strategy-tab');
    await expect(tab).toBeVisible();

    await tab.locator(`button[data-action="spendCheck"][data-actor-id="${pcIds.Thrar}"][data-purpose="test"]`).click();

    await expect
      .poll(() => page.evaluate((id) => game.actors.get(id).system.checks, pcIds.Thrar))
      .toBe(1);
    const log = await page.evaluate(() => game.settings.get('tb2e', 'campState').log);
    expect(log).toHaveLength(1);
    expect(log[0].kind).toBe('test');
    expect(log[0].actorId).toBe(pcIds.Thrar);
  });

  test('watchers cannot Recover / Memorize / Purify (SG p. 92)', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);
    const { pcIds } = await seedStrategyCamp(page, {
      pcs: [{ name: 'Thrar', checks: 2 }, { name: 'Grima', checks: 1 }],
      watchers: ['Thrar']
    });

    const panel = new CampPanel(page);
    await panel.clickToolbarButton();
    await expect(panel.root).toBeVisible();

    const tab = panel.root.locator('.strategy-tab');
    const thrar = tab.locator(`.camp-strategy-pc:has([src][alt]):has(.camp-strategy-pc-name:text("Thrar"))`);

    // Watcher lockouts.
    await expect(tab.locator(`button[data-action="spendCheck"][data-actor-id="${pcIds.Thrar}"][data-purpose="recover"]`)).toBeDisabled();
    await expect(tab.locator(`button[data-action="recordMemorize"][data-actor-id="${pcIds.Thrar}"]`)).toBeDisabled();
    await expect(tab.locator(`button[data-action="recordPurify"][data-actor-id="${pcIds.Thrar}"]`)).toBeDisabled();

    // Non-watcher can.
    await expect(tab.locator(`button[data-action="recordMemorize"][data-actor-id="${pcIds.Grima}"]`)).toBeEnabled();
  });

  test('memorize and purify are once-per-camp per actor (SG p. 95)', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);
    const { pcIds } = await seedStrategyCamp(page, { pcs: [{ name: 'Pyre', checks: 3 }] });

    const panel = new CampPanel(page);
    await panel.clickToolbarButton();
    await expect(panel.root).toBeVisible();

    const tab = panel.root.locator('.strategy-tab');
    const memorize = tab.locator(`button[data-action="recordMemorize"][data-actor-id="${pcIds.Pyre}"]`);
    const purify = tab.locator(`button[data-action="recordPurify"][data-actor-id="${pcIds.Pyre}"]`);

    await memorize.click();
    await expect(memorize).toBeDisabled();
    await expect
      .poll(() => page.evaluate(() => game.settings.get('tb2e', 'campState').memorizedBy.length))
      .toBe(1);

    await purify.click();
    await expect(purify).toBeDisabled();
    await expect
      .poll(() => page.evaluate(() => game.settings.get('tb2e', 'campState').purifiedBy.length))
      .toBe(1);
  });

  test('instinct is free for non-exhausted PCs; costs 1 check for exhausted (SG p. 95)', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);
    const { pcIds } = await seedStrategyCamp(page, {
      pcs: [
        { name: 'Well', checks: 2, conditions: {} },
        { name: 'Tired', checks: 2, conditions: { exhausted: true } }
      ]
    });

    const panel = new CampPanel(page);
    await panel.clickToolbarButton();
    await expect(panel.root).toBeVisible();

    const tab = panel.root.locator('.strategy-tab');

    // Well: instinct shows "(free)" and does NOT deduct a check.
    await tab.locator(`button[data-action="useInstinct"][data-actor-id="${pcIds.Well}"]`).click();
    await expect
      .poll(() => page.evaluate((id) => game.actors.get(id).system.checks, pcIds.Well))
      .toBe(2);

    // Tired: instinct costs 1 check.
    await tab.locator(`button[data-action="useInstinct"][data-actor-id="${pcIds.Tired}"]`).click();
    await expect
      .poll(() => page.evaluate((id) => game.actors.get(id).system.checks, pcIds.Tired))
      .toBe(1);
  });

  test('camp log shows "Kind: Actor" + "→ Receiver" for shares', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);

    const { pcIds } = await seedStrategyCamp(page, {
      pcs: [{ name: 'Gerald', checks: 2 }, { name: 'Karolina', checks: 1 }]
    });

    const panel = new CampPanel(page);
    await panel.clickToolbarButton();
    await expect(panel.root).toBeVisible();

    const tab = panel.root.locator('.strategy-tab');

    // Make a test, a recover, and a share — log should name the actors.
    await tab.locator(`button[data-action="spendCheck"][data-actor-id="${pcIds.Gerald}"][data-purpose="test"]`).click();
    await tab.locator(`button[data-action="spendCheck"][data-actor-id="${pcIds.Karolina}"][data-purpose="recover"]`).click();
    await tab.locator(`select.camp-strategy-share-select[data-actor-id="${pcIds.Gerald}"]`).selectOption(pcIds.Karolina);

    // Log renders with kind labels + actor names, not just raw kinds.
    const log = tab.locator('.camp-strategy-log');

    const first = log.locator('.camp-strategy-log-entry').nth(0);
    await expect(first.locator('.camp-strategy-log-kind')).toContainText('Test');
    await expect(first.locator('.camp-strategy-log-actor')).toContainText('Gerald');

    const second = log.locator('.camp-strategy-log-entry').nth(1);
    await expect(second.locator('.camp-strategy-log-kind')).toContainText('Recover');
    await expect(second.locator('.camp-strategy-log-actor')).toContainText('Karolina');

    const shareEntry = log.locator('.camp-strategy-log-entry').nth(2);
    await expect(shareEntry.locator('.camp-strategy-log-kind')).toContainText('Share');
    await expect(shareEntry.locator('.camp-strategy-log-actor').first()).toContainText('Gerald');
    await expect(shareEntry.locator('.camp-strategy-log-actor').nth(1)).toContainText('Karolina');
    await expect(shareEntry.locator('.camp-strategy-log-arrow')).toHaveText('→');
  });

  test('share check transfers 1 check from giver to receiver (DH p. 81)', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);
    const { pcIds } = await seedStrategyCamp(page, {
      pcs: [
        { name: 'Giver', checks: 3 },
        { name: 'Taker', checks: 0 }
      ]
    });

    const panel = new CampPanel(page);
    await panel.clickToolbarButton();
    await expect(panel.root).toBeVisible();

    const tab = panel.root.locator('.strategy-tab');
    const shareSel = tab.locator(`select.camp-strategy-share-select[data-actor-id="${pcIds.Giver}"]`);
    await shareSel.selectOption(pcIds.Taker);

    await expect
      .poll(() => page.evaluate((id) => game.actors.get(id).system.checks, pcIds.Giver))
      .toBe(2);
    await expect
      .poll(() => page.evaluate((id) => game.actors.get(id).system.checks, pcIds.Taker))
      .toBe(1);
  });
});
