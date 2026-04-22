import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §13 Conflict: Disposition — Hungry & Thirsty team penalty (SG pp.47, 54).
 *
 * SG p.47:
 *   "While hungry and thirsty, that team suffers -1s to its disposition
 *    roll in all conflicts. This penalty counts once, no matter how many
 *    in a group are hungry and thirsty. Minimum starting disposition is 1."
 *
 * SG p.54 (Conditions in a Conflict):
 *   "While any member is hungry and thirsty, a team suffers -1s to its
 *    disposition roll in all conflicts. This counts once, no matter how
 *    many of are hungry and thirsty."
 *
 * Production implementation:
 *   - `module/dice/conflict-roll.mjs` `computeTeamConditionPenalties` walks
 *     the group's combatants and returns a post-timing success modifier
 *     (`{type:"success", value:-1, timing:"post"}`) when ANY member has
 *     `system.conditions.hungry === true`.
 *   - `module/applications/conflict/conflict-panel.mjs` `#onRollDisposition`
 *     spreads the helper's output into `contextModifiers`, which flows
 *     through `rollTest` → `_handleDispositionRoll` (tb2e-roll.mjs L1681-
 *     L1687) where `postSuccessMods` are summed into `finalSuccesses`.
 *   - The existing minimum-1 clamp at L1687 (`Math.max(finalSuccesses +
 *     abilityRating, 1)`) enforces SG p.47's "Minimum starting disposition
 *     is 1."
 *
 * Staging:
 *   - Kill conflict, party captain + alt character vs two Kobolds.
 *   - Captain: fighter=3, health=4, Might=3 (default — delta=2 vs Kobold
 *     Might=1, so Order of Might WOULD apply if the L393 dispatcher gap
 *     were fixed; but that gap is intentionally still present so this
 *     spec isolates the new hungry penalty path).
 *   - PRNG stubbed to 0.001 → every d6 rolls 6 (success). Fighter=3 →
 *     3 base successes. Health=4 → disposition = 3 + 4 - penalty.
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
          // Character Might defaults to 3 (character.mjs L86). Kobolds have
          // Might=1. In a Kill conflict that delta triggers `computeOrderModifier`
          // to add a +2s success bonus (SG p.80, now applied to disposition
          // too via #onRollDisposition). Setting captain Might=1 keeps the
          // Order of Might delta=0 so this spec isolates the hungry penalty.
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
        // Match Kobold Might=1 so getTeamMight returns 1 for the party —
        // otherwise the alt's default Might=3 would trigger a +2s Order
        // of Might bonus (now applied to disposition via #onRollDisposition).
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

/**
 * Full setup → disposition-roll flow for the party side of a Kill
 * conflict with two party members + two Kobolds. Returns
 * `{ combatId, partyGroupId, cmb }` so the caller can introspect.
 * PRNG stub is installed BEFORE the roll and cleared after.
 */
