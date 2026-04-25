import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §13 Conflict: Disposition — Aura of Authority does NOT apply to disposition
 * (SG p.82).
 *
 * SG p.82 "The Aura of Authority" mirrors SG p.80 ("The Greater the Might"):
 * +1s per point of Precedence greater than the opponent's, applied "for all
 * successful or tied actions" — i.e., the volley actions during the
 * convince/negotiate/convinceCrowd conflict, not the disposition test that
 * sets HP before any actions occur.
 *
 * This is the Precedence analog of disposition-order-of-might.spec.mjs.
 * Same RAW reasoning: the disposition test isn't an action, so the bonus
 * doesn't apply there. Volley action rolls during the conflict pick the
 * bonus up via `computeOrderModifier` at conflict-panel.mjs
 * #onRollConflictAction.
 *
 * Fixture: Convince conflict, party captain persuader=3 / will=4 /
 * precedence=5 vs two Kobolds (precedence=1). PRNG all-6s → persuader=3
 * rolls 3 successes. Expected disposition total = 3 (successes) + 4 (will,
 * convince's dispositionAbility per config.mjs) = 7.
 * Buggy behavior would give 3 + 4 (precedence delta) + 4 = 11.
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
    'Convince conflict: Aura of Authority is NOT applied to the disposition roll',
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
        // precedence=5; delta to Kobolds = 4. RAW: Aura of Authority does
        // NOT apply to disposition (SG p.82 — "successful or tied actions"
        // is volley-action wording).
        // Expected disposition = 3 (successes) + 4 (will) = 7.
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

        // Pre-flight sanity: `computeOrderModifier` itself still returns
        // the +4s mod when invoked directly — the function is correct, it
        // just must not be wired into the disposition-roll path. Guards
        // against accidental regression of the helper. (Mirrors the Order
        // of Might anti-spec.)
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

        // The disposition card's modifier list must NOT contain an Aura
        // of Authority entry — the bonus belongs on volley actions, not
        // on the disposition test (SG p.82).
        const modsOnCard = await page.evaluate(() => {
          const msg = game.messages.contents.at(-1);
          return [
            ...(msg?.flags?.tb2e?.roll?.modifiers ?? []),
            ...(msg?.flags?.tb2e?.postSuccessMods ?? [])
          ];
        });
        const auraEntry = modsOnCard.find((m) =>
          typeof m.label === 'string'
            && m.label.includes('Aura of Authority')
        );
        expect(auraEntry).toBeUndefined();

        await card.clickFinalize();

        await page.evaluate(() => {
          if ( globalThis.__tb2eE2EPrevRandomUniform ) {
            CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
            delete globalThis.__tb2eE2EPrevRandomUniform;
          }
        });

        // Disposition total without Aura of Authority: 3 base successes
        // + 4 (will) = 7.
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
