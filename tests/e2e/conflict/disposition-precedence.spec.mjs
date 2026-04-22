import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §13 Conflict: Disposition — Aura of Authority / Precedence (SG p.82).
 *
 * SG p.82 "The Aura of Authority":
 *   In a convince, negotiate or convince-a-crowd conflict, the side with
 *   the higher Precedence gains a +1s bonus per point of Precedence
 *   greater than their opponent. If one side has no applicable Precedence
 *   at all, the rule does not apply ("they simply won't be heard").
 *
 * This is the Convince-conflict analog of Order of Might (SG p.80). It's
 * a post-success modifier on "successful tests in these conflicts" —
 * which, per DH pp.120-122, includes the disposition test (the first
 * roll inside the conflict, rolled once per team to set that team's
 * HP total).
 *
 * -------------------------------------------------------------------
 * Expected production behavior (per SG p.82)
 * -------------------------------------------------------------------
 *   - Party (Precedence P_ours) vs NPC/monster side (Precedence P_theirs),
 *     Convince conflict.
 *   - Let delta = max(P_ours - P_theirs, 0).
 *   - When the party captain rolls disposition, `contextModifiers`
 *     includes an Aura of Authority bonus of `+<delta>s`
 *     (type: "success", timing: "post",
 *     label "Aura of Authority +Ns" — lang/en.json L503).
 *   - `_handleDispositionRoll` applies postSuccessMods to
 *     `finalSuccesses` (tb2e-roll.mjs L1681-1687), so the stored
 *     disposition total is `baseSuccesses + delta + dispositionAbility`.
 *   - The disadvantaged side gets no such bonus (diff ≤ 0 → null).
 *
 * -------------------------------------------------------------------
 * Current production behavior (the gap this spec encodes)
 * -------------------------------------------------------------------
 * `computeOrderModifier` (module/dice/conflict-roll.mjs L312-345) is a
 * single dispatcher for BOTH Order of Might (Might conflicts) and Aura
 * of Authority (Precedence conflicts). The Precedence branch at
 * L321-328 correctly returns a `+<delta>s` success modifier for
 * PRECEDENCE_CONFLICT_TYPES={"convince","convinceCrowd","negotiate"}
 * (conflict-roll.mjs L188), reading team precedence via
 * `getTeamPrecedence` (L287-295) which delegates to
 * `_readActorPrecedence` (L264-273) — character precedence lives at
 * `system.abilities.precedence` (NumberField, character.mjs L83),
 * monster precedence at `system.precedence` (string/numeric, parsed by
 * `parsePrecedence` at L198-231). `_handleDispositionRoll` applies
 * `postSuccessMods` to `finalSuccesses` at tb2e-roll.mjs L1681-1687 —
 * the downstream plumbing exists end-to-end.
 *
 * The gap is the same one covered by disposition-order-of-might.spec.mjs
 * (TEST_PLAN.md L393): `ConflictPanel.#onRollDisposition`
 * (conflict-panel.mjs L1582-1653) builds its own `contextModifiers`
 * array at L1615 but only pushes the monster group-help dice bonus
 * (L1616-1632). It never calls `computeOrderModifier`. So for a
 * Convince conflict the disposition total ends up
 * `successes + dispositionAbility`, ignoring any Precedence advantage.
 * `computeOrderModifier` IS consumed for volley action rolls
 * (conflict-panel.mjs L1927-1933) but not the disposition roll.
 *
 * Fix shape (identical to the Order of Might fixme; one code change
 * closes both):
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
 *     - Captain: character persuader=3, will=4, precedence=5.
 *       (Character precedence is a writable NumberField,
 *       character.mjs L83, max 7.)
 *     - Member: default character (precedence defaults to 0 per
 *       character.mjs L83, which is ≤ the captain — captain's 5
 *       dominates `getTeamPrecedence`, conflict-roll.mjs L287-295).
 *   Opponent side:
 *     - Captain: Kobold (precedence="1", packs/_source/monsters/
 *       Kobold_a1b2c3d4e5f60001.yml L9).
 *     - Member: another Kobold.
 *   Convince conflict. PRNG stubbed to 0.001 → every d6 rolls 6.
 *
 *   Delta = 5 - 1 = 4 → +4s Aura of Authority on the party's roll.
 *   Base successes from persuader=3: 3. Plus +4s (post-success): 7.
 *   Plus will=4 (config.mjs L286 sets dispositionAbility=will for
 *   convince): disposition total = 7 + 4 = 11.
 *
 *   Current (buggy) total: 3 + 4 = 7 (no +4s applied).
 *
 * -------------------------------------------------------------------
 * Why the spec is a single `test.fixme`, not an anti-spec
 * -------------------------------------------------------------------
 * TEST_PLAN.md L394 phrases the checkbox positively: "team with higher
 * Precedence gains +1s (SG p.82)". An anti-spec would green up the
 * checkbox on a broken implementation and hide the bug. A `test.fixme`
 * that encodes the expected behavior fails closed until the dispatcher
 * wiring lands, making the TEST_PLAN flip a one-line change.
 *
 * Guard removal: when `#onRollDisposition` is patched to invoke
 * `computeOrderModifier` + push the modifier into `contextModifiers`,
 * drop the `test.fixme` here (and on disposition-order-of-might —
 * both fail through the same plumbing gap) and flip TEST_PLAN.md L394
 * to `[x]`.
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
 * Create a character with deterministic persuader/will ratings and an
 * explicit precedence override. Character precedence is a NumberField
 * with initial=0, max=7 (character.mjs L83). `conditions.fresh=false`
 * keeps the persuader pool from picking up the +1D fresh bonus.
 */
