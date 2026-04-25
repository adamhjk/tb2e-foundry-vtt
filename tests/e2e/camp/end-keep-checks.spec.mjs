import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CampPanel } from '../pages/CampPanel.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §X Camp Panel — End Camp with the "discard checks" toggle off.
 *
 * Default behavior (toggle checked) follows SG p. 95 — disaster wipes
 * the party's checks. The toggle is the GM's deviation lever: when
 * unchecked, the camp still ends and the visit is logged (and any
 * disaster still increments the counter), but PCs keep their unspent
 * checks. The user's case: "sometimes that's what happens — it should
 * still count as a dangerous event, but returns them to the adventure".
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

test.describe('§X Camp Panel — End Camp keeping checks', () => {
  test.afterEach(async ({ page }) => { await resetWorld(page); });

  test('endCamp({ discardChecks: false }) preserves checks but still logs visit + disaster', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);

    const ids = await page.evaluate(async () => {
      const s = await import('/systems/tb2e/module/data/camp/state.mjs');
      const pc = await Actor.create({ name: 'Thrar', type: 'character', system: { checks: 3 } });
      const camp = await Actor.create({
        name: 'Cave', type: 'camp',
        system: { type: 'natural-caves', defaultDanger: 'unsafe' }
      });
      await s.beginCamp(camp.id);

      // Simulate a disaster-ended visit so the writeback path is exercised.
      const st = s.getCampState();
      st.events.preCampGrindTurn = 4;
      st.events.isDisaster = true;
      st.events.outcome = 'ended';
      await game.settings.set('tb2e', 'campState', st);

      await s.endCamp({ discardChecks: false });
      return { pcId: pc.id, campId: camp.id };
    });

    const out = await page.evaluate((ids) => ({
      pcChecks:        game.actors.get(ids.pcId).system.checks,
      campDisasters:   game.actors.get(ids.campId).system.disastersThisAdventure,
      lastVisit:       game.actors.get(ids.campId).system.visits.at(-1),
      grindPhase:      game.settings.get('tb2e', 'grindPhase'),
      grindTurn:       game.settings.get('tb2e', 'grindTurn'),
      campActive:      game.settings.get('tb2e', 'campState').active
    }), ids);

    expect(out.pcChecks).toBe(3);                       // checks preserved
    expect(out.campDisasters).toBe(1);                  // disaster still counted
    expect(out.lastVisit.outcome).toBe('broken');       // visit logged as broken
    expect(out.grindPhase).toBe('adventure');           // returned to adventure
    expect(out.grindTurn).toBe(4);                      // grind tracker stays on the turn it was on
    expect(out.campActive).toBe(false);                 // session cleared
  });

  test('endCamp({ discardChecks: false }) restores pre-camp grindTurn after a safe-camp wipe', async ({ page }) => {
    // The safe-camp roll resets grindTurn to 1 (rollEvents). When the GM
    // ends camp keeping checks, the same gesture should also undo the
    // grind reset — otherwise the party gets a free grind refresh to go
    // with their preserved checks.
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);

    await page.evaluate(async () => {
      const s = await import('/systems/tb2e/module/data/camp/state.mjs');
      const pc = await Actor.create({ name: 'Thrar', type: 'character', system: { checks: 2 } });
      const camp = await Actor.create({
        name: 'Cave', type: 'camp',
        system: { type: 'natural-caves', defaultDanger: 'typical' }
      });
      await s.beginCamp(camp.id);

      // Simulate the post-roll state of a SAFE camp: preCampGrindTurn
      // stashed at 5, grindTurn already reset to 1 by rollEvents, no
      // disaster flagged. Also exercise the writeback path with a logged
      // visit outcome of "safe".
      const st = s.getCampState();
      st.events.preCampGrindTurn = 5;
      st.events.isDisaster = false;
      st.events.outcome = 'continuing';
      await game.settings.set('tb2e', 'campState', st);
      await game.settings.set('tb2e', 'grindTurn', 1);

      await s.endCamp({ discardChecks: false });
      // Mark pc/camp ids irrelevant — the assertion is on settings only.
      return { pcId: pc.id, campId: camp.id };
    });

    const grindTurn = await page.evaluate(() => game.settings.get('tb2e', 'grindTurn'));
    expect(grindTurn).toBe(5);
  });

  test('endCamp({ discardChecks: true }) leaves grindTurn at the rolled value (SG p. 95)', async ({ page }) => {
    // Negative control: the default flow (discard checks) does NOT touch
    // grindTurn — the safe-camp reset to 1 from rollEvents stays put.
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);

    await page.evaluate(async () => {
      const s = await import('/systems/tb2e/module/data/camp/state.mjs');
      await Actor.create({ name: 'Thrar', type: 'character', system: { checks: 2 } });
      const camp = await Actor.create({
        name: 'Cave', type: 'camp',
        system: { type: 'natural-caves', defaultDanger: 'typical' }
      });
      await s.beginCamp(camp.id);

      const st = s.getCampState();
      st.events.preCampGrindTurn = 5;
      st.events.isDisaster = false;
      st.events.outcome = 'continuing';
      await game.settings.set('tb2e', 'campState', st);
      await game.settings.set('tb2e', 'grindTurn', 1);

      await s.endCamp({ discardChecks: true });
    });

    const grindTurn = await page.evaluate(() => game.settings.get('tb2e', 'grindTurn'));
    expect(grindTurn).toBe(1);
  });

  test('Break tab toggle drives endCamp from the panel — unchecked keeps checks', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);

    const ids = await page.evaluate(async () => {
      const s = await import('/systems/tb2e/module/data/camp/state.mjs');
      const pc = await Actor.create({ name: 'Thrar', type: 'character', system: { checks: 2 } });
      const camp = await Actor.create({
        name: 'Cave', type: 'camp',
        system: { type: 'natural-caves', defaultDanger: 'typical' }
      });
      await s.beginCamp(camp.id);
      await s.setPhase('break');
      return { pcId: pc.id, campId: camp.id };
    });

    const panel = new CampPanel(page);
    await panel.clickToolbarButton();
    await expect(panel.root).toBeVisible();
    await expect(panel.tabButton('break')).toHaveClass(/\bactive\b/);

    const tab = panel.root.locator('.break-tab');
    const toggle = tab.locator('input.camp-break-discard-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeChecked();   // default = SG p. 95 (discard)

    // Uncheck → end camp keeps the checks.
    await toggle.uncheck();
    await tab.locator('button[data-action="endCamp"]').click();

    await expect(panel.root).toHaveCount(0);
    const checks = await page.evaluate((id) => game.actors.get(id).system.checks, ids.pcId);
    expect(checks).toBe(2);  // preserved
  });

  test('default (toggle checked) still discards checks — no regression on SG p. 95', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);

    const ids = await page.evaluate(async () => {
      const s = await import('/systems/tb2e/module/data/camp/state.mjs');
      const pc = await Actor.create({ name: 'Thrar', type: 'character', system: { checks: 4 } });
      const camp = await Actor.create({
        name: 'Cave', type: 'camp',
        system: { type: 'natural-caves', defaultDanger: 'typical' }
      });
      await s.beginCamp(camp.id);
      await s.setPhase('break');
      return { pcId: pc.id, campId: camp.id };
    });

    const panel = new CampPanel(page);
    await panel.clickToolbarButton();
    const tab = panel.root.locator('.break-tab');
    // Toggle stays at default (checked).
    await tab.locator('button[data-action="endCamp"]').click();

    await expect(panel.root).toHaveCount(0);
    const checks = await page.evaluate((id) => game.actors.get(id).system.checks, ids.pcId);
    expect(checks).toBe(0);  // discarded per SG p. 95
  });
});
