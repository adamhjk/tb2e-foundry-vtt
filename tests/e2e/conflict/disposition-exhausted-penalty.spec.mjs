import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §13 Conflict: Disposition — Exhausted team penalty (SG pp.48-49, 54).
 *
 * SG p.48:
 *   "While exhausted, your team suffers -1s to its disposition roll in all
 *    conflicts. This penalty is applied once even if multiple people are
 *    exhausted. Minimum starting disposition is 1. This penalty stacks
 *    with hungry and thirsty."
 *
 * Production implementation:
 *   - `computeTeamConditionPenalties` in `module/dice/conflict-roll.mjs`
 *     returns ONE -1s post-success modifier when any team member has
 *     `system.conditions.exhausted === true`.
 *   - It additionally returns a second -1s modifier (type: "success") for
 *     hungry when any member is hungry — so the two stack as RAW requires.
 *   - Minimum-1 clamp enforced at `module/dice/tb2e-roll.mjs:1687`
 *     `Math.max(finalSuccesses + abilityRating, 1)`.
 *
 * SG p.48 "stacks with hungry and thirsty" is the distinguishing
 * assertion that separates this spec from disposition-hungry-penalty.
 *
 * NOTE on out-of-scope RAW for exhausted: SG p.48 also says "Exhaustion
 * also prohibits an adventurer from using their instinct for free.
 * They may still take the action described in the instinct, but it
 * costs a turn and suffers a +1 Ob penalty." — this requires an
 * instinct-action system that does not exist in production.
 * `system.instinct` is a narrative String field only. Left untested
 * until the feature lands.
 */

const MONSTER_PACK_ID = 'tb2e.monsters';

async function importMonster(page, { sourceName, uniqueName, tag }) {
  return page.evaluate(
    async ({ pId, src, name, t }) => {
      const pack = game.packs.get(pId);
      if ( !pack ) throw new Error(`Pack not found: ${pId}`);
      const docs = await pack.getDocuments();
      const source = docs.find((d) => d.name === src);
      if ( !source ) throw new Error(`Source "${src}" not in pack ${pId}`);
      const data = source.toObject();
      data.name = name;
      data.flags = {
        ...(data.flags ?? {}),
        tb2e: { ...(data.flags?.tb2e ?? {}), e2eTag: t }
      };
      const created = await Actor.implementation.create(data);
      return created.id;
    },
    { pId: MONSTER_PACK_ID, src: sourceName, name: uniqueName, t: tag }
  );
}

async function createCaptainCharacter(page, { name, tag, fighter, health, conditions = {} }) {
  return page.evaluate(
    async ({ n, t, f, h, cond }) => {
      const actor = await Actor.implementation.create({
        name: n,
        type: 'character',
        flags: { tb2e: { e2eTag: t } },
        system: {
          // Match Kobold Might=1 so Order of Might delta=0 — isolates the
          // exhausted/hungry penalty from the Might bonus now applied to
          // disposition (SG p.80, via #onRollDisposition).
          might: 1,
          abilities: {
            health: { rating: h, pass: 0, fail: 0 },
            will:   { rating: 4, pass: 0, fail: 0 },
            nature: { rating: 3, max: 3, pass: 0, fail: 0 }
          },
          skills: {
            fighter: { rating: f, pass: 0, fail: 0 }
          },
          conditions: { fresh: false, ...cond }
        }
      });
      return actor.id;
    },
    { n: name, t: tag, f: fighter, h: health, cond: conditions }
  );
}

async function createCharacter(page, { name, tag, conditions = {} }) {
  return page.evaluate(
    async ({ n, t, cond }) => {
      const actor = await Actor.implementation.create({
        name: n,
        type: 'character',
        flags: { tb2e: { e2eTag: t } },
        // Match Kobold Might=1 so getTeamMight returns 1 — alt's default
        // Might=3 would otherwise trigger a +2s Order of Might bonus.
        system: { might: 1, conditions: { fresh: false, ...cond } }
      });
      return actor.id;
    },
    { n: name, t: tag, cond: conditions }
  );
}

async function cleanupTaggedActors(page, tag) {
  await page.evaluate(async (t) => {
    const ids = game.actors
      .filter((a) => a.getFlag?.('tb2e', 'e2eTag') === t)
      .map((a) => a.id);
    if ( ids.length ) await Actor.implementation.deleteDocuments(ids);
  }, tag);
}

