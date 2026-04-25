import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CampPanel } from '../pages/CampPanel.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §X Camp Panel — Site tab (Phase D).
 *
 * Implementation map:
 *   - `templates/camp/panel-site.hbs` lists existing camp actors and
 *     hosts an inline form to create a new camp site.
 *   - `CampPanel` actions: `selectCamp`, `createNewCamp`, `openCampSheet`,
 *     `advanceTo` (dispatches to `campState.beginCamp` /
 *     `createAndBeginCamp` / `setPhase`).
 *   - `campState.beginCamp` advances `phase` to "setup".
 *
 * Rules citations — SG p. 91 (map-pinned camp sites); SG p. 91 (GM notes
 * the camp on the map).
 */

async function resetWorld(page) {
  await page.evaluate(async () => {
    const { defaultCampState } = await import('/systems/tb2e/module/data/camp/state.mjs');
    await game.settings.set('tb2e', 'campState', defaultCampState());
    for ( const a of [...game.actors] ) {
      if ( a.type === 'camp' ) await a.delete();
    }
  });
}

test.describe('§X Camp Panel — Site tab (Phase D)', () => {
  test.afterEach(async ({ page }) => { await resetWorld(page); });

  test('shows the new-camp form; creating one selects it and advances the phase', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);

    const panel = new CampPanel(page);
    await panel.clickToolbarButton();
    await expect(panel.root).toBeVisible();

    // Site tab active by default.
    await expect(panel.tabButton('site')).toHaveClass(/\bactive\b/);

    const form = panel.root.locator('form.camp-new-camp-form');
    await expect(form).toBeVisible();

    await form.locator('input[name="name"]').fill('Skogenby Barrow');
    await form.locator('select[name="type"]').selectOption('ancient-ruins');
    await form.locator('select[name="defaultDanger"]').selectOption('dangerous');
    await panel.root.locator('button[data-action="createNewCamp"]').click();

    // Poll — creation + updateSetting hook re-render are async.
    await expect
      .poll(() => page.evaluate(() => game.actors.filter(a => a.type === 'camp').length))
      .toBe(1);

    const state = await page.evaluate(() => game.settings.get('tb2e', 'campState'));
    expect(state.active).toBe(true);
    expect(state.phase).toBe('setup');
    expect(state.danger).toBe('dangerous');
    expect(state.campActorId).toBeTruthy();

    // Active tab auto-follows the phase advance.
    await expect(panel.tabButton('setup')).toHaveClass(/\bactive\b/);
  });

  test('lists an existing camp and "Select" advances to Setup', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);

    // Seed an existing camp before opening the panel.
    const campId = await page.evaluate(async () => {
      const a = await Actor.create({
        name: 'The Overlook', type: 'camp',
        system: { type: 'natural-caves', defaultDanger: 'unsafe',
                  amenities: { shelter: true } }
      });
      return a.id;
    });

    const panel = new CampPanel(page);
    await panel.clickToolbarButton();
    await expect(panel.root).toBeVisible();

    // The list shows the seeded camp with its metadata.
    const entry = panel.root.locator(`.camp-site-entry[data-camp-id="${campId}"]`);
    await expect(entry).toBeVisible();
    await expect(entry.locator('.camp-site-name')).toHaveText('The Overlook');
    await expect(entry.locator('.camp-site-type')).toContainText('Natural Caves');
    await expect(entry.locator('.camp-site-danger')).toContainText('Unsafe');
    await expect(entry.locator('.camp-site-amenities')).toContainText('Shelter');

    // Select → beginCamp → phase advances to "setup".
    await entry.locator('button[data-action="selectCamp"]').click();

    await expect
      .poll(() => page.evaluate(() => game.settings.get('tb2e', 'campState').phase))
      .toBe('setup');
    const state = await page.evaluate(() => game.settings.get('tb2e', 'campState'));
    expect(state.campActorId).toBe(campId);
    // Danger seeded from the actor's defaultDanger.
    expect(state.danger).toBe('unsafe');
  });
});
