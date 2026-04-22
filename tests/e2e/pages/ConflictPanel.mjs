import { expect } from '@playwright/test';

/**
 * Page object for the Conflict Panel (the 7-tab "playbook" wizard).
 *
 * Source: `module/applications/conflict/conflict-panel.mjs` — a
 * `HandlebarsApplicationMixin(ApplicationV2)` singleton accessed via
 * `ConflictPanel.getInstance()` / `game.tb2e.conflictPanel`. Rendered from
 * `templates/conflict/panel.hbs` with per-tab partials under
 * `templates/conflict/panel-{setup,disposition,weapons,script,resolve,resolution,roster}.hbs`.
 *
 * `DEFAULT_OPTIONS.id = "conflict-panel"` → outer window element is
 * `<div id="conflict-panel" class="application ... conflict-panel">`.
 *
 * The tab strip is rendered at `panel.hbs` L40-54 as `<nav class="panel-tabs">`
 * with one `<button class="panel-tab {{state}} {{isActive?active}}"
 * data-action="switchTab" data-tab="{{id}}">` per tab. Tab ids in order:
 *   setup, disposition, weapons, script, resolve, resolution
 * (see conflict-panel.mjs L510-517).
 *
 * This POM is sized for §12–§20 reuse: the active-tab assertion and
 * tab-click helper are usable for every conflict spec, and the `setup*`
 * helpers cover the §12 checkboxes.
 */
export class ConflictPanel {
  constructor(page) {
    this.page = page;
    this.root = page.locator('#conflict-panel');
    this.tabs = this.root.locator('nav.panel-tabs');
    this.setupContent = this.root.locator('.panel-tab-content.setup-tab');
    this.conflictTypeSelect = this.root.locator('select.conflict-type-select');
    this.conflictNameInput = this.root.locator('input.conflict-name-input');
  }

  /**
   * Render the singleton panel via its public API. Matches the flow the
   * tracker's "Open Playbook" button uses (conflict-tracker.mjs L322-324).
   */
  async open() {
    await this.page.evaluate(async () => {
      const mod = await import('/systems/tb2e/module/applications/conflict/conflict-panel.mjs');
      const panel = mod.default.getInstance();
      return panel.render({ force: true });
    });
    await expect(this.root).toBeVisible();
  }

  /** Close the panel (also unhooks updateCombat / updateCombatant listeners). */
  async close() {
    await this.page.evaluate(() => game.tb2e.conflictPanel?.close());
    await expect(this.root).toHaveCount(0);
  }

  /** The tab button for a given tab id (setup|disposition|weapons|script|resolve|resolution). */
  tab(tabId) {
    return this.tabs.locator(`button.panel-tab[data-tab="${tabId}"]`);
  }

  /** Click a tab button and wait for the switch to take effect. */
  async switchTab(tabId) {
    await this.tab(tabId).click();
    await expect(this.tab(tabId)).toHaveClass(/\bactive\b/);
  }

  /**
   * Read the currently active tab id. ApplicationV2 exposes the underlying
   * instance on the singleton; its private #activeTab is reflected by the
   * `.active` class on the tab button in the DOM.
   */
  async activeTabId() {
    return this.root
      .locator('nav.panel-tabs button.panel-tab.active')
      .getAttribute('data-tab');
  }
}
