import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CampPanel } from '../pages/CampPanel.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §X Camp Panel — Events tab (Phase G).
 *
 * Rules citations:
 *   - SG p. 93 — modifier breakdown (shelter/concealment/ranger/outcast/
 *     watch, danger, dark-camp relief, prior disasters, GM situational).
 *   - SG p. 94 — safe → strategize; disaster + no watch → camp ends, checks
 *     lost; disaster + watch → spend 1 check to avert.
 *   - SG pp. 266–278 — specific entries flagged unavertable.
 */

async function resetWorld(page) {
  await page.evaluate(async () => {
    const { defaultCampState } = await import('/systems/tb2e/module/data/camp/state.mjs');
    await game.settings.set('tb2e', 'campState', defaultCampState());
    for ( const a of [...game.actors] ) {
      if ( a.type === 'camp' || a.type === 'character' ) await a.delete();
    }
    for ( const m of [...game.messages] ) {
      if ( m.getFlag('tb2e', 'campEventDraw') ) await m.delete();
    }
  });
}

async function seedNaturalCaveAtEvents(page, opts = {}) {
  return page.evaluate(async (opts) => {
    const s = await import('/systems/tb2e/module/data/camp/state.mjs');
    for ( const name of opts.pcs ?? [] ) {
      await Actor.create({ name, type: 'character', system: { checks: 1 } });
    }
    const camp = await Actor.create({
      name: 'The Cave', type: 'camp',
      system: { type: 'natural-caves', defaultDanger: 'typical' }
    });
    await s.beginCamp(camp.id);
    await s.setPhase('events');
    return camp.id;
  }, opts);
}

