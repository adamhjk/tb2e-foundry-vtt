import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §12 Conflict: Setup — cycle through all 14 conflict types via the setup
 * tab type selector; verify each type persists on the Combat document and
 * the `getEffectiveConflictConfig()` the rest of the system reads resolves
 * the expected per-action skill/ability mapping from
 * `CONFIG.TB2E.conflictTypes`. Also verify the GM-only manual-config panel
 * is gated on `conflictType === "manual"` (the only type whose per-action
 * mapping is user-authored rather than fixed by config).
 *
 * Rules under test: choosing the conflict type during setup (DH pp.118-120 —
 * declaring a conflict; SG chapter on conflict types). Each conflict type
 * fixes the captain's disposition roll (ability + skill choices) and the
 * per-action test (attack/defend/feint/maneuver → ability or skill). The
 * 14 types are Kill, Capture, Chase, Drive Off, Flee, Convince, Convince
 * Crowd, Trick, Negotiate, Abjure, Riddle, War, Journey, Manual. Manual is
 * the GM escape hatch — it lets the GM author each action's test key.
 *
 * Implementation map (file:line verified against current source):
 *   - Type selector UI: `panel-setup.hbs` L5-14 renders a GM-only
 *     `<select class="conflict-type-select">` with one `<option>` per key
 *     from `context.conflictTypes`. That context slot is built at
 *     `conflict-panel.mjs` L585-589 from `Object.entries(CONFIG.TB2E.conflictTypes)`.
 *   - Change dispatch: the select's `change` listener
 *     (`conflict-panel.mjs` L201-207) calls
 *     `combat.update({ "system.conflictType": value })`. No mailbox — GM-only UI.
 *   - Storage: `CombatData.conflictType` (combat data model) seeded to
 *     `"manual"` by `TB2ECombat.createConflict` (`combat.mjs` L42-48).
 *   - Effective config: `TB2ECombat.getEffectiveConflictConfig`
 *     (`combat.mjs` L70-89) returns `CONFIG.TB2E.conflictTypes[type]` for
 *     non-manual types and layers `manualDispositionAbility/Skills` +
 *     `manualActions.*` over the base for manual. This is the surface the
 *     rest of the system reads (disposition, weapons, rolls — see call
 *     sites in conflict-panel.mjs L716, L880, L1552, L1595, L1859, and in
 *     `conflict-roll.mjs` L36). So verifying this function returns the
 *     right shape for each type is what proves "the mapping works end to
 *     end" without having to cycle every downstream tab.
 *   - Manual-config gate: `isManual` in setup context (`conflict-panel.mjs`
 *     L663-707) drives the `<div class="setup-manual-config">` block in
 *     `panel-setup.hbs` L38-80 — so switching *out of* manual should hide
 *     the block and switching *into* it should show it again.
 *
 * Scope notes (per agent briefing):
 *   - We do NOT deep-test individual action mechanics here (§15-§16
 *     territory). We prove that setting `conflictType = X` makes the
 *     effective config return the shape config.mjs declares, and that the
 *     UI re-renders accordingly. Downstream specs (disposition, weapons,
 *     resolve, …) verify that shape actually drives their UIs.
 *   - We use the UI select (the user path, with its live `change` listener)
 *     rather than `combat.update` directly, so a regression in the listener
 *     wiring would fail this spec.
 *
 * Cleanup: deletes every Combat this test created so sibling specs sharing
 * the worker don't inherit an orphan conflict.
 */