async function runPartyDispositionRoll(page, { captainId, altId, monAId, monBId }) {
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

  await page.evaluate(() => {
    globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => 0.001;
  });

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

  return { combatId, partyGroupId, cmb };
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

test.describe('§13 Conflict: Disposition — Hungry & Thirsty team penalty', () => {
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

  // Baseline: hungry only on the ALT, not on the captain. Proves the
  // helper walks the full group, not just the captain (SG p.54 "any
  // member"). Disposition = 3 base successes + 4 health - 1 hungry = 6.
  test('alt member hungry → team disposition gets -1s penalty',
  async ({ page }, testInfo) => {
    const tag = `e2e-disp-hungry-${testInfo.parallelIndex}-${Date.now()}`;
    const stamp = Date.now();

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    try {
      const captainId = await createCaptainCharacter(page, {
        name: `E2E Hungry Captain ${stamp}`, tag, fighter: 3, health: 4
      });
      const altId = await createCharacter(page, {
        name: `E2E Hungry Alt ${stamp}`, tag,
        conditions: { hungry: true }
      });
      const monAId = await importMonster(page, {
        sourceName: 'Kobold', uniqueName: `E2E Hungry Kobold A ${stamp}`, tag
      });
      const monBId = await importMonster(page, {
        sourceName: 'Kobold', uniqueName: `E2E Hungry Kobold B ${stamp}`, tag
      });

      const { combatId, partyGroupId } = await runPartyDispositionRoll(page, {
        captainId, altId, monAId, monBId
      });

      // Message flags carry the -1s hungry penalty.
      const mods = await readLatestMods(page);
      const hungryEntries = mods.filter(
        (m) => typeof m.label === 'string' && /hungry/i.test(m.label)
      );
      expect(hungryEntries).toHaveLength(1);
      expect(hungryEntries[0]).toMatchObject({ type: 'success', value: -1 });

      // Stored disposition reflects the penalty.
      await dispositionPoll(page, { combatId, groupId: partyGroupId }).toBe(6);
    } finally {
      await cleanupTaggedActors(page, tag);
    }
  });

  // Both captain and alt hungry → still only one -1s penalty. Proves
  // once-per-team collapse (SG p.47 / p.54 "This counts once, no matter
  // how many of are hungry and thirsty").
  test('multiple hungry members → penalty counts once (team-scoped)',
  async ({ page }, testInfo) => {
    const tag = `e2e-disp-hungry-${testInfo.parallelIndex}-${Date.now()}`;
    const stamp = Date.now();

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    try {
      const captainId = await createCaptainCharacter(page, {
        name: `E2E HungryBoth Captain ${stamp}`, tag, fighter: 3, health: 4,
        conditions: { hungry: true }
      });
      const altId = await createCharacter(page, {
        name: `E2E HungryBoth Alt ${stamp}`, tag,
        conditions: { hungry: true }
      });
      const monAId = await importMonster(page, {
        sourceName: 'Kobold', uniqueName: `E2E HungryBoth Kobold A ${stamp}`, tag
      });
      const monBId = await importMonster(page, {
        sourceName: 'Kobold', uniqueName: `E2E HungryBoth Kobold B ${stamp}`, tag
      });

      const { combatId, partyGroupId } = await runPartyDispositionRoll(page, {
        captainId, altId, monAId, monBId
      });

      const mods = await readLatestMods(page);
      const hungryEntries = mods.filter(
        (m) => typeof m.label === 'string' && /hungry/i.test(m.label)
      );
      // Exactly ONE hungry modifier, not two — even though both members
      // are hungry. This is the once-per-team contract.
      expect(hungryEntries).toHaveLength(1);
      expect(hungryEntries[0]).toMatchObject({ type: 'success', value: -1 });

      // Same disposition total as the single-hungry case — proves the
      // second hungry member did not stack a second -1s.
      await dispositionPoll(page, { combatId, groupId: partyGroupId }).toBe(6);
    } finally {
      await cleanupTaggedActors(page, tag);
    }
  });

  // Control: no hungry condition → no penalty. Guards against the
  // helper firing spuriously.
  test('no hungry members → no hungry modifier, no penalty',
  async ({ page }, testInfo) => {
    const tag = `e2e-disp-hungry-${testInfo.parallelIndex}-${Date.now()}`;
    const stamp = Date.now();

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    try {
      const captainId = await createCaptainCharacter(page, {
        name: `E2E HungryNone Captain ${stamp}`, tag, fighter: 3, health: 4
      });
      const altId = await createCharacter(page, {
        name: `E2E HungryNone Alt ${stamp}`, tag
      });
      const monAId = await importMonster(page, {
        sourceName: 'Kobold', uniqueName: `E2E HungryNone Kobold A ${stamp}`, tag
      });
      const monBId = await importMonster(page, {
        sourceName: 'Kobold', uniqueName: `E2E HungryNone Kobold B ${stamp}`, tag
      });

      const { combatId, partyGroupId } = await runPartyDispositionRoll(page, {
        captainId, altId, monAId, monBId
      });

      const mods = await readLatestMods(page);
      const hungryEntries = mods.filter(
        (m) => typeof m.label === 'string' && /hungry/i.test(m.label)
      );
      expect(hungryEntries).toHaveLength(0);

      // No penalty: 3 successes + 4 health = 7.
      await dispositionPoll(page, { combatId, groupId: partyGroupId }).toBe(7);
    } finally {
      await cleanupTaggedActors(page, tag);
    }
  });
});