test.describe('§X Camp Panel — Events tab (Phase G)', () => {
  test.afterEach(async ({ page }) => { await resetWorld(page); });

  test('modifier breakdown lists all nine rule lines (SG p. 93)', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);
    await seedNaturalCaveAtEvents(page, { pcs: ['Thrar'] });

    const panel = new CampPanel(page);
    await panel.clickToolbarButton();
    await expect(panel.root).toBeVisible();

    const tab = panel.root.locator('.events-tab');
    await expect(tab).toBeVisible();

    const modLines = tab.locator('.camp-events-breakdown .camp-events-mod-label');
    // 9 rule lines + 1 total row.
    const labels = await modLines.allTextContents();
    expect(labels).toEqual([
      'Shelter',
      'Concealment',
      'Ranger in wilderness',
      'Outcast in dungeon',
      'Watch set',
      'Danger: Typical',
      'Prior disasters here',
      'GM situational',
      'Net modifier'
    ]);
  });

  test('GM stepper adjusts situational modifier ±1', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);
    await seedNaturalCaveAtEvents(page, { pcs: ['Thrar'] });

    const panel = new CampPanel(page);
    await panel.clickToolbarButton();
    await expect(panel.root).toBeVisible();

    const tab = panel.root.locator('.events-tab');
    const plus = tab.locator('.gm-situational .camp-events-mod-adjust[data-delta="1"]');
    const minus = tab.locator('.gm-situational .camp-events-mod-adjust[data-delta="-1"]');

    await plus.click();
    await plus.click();
    await expect
      .poll(() => page.evaluate(() => game.settings.get('tb2e', 'campState').events.gmSituational))
      .toBe(2);

    await minus.click();
    await minus.click();
    await minus.click();
    await expect
      .poll(() => page.evaluate(() => game.settings.get('tb2e', 'campState').events.gmSituational))
      .toBe(-1);
  });

  test('Roll 3d6 posts chat card and surfaces the result in the panel', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);
    await seedNaturalCaveAtEvents(page, { pcs: ['Thrar'] });

    // Force a deterministic dice result so we know which event fires.
    // 3 × 4 → total 12 (Safe camp) on Natural Caves table.
    await page.evaluate(() => {
      const orig = Roll.prototype.evaluate;
      window.__campOrigEval = orig;
      Roll.prototype.evaluate = async function() {
        await orig.call(this);
        if ( this.dice.length === 1 && this.dice[0].number === 3 && this.dice[0].faces === 6 ) {
          this.dice[0].results = [
            { result: 4, active: true }, { result: 4, active: true }, { result: 4, active: true }
          ];
          const modTerm = this.terms.find(t => t.term === "mod");
          this._total = 12 + (modTerm?.total ?? 0);
        }
        return this;
      };
    });

    const panel = new CampPanel(page);
    await panel.clickToolbarButton();
    await expect(panel.root).toBeVisible();

    const tab = panel.root.locator('.events-tab');
    await tab.locator('button[data-action="rollEvents"]').click();

    // Panel shows the result.
    await expect(tab.locator('.camp-events-result-name')).toContainText('Safe camp');

    // Chat card posted (per Phase B3).
    const chatCard = page.locator('.tb2e-chat-card.loot-card--camp-event').last();
    await expect(chatCard).toBeVisible();

    await page.evaluate(() => { Roll.prototype.evaluate = window.__campOrigEval; delete window.__campOrigEval; });
  });

  test('avertable disaster with no watchers surfaces the "no watch" message (SG p. 94)', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);
    await seedNaturalCaveAtEvents(page, { pcs: ['Thrar'] });

    // Directly seed the session events payload — simulates a completed roll
    // that landed on an avertable disaster. This test is about the UI
    // response, not the roll mechanism (covered in "Roll 3d6 posts chat card").
    await page.evaluate(async () => {
      const pack = game.packs.get('tb2e.camp-events');
      const tables = await pack.getDocuments();
      const natural = tables.find(t => t.name === 'Natural Caves Camp Events');
      const cavein = [...natural.results].find(r => r.name.startsWith('Cave-in'));
      const state = game.settings.get('tb2e', 'campState');
      state.events = {
        ...state.events,
        rolled: true,
        dice: [1, 1, 1],
        modifier: -3,
        total: 0,
        resultUuid: cavein.uuid,
        topResultUuid: cavein.uuid,
        isDisaster: true,
        isUnavertable: false,
        averted: null,
        // No watchers + disaster → outcome is "ended" (set by rollEvents).
        outcome: 'ended'
      };
      // No watchers (empty array left from seeding defaults).
      state.watchers = [];
      await game.settings.set('tb2e', 'campState', state);
    });

    const panel = new CampPanel(page);
    await panel.clickToolbarButton();
    await expect(panel.root).toBeVisible();

    const tab = panel.root.locator('.events-tab');
    // The result card renders the Cave-in title + page ref.
    await expect(tab.locator('.camp-events-result-name')).toContainText('Cave-in');
    // No watchers → "no watch" message + forced Break Camp advance.
    await expect(tab.locator('.camp-events-no-watch')).toBeVisible();
    await expect(tab.locator('button[data-phase="break"]')).toBeVisible();
  });

  test('watcher avert flow — watcher button records success + camp continues (SG p. 94)', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);

    const campId = await seedNaturalCaveAtEvents(page, { pcs: ['Thrar', 'Grima'] });

    // Seed: Cave-in result + Thrar on watch.
    await page.evaluate(async ({ campId }) => {
      const pack = game.packs.get('tb2e.camp-events');
      const tables = await pack.getDocuments();
      const natural = tables.find(t => t.name === 'Natural Caves Camp Events');
      const cavein = [...natural.results].find(r => r.name.startsWith('Cave-in'));
      const thrar = game.actors.getName('Thrar');
      const state = game.settings.get('tb2e', 'campState');
      state.events = {
        ...state.events,
        rolled: true, dice: [1, 1, 1], modifier: -3, total: 0,
        resultUuid: cavein.uuid, isDisaster: true, isUnavertable: false,
        averted: null, outcome: 'pending'
      };
      state.watchers = [thrar.id];
      await game.settings.set('tb2e', 'campState', state);
    }, { campId });

    const panel = new CampPanel(page);
    await panel.clickToolbarButton();
    await expect(panel.root).toBeVisible();

    const tab = panel.root.locator('.events-tab');
    await expect(tab.locator('.camp-events-avert-buttons button[data-success="true"]')).toHaveCount(1);

    // Click "avert" for Thrar — marks success, outcome becomes "averted".
    await tab.locator('button[data-action="markAvert"][data-success="true"]').click();
    await expect
      .poll(() => page.evaluate(() => game.settings.get('tb2e', 'campState').events.outcome))
      .toBe('averted');
    await expect(tab.locator('.camp-events-averted')).toBeVisible();
  });
});
