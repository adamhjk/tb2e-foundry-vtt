import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CampPanel } from '../pages/CampPanel.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §X Camp Panel — Setup tab (Phase E).
 *
 * Rules citations:
 *   - SG p. 90 — camp requires ≥1 check in the party.
 *   - SG p. 91 — danger level is site-dependent; GM may override per visit.
 *
 * Implementation map — `templates/camp/panel-setup.hbs`:
 *   - Summary row with actor name, type label, open-sheet button.
 *   - Amenities read from camp actor (shelter / concealment / water).
 *   - Danger radio — `setDanger` action routes to `campState.setDanger`.
 *   - Party check pool — `partyChecks[]` and `canBeginDecisions` derived
 *     from all character actors' `system.checks` totals.
 *   - Next button disabled when partyCheckTotal === 0.
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

test.describe('§X Camp Panel — Setup tab (Phase E)', () => {
  test.afterEach(async ({ page }) => { await resetWorld(page); });

  test('displays camp actor summary, danger override, and check pool gate', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);

    // Seed a camp actor + begin camp + one PC with checks.
    await page.evaluate(async () => {
      const s = await import('/systems/tb2e/module/data/camp/state.mjs');
      await Actor.create({
        name: 'Thrar', type: 'character', system: { checks: 2 }
      });
      const camp = await Actor.create({
        name: 'Skogenby Barrow', type: 'camp',
        system: { type: 'ancient-ruins', defaultDanger: 'unsafe',
                  amenities: { shelter: true } }
      });
      await s.beginCamp(camp.id);
    });

    const panel = new CampPanel(page);
    await panel.clickToolbarButton();
    await expect(panel.root).toBeVisible();
    // beginCamp moved phase to "setup"; active tab should follow.
    await expect(panel.tabButton('setup')).toHaveClass(/\bactive\b/);

    const setup = panel.root.locator('.panel-content .setup-tab');
    await expect(setup).toBeVisible();
    await expect(setup.locator('.camp-setup-site-name')).toHaveText('Skogenby Barrow');
    await expect(setup.locator('.camp-setup-site-type')).toContainText('Ancient Ruins');

    // Amenities — shelter marked present, others missing.
    await expect(setup.locator('.camp-setup-amenities li.present')).toHaveCount(1);
    await expect(setup.locator('.camp-setup-amenities li.missing')).toHaveCount(2);

    // Danger radio — seeded from actor's defaultDanger.
    await expect(setup.locator('input[name="danger"]:checked')).toHaveValue('unsafe');

    // Check pool — Thrar has 2 checks, canBeginDecisions = true.
    await expect(setup.locator('.camp-setup-checks-total strong')).toHaveText(/Total/);
    await expect(setup.locator('.camp-setup-checks-total')).toContainText('2');
    await expect(setup.locator('.camp-setup-checks-empty')).toHaveCount(0);
    await expect(setup.locator('.camp-setup-footer button[data-action="advanceTo"]')).toBeEnabled();
  });

  test('disables Next when the party has 0 checks (SG p. 90)', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);

    await page.evaluate(async () => {
      const s = await import('/systems/tb2e/module/data/camp/state.mjs');
      await Actor.create({ name: 'Mira', type: 'character', system: { checks: 0 } });
      const camp = await Actor.create({
        name: 'Wild Camp', type: 'camp',
        system: { type: 'wilderness', defaultDanger: 'typical' }
      });
      await s.beginCamp(camp.id);
    });

    const panel = new CampPanel(page);
    await panel.clickToolbarButton();
    await expect(panel.root).toBeVisible();

    const nextBtn = panel.root.locator('.camp-setup-footer button[data-action="advanceTo"]');
    await expect(nextBtn).toBeDisabled();
    await expect(panel.root.locator('.camp-setup-checks-warning')).toBeVisible();
  });

  test('switching danger radio updates session state', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);

    await page.evaluate(async () => {
      const s = await import('/systems/tb2e/module/data/camp/state.mjs');
      await Actor.create({ name: 'Pyre', type: 'character', system: { checks: 1 } });
      const camp = await Actor.create({
        name: 'Cave', type: 'camp',
        system: { type: 'natural-caves', defaultDanger: 'typical' }
      });
      await s.beginCamp(camp.id);
    });

    const panel = new CampPanel(page);
    await panel.clickToolbarButton();
    await expect(panel.root).toBeVisible();

    await panel.root.locator('input[name="danger"][value="dangerous"]').check();

    await expect
      .poll(() => page.evaluate(() => game.settings.get('tb2e', 'campState').danger))
      .toBe('dangerous');
  });

  test('Next advances to Decisions tab', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);

    await page.evaluate(async () => {
      const s = await import('/systems/tb2e/module/data/camp/state.mjs');
      await Actor.create({ name: 'Grima', type: 'character', system: { checks: 1 } });
      const camp = await Actor.create({
        name: 'Cave', type: 'camp',
        system: { type: 'natural-caves', defaultDanger: 'typical' }
      });
      await s.beginCamp(camp.id);
    });

    const panel = new CampPanel(page);
    await panel.clickToolbarButton();
    await expect(panel.root).toBeVisible();

    await panel.root.locator('.camp-setup-footer button[data-action="advanceTo"][data-phase="decisions"]').click();

    await expect
      .poll(() => page.evaluate(() => game.settings.get('tb2e', 'campState').phase))
      .toBe('decisions');
    await expect(panel.tabButton('decisions')).toHaveClass(/\bactive\b/);
  });
});
