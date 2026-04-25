import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CampPanel } from '../pages/CampPanel.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §X Camp ↔ Grind tracker sync + re-roll + footer nav (bug fixes).
 *
 * Rules citations:
 *   - SG p. 93 — "Roll for Camp Events" commits the camp phase.
 *   - SG p. 94 — safe → strategize; disaster + no watch → camp ends, all
 *     checks lost; disaster regardless of avert counts as a disaster.
 *   - SG p. 96 — "Upon breaking camp, the turn count resets to 1 for the
 *     next adventure phase." We interpret: safe camp → reset to 1; disaster
 *     → grind continues (turn preserved).
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

/**
 * Install a single-patch Roll override. `forceNextRoll(page, dice, total)`
 * updates the globals every test reads — re-calling it simply swaps the
 * forced result without stacking prototype patches (stacking breaks chain
 * composition in RollTable's internal `roll.reroll()` calls).
 */
async function installRollForce(page) {
  await page.evaluate(() => {
    if ( window.__rollForceInstalled ) return;
    window.__rollForceInstalled = true;
    window.__forcedDice = null;
    window.__forcedTotal = null;
    const orig = Roll.prototype.evaluate;
    Roll.prototype.evaluate = async function() {
      await orig.call(this);
      if ( window.__forcedDice && this.dice.length === 1 &&
           this.dice[0].number === 3 && this.dice[0].faces === 6 ) {
        this.dice[0].results = window.__forcedDice.map(r => ({ result: r, active: true }));
        this._total = window.__forcedTotal;
      }
      return this;
    };
  });
}

async function forceNextRoll(page, dice, total) {
  await installRollForce(page);
  await page.evaluate(({ dice, total }) => {
    window.__forcedDice = dice;
    window.__forcedTotal = total;
  }, { dice, total });
}

async function unforceRoll(page) {
  await page.evaluate(() => {
    window.__forcedDice = null;
    window.__forcedTotal = null;
  });
}

