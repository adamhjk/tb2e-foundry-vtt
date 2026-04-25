import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CampPanel } from '../pages/CampPanel.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §X Camp Panel — Break Camp tab (Phase I).
 *
 * Rules citations:
 *   - SG p. 95 — unspent checks are lost on Break Camp.
 *   - SG p. 96 — turn count resets to 1 for the next adventure phase.
 *   - SG p. 91 — amenities found this visit persist on the camp actor.
 *   - SG p. 93 — prior disasters in this area increment the cumulative penalty.
 */

async function resetWorld(page) {
  await page.evaluate(async () => {
    const { defaultCampState } = await import('/systems/tb2e/module/data/camp/state.mjs');
    await game.settings.set('tb2e', 'campState', defaultCampState());
    await game.settings.set('tb2e', 'grindTurn', 1);
    await game.settings.set('tb2e', 'grindPhase', 'adventure');
    for ( const a of [...game.actors] ) {
      if ( a.type === 'camp' || a.type === 'character' ) await a.delete();
    }
  });
}

test.describe('§X Camp Panel — Break Camp (Phase I)', () => {
  test.afterEach(async ({ page }) => { await resetWorld(page); });

  test('summary renders site + danger + outcome; End Camp wipes session and resets grind', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);

    const ids = await page.evaluate(async () => {
      const s = await import('/systems/tb2e/module/data/camp/state.mjs');
      const thrar = await Actor.create({ name: 'Thrar', type: 'character', system: { checks: 3 } });
      const camp = await Actor.create({
        name: 'The Cave', type: 'camp',
        system: { type: 'natural-caves', defaultDanger: 'unsafe' }
      });
      await s.beginCamp(camp.id);
      await s.setDanger('dangerous');
      await s.toggleSurvey('shelter');
      // Simulate a safe-camp roll so grindTurn gets set to 1 by rollEvents
      // (the source of truth for this transition under the new design —
      // SG p. 96; endCamp does not modify grindTurn).
      await s.setPhase('events');
      const state = s.getCampState();
      state.events.rolled = true;
      state.events.outcome = 'continuing';
      state.events.isDisaster = false;
      await game.settings.set('tb2e', 'campState', state);
      await game.settings.set('tb2e', 'grindTurn', 1); // safe camp's net result
      await s.setPhase('break');

      // grindPhase stays "camp" (set when we entered events phase).
      return { thrarId: thrar.id, campId: camp.id };
    });

    const panel = new CampPanel(page);
    await panel.clickToolbarButton();
    await expect(panel.root).toBeVisible();

    const tab = panel.root.locator('.break-tab');
    await expect(tab).toBeVisible();
    await expect(tab.locator('.camp-break-summary')).toContainText('The Cave');
    await expect(tab.locator('.camp-break-summary')).toContainText('Natural Caves');
    await expect(tab.locator('.camp-break-summary')).toContainText('Dangerous');
    // 3 checks remaining → will be discarded.
    await expect(tab.locator('.camp-break-checks')).toContainText('3');
    await expect(tab.locator('.camp-break-checks-lose')).toBeVisible();

    // End Camp button.
    await tab.locator('button[data-action="endCamp"]').click();

    // Panel closes, session wiped, grind reset, checks discarded, amenity persisted.
    await expect(panel.root).toHaveCount(0);
    const result = await page.evaluate((ids) => ({
      campActive: game.settings.get('tb2e', 'campState').active,
      campActorId: game.settings.get('tb2e', 'campState').campActorId,
      grindTurn: game.settings.get('tb2e', 'grindTurn'),
      grindPhase: game.settings.get('tb2e', 'grindPhase'),
      thrarChecks: game.actors.get(ids.thrarId).system.checks,
      campShelter: game.actors.get(ids.campId).system.amenities.shelter,
      visitsLength: game.actors.get(ids.campId).system.visits.length
    }), ids);

    expect(result.campActive).toBe(false);
    expect(result.campActorId).toBeNull();
    expect(result.grindTurn).toBe(1);
    expect(result.grindPhase).toBe('adventure');
    expect(result.thrarChecks).toBe(0);
    expect(result.campShelter).toBe(true);
    expect(result.visitsLength).toBe(1);
  });
});
