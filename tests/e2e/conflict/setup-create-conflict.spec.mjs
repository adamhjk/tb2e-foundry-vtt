import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §12 Conflict: Setup — create a new conflict and verify the wizard opens
 * on the setup tab, and the sidebar scoreboard renders the new conflict.
 *
 * Rules under test: conflict creation mechanics (DH pp.118-120 — declaring
 * the conflict type / setting up teams). This spec deliberately stops at
 * "conflict exists and the UI is wired up" — sibling specs
 * (setup-add-combatants, setup-assign-captain, setup-assign-boss,
 * setup-select-type — TEST_PLAN.md L366-369) cover the rest of §12.
 *
 * Implementation map (all file:line refs verified against current source):
 *   - Create path: the tracker footer's `[data-action="createConflict"]`
 *     button (templates/conflict/tracker-footer.hbs L7) dispatches to
 *     `ConflictTracker.#onCreateConflict` (conflict-tracker.mjs L267-269),
 *     which calls `Combat.implementation.createConflict()`.
 *   - `TB2ECombat.createConflict` (combat.mjs L42-48) seeds
 *     `{ type: "conflict", active: true, system: { conflictType: "manual",
 *     phase: "setup" } }` and delegates to `TB2ECombat.create`
 *     (combat.mjs L20-35), which ensures two default CombatantGroups
 *     (PCTeam + NPCTeam).
 *   - The tracker replaces Foundry's default CombatTracker via
 *     `CONFIG.ui.combat = applications.conflict.ConflictTracker`
 *     (tb2e.mjs L67). It extends `AbstractSidebarTab` which ids the tab
 *     section as `#combat` (sidebar-tab.mjs L82-83).
 *   - The ConflictPanel is a separate singleton ApplicationV2 with
 *     `DEFAULT_OPTIONS.id = "conflict-panel"` (conflict-panel.mjs L41) —
 *     so its window element is `#conflict-panel`. Opening it on "setup"
 *     phase requires an explicit render; `tb2e.mjs` L273-280 only
 *     auto-opens on the `disposition` phase transition. This spec uses
 *     `ConflictPanel.open()` (which calls `getInstance().render()`) to
 *     assert the wizard is reachable and shows the setup tab as the
 *     active tab (conflict-panel.mjs L17 — initial #activeTab = "setup";
 *     L526 sets `context.isSetupTab`).
 *
 * Cleanup: deletes every Combat the test created to keep the world tidy
 * across repeat-each iterations and across specs sharing the same worker.
 */
test.describe('§12 Conflict: Setup — create conflict', () => {
  test.afterEach(async ({ page }) => {
    // Always close the panel singleton and delete any conflicts, even on
    // test failure — otherwise sibling specs in the same worker inherit an
    // orphan Combat / open floating window.
    await page.evaluate(async () => {
      try { await game.tb2e.conflictPanel?.close(); } catch {}
      const ids = Array.from(game.combats ?? []).map(c => c.id);
      if ( ids.length ) await Combat.deleteDocuments(ids);
    });
  });

  test('GM creates a conflict; tracker updates and panel opens on setup tab', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    const tracker = new ConflictTracker(page);
    await tracker.open();

    // No combat yet — the footer should show the GM's "Create Conflict"
    // button and the body should render the "no conflict" empty state.
    await expect(tracker.createConflictButton).toBeVisible();
    await expect(tracker.groups).toHaveCount(0);

    const initialCombats = await page.evaluate(() => game.combats.size);

    await tracker.clickCreateConflict();

    // A new TB2ECombat of type "conflict" exists, active, phase "setup".
    await expect
      .poll(() => page.evaluate(() => game.combats.size), { timeout: 10_000 })
      .toBe(initialCombats + 1);

    const combatSnapshot = await page.evaluate(() => {
      // Prefer the active conflict, but fall back to any conflict so the
      // assertion isn't sensitive to whether `active: true` survived the
      // DB round-trip.
      const c = game.combats.find(x => x.isConflict && x.active)
            ?? game.combats.find(x => x.isConflict);
      if ( !c ) return null;
      return {
        id: c.id,
        type: c.type,
        phase: c.system.phase,
        conflictType: c.system.conflictType,
        groupCount: c.groups.size,
        groupNames: Array.from(c.groups).map(g => g.name)
      };
    });
    expect(combatSnapshot).not.toBeNull();
    expect(combatSnapshot.type).toBe('conflict');
    expect(combatSnapshot.phase).toBe('setup');
    expect(combatSnapshot.conflictType).toBe('manual');
    // combat.mjs L27-32 seeds exactly two default groups.
    expect(combatSnapshot.groupCount).toBe(2);
    expect(combatSnapshot.groupNames).toHaveLength(2);

    // Tracker body now reflects the new combat — create button is gone and
    // both groups render as sections with matching data-group-ids.
    await expect(tracker.createConflictButton).toHaveCount(0);
    await expect(tracker.openPanelButton).toBeVisible();
    await expect(tracker.groups).toHaveCount(2);

    // Open the playbook panel. The tracker footer's "Open Playbook" button
    // is the user-facing entry (conflict-tracker.mjs L322-324); the POM's
    // `open()` uses the same singleton API the button invokes.
    const panel = new ConflictPanel(page);
    await panel.open();

    // Panel is rendered on the setup tab — the default initial #activeTab
    // is "setup" (conflict-panel.mjs L17) and no phase transition has
    // advanced it.
    expect(await panel.activeTabId()).toBe('setup');
    await expect(panel.tab('setup')).toHaveClass(/\bactive\b/);
    await expect(panel.setupContent).toBeVisible();

    // Sanity: the panel reads the combat we just created — the conflict
    // type select should be present (GM) and reflect the seeded value.
    await expect(panel.conflictTypeSelect).toBeVisible();
    await expect(panel.conflictTypeSelect).toHaveValue('manual');
  });
});
