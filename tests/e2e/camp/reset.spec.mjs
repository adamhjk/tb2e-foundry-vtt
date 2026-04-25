import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CampPanel } from '../pages/CampPanel.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §X Camp Panel — Reset (cancel without recording).
 *
 * Differs from `endCamp` (Break Camp button):
 *   - No visit entry is appended to the camp actor.
 *   - `disastersThisAdventure` is NOT incremented.
 *   - Newly-found amenities this visit are NOT flushed to the actor.
 *   - PC `system.checks` are NOT discarded — they survive the reset
 *     (per SG p. 95: checks are only lost when camp is broken).
 *   - Grind turn restored to pre-camp; phase returned to adventure.
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

test.describe('§X Camp Panel — Reset (cancelCamp)', () => {
  test.afterEach(async ({ page }) => { await resetWorld(page); });

  test('cancelCamp clears session, restores grindTurn, leaves actor + checks untouched', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);

    const ids = await page.evaluate(async () => {
      const s = await import('/systems/tb2e/module/data/camp/state.mjs');
      const pc = await Actor.create({ name: 'Thrar', type: 'character', system: { checks: 3 } });
      const camp = await Actor.create({
        name: 'The Cave', type: 'camp',
        system: { type: 'natural-caves', defaultDanger: 'unsafe',
                  amenities: { shelter: false, concealment: false, water: false } }
      });
      // Pre-camp state: turn 5, mid-adventure.
      await game.settings.set('tb2e', 'grindTurn', 5);
      await s.beginCamp(camp.id);
      await s.toggleSurvey('shelter');                    // newly found this visit
      await s.setPhase('events');                         // stashes preCampGrindTurn
      await s.cancelCamp();
      return { pcId: pc.id, campId: camp.id };
    });

    const out = await page.evaluate(({ pcId, campId }) => ({
      campState: game.settings.get('tb2e', 'campState'),
      grindTurn:  game.settings.get('tb2e', 'grindTurn'),
      grindPhase: game.settings.get('tb2e', 'grindPhase'),
      pcChecks:   game.actors.get(pcId).system.checks,
      campShelter:    game.actors.get(campId).system.amenities.shelter,
      campDisasters:  game.actors.get(campId).system.disastersThisAdventure,
      campVisits:     game.actors.get(campId).system.visits.length
    }), ids);

    // Session cleared.
    expect(out.campState.active).toBe(false);
    expect(out.campState.campActorId).toBeNull();
    expect(out.campState.phase).toBe('site');

    // Grind restored to pre-camp + back to adventure.
    expect(out.grindTurn).toBe(5);
    expect(out.grindPhase).toBe('adventure');

    // Checks survive — reset doesn't discard them.
    expect(out.pcChecks).toBe(3);

    // Camp actor is UNTOUCHED — newly-found shelter not flushed, no
    // visit appended, no disaster recorded.
    expect(out.campShelter).toBe(false);
    expect(out.campDisasters).toBe(0);
    expect(out.campVisits).toBe(0);
  });

  test('Reset button appears in the header only when a camp is active', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);

    const panel = new CampPanel(page);
    await panel.clickToolbarButton();
    await expect(panel.root).toBeVisible();

    // No active camp → no Reset button.
    await expect(panel.root.locator('button.camp-header-reset-btn')).toHaveCount(0);

    // Begin a camp from outside the panel.
    await page.evaluate(async () => {
      const s = await import('/systems/tb2e/module/data/camp/state.mjs');
      const camp = await Actor.create({ name: 'Cave', type: 'camp',
        system: { type: 'natural-caves', defaultDanger: 'typical' } });
      await s.beginCamp(camp.id);
    });

    // Reset button now visible + wired to the cancelCamp action.
    const resetBtn = panel.root.locator('button.camp-header-reset-btn');
    await expect(resetBtn).toBeVisible();
    await expect(resetBtn).toHaveAttribute('data-action', 'cancelCamp');

    // Drive cancelCamp directly (the production button shows a Foundry
    // confirm dialog before firing — that's a UI concern; the state
    // mutation is what we lock down here).
    await page.evaluate(async () => {
      const s = await import('/systems/tb2e/module/data/camp/state.mjs');
      await s.cancelCamp();
    });

    // Reset button hides again.
    await expect(panel.root.locator('button.camp-header-reset-btn')).toHaveCount(0);
  });
});
