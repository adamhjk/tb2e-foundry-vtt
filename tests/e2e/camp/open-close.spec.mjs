import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CampPanel } from '../pages/CampPanel.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §X Camp Panel — first-pass scaffold (Scholar's Guide pp. 90–96).
 *
 * Implementation map (verified against
 * `module/applications/camp-panel.mjs`):
 *   - Singleton accessor: `CampPanel.getInstance()` caches on
 *     `game.tb2e.campPanel` (init to null in tb2e.mjs L14).
 *   - `DEFAULT_OPTIONS.id = "camp-panel"` → outer `<div id="camp-panel">`.
 *   - Template: `templates/camp-panel.hbs` renders a `.camp-panel-shell`
 *     wrapper with a single `<h2>Camp</h2>` heading (placeholder body).
 *   - Toolbar registration: tb2e.mjs `getSceneControlButtons` hook adds a
 *     `camp-panel` tool under the `tokens` control, icon
 *     `fa-solid fa-campground`, with an `onChange` handler that toggles
 *     `CampPanel.getInstance().render()` / `.close()`.
 *
 * This is the scaffold pass — no state, no tabs, no behavior beyond open/close.
 * The test asserts only what exists:
 *   - The campground button appears in the scene-controls toolbar.
 *   - Clicking it toggles the panel open/closed.
 *   - The panel renders the placeholder heading.
 *   - The singleton is cached on `game.tb2e.campPanel` after first open.
 *   - The window title localizes to "Camp" (TB2E.CampPanel.Title).
 */
test.describe('§X Camp Panel — open/close scaffold', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => {
      try { game.tb2e.campPanel?.close?.(); } catch {}
    });
  });

  test('campground toolbar button toggles the panel open and closed', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    const panel = new CampPanel(page);

    // Pre-open: singleton is null (module-level init leaves it null until the
    // first getInstance() call).
    expect(await panel.isSingletonInstantiated()).toBe(false);
    await expect(panel.root).toHaveCount(0);

    // The toolbar button itself should be present (registered in the
    // getSceneControlButtons hook — button.tool[data-tool="camp-panel"]).
    await expect(panel.toolbarButton).toHaveCount(1);

    // Open via the toolbar.
    await panel.clickToolbarButton();

    // Panel renders.
    await expect(panel.root).toBeVisible();
    await expect(panel.heading).toHaveText('Camp');

    // Singleton now cached.
    expect(await panel.isSingletonInstantiated()).toBe(true);
    expect(await panel.isRendered()).toBe(true);

    // Window title is localized from TB2E.CampPanel.Title.
    expect(await panel.getWindowTitle()).toBe('Camp');

    // Click again — toggles closed (onChange handler: `if (rendered) close`).
    await panel.clickToolbarButton();
    await expect(panel.root).toHaveCount(0);
    expect(await panel.isRendered()).toBe(false);

    // Singleton stays cached — `close()` doesn't null out game.tb2e.campPanel.
    expect(await panel.isSingletonInstantiated()).toBe(true);

    // Click a third time — re-opens cleanly from the cached instance.
    await panel.clickToolbarButton();
    await expect(panel.root).toBeVisible();
    await expect(panel.heading).toHaveText('Camp');
  });
});