test.describe('§X Camp ↔ grind sync + re-roll + nav', () => {
  test.afterEach(async ({ page }) => { await unforceRoll(page); await resetWorld(page); });

  test('entering Events phase switches grindPhase to camp and stashes preCampGrindTurn', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);

    await page.evaluate(async () => {
      const s = await import('/systems/tb2e/module/data/camp/state.mjs');
      await game.settings.set('tb2e', 'grindTurn', 3);
      const camp = await Actor.create({ name: 'Cave', type: 'camp',
        system: { type: 'natural-caves', defaultDanger: 'typical' } });
      await s.beginCamp(camp.id);
    });

    const beforeEvents = await page.evaluate(() => ({
      grindPhase: game.settings.get('tb2e', 'grindPhase'),
      grindTurn:  game.settings.get('tb2e', 'grindTurn')
    }));
    expect(beforeEvents.grindPhase).toBe('adventure');

    await page.evaluate(async () => {
      const s = await import('/systems/tb2e/module/data/camp/state.mjs');
      await s.setPhase('events');
    });

    const afterEvents = await page.evaluate(() => ({
      grindPhase: game.settings.get('tb2e', 'grindPhase'),
      grindTurn:  game.settings.get('tb2e', 'grindTurn'),
      preCampGrindTurn: game.settings.get('tb2e', 'campState').events.preCampGrindTurn
    }));
    expect(afterEvents.grindPhase).toBe('camp');       // switched
    expect(afterEvents.grindTurn).toBe(3);             // unchanged on entry
    expect(afterEvents.preCampGrindTurn).toBe(3);      // stashed
  });

  test('safe roll sets grindTurn to 1; disaster roll restores preCampGrindTurn (re-roll resilient)', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);

    await page.evaluate(async () => {
      const s = await import('/systems/tb2e/module/data/camp/state.mjs');
      await game.settings.set('tb2e', 'grindTurn', 4);
      const camp = await Actor.create({ name: 'Cave', type: 'camp',
        system: { type: 'natural-caves', defaultDanger: 'typical' } });
      await s.beginCamp(camp.id);
      await s.setPhase('events');
    });

    // First roll: force total = 11 → "Safe camp" (Natural Caves row 11–12).
    await forceNextRoll(page, [4, 4, 3], 11);
    await page.evaluate(async () => {
      const s = await import('/systems/tb2e/module/data/camp/state.mjs');
      await s.rollEvents();
    });

    let state = await page.evaluate(() => ({
      grindTurn:  game.settings.get('tb2e', 'grindTurn'),
      isDisaster: game.settings.get('tb2e', 'campState').events.isDisaster,
      outcome:    game.settings.get('tb2e', 'campState').events.outcome
    }));
    expect(state.isDisaster).toBe(false);
    expect(state.outcome).toBe('continuing');
    expect(state.grindTurn).toBe(1);

    // Re-roll: force total = 0 → Cave-in disaster. grindTurn restores to 4.
    await forceNextRoll(page, [1, 1, 1], 0);
    await page.evaluate(async () => {
      const s = await import('/systems/tb2e/module/data/camp/state.mjs');
      await s.rollEvents();
    });
    state = await page.evaluate(() => ({
      grindTurn:  game.settings.get('tb2e', 'grindTurn'),
      isDisaster: game.settings.get('tb2e', 'campState').events.isDisaster,
      outcome:    game.settings.get('tb2e', 'campState').events.outcome
    }));
    expect(state.isDisaster).toBe(true);
    expect(state.grindTurn).toBe(4);
  });

  test('disaster with NO watchers: outcome = "ended", Break Camp persists outcome "ended" AND increments disaster count', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);

    const campId = await page.evaluate(async () => {
      const s = await import('/systems/tb2e/module/data/camp/state.mjs');
      await Actor.create({ name: 'Thrar', type: 'character', system: { checks: 2 } });
      const camp = await Actor.create({ name: 'Cave', type: 'camp',
        system: { type: 'natural-caves', defaultDanger: 'typical' } });
      await s.beginCamp(camp.id);
      // No watchers set.
      await s.setPhase('events');
      return camp.id;
    });

    // Force total = 0 → Cave-in (avertable disaster). With no watchers,
    // outcome should pin to "ended".
    await forceNextRoll(page, [1, 1, 1], 0);
    await page.evaluate(async () => {
      const s = await import('/systems/tb2e/module/data/camp/state.mjs');
      await s.rollEvents();
    });

    const afterRoll = await page.evaluate(() => game.settings.get('tb2e', 'campState').events);
    expect(afterRoll.isDisaster).toBe(true);
    expect(afterRoll.outcome).toBe('ended');       // no watchers → forced end

    // End the camp. Verify writeback: visit outcome "ended" + disaster
    // counter incremented (SG p. 93 — applies even on averted).
    await page.evaluate(async () => {
      const s = await import('/systems/tb2e/module/data/camp/state.mjs');
      await s.endCamp();
    });

    const camp = await page.evaluate((id) => ({
      disasters: game.actors.get(id).system.disastersThisAdventure,
      lastVisit: game.actors.get(id).system.visits.at(-1)
    }), campId);

    // Visit label uses human-readable outcomes (SG p. 93):
    //   - "safe":     no disaster rolled
    //   - "disaster": rolled and averted (camp continued)
    //   - "broken":   rolled and camp ended
    expect(camp.lastVisit.outcome).toBe('broken');
    expect(camp.disasters).toBe(1);                 // disaster counter increments regardless
  });

  test('Events tab exposes a Re-roll button after rolling, and using it overwrites the result', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);

    await page.evaluate(async () => {
      const s = await import('/systems/tb2e/module/data/camp/state.mjs');
      await Actor.create({ name: 'Thrar', type: 'character', system: { checks: 2 } });
      const camp = await Actor.create({ name: 'Cave', type: 'camp',
        system: { type: 'natural-caves', defaultDanger: 'typical' } });
      await s.beginCamp(camp.id);
      await s.setPhase('events');
    });

    // First roll: safe total 11.
    await forceNextRoll(page, [4, 4, 3], 11);

    const panel = new CampPanel(page);
    await panel.clickToolbarButton();
    await expect(panel.root).toBeVisible();

    const tab = panel.root.locator('.events-tab');
    await tab.locator('button[data-action="rollEvents"]').click();

    // Result name "Safe camp" appears + Re-roll button is visible.
    await expect(tab.locator('.camp-events-result-name')).toContainText('Safe camp');
    const reroll = tab.locator('button.camp-events-reroll-btn');
    await expect(reroll).toBeVisible();

    // Force next roll to disaster total 0 = Cave-in, then click re-roll.
    await forceNextRoll(page, [1, 1, 1], 0);
    await reroll.click();

    // Result card updates to the new result.
    await expect(tab.locator('.camp-events-result-name')).toContainText('Cave-in');
  });

  test('every tab with a back/next footer keeps them present & wired', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);

    await page.evaluate(async () => {
      const s = await import('/systems/tb2e/module/data/camp/state.mjs');
      await Actor.create({ name: 'Thrar', type: 'character', system: { checks: 2 } });
      const camp = await Actor.create({ name: 'Cave', type: 'camp',
        system: { type: 'natural-caves', defaultDanger: 'typical' } });
      await s.beginCamp(camp.id);
    });

    const panel = new CampPanel(page);
    await panel.clickToolbarButton();
    await expect(panel.root).toBeVisible();

    await panel.switchToTab('setup');
    const setupTab = panel.root.locator('.setup-tab');
    await expect(setupTab.locator('button.camp-back-btn[data-tab="site"]')).toBeVisible();
    await expect(setupTab.locator('button.camp-advance-btn[data-phase="decisions"]')).toBeVisible();

    await panel.switchToTab('decisions');
    const decTab = panel.root.locator('.decisions-tab');
    await expect(decTab.locator('button.camp-back-btn[data-tab="setup"]')).toBeVisible();
    await expect(decTab.locator('button.camp-advance-btn[data-phase="events"]')).toBeVisible();

    await panel.switchToTab('events');
    const evTab = panel.root.locator('.events-tab');
    await expect(evTab.locator('button.camp-back-btn[data-tab="decisions"]')).toBeVisible();
    await expect(evTab.locator('button.camp-advance-btn')).toBeVisible();
    await expect(evTab.locator('button.camp-advance-btn').first()).toBeDisabled();

    await panel.switchToTab('strategy');
    const stratTab = panel.root.locator('.strategy-tab');
    await expect(stratTab.locator('button.camp-back-btn[data-tab="events"]')).toBeVisible();
    await expect(stratTab.locator('button.camp-advance-btn[data-phase="break"]')).toBeVisible();

    await panel.switchToTab('break');
    const brkTab = panel.root.locator('.break-tab');
    await expect(brkTab.locator('button.camp-back-btn[data-tab="strategy"]')).toBeVisible();
    await expect(brkTab.locator('button[data-action="endCamp"]')).toBeVisible();
  });
});
