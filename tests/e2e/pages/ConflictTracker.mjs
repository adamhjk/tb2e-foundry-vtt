import { expect } from '@playwright/test';

/**
 * Page object for the Conflict Tracker — the sidebar scoreboard that
 * replaces Foundry's default CombatTracker.
 *
 * Source: `module/applications/conflict/conflict-tracker.mjs` — extends
 * `foundry.applications.sidebar.tabs.CombatTracker` and is registered as
 * `CONFIG.ui.combat` in `tb2e.mjs` L67. Foundry's sidebar keys this tab
 * by `static tabName = "combat"`, so it renders into `<section id="combat">`
 * inside the main sidebar.
 *
 * Templates (all under `templates/conflict/`):
 *   - tracker-header.hbs — `<div class="tb2e-conflict-header">`, encounter
 *     title + GM context menu
 *   - tracker-body.hbs   — `<div class="tb2e-conflict-body">` with one
 *     `<section class="conflict-group" data-group-id="...">` per group
 *     (groups are PC Team / NPC Team by default — see combat.mjs L28-31)
 *   - tracker-footer.hbs — `<div class="tb2e-conflict-footer">` with
 *     `button[data-action="createConflict"]` (when no combat) and
 *     `button[data-action="openPanel"]` / `[data-action="endConflict"]`
 *     (when one exists)
 *
 * Sized for §12–§20 reuse: `createConflict`, `openPanel`, `endConflict`,
 * and group/combatant lookups will all be needed repeatedly.
 */
export class ConflictTracker {
  constructor(page) {
    this.page = page;
    // The sidebar Combat tab's panel — matches Foundry's `tabName = "combat"`.
    this.root = page.locator('#combat');
    this.header = this.root.locator('.tb2e-conflict-header');
    this.body = this.root.locator('.tb2e-conflict-body');
    this.footer = this.root.locator('.tb2e-conflict-footer');
    this.createConflictButton = this.footer.locator(
      'button.conflict-control[data-action="createConflict"]'
    );
    this.openPanelButton = this.footer.locator(
      'button.conflict-control[data-action="openPanel"]'
    );
    this.endConflictButton = this.footer.locator(
      'button.conflict-control[data-action="endConflict"]'
    );
    this.encounterTitle = this.header.locator('.encounter-title span');
    this.groups = this.body.locator('section.conflict-group');
  }

  /**
   * Navigate to the Combat sidebar tab so the tracker is visible. Foundry's
   * sidebar uses `<a data-tab="combat">` (or the rendered aria tab) for the
   * tab switch. We rely on the role-based locator from GameUI.openSidebarTab
   * when called from a spec; this helper is a convenience that activates
   * the tab via the game's sidebar API (works regardless of label/i18n).
   */
  async open() {
    // Foundry's sidebar starts collapsed; changeTab alone doesn't expand it,
    // and an unexpanded sidebar leaves the tracker panel off-viewport so
    // footer buttons fail the "visible + in-viewport" gate. Expand first,
    // then switch to the combat tab.
    await this.page.evaluate(() => {
      ui.sidebar?.toggleExpanded?.(true);
      ui.sidebar?.changeTab?.('combat', 'primary');
    });
    await expect(this.root).toBeVisible();
  }

  /** Click the "Create Conflict" footer button (GM-only, shown when no combat exists). */
  async clickCreateConflict() {
    await this.createConflictButton.click();
  }

  /** Click the "Open Playbook" footer button (shown when a combat exists). */
  async clickOpenPanel() {
    await this.openPanelButton.click();
  }

  /** Click the "End Conflict" footer button (GM-only, shown when a combat exists). */
  async clickEndConflict() {
    await this.endConflictButton.click();
  }

  /**
   * Locator for a specific group section by id.
   * @param {string} groupId
   */
  group(groupId) {
    return this.body.locator(`section.conflict-group[data-group-id="${groupId}"]`);
  }
}
