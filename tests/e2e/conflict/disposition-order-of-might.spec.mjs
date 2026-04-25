import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §13 Conflict: Disposition — Order of Might does NOT apply to disposition
 * (SG p.80, p.171-174).
 *
 * SG p.80 "The Greater the Might, the More You Hurt":
 *   "your Might grants +1s per point of Might greater than your opponent's
 *   for all successful or tied actions in kill, capture, and drive off
 *   conflicts."
 *
 * SG p.174 reiterates: "+1s bonus per point of Might greater than their
 * opponent for all successful tests in these conflicts."
 *
 * The bonus applies to successful or tied ACTIONS — i.e., the volley
 * actions during the conflict (attack, defend, feint, maneuver). The
 * disposition test sets each team's HP before any actions are taken; it
 * is not itself an action and is not gated on "success or tie" against
 * an opponent. RAW: no Order of Might bonus on the disposition roll.
 *
 * This spec is an anti-spec: it pins the production behavior so a future
 * change cannot quietly re-add the bonus to disposition. The volley path
 * (conflict-panel.mjs #onRollConflictAction) is where `computeOrderModifier`
 * legitimately fires; the disposition path (#onRollDisposition) must not.
 *
 * Fixture: Kill conflict, party captain Might=5 / fighter=3 / health=4
 * vs two Kobolds (Might=1). PRNG all-6s → fighter=3 rolls 3 successes.
 * Expected disposition total = 3 (successes) + 4 (health) = 7.
 * Buggy behavior would give 3 + 4 (Might delta) + 4 = 11.
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

/**
 * Create a character with deterministic fighter/health ratings and an
 * explicit Might override (default character Might is 3 per
 * character.mjs L86). `conditions.fresh = false` so no +1D pool bump.
 */
async function createCaptainCharacter(page, { name, tag, fighter, health, might }) {
  return page.evaluate(
    async ({ n, t, f, h, m }) => {
      const actor = await Actor.implementation.create({
        name: n,
        type: 'character',
        flags: { tb2e: { e2eTag: t } },
        system: {
          might: m,
          abilities: {
            health: { rating: h, pass: 0, fail: 0 },
            will:   { rating: 4, pass: 0, fail: 0 },
            nature: { rating: 3, max: 3, pass: 0, fail: 0 }
          },
          skills: {
            fighter: { rating: f, pass: 0, fail: 0 }
          },
          conditions: { fresh: false }
        }
      });
      return actor.id;
    },
    { n: name, t: tag, f: fighter, h: health, m: might }
  );
}

async function createCharacter(page, { name, tag }) {
  return page.evaluate(
    async ({ n, t }) => {
      const actor = await Actor.implementation.create({
        name: n,
        type: 'character',
        flags: { tb2e: { e2eTag: t } },
        system: { conditions: { fresh: false } }
      });
      return actor.id;
    },
    { n: name, t: tag }
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

test.describe('§13 Conflict: Disposition — Order of Might', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => {
      if ( globalThis.__tb2eE2EPrevRandomUniform ) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
      try { game.tb2e?.conflictPanel?.close(); } catch {}
    });
    await page.evaluate(async () => {
      const ids = Array.from(game.combats ?? []).map((c) => c.id);
      if ( ids.length ) await Combat.deleteDocuments(ids);
    });
  });

  test(
    'Kill conflict: Order of Might is NOT applied to the disposition roll',
    async ({ page }, testInfo) => {
      const tag = `e2e-disp-oom-${testInfo.parallelIndex}-${Date.now()}`;
      const stamp = Date.now();
      const charAName = `E2E OoM Captain ${stamp}`;
      const charBName = `E2E OoM Char B ${stamp}`;
      const monsterAName = `E2E OoM Kobold A ${stamp}`;
      const monsterBName = `E2E OoM Kobold B ${stamp}`;

      await page.goto('/game');
      const ui = new GameUI(page);
      await ui.waitForReady();
      await ui.dismissTours();

      try {
        // Arrange — Might-advantaged party vs two Kobolds (Might 1).
        // Party captain fighter=3 (all-6s → 3 base successes), health=4.
        // Party captain Might=5; delta to Kobolds = 4. RAW: Order of Might
        // does NOT apply to disposition (SG p.80 — "successful or tied
        // actions" is volley-action wording).
        // Expected disposition = 3 (successes) + 4 (health) = 7.
        const captainId = await createCaptainCharacter(page, {
          name: charAName, tag, fighter: 3, health: 4, might: 5
        });
        const charBId = await createCharacter(page, { name: charBName, tag });
        const monAId = await importMonster(page, {
          sourceName: 'Kobold', uniqueName: monsterAName, tag
        });
        const monBId = await importMonster(page, {
          sourceName: 'Kobold', uniqueName: monsterBName, tag
        });

        // Sanity-check Might values actually reached the actor documents
        // (the character.might field is writable per character.mjs L86;
        // Kobold Might=1 comes from packs/_source/monsters/Kobold_…yml L7).
        const mights = await page.evaluate(
          ({ cap, kA, kB }) => ({
            captain: game.actors.get(cap)?.system.might ?? null,
            koboldA: game.actors.get(kA)?.system.might ?? null,
            koboldB: game.actors.get(kB)?.system.might ?? null
          }),
          { cap: captainId, kA: monAId, kB: monBId }
        );
        expect(mights).toEqual({ captain: 5, koboldA: 1, koboldB: 1 });

        const tracker = new ConflictTracker(page);
        await tracker.open();
        await tracker.clickCreateConflict();
        await expect
          .poll(
            () => page.evaluate(() => {
              const c = game.combats.find((x) => x.isConflict);
              return c ? c.groups.size : 0;
            }),
            { timeout: 10_000 }
          )
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
        cmb.captain = await panel.addCombatant({
          combatId, actorId: captainId, groupId: partyGroupId
        });
        cmb.charB = await panel.addCombatant({
          combatId, actorId: charBId, groupId: partyGroupId
        });
        cmb.monA = await panel.addCombatant({
          combatId, actorId: monAId, groupId: gmGroupId
        });
        cmb.monB = await panel.addCombatant({
          combatId, actorId: monBId, groupId: gmGroupId
        });
        await expect(panel.setupCombatants).toHaveCount(4);

        await panel.clickCaptainButton(cmb.captain);
        await panel.clickCaptainButton(cmb.monA);

        // Kill conflict — this is what triggers MIGHT_CONFLICT_TYPES in
        // `computeOrderModifier` (conflict-roll.mjs L185, L316-320).
        await panel.selectConflictType('kill');

        // Pre-flight sanity: `computeOrderModifier` itself still returns
        // the +4s mod when invoked directly — the function is correct, it
        // just must not be wired into the disposition-roll path. This
        // assertion guards against accidental regression in the helper
        // (versus a future change that erroneously re-wires it into
        // #onRollDisposition).
        const expectedMod = await page.evaluate(
          async ({ cId, gId }) => {
            const combat = game.combats.get(cId);
            const groups = Array.from(combat.groups);
            const opp = groups.find((g) => g.id !== gId)?.id;
            const mod = await import(
              '/systems/tb2e/module/dice/conflict-roll.mjs'
            ).then((m) =>
              m.computeOrderModifier({
                conflictType: combat.system.conflictType,
                ourGroupId: gId,
                opponentGroupId: opp,
                combat
              })
            );
            return mod ? { value: mod.value, type: mod.type, timing: mod.timing } : null;
          },
          { cId: combatId, gId: partyGroupId }
        );
        expect(expectedMod).toEqual({ value: 4, type: 'success', timing: 'post' });

        await expect(panel.beginDispositionButton).toBeEnabled();
        await panel.clickBeginDisposition();

        await page.evaluate(() => {
          globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
          CONFIG.Dice.randomUniform = () => 0.001;
        });

        const initialChatCount = await page.evaluate(
          () => game.messages.contents.length
        );

        // Act — roll disposition for the Might-advantaged party side.
        await expect(panel.rollDispositionButton(partyGroupId)).toBeVisible();
        await panel.rollDispositionButton(partyGroupId).click();

        const dialog = new RollDialog(page);
        await dialog.waitForOpen();
        // Pool is fighter=3 (no pre-success Order of Might dice — the
        // rule is +Ns post-success).
        expect(await dialog.getPoolSize()).toBe(3);
        await dialog.submit();

        await expect
          .poll(() => page.evaluate(() => game.messages.contents.length), {
            timeout: 10_000
          })
          .toBeGreaterThan(initialChatCount);

        await page.evaluate(() =>
          ui.sidebar?.changeTab?.('chat', 'primary')
        );
        const card = new RollChatCard(page);
        await card.expectPresent();

        // The disposition card's modifier list must NOT contain an Order
        // of Might entry — the bonus belongs on volley actions, not on
        // the disposition test (SG p.80).
        const modsOnCard = await page.evaluate(() => {
          const msg = game.messages.contents.at(-1);
          return [
            ...(msg?.flags?.tb2e?.roll?.modifiers ?? []),
            ...(msg?.flags?.tb2e?.postSuccessMods ?? [])
          ];
        });
        const orderEntry = modsOnCard.find((m) =>
          typeof m.label === 'string'
            && m.label.includes('Order of Might')
        );
        expect(orderEntry).toBeUndefined();

        await card.clickFinalize();

        await page.evaluate(() => {
          if ( globalThis.__tb2eE2EPrevRandomUniform ) {
            CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
            delete globalThis.__tb2eE2EPrevRandomUniform;
          }
        });

        // Disposition total without Order of Might: 3 base successes + 4
        // (health) = 7.
        await expect
          .poll(() => page.evaluate(({ cId, gId }) => {
            const c = game.combats.get(cId);
            return c?.system.groupDispositions?.[gId]?.rolled ?? null;
          }, { cId: combatId, gId: partyGroupId }), { timeout: 10_000 })
          .toBe(7);
      } finally {
        await cleanupTaggedActors(page, tag);
      }
    }
  );
});
