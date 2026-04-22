import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §3 Rolls — condition-based dice modifiers (RAW).
 *
 * Per RAW (Scholar's Guide), only three conditions impose a dice-pool
 * modifier on tests:
 *   - fresh   → +1D on all rolls (SG p.47)
 *   - injured → -1D on Nature/Will/Health/skills (SG pp.49, 52, 54)
 *   - sick    → -1D on Nature/Will/Health/skills (SG pp.50, 52, 54)
 *
 * Injured/Sick do NOT apply to Resources, Circles, or recovery rolls —
 * production `gatherConditionModifiers` gates those paths via
 * `testContext.isResources / isCircles / isRecovery`
 * (`module/dice/tb2e-roll.mjs` L96-99).
 *
 * Afraid, hungry, angry, exhausted have non-dice effects (help-gate, BL
 * gate, rest-gate, trait-restrictions) that are covered elsewhere or in
 * their own specs; they are intentionally NOT asserted here because they
 * impose no dice modifier.
 */

async function createWillCharacter(page, name, conditions = {}) {
  return page.evaluate(async ({ n, cond }) => {
    const actor = await Actor.create({
      name: n,
      type: 'character',
      system: {
        abilities: {
          will:   { rating: 4, pass: 0, fail: 0 },
          health: { rating: 3, pass: 0, fail: 0 },
          nature: { rating: 3, max: 3, pass: 0, fail: 0 }
        },
        conditions: cond
      }
    });
    return actor.id;
  }, { n: name, cond: conditions });
}

async function rollWillAndAssert(page, { actorName, actorId, expectedPool, expectedLabel }) {
  const sheet = new CharacterSheet(page, actorName);
  await page.evaluate((id) => game.actors.get(id).sheet.render(true), actorId);
  await sheet.expectOpen();

  await sheet.openAbilitiesTab();

  const initialChatCount = await page.evaluate(() => game.messages.contents.length);
  await sheet.rollAbilityRow('will').click();

  const dialog = new RollDialog(page);
  await dialog.waitForOpen();

  // Base dice = raw rating (condition mods don't rewrite `poolSize` input).
  expect(await dialog.getPoolSize()).toBe(4);
  // Summary reflects the applied condition mod.
  expect(await dialog.getSummaryPool()).toBe(expectedPool);
  // Exactly one condition modifier row rendered, with the expected label.
  await expect(dialog.modifierRows).toHaveCount(1);
  await expect(dialog.modifierRows.first()).toContainText(new RegExp(expectedLabel, 'i'));

  // Submit at Ob = expectedPool so an all-6s roll is a deterministic PASS.
  await dialog.fillObstacle(expectedPool);
  await dialog.submit();

  await expect
    .poll(() => page.evaluate(() => game.messages.contents.length), { timeout: 10_000 })
    .toBeGreaterThan(initialChatCount);

  const card = new RollChatCard(page);
  await card.expectPresent();
  expect(await card.getPool()).toBe(expectedPool);
  await expect(card.diceResults).toHaveCount(expectedPool);
  expect(await card.getSuccesses()).toBe(expectedPool);
  expect(await card.getObstacle()).toBe(expectedPool);
  expect(await card.isPass()).toBe(true);

  const flags = await page.evaluate(() => {
    const msg = game.messages.contents.at(-1);
    const f = msg?.flags?.tb2e?.roll;
    return f ? {
      type: f.type,
      key: f.key,
      baseDice: f.baseDice,
      poolSize: f.poolSize,
      successes: f.successes,
      obstacle: f.obstacle,
      pass: f.pass
    } : null;
  });
  expect(flags).toEqual({
    type: 'ability',
    key: 'will',
    baseDice: 4,
    poolSize: expectedPool,
    successes: expectedPool,
    obstacle: expectedPool,
    pass: true
  });
}

test.describe('§3 Rolls — condition dice modifiers (RAW)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Stub PRNG to all-6s for deterministic PASS outcomes.
    await page.evaluate(() => {
      globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => 0.001;
    });
  });

  test.afterEach(async ({ page }) => {
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });
  });

  // SG p.47 — "While fresh, you get to roll one extra die on any test."
  test('fresh adds +1D to a Will roll', async ({ page }) => {
    const actorName = `E2E Fresh Will ${Date.now()}`;
    const actorId = await createWillCharacter(page, actorName, { fresh: true });
    expect(actorId).toBeTruthy();

    await rollWillAndAssert(page, {
      actorName, actorId,
      expectedPool: 5,
      expectedLabel: 'fresh'
    });

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });

  // SG p.49 / p.52 / p.54 — "Characters who are injured suffer -1D to all rolls,
  // including disposition" (excluding Resources/Circles/recovery per production
  // gate at tb2e-roll.mjs L96).
  test('injured imposes -1D on a Will roll', async ({ page }) => {
    const actorName = `E2E Injured Will ${Date.now()}`;
    const actorId = await createWillCharacter(page, actorName, { fresh: false, injured: true });
    expect(actorId).toBeTruthy();

    await rollWillAndAssert(page, {
      actorName, actorId,
      expectedPool: 3,
      expectedLabel: 'injured'
    });

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });

  // SG p.50 / p.52 / p.54 — same -1D rule for sick as for injured.
  test('sick imposes -1D on a Will roll', async ({ page }) => {
    const actorName = `E2E Sick Will ${Date.now()}`;
    const actorId = await createWillCharacter(page, actorName, { fresh: false, sick: true });
    expect(actorId).toBeTruthy();

    await rollWillAndAssert(page, {
      actorName, actorId,
      expectedPool: 3,
      expectedLabel: 'sick'
    });

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });
});