async function runPartyDispositionRoll(page, { captainId, altId, monAId, monBId, prng = 0.001 }) {
  const tracker = new ConflictTracker(page);
  await tracker.open();
  await tracker.clickCreateConflict();
  await expect
    .poll(() => page.evaluate(() => {
      const c = game.combats.find((x) => x.isConflict);
      return c ? c.groups.size : 0;
    }), { timeout: 10_000 })
    .toBe(2);
  const { combatId, partyGroupId, gmGroupId } = await page.evaluate(() => {
    const c = game.combats.find((x) => x.isConflict);
    const g = Array.from(c.groups);
    return { combatId: c.id, partyGroupId: g[0].id, gmGroupId: g[1].id };
  });

  const panel = new ConflictPanel(page);
  await panel.open();
  expect(await panel.activeTabId()).toBe('setup');

  const cmb = {};
  cmb.captain = await panel.addCombatant({ combatId, actorId: captainId, groupId: partyGroupId });
  cmb.alt     = await panel.addCombatant({ combatId, actorId: altId,     groupId: partyGroupId });
  cmb.monA    = await panel.addCombatant({ combatId, actorId: monAId,    groupId: gmGroupId });
  cmb.monB    = await panel.addCombatant({ combatId, actorId: monBId,    groupId: gmGroupId });
  await expect(panel.setupCombatants).toHaveCount(4);

  await panel.clickCaptainButton(cmb.captain);
  await panel.clickCaptainButton(cmb.monA);
  await panel.selectConflictType('kill');

  await expect(panel.beginDispositionButton).toBeEnabled();
  await panel.clickBeginDisposition();

  await page.evaluate((p) => {
    globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => p;
  }, prng);

  const initialChatCount = await page.evaluate(() => game.messages.contents.length);

  await expect(panel.rollDispositionButton(partyGroupId)).toBeVisible();
  await panel.rollDispositionButton(partyGroupId).click();

  const dialog = new RollDialog(page);
  await dialog.waitForOpen();
  await dialog.submit();

  await expect
    .poll(() => page.evaluate(() => game.messages.contents.length), { timeout: 10_000 })
    .toBeGreaterThan(initialChatCount);

  await page.evaluate(() => ui.sidebar?.changeTab?.('chat', 'primary'));
  const card = new RollChatCard(page);
  await card.expectPresent();
  await card.clickFinalize();

  return { combatId, partyGroupId };
}

async function readLatestMods(page) {
  return page.evaluate(() => {
    const msg = game.messages.contents.at(-1);
    return msg?.flags?.tb2e?.allModifiers
      ?? msg?.flags?.tb2e?.modifiers
      ?? msg?.flags?.tb2e?.postSuccessMods
      ?? [];
  });
}

function dispositionPoll(page, { combatId, groupId }) {
  return expect
    .poll(() => page.evaluate(({ cId, gId }) => {
      const c = game.combats.get(cId);
      return c?.system.groupDispositions?.[gId]?.rolled ?? null;
    }, { cId: combatId, gId: groupId }), { timeout: 10_000 });
}

