import { expect } from '@playwright/test';

/**
 * Page object for the Camp Panel (Scholar's Guide pp. 90–96).
 *
 * Source: `module/applications/camp-panel.mjs` — singleton
 * `HandlebarsApplicationMixin(ApplicationV2)` rendered from
 * `templates/camp-panel.hbs`. Access via `game.tb2e.campPanel` or
 * `CampPanel.getInstance()`. Exposed on the tokens scene-controls toolbar
 * as the "camp-panel" tool (see tb2e.mjs `getSceneControlButtons` hook).
 *
 * DEFAULT_OPTIONS.id = "camp-panel" → the outer element is
 * `<div id="camp-panel" class="application ... tb2e camp-panel">`.
 *
 * This is the first-pass scaffold — no state, no interactive controls.
 * The page object exposes only the primitives needed to verify that the
 * scene-control button opens/closes the panel and that the template renders.
 */
export class CampPanel {
  constructor(page) {
    this.page = page;
    this.root = page.locator('#camp-panel');
    this.heading = this.root.locator('.camp-panel-shell h2');
    // Scene-controls toolbar button — rendered by Foundry's SceneControls
    // app at #scene-controls-tools; selector verified against
    // foundry/client/applications/ui/scene-controls.mjs L216 / L281.
    this.toolbarButton = page.locator('#scene-controls-tools button.tool[data-tool="camp-panel"]');
  }

  /** Click the campground button in the tokens scene-controls toolbar. */
  async clickToolbarButton() {
    // The tokens control must be active for its tools to be visible.
    // Foundry defaults to the tokens control on load; we click it to be
    // safe in case a prior test switched layers.
    await this.page.locator('#scene-controls-layers button.control[data-control="tokens"]').click();
    await expect(this.toolbarButton).toBeVisible();
    await this.toolbarButton.click();
  }

  /** Close via the singleton API (used for teardown). */
  async close() {
    await this.page.evaluate(() => game.tb2e.campPanel?.close());
    await expect(this.root).toHaveCount(0);
  }

  /** Whether the singleton is instantiated on game.tb2e.campPanel. */
  async isSingletonInstantiated() {
    return this.page.evaluate(() => !!game.tb2e.campPanel);
  }

  /** Whether the singleton reports itself as rendered. */
  async isRendered() {
    return this.page.evaluate(() => game.tb2e.campPanel?.rendered === true);
  }

  /** Read the window title from the application frame header. */
  async getWindowTitle() {
    return (await this.root.locator('.window-title').first().textContent())?.trim();
  }

  /* ------------------------------------------------------------------ */
  /*  Tab strip                                                          */
  /* ------------------------------------------------------------------ */

  /** All tab buttons in the strip, in template order. */
  tabButtons() {
    return this.root.locator('nav.panel-tabs button.panel-tab');
  }

  /** A specific tab button by id (data-tab). */
  tabButton(tabId) {
    return this.root.locator(`nav.panel-tabs button.panel-tab[data-tab="${tabId}"]`);
  }

  /** Click a tab to switch the active tab. */
  async switchToTab(tabId) {
    await this.tabButton(tabId).click();
  }

  /** Read the state class ("upcoming" | "current" | "completed") from a tab button. */
  async tabState(tabId) {
    const btn = this.tabButton(tabId);
    for ( const state of ["upcoming", "current", "completed"] ) {
      const classes = await btn.getAttribute('class');
      if ( classes?.split(/\s+/).includes(state) ) return state;
    }
    return null;
  }

  /** The placeholder paragraph rendered by a tab's partial (scaffold phase). */
  placeholder() {
    return this.root.locator('.panel-content .panel-placeholder');
  }
}