async function createCaptainCharacter(page, { name, tag, persuader, will, precedence }) {
  return page.evaluate(
    async ({ n, t, p, w, prec }) => {
      const actor = await Actor.implementation.create({
        name: n,
        type: 'character',
        flags: { tb2e: { e2eTag: t } },
        system: {
          abilities: {
            health: { rating: 4, pass: 0, fail: 0 },
            will:   { rating: w, pass: 0, fail: 0 },
            nature: { rating: 3, max: 3, pass: 0, fail: 0 },
            precedence: prec
          },
          skills: {
            persuader: { rating: p, pass: 0, fail: 0 }
          },
          conditions: { fresh: false }
        }
      });
      return actor.id;
    },
    { n: name, t: tag, p: persuader, w: will, prec: precedence }
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

test.describe('§13 Conflict: Disposition — Aura of Authority (Precedence)', () => {
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
    'Convince conflict: party with higher Precedence gets +1s per point on disposition roll',
    async ({ page }, testInfo) => {
      const tag = `e2e-disp-prec-${testInfo.parallelIndex}-${Date.now()}`;
      const stamp = Date.now();
      const charAName = `E2E Prec Captain ${stamp}`;
      const charBName = `E2E Prec Char B ${stamp}`;
      const monsterAName = `E2E Prec Kobold A ${stamp}`;
      const monsterBName = `E2E Prec Kobold B ${stamp}`;

      await page.goto('/game');
      const ui = new GameUI(page);
      await ui.waitForReady();
      await ui.dismissTours();

      try {
        // Arrange — Precedence-advantaged party vs two Kobolds
        // (precedence=1 per Kobold_a1b2c3d4e5f60001.yml L9).
        // Party captain persuader=3 (all-6s → 3 base successes),
        // will=4 (convince's dispositionAbility per config.mjs L286),
        // precedence=5 → delta = 5 - 1 = 4 vs Kobolds.
        // Expected disposition = 3 + 4 (Aura of Authority) + 4 (will) = 11.
        const captainId = await createCaptainCharacter(page, {
          name: charAName, tag, persuader: 3, will: 4, precedence: 5
        });
        const charBId = await createCharacter(page, { name: charBName, tag });
        const monAId = await importMonster(page, {
          sourceName: 'Kobold', uniqueName: monsterAName, tag
        });
        const monBId = await importMonster(page, {
          sourceName: 'Kobold', uniqueName: monsterBName, tag
        });

        // Sanity-check Precedence values actually reached the actor
        // documents — character precedence lives at
        // `system.abilities.precedence` (character.mjs L83), monster
        // precedence at `system.precedence` (monster.mjs). Kobold=1
        // comes straight from the pack YAML.
        const precs = await page.evaluate(
          ({ cap, kA, kB }) => ({
            captain: game.actors.get(cap)?.system.abilities?.precedence ?? null,
            koboldA: game.actors.get(kA)?.system.precedence ?? null,
            koboldB: game.actors.get(kB)?.system.precedence ?? null
          }),
          { cap: captainId, kA: monAId, kB: monBId }
        );
        expect(precs).toEqual({ captain: 5, koboldA: '1', koboldB: '1' });

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

        // Convince conflict — this is what triggers
        // PRECEDENCE_CONFLICT_TYPES in `computeOrderModifier`
        // (conflict-roll.mjs L188, L321-328).
        await panel.selectConflictType('convince');

        // Pre-flight sanity: at this point `computeOrderModifier` already
        // returns a +4s mod if invoked. Prove the function would produce
        // the expected bonus so that when the implementation gap is
        // closed, we know the plumbing — not the calculation — is all
        // that needs to change. (Mirrors the Order-of-Might spec's
        // pre-flight assertion at L288-311.)
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

        // Act — roll disposition for the Precedence-advantaged party.
        await expect(panel.rollDispositionButton(partyGroupId)).toBeVisible();
        await panel.rollDispositionButton(partyGroupId).click();

        const dialog = new RollDialog(page);
        await dialog.waitForOpen();
        // Pool is persuader=3 (no pre-success Aura of Authority dice —
        // the rule is +Ns post-success, same as Order of Might).
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
        // the fixme. When `#onRollDisposition` pushes the Aura of Authority
        // modifier into `contextModifiers`, all four should pass.

        // The disposition card's modifier list contains the Aura of
        // Authority bonus, with the localized label from lang/en.json L503
        // ("Aura of Authority +Ns") and a +4s value.
        const modsOnCard = await page.evaluate(() => {
          const msg = game.messages.contents.at(-1);
          return msg?.flags?.tb2e?.allModifiers ?? msg?.flags?.tb2e?.modifiers
            ?? msg?.flags?.tb2e?.postSuccessMods ?? [];
        });
        const auraEntry = modsOnCard.find((m) =>
          typeof m.label === 'string'
            && m.label.includes('Aura of Authority')
        );
        expect(auraEntry).toBeTruthy();
        expect(auraEntry.value).toBe(4);
        expect(auraEntry.type).toBe('success');

        await card.clickFinalize();

        await page.evaluate(() => {
          if ( globalThis.__tb2eE2EPrevRandomUniform ) {
            CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
            delete globalThis.__tb2eE2EPrevRandomUniform;
          }
        });

        // Disposition total with Aura of Authority: 3 base successes + 4
        // Aura of Authority + 4 will = 11.
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