test.describe('§13 Conflict: Disposition — Exhausted team penalty', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => {
      if ( globalThis.__tb2eE2EPrevRandomUniform ) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
      try { game.tb2e?.conflictPanel?.close(); } catch { /* noop */ }
    });
    await page.evaluate(async () => {
      const ids = Array.from(game.combats ?? []).map((c) => c.id);
      if ( ids.length ) await Combat.deleteDocuments(ids);
    });
  });

  // Single exhausted alt member → -1s penalty. Disposition = 3 + 4 - 1 = 6.
  test('alt member exhausted → team disposition gets -1s penalty',
  async ({ page }, testInfo) => {
    const tag = `e2e-disp-exh-${testInfo.parallelIndex}-${Date.now()}`;
    const stamp = Date.now();

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    try {
      const captainId = await createCaptainCharacter(page, {
        name: `E2E Exh Captain ${stamp}`, tag, fighter: 3, health: 4
      });
      const altId = await createCharacter(page, {
        name: `E2E Exh Alt ${stamp}`, tag,
        conditions: { exhausted: true }
      });
      const monAId = await importMonster(page, {
        sourceName: 'Kobold', uniqueName: `E2E Exh Kobold A ${stamp}`, tag
      });
      const monBId = await importMonster(page, {
        sourceName: 'Kobold', uniqueName: `E2E Exh Kobold B ${stamp}`, tag
      });

      const { combatId, partyGroupId } = await runPartyDispositionRoll(page, {
        captainId, altId, monAId, monBId
      });

      const mods = await readLatestMods(page);
      const exhEntries = mods.filter(
        (m) => typeof m.label === 'string' && /exhausted/i.test(m.label)
      );
      expect(exhEntries).toHaveLength(1);
      expect(exhEntries[0]).toMatchObject({ type: 'success', value: -1 });

      // Hungry is NOT present — verify penalties are independent.
      const hungryEntries = mods.filter(
        (m) => typeof m.label === 'string' && /hungry/i.test(m.label)
      );
      expect(hungryEntries).toHaveLength(0);

      await dispositionPoll(page, { combatId, groupId: partyGroupId }).toBe(6);
    } finally {
      await cleanupTaggedActors(page, tag);
    }
  });

  // SG p.48: "This penalty stacks with hungry and thirsty." One member
  // hungry + another exhausted → both -1s modifiers present → -2s total.
  // Disposition = 3 + 4 - 2 = 5.
  test('exhausted + hungry stack to -2s (SG p.48)',
  async ({ page }, testInfo) => {
    const tag = `e2e-disp-exh-${testInfo.parallelIndex}-${Date.now()}`;
    const stamp = Date.now();

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    try {
      const captainId = await createCaptainCharacter(page, {
        name: `E2E ExhStack Captain ${stamp}`, tag, fighter: 3, health: 4,
        conditions: { hungry: true }
      });
      const altId = await createCharacter(page, {
        name: `E2E ExhStack Alt ${stamp}`, tag,
        conditions: { exhausted: true }
      });
      const monAId = await importMonster(page, {
        sourceName: 'Kobold', uniqueName: `E2E ExhStack Kobold A ${stamp}`, tag
      });
      const monBId = await importMonster(page, {
        sourceName: 'Kobold', uniqueName: `E2E ExhStack Kobold B ${stamp}`, tag
      });

      const { combatId, partyGroupId } = await runPartyDispositionRoll(page, {
        captainId, altId, monAId, monBId
      });

      const mods = await readLatestMods(page);
      const exhEntries = mods.filter(
        (m) => typeof m.label === 'string' && /exhausted/i.test(m.label)
      );
      const hungryEntries = mods.filter(
        (m) => typeof m.label === 'string' && /hungry/i.test(m.label)
      );
      expect(exhEntries).toHaveLength(1);
      expect(hungryEntries).toHaveLength(1);
      expect(exhEntries[0]).toMatchObject({ type: 'success', value: -1 });
      expect(hungryEntries[0]).toMatchObject({ type: 'success', value: -1 });

      // Stacked penalty: 3 successes + 4 health - 2 = 5.
      await dispositionPoll(page, { combatId, groupId: partyGroupId }).toBe(5);
    } finally {
      await cleanupTaggedActors(page, tag);
    }
  });

  // SG p.47: "Minimum starting disposition is 1." Penalties that would
  // drive disposition below 1 are clamped. Setup: fighter=1 (no BL), PRNG
  // stubbed to 0.999 (all 1s — 0 successes). Captain hungry + alt
  // exhausted → -2s bonus. Pre-clamp: 0 successes - 2 = -2 → floor'd to
  // 0 finalSuccesses; + 0 health = 0 → Math.max(0, 1) = 1.
  test('minimum-1 clamp absorbs stacked penalties below floor (SG p.47)',
  async ({ page }, testInfo) => {
    const tag = `e2e-disp-exh-${testInfo.parallelIndex}-${Date.now()}`;
    const stamp = Date.now();

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    try {
      // fighter=1 avoids Beginner's Luck (which would re-route through
      // Health); health=0 gives zero ability contribution.
      const captainId = await createCaptainCharacter(page, {
        name: `E2E ExhFloor Captain ${stamp}`, tag, fighter: 1, health: 0,
        conditions: { hungry: true }
      });
      const altId = await createCharacter(page, {
        name: `E2E ExhFloor Alt ${stamp}`, tag,
        conditions: { exhausted: true }
      });
      const monAId = await importMonster(page, {
        sourceName: 'Kobold', uniqueName: `E2E ExhFloor Kobold A ${stamp}`, tag
      });
      const monBId = await importMonster(page, {
        sourceName: 'Kobold', uniqueName: `E2E ExhFloor Kobold B ${stamp}`, tag
      });

      // PRNG 0.999 → every d6 rolls 1 → zero successes.
      const { combatId, partyGroupId } = await runPartyDispositionRoll(page, {
        captainId, altId, monAId, monBId, prng: 0.999
      });

      const mods = await readLatestMods(page);
      const exhEntries = mods.filter(
        (m) => typeof m.label === 'string' && /exhausted/i.test(m.label)
      );
      const hungryEntries = mods.filter(
        (m) => typeof m.label === 'string' && /hungry/i.test(m.label)
      );
      expect(exhEntries).toHaveLength(1);
      expect(hungryEntries).toHaveLength(1);

      // Post-clamp: disposition = 1 even though raw math yields a
      // negative. This is the SG p.47 floor enforced at
      // tb2e-roll.mjs:1687.
      await dispositionPoll(page, { combatId, groupId: partyGroupId }).toBe(1);
    } finally {
      await cleanupTaggedActors(page, tag);
    }
  });
});