test.describe('§12 Conflict: Setup — cycle conflict types', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(async () => {
      try { await game.tb2e.conflictPanel?.close(); } catch {}
      const ids = Array.from(game.combats ?? []).map((c) => c.id);
      if ( ids.length ) await Combat.deleteDocuments(ids);
    });
  });

  test('GM cycles all 14 conflict types; each resolves to its config.mjs mapping', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Arrange — create a conflict and open the panel on the setup tab.
    const tracker = new ConflictTracker(page);
    await tracker.open();
    await tracker.clickCreateConflict();
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const c = game.combats.find((x) => x.isConflict);
            return c ? c.groups.size : 0;
          }),
        { timeout: 10_000 }
      )
      .toBe(2);

    const panel = new ConflictPanel(page);
    await panel.open();
    expect(await panel.activeTabId()).toBe('setup');
    await expect(panel.conflictTypeSelect).toBeVisible();
    // Seeded value per combat.mjs L42-48.
    await expect(panel.conflictTypeSelect).toHaveValue('manual');

    // Read both the config (expected) and the rendered option values
    // (actual) — they MUST agree so the `select` is a faithful surface of
    // `CONFIG.TB2E.conflictTypes`. This is the single assertion that would
    // catch "we added a type to config but forgot to re-render" regressions.
    const expectedTypes = await page.evaluate(() => {
      return Object.entries(CONFIG.TB2E.conflictTypes).map(([key, cfg]) => ({
        key,
        label: game.i18n.localize(cfg.label),
        dispositionAbility: cfg.dispositionAbility,
        dispositionSkills: Array.isArray(cfg.dispositionSkills)
          ? [...cfg.dispositionSkills]
          : [],
        actions: Object.fromEntries(
          Object.entries(cfg.actions).map(([k, a]) => [
            k,
            { type: a.type, keys: [...(a.keys ?? [])] }
          ])
        )
      }));
    });

    // §12 briefing cites "14 types" — assert the count explicitly so adding
    // or removing a type forces someone to update this spec with intent.
    expect(expectedTypes).toHaveLength(14);
    const expectedKeys = expectedTypes.map((t) => t.key).sort();
    expect(expectedKeys).toEqual(
      [
        'manual', 'kill', 'capture', 'chase', 'driveOff', 'flee',
        'convince', 'convinceCrowd', 'trick', 'negotiate', 'abjure',
        'riddle', 'war', 'journey'
      ].sort()
    );

    // Rendered <option value> values match the config keys exactly.
    const optionValues = await panel.conflictTypeOptionValues();
    expect(optionValues.sort()).toEqual(expectedKeys);

    // Cycle every type through the UI. For each:
    //   1) combat.system.conflictType now equals the chosen key
    //   2) getEffectiveConflictConfig() returns a config whose actions +
    //      dispositionAbility + dispositionSkills match config.mjs
    //   3) The manual-config UI block is visible iff key === "manual"
    //
    // Order: manual LAST so we leave the panel in a state where the gate
    // flips both ways (setup starts manual → non-manual → ... → manual).
    const nonManual = expectedTypes.filter((t) => t.key !== 'manual');
    const manual = expectedTypes.find((t) => t.key === 'manual');
    const cycle = [...nonManual, manual];

    for ( const expected of cycle ) {
      await panel.selectConflictType(expected.key);

      // Read through the panel's own resolution path — the exact surface
      // every downstream tab consumes (conflict-panel.mjs L478, L716, L880,
      // L1552, L1595, L1859; conflict-roll.mjs L36).
      const resolved = await page.evaluate(() => {
        const c = game.combats.find((x) => x.isConflict);
        if ( !c ) return null;
        const cfg = c.getEffectiveConflictConfig();
        return {
          conflictType: c.system.conflictType,
          dispositionAbility: cfg.dispositionAbility,
          dispositionSkills: Array.isArray(cfg.dispositionSkills)
            ? [...cfg.dispositionSkills]
            : [],
          actions: Object.fromEntries(
            Object.entries(cfg.actions).map(([k, a]) => [
              k,
              { type: a.type, keys: [...(a.keys ?? [])] }
            ])
          )
        };
      });

      expect(resolved, `resolved config for ${expected.key}`).not.toBeNull();
      expect(
        resolved.conflictType,
        `combat.system.conflictType for ${expected.key}`
      ).toBe(expected.key);
      expect(
        resolved.dispositionAbility,
        `dispositionAbility for ${expected.key}`
      ).toBe(expected.dispositionAbility);
      expect(
        resolved.dispositionSkills,
        `dispositionSkills for ${expected.key}`
      ).toEqual(expected.dispositionSkills);

      // Assert all four actions (attack/defend/feint/maneuver) match the
      // config.mjs mapping for this type. The agent briefing allows a
      // representative subset, but the full set is four keys per type so
      // cost is negligible and regressions on any one action show up loud.
      for ( const actionKey of ['attack', 'defend', 'feint', 'maneuver'] ) {
        expect(
          resolved.actions[actionKey],
          `action ${actionKey} for conflict type ${expected.key}`
        ).toEqual(expected.actions[actionKey]);
      }

      // Manual-config gate — `isManual` in the setup context
      // (conflict-panel.mjs L663) controls the whole
      // `.setup-manual-config` block in panel-setup.hbs L38-80.
      if ( expected.key === 'manual' ) {
        await expect(panel.setupManualConfig).toBeVisible();
        // All four conflict actions get a row (conflict-panel.mjs L694-706
        // iterates `CONFIG.TB2E.conflictActions`, which has exactly 4 keys).
        await expect(panel.manualActionRows).toHaveCount(4);
      } else {
        await expect(panel.setupManualConfig).toHaveCount(0);
      }
    }

    // Sanity: the select's rendered value at the end of the loop reflects
    // the last type we selected (manual — the cycle terminator).
    await expect(panel.conflictTypeSelect).toHaveValue('manual');
  });
});
