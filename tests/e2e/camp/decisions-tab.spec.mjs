import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CampPanel } from '../pages/CampPanel.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §X Camp Panel — Decisions tab (Phase F).
 *
 * Rules citations:
 *   - SG p. 91 — survey + amenities (Survivalist); water gives no roll bonus.
 *   - SG p. 92 — dark camp: cooking/distilling/forging blocked; recovery +1 Ob;
 *     danger penalty reduced by 1.
 *   - SG p. 92 — watch grants +1 regardless of count; watchers cannot recover,
 *     memorize spells, or purify Immortal burden this camp.
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

async function seedCampAtPhase(page, { phase = 'decisions', withPC = true } = {}) {
  return page.evaluate(async ({ phase, withPC }) => {
    const s = await import('/systems/tb2e/module/data/camp/state.mjs');
    if ( withPC ) {
      await Actor.create({ name: 'Thrar', type: 'character', system: { checks: 2 } });
      await Actor.create({ name: 'Grima', type: 'character', system: { checks: 1 } });
    }
    const camp = await Actor.create({
      name: 'The Overlook', type: 'camp',
      system: { type: 'natural-caves', defaultDanger: 'unsafe' }
    });
    await s.beginCamp(camp.id);
    await s.setPhase(phase);
    return camp.id;
  }, { phase, withPC });
}

test.describe('§X Camp Panel — Decisions tab (Phase F)', () => {
  test.afterEach(async ({ page }) => { await resetWorld(page); });

  test('survey toggle reveals amenity checkboxes and persists', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);
    await seedCampAtPhase(page);

    const panel = new CampPanel(page);
    await panel.clickToolbarButton();
    await expect(panel.root).toBeVisible();
    await expect(panel.tabButton('decisions')).toHaveClass(/\bactive\b/);

    const tab = panel.root.locator('.decisions-tab');
    await expect(tab).toBeVisible();

    // Initially amenities list is hidden until survey is toggled on.
    await expect(tab.locator('.camp-decisions-amenities')).toHaveCount(0);

    await tab.locator('input[data-action="toggleSurvey"][data-key="performed"]').check();
    await expect
      .poll(() => page.evaluate(() => game.settings.get('tb2e', 'campState').survey.performed))
      .toBe(true);
    await expect(tab.locator('.camp-decisions-amenities')).toBeVisible();

    // Toggle shelter found — writes to campState.survey.shelter.
    await tab.locator('input[data-action="toggleSurvey"][data-key="shelter"]').check();
    await expect
      .poll(() => page.evaluate(() => game.settings.get('tb2e', 'campState').survey.shelter))
      .toBe(true);
  });

  test('setting dark camp surfaces the +1 Ob recovery hint', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);
    await seedCampAtPhase(page);

    const panel = new CampPanel(page);
    await panel.clickToolbarButton();
    await expect(panel.root).toBeVisible();

    const tab = panel.root.locator('.decisions-tab');

    // Default fire = "lit"; no dark hint.
    await expect(tab.locator('.dark-camp-hint')).toHaveCount(0);

    await tab.locator('input[name="fire"][value="dark"]').check();

    await expect
      .poll(() => page.evaluate(() => game.settings.get('tb2e', 'campState').fire))
      .toBe('dark');
    await expect(tab.locator('.dark-camp-hint')).toBeVisible();
    await expect(tab.locator('.dark-camp-hint')).toContainText('+1 Ob');
  });

  test('toggling watchers updates the session watcher list', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);
    await seedCampAtPhase(page);

    const panel = new CampPanel(page);
    await panel.clickToolbarButton();
    await expect(panel.root).toBeVisible();

    const tab = panel.root.locator('.decisions-tab');
    const watchers = tab.locator('.camp-decisions-watchers input[data-action="toggleWatcher"]');
    await expect(watchers).toHaveCount(2);

    const thrarBox = watchers.first();
    await thrarBox.check();

    const state = await page.evaluate(() => game.settings.get('tb2e', 'campState'));
    expect(state.watchers).toHaveLength(1);
  });
});
