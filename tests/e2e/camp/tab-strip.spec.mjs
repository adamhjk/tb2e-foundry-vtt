import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CampPanel } from '../pages/CampPanel.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §X Camp Panel — Phase A tab strip.
 *
 * Implementation map (verified against
 * `module/applications/camp/camp-panel.mjs`):
 *   - `static TAB_DEFS` declares six tabs in order: site, setup, decisions,
 *     events, strategy, break.
 *   - `#activeTab` defaults to "site"; switched via `switchTab` action.
 *   - Tab button state class: "completed" for tabs before active,
 *     "current" for the active tab, "upcoming" for tabs after.
 *   - Each tab's content partial renders a `.panel-placeholder` paragraph
 *     naming the tab (until subsequent phases fill them in).
 *
 * This spec verifies the Phase A shell: tabs exist, default active is Site,
 * state classes progress correctly as the user clicks through, and the
 * correct partial renders for each tab.
 *
 * Rules citation: this test enforces no Torchbearer rule directly — it
 * enforces the plan at `tests/e2e/camp/CAMP_PLAN.md` §3 (Shell) and §2 (Tabs).
 */
test.describe('§X Camp Panel — tab strip (Phase A)', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => {
      try { game.tb2e.campPanel?.close?.(); } catch {}
    });
  });

  test('renders 6 tabs in order with Site active by default', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Reset campState so phase is at "site".
    await page.evaluate(async () => {
      const { defaultCampState } = await import('/systems/tb2e/module/data/camp/state.mjs');
      await game.settings.set('tb2e', 'campState', defaultCampState());
    });

    const panel = new CampPanel(page);
    await panel.clickToolbarButton();
    await expect(panel.root).toBeVisible();

    // Six tabs, in order.
    const ids = await panel.tabButtons().evaluateAll(
      (buttons) => buttons.map(b => b.dataset.tab)
    );
    expect(ids).toEqual(['site', 'setup', 'decisions', 'events', 'strategy', 'break']);

    // Site is active + current phase; rest are upcoming.
    await expect(panel.tabButton('site')).toHaveClass(/\bactive\b/);
    expect(await panel.tabState('site')).toBe('current');
    for ( const id of ['setup', 'decisions', 'events', 'strategy', 'break'] ) {
      expect(await panel.tabState(id)).toBe('upcoming');
    }

    // Site tab content rendered (site-tab wrapper + create-camp form).
    await expect(panel.root.locator('.panel-content .site-tab')).toBeVisible();
    await expect(panel.root.locator('.panel-content form.camp-new-camp-form')).toBeVisible();
  });

  test('clicking tabs switches the rendered partial but does NOT advance procedure state', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Baseline: reset campState so phase is "site".
    await page.evaluate(async () => {
      const { defaultCampState } = await import('/systems/tb2e/module/data/camp/state.mjs');
      await game.settings.set('tb2e', 'campState', defaultCampState());
    });

    const panel = new CampPanel(page);
    await panel.clickToolbarButton();
    await expect(panel.root).toBeVisible();

    // Click Events — active highlight moves, state icons unchanged.
    await panel.switchToTab('events');
    await expect(panel.tabButton('events')).toHaveClass(/\bactive\b/);
    // Events partial rendered (verified by its wrapper class).
    await expect(panel.root.locator('.panel-content .events-tab')).toBeVisible();

    // State icons unchanged — only "site" is current, the rest upcoming.
    expect(await panel.tabState('site')).toBe('current');
    expect(await panel.tabState('setup')).toBe('upcoming');
    expect(await panel.tabState('decisions')).toBe('upcoming');
    expect(await panel.tabState('events')).toBe('upcoming');

    // Switch back to Site.
    await panel.switchToTab('site');
    await expect(panel.tabButton('site')).toHaveClass(/\bactive\b/);
    await expect(panel.root.locator('.panel-content .site-tab')).toBeVisible();
  });

  test('state icons advance when the session phase advances', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Drive the session phase forward from outside the panel.
    await page.evaluate(async () => {
      const s = await import('/systems/tb2e/module/data/camp/state.mjs');
      const { defaultCampState } = s;
      const state = defaultCampState();
      state.phase = 'events';
      state.active = true;
      await game.settings.set('tb2e', 'campState', state);
    });

    const panel = new CampPanel(page);
    await panel.clickToolbarButton();
    await expect(panel.root).toBeVisible();

    // State icons reflect procedure progression.
    await expect
      .poll(() => panel.tabState('site'))
      .toBe('completed');
    expect(await panel.tabState('setup')).toBe('completed');
    expect(await panel.tabState('decisions')).toBe('completed');
    expect(await panel.tabState('events')).toBe('current');
    expect(await panel.tabState('strategy')).toBe('upcoming');
    expect(await panel.tabState('break')).toBe('upcoming');

    // Restore default for subsequent tests.
    await page.evaluate(async () => {
      const { defaultCampState } = await import('/systems/tb2e/module/data/camp/state.mjs');
      await game.settings.set('tb2e', 'campState', defaultCampState());
    });
  });
});
