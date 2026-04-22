import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §13 Conflict: Disposition — Order of Might (SG p.80, p.171-174).
 *
 * SG p.80 "The Greater the Might, the More You Hurt":
 *   "When two opponents with different Might ratings are engaged in a
 *   kill, capture or drive off conflict, the one with the higher Might
 *   has a serious advantage. They have a +1s bonus per point of Might
 *   greater than their opponent for all successful tests in these
 *   conflicts."
 *
 * The key phrase is "all successful tests in these conflicts" — i.e.,
 * every post-success test rolled during a kill/capture/driveOff
 * conflict. The disposition test (DH pp.120-122, rolled once per team
 * at the start of the conflict to set that team's HP total) is such a
 * test — it is the first roll inside the conflict, and nothing in the
 * rule carves it out from the "all successful tests" scope.
 *
 * -------------------------------------------------------------------
 * Expected production behavior (per SG p.80)
 * -------------------------------------------------------------------
 *   - Party (Might M_ours) vs Monster side (Might M_theirs), Kill.
 *   - Let delta = max(M_ours - M_theirs, 0).
 *   - When the party captain rolls disposition, `contextModifiers`
 *     includes an Order of Might bonus of `+<delta>s` (type: "success",
 *     timing: "post", label "Order of Might +Ns").
 *   - `_handleDispositionRoll` applies postSuccessMods to
 *     `finalSuccesses` (tb2e-roll.mjs L1681-1687), so the stored
 *     disposition total is `baseSuccesses + delta + dispositionAbility`.
 *   - The disadvantaged side gets no such bonus (delta = 0 by clamp).
 *
 * -------------------------------------------------------------------
 * Current production behavior (the gap this spec encodes)
 * -------------------------------------------------------------------
 * `computeOrderModifier` exists (module/dice/conflict-roll.mjs L312-345)
 * and correctly returns a `+<delta>s` success modifier for
 * MIGHT_CONFLICT_TYPES={"kill","capture","driveOff"} — but it is ONLY
 * consumed from `ConflictPanel.#onRollConflictAction`
 * (conflict-panel.mjs L1927-1933), i.e., the volley action rolls in
 * the resolve phase.
 *
 * The disposition roll dispatcher `ConflictPanel.#onRollDisposition`
 * (conflict-panel.mjs L1582-1653) builds its own `contextModifiers`
 * array (L1615) but only adds the monster group-help dice bonus
 * (L1616-1632). It never calls `computeOrderModifier`. So the
 * disposition total for a Kill conflict with a Might advantage ends
 * up `successes + dispositionAbility` — unchanged from a non-Might
 * conflict — which is the bug this fixme is guarding.
 *
 * Fix shape (mirrors the volley path at conflict-panel.mjs L1927-1933):
 *
 *   const opponentGroupId = Array.from(combat.groups)
 *     .find(g => g.id !== groupId)?.id;
 *   const orderMod = computeOrderModifier({
 *     conflictType: combat.system.conflictType,
 *     ourGroupId: groupId,
 *     opponentGroupId,
 *     combat
 *   });
 *   if ( orderMod ) contextModifiers.push(orderMod);
 *
 * (Plus the matching import at conflict-panel.mjs L4.)
 *
 * -------------------------------------------------------------------
 * Test fixture (deterministic)
 * -------------------------------------------------------------------
 *   Party side:
 *     - Captain: character Might=5, fighter=3, health=4.
 *       (Adventurers default to Might 3 per character.mjs L86.)
 *     - Member: default character.
 *   Monster side:
 *     - Captain: Kobold (Might=1, per packs/_source/monsters/Kobold_…yml).
 *     - Member: another Kobold.
 *   Kill conflict. PRNG stubbed to 0.001 → every d6 rolls 6.
 *
 *   Delta = 5 - 1 = 4 → +4s Order of Might on the party's roll.
 *   Base successes from fighter=3: 3. Plus +4s (Order of Might): 7.
 *   Plus health=4: disposition total = 7 + 4 = 11.
 *
 *   Current (buggy) total: 3 + 4 = 7 (no +4s applied).
 *
 * -------------------------------------------------------------------
 * Why the spec is a single `test.fixme`, not an anti-spec
 * -------------------------------------------------------------------
 * Checking the test plan (TEST_PLAN.md L393), the checkbox is phrased
 * positively: "team with higher Might bonus receives +1s per point
 * advantage (SG p.80; see `computeOrderModifier`)". An anti-spec that
 * only asserts the absence of the bonus would green up the checkbox
 * on a broken implementation and hide the bug. A `test.fixme` that
 * encodes the expected behavior surfaces the gap and fails closed
 * when the fix lands, making it trivial to remove the fixme.
 *
 * Guard removal: when `#onRollDisposition` is patched to invoke
 * `computeOrderModifier` + push the modifier into `contextModifiers`,
 * drop the `test.fixme` here and flip TEST_PLAN.md L393 to `[x]`.
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
    'Kill conflict: party with higher Might gets +1s per point on disposition roll',
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
        // Party captain Might=5 → delta=4 vs Kobolds' Might=1.
        // Expected disposition = 3 + 4 (Order of Might) + 4 (health) = 11.
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

        // Pre-flight sanity: at this point `computeOrderModifier` already
        // returns a +4s mod if invoked. Prove the function would produce
        // the expected bonus so that when the implementation gap is
        // closed, we know the plumbing — not the calculation — is all
        // that needs to change.
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

        // --- EXPECTED (fixme) ASSERTIONS ---------------------------------
        // These will fail against current source, which is the point of
        // the fixme. When `#onRollDisposition` pushes the Order-of-Might
        // modifier into `contextModifiers`, all four should pass.

        // The disposition card's modifier list contains the Order of
        // Might bonus, with the localized label from lang/en.json L502
        // ("Order of Might +Ns") and a +4s value.
        const modsOnCard = await page.evaluate(() => {
          const msg = game.messages.contents.at(-1);
          return msg?.flags?.tb2e?.allModifiers ?? msg?.flags?.tb2e?.modifiers
            ?? msg?.flags?.tb2e?.postSuccessMods ?? [];
        });
        const orderEntry = modsOnCard.find((m) =>
          typeof m.label === 'string'
            && m.label.includes('Order of Might')
        );
        expect(orderEntry).toBeTruthy();
        expect(orderEntry.value).toBe(4);
        expect(orderEntry.type).toBe('success');

        await card.clickFinalize();

        await page.evaluate(() => {
          if ( globalThis.__tb2eE2EPrevRandomUniform ) {
            CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
            delete globalThis.__tb2eE2EPrevRandomUniform;
          }
        });

        // Disposition total with Order of Might: 3 base successes + 4
        // Order of Might + 4 health = 11.
        await expect
          .poll(() => page.evaluate(({ cId, gId }) => {
            const c = game.combats.get(cId);
            return c?.system.groupDispositions?.[gId]?.rolled ?? null;
          }, { cId: combatId, gId: partyGroupId }), { timeout: 10_000 })
          .toBe(11);
      } finally {
        await cleanupTaggedActors(page, tag);
      }
    }
  );
});
