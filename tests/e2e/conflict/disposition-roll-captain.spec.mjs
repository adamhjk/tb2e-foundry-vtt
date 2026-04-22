import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §13 Conflict: Disposition — GM captain rolls the disposition test for the
 * party side; successes + ability rating become the team's disposition total
 * (DH pp.120-122), which the captain then distributes across teammates as
 * each combatant's `system.conflict.hp.{value,max}` (DH pp.122).
 *
 * Rules under test:
 *   - Disposition total = successes + dispositionAbility rating (min 1).
 *     For a "kill" conflict this is `fighter` successes + `health` rating
 *     (config.mjs L200-211).
 *   - Monster disposition (flat or rolled) is a separate checkbox
 *     (disposition-flat-monster.spec.mjs) and NOT covered here — we roll
 *     only the party side so the monster side stays at 0 HP as the negative
 *     control.
 *   - Player-captain distribution mailbox is a separate checkbox
 *     (disposition-distribution-player.spec.mjs) — here the GM owns the
 *     captain, so `distribute` runs the direct path (combat.mjs L226-242),
 *     no mailbox.
 *
 * Implementation map (file:line refs verified against current source):
 *   - Setup phase → disposition transition: `ConflictPanel.#onBeginDisposition`
 *     (conflict-panel.mjs L1543-1574) calls `combat.beginDisposition()`
 *     (combat.mjs L144-174); that also flips `system.phase = "disposition"`
 *     which the panel's `_prepareContext` detects (conflict-panel.mjs
 *     L494-499) and auto-advances `activeTab` to "disposition".
 *   - Roll path: `#onRollDisposition` (conflict-panel.mjs L1582-1653) calls
 *     `rollTest({ actor: captainActor, type: "skill", key: "fighter",
 *     testContext: { isDisposition, conflictGroupId, combatId, … } })`.
 *     The roll dialog opens (module/dice/tb2e-roll.mjs `_showRollDialog`
 *     L376-…), we stub PRNG to all-6s BEFORE submit for deterministic
 *     successes. `_handleDispositionRoll` (tb2e-roll.mjs L1659-1739)
 *     computes `disposition = max(successes + abilityRating, 1)` and posts
 *     a roll card with `flags.tb2e.testContext.isDisposition = true`.
 *   - Finalize: `_handleFinalize` (post-roll.mjs L477-504) branches on
 *     `testContext.isDisposition` and calls
 *     `combat.requestStoreDispositionRoll(groupId, { rolled, … })` which
 *     (GM path) writes to `system.groupDispositions[groupId].rolled`
 *     (combat.mjs L183-210).
 *   - Distribute: the disposition tab re-renders with a `.distribution-section`
 *     pre-filled with a suggested even split (conflict-panel.mjs L791-820,
 *     panel-disposition.hbs L84-108). Clicking "Distribute" dispatches to
 *     `#onDistribute` (conflict-panel.mjs L1661-1683) which calls
 *     `combat.distributeDisposition(groupId, distribution)` (combat.mjs
 *     L219-242). That update writes `system.conflict.hp.value` and
 *     `system.conflict.hp.max` on each member's actor — the primary
 *     assertion surface here.
 *   - Synthetic tokens (CLAUDE.md): we read HP through `combatant.actor`
 *     rather than `game.actors.get(combatant.actorId)`, so monster unlinked
 *     tokens resolve to the synthetic actor. Our characters are linked
 *     (non-token world actors), so either path returns the same document,
 *     but we use `combatant.actor` to match the production invariant.
 *
 * Dice determinism: `CONFIG.Dice.randomUniform = () => 0.001` makes every
 * d6 roll 6 (isSun), so an N-dice fighter pool yields N successes. With
 * fighter rating 3 + health rating 4 on the party captain, the expected
 * disposition total is `3 + 4 = 7`. An even split across 2 members
 * (conflict-panel.mjs L810-819) suggests `ceil(7/2)=4` and `floor(7/2)=3`.
 *
 * Scope notes (per agent briefing):
 *   - We do NOT cover monster/flat disposition, player-distribution
 *     mailbox, or Order-of-Might / Precedence bonuses — each has its own
 *     checkbox (TEST_PLAN.md L391-394).
 *   - We do NOT deep-test the disposition-tab UI beyond roll + HP.
 *
 * Cleanup: stubbed PRNG restored in afterEach even if a mid-test failure
 * skips the inline restore, plus every tagged actor and every combat is
 * removed so sibling specs on the same worker start with a clean world.
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
 * Create a character actor with fighter + health ratings we control, so
 * the disposition pool size and ability bonus are both deterministic.
 * Default `conditions.fresh = true` would add +1D to the pool via
 * `gatherConditionModifiers` — turn it off so the pool is exactly the
 * skill rating (same rationale as ability-test-basic.spec.mjs).
 */
async function createCaptainCharacter(page, { name, tag, fighter, health }) {
  return page.evaluate(
    async ({ n, t, f, h }) => {
      const actor = await Actor.implementation.create({
        name: n,
        type: 'character',
        flags: { tb2e: { e2eTag: t } },
        system: {
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
    { n: name, t: tag, f: fighter, h: health }
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

test.describe('§13 Conflict: Disposition — GM captain roll', () => {
  test.afterEach(async ({ page }) => {
    // Restore the PRNG stub (defensive — inline restore already runs on
    // the happy path, but a mid-test failure would otherwise leak the
    // stub into sibling specs on the same worker).
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
    'GM captain rolls disposition → total stored, distribute sets conflict.hp on each member',
    async ({ page }, testInfo) => {
      const tag = `e2e-disp-roll-${testInfo.parallelIndex}-${Date.now()}`;
      const stamp = Date.now();
      const charAName = `E2E Captain ${stamp}`;
      const charBName = `E2E Char B ${stamp}`;
      const monsterAName = `E2E Kobold ${stamp}`;
      const monsterBName = `E2E Bugbear ${stamp}`;

      await page.goto('/game');
      const ui = new GameUI(page);
      await ui.waitForReady();
      await ui.dismissTours();

      try {
        // Arrange — two characters + two monsters. The party captain has
        // fighter=3, health=4 so an all-6s roll yields 3 successes + 4 =
        // disposition total of 7.
        const captainId = await createCaptainCharacter(page, {
          name: charAName, tag, fighter: 3, health: 4
        });
        const charBId = await createCharacter(page, { name: charBName, tag });
        const monAId = await importMonster(page, {
          sourceName: 'Kobold', uniqueName: monsterAName, tag
        });
        const monBId = await importMonster(page, {
          sourceName: 'Bugbear', uniqueName: monsterBName, tag
        });

        // Create conflict + resolve group ids (same pattern as
        // setup-assign-captain.spec.mjs L132-150).
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

        // Populate, captainize, conflict-type.
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

        // "kill" has a single disposition skill (fighter) + health ability
        // (config.mjs L200-211), so `beginDisposition` auto-sets
        // `chosenSkill = "fighter"` (combat.mjs L156-168) and the roll UI
        // skips the skill-choice step.
        await panel.selectConflictType('kill');

        await expect(panel.beginDispositionButton).toBeEnabled();
        await panel.clickBeginDisposition();

        // Precondition: neither side has rolled; HP is 0 on every member.
        const hpBefore = await page.evaluate((cId) => {
          const c = game.combats.get(cId);
          return Array.from(c.combatants).map((co) => ({
            id: co.id,
            hp: co.actor?.system.conflict?.hp?.value ?? null,
            max: co.actor?.system.conflict?.hp?.max ?? null,
            groupId: co._source.group
          }));
        }, combatId);
        for ( const row of hpBefore ) {
          expect(row.hp, `initial hp for ${row.id}`).toBe(0);
          expect(row.max, `initial max for ${row.id}`).toBe(0);
        }

        // Stub PRNG BEFORE clicking roll so the evaluated roll is
        // deterministic. u=0.001 → Math.ceil((1-0.001)*6) = 6 on every die.
        await page.evaluate(() => {
          globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
          CONFIG.Dice.randomUniform = () => 0.001;
        });

        const initialChatCount = await page.evaluate(
          () => game.messages.contents.length
        );

        // Act — roll disposition for the party side only. The monster side
        // stays at 0 HP as the negative control.
        await expect(panel.rollDispositionButton(partyGroupId)).toBeVisible();
        await panel.rollDispositionButton(partyGroupId).click();

        // Submit the roll dialog (no obstacle for disposition — DH p.120).
        const dialog = new RollDialog(page);
        await dialog.waitForOpen();
        // Pool size should mirror the captain's fighter rating (3).
        expect(await dialog.getPoolSize()).toBe(3);
        await dialog.submit();

        // The disposition card posts with `flags.tb2e.testContext.isDisposition`
        // but no obstacle/pass banner (tb2e-roll.mjs L1677-1679). Wait for
        // it to appear, then finalize so `storeDispositionRoll` runs.
        await expect
          .poll(() => page.evaluate(() => game.messages.contents.length), {
            timeout: 10_000
          })
          .toBeGreaterThan(initialChatCount);

        // We opened the tracker via `ConflictTracker.open()` which switches
        // the sidebar to the Combat tab — that tab replaces the Chat tab
        // DOM, so the chat card is mounted but `display: none`. Switch back
        // to the Chat tab so the roll-card POM can assert visibility and
        // click Finalize.
        await page.evaluate(() =>
          ui.sidebar?.changeTab?.('chat', 'primary')
        );

        const card = new RollChatCard(page);
        await card.expectPresent();

        // Sanity: the posted card is a disposition roll carrying the
        // group/combat refs the finalize path needs (post-roll.mjs L489-499).
        const dispFlags = await page.evaluate(() => {
          const msg = game.messages.contents.at(-1);
          const f = msg?.flags?.tb2e;
          return f ? {
            isDisposition: !!f.testContext?.isDisposition,
            conflictGroupId: f.testContext?.conflictGroupId ?? null,
            combatId: f.testContext?.combatId ?? null,
            dispositionAbilityKey: f.testContext?.dispositionAbilityKey ?? null,
            dispositionAbilityRating: f.testContext?.dispositionAbilityRating ?? null,
            successes: f.roll?.successes ?? null
          } : null;
        });
        expect(dispFlags).toEqual({
          isDisposition: true,
          conflictGroupId: partyGroupId,
          combatId,
          dispositionAbilityKey: 'health',
          dispositionAbilityRating: 4,
          successes: 3
        });

        await card.clickFinalize();

        // Restore PRNG — no more dice rolls happen after this point.
        await page.evaluate(() => {
          if ( globalThis.__tb2eE2EPrevRandomUniform ) {
            CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
            delete globalThis.__tb2eE2EPrevRandomUniform;
          }
        });

        // Assert — disposition total stored on the party group; monster
        // side is still unrolled.
        await expect
          .poll(() => page.evaluate(({ cId, gId }) => {
            const c = game.combats.get(cId);
            return c?.system.groupDispositions?.[gId]?.rolled ?? null;
          }, { cId: combatId, gId: partyGroupId }), { timeout: 10_000 })
          .toBe(7);
        const gd = await page.evaluate(
          ({ cId }) => {
            const c = game.combats.get(cId);
            return foundry.utils.deepClone(c.system.groupDispositions || {});
          },
          { cId: combatId }
        );
        expect(gd[partyGroupId]?.rolled).toBe(7);
        expect(gd[partyGroupId]?.distributed ?? false).toBe(false);
        expect(gd[gmGroupId]?.rolled ?? null).toBeNull();

        // Panel DOM — the party group now shows the rolled value and a
        // distribute form; the gm group still has its roll affordance.
        await expect(panel.dispositionRolledValue(partyGroupId)).toHaveText(
          '7'
        );
        await expect(panel.distributionSection(partyGroupId)).toBeVisible();
        await expect(panel.distributeButton(partyGroupId)).toBeVisible();

        // Pre-populated distribution inputs should sum to the rolled total
        // (conflict-panel.mjs L810-819 — even split, remainder distributed
        // one-per-member from the top).
        const distInputs = panel
          .distributionSection(partyGroupId)
          .locator('.dist-value');
        await expect(distInputs).toHaveCount(2);
        const suggested = await distInputs.evaluateAll((els) =>
          els.map((el) => Number(el.value))
        );
        expect(suggested.reduce((a, b) => a + b, 0)).toBe(7);
        expect(Math.max(...suggested)).toBe(4); // ceil(7/2)
        expect(Math.min(...suggested)).toBe(3); // floor(7/2)

        // Distribute — the primary assertion surface.
        await panel.distributeButton(partyGroupId).click();

        // Wait for each party member to have HP assigned.
        await expect
          .poll(() => page.evaluate((ids) => {
            return ids.every((id) => {
              const co = game.combats.contents[0]?.combatants.get(id);
              return (co?.actor?.system.conflict?.hp?.max ?? 0) > 0;
            });
          }, [cmb.captain, cmb.charB]), { timeout: 10_000 })
          .toBe(true);

        const hpAfter = await page.evaluate((cId) => {
          const c = game.combats.get(cId);
          return Array.from(c.combatants).map((co) => ({
            id: co.id,
            name: co.name,
            groupId: co._source.group,
            // Per CLAUDE.md: read HP via `combatant.actor`, not
            // `game.actors.get(combatant.actorId)` — monsters are
            // unlinked, so their world actor's HP stays at 0.
            hp: co.actor?.system.conflict?.hp?.value ?? null,
            max: co.actor?.system.conflict?.hp?.max ?? null
          }));
        }, combatId);
        const party = hpAfter.filter((x) => x.groupId === partyGroupId);
        const monsters = hpAfter.filter((x) => x.groupId === gmGroupId);
        // Party HP matches the distribution (captain gets the ceil'd share,
        // charB gets floor — matches the rendered suggestion above).
        const partyValues = party.map((x) => x.hp).sort((a, b) => a - b);
        expect(partyValues).toEqual([3, 4]);
        // Max mirrors value (combat.mjs L231 writes both).
        for ( const row of party ) {
          expect(row.hp, `hp set on ${row.name}`).toBeGreaterThan(0);
          expect(row.max, `max set on ${row.name}`).toBe(row.hp);
        }
        expect(partyValues.reduce((a, b) => a + b, 0)).toBe(7);
        // Monster side is the negative control — no roll, no distribution,
        // HP still 0.
        for ( const row of monsters ) {
          expect(row.hp, `monster hp for ${row.name}`).toBe(0);
          expect(row.max, `monster max for ${row.name}`).toBe(0);
        }

        // Panel DOM — the "Distributed" badge renders on the party side,
        // the distribution form is gone (panel-disposition.hbs L83, L110).
        await expect(panel.dispositionDistributedBadge(partyGroupId)).toBeVisible();
        await expect(panel.distributionSection(partyGroupId)).toHaveCount(0);
        // Monster side has none of the post-roll UI yet.
        await expect(panel.dispositionRolledValue(gmGroupId)).toHaveCount(0);
        await expect(panel.dispositionDistributedBadge(gmGroupId)).toHaveCount(0);

        // Storage flag: groupDispositions reflects the distributed marker.
        const gdAfter = await page.evaluate(
          ({ cId }) => {
            const c = game.combats.get(cId);
            return foundry.utils.deepClone(c.system.groupDispositions || {});
          },
          { cId: combatId }
        );
        expect(gdAfter[partyGroupId]?.distributed).toBe(true);
        expect(gdAfter[gmGroupId]?.distributed ?? false).toBe(false);
      } finally {
        await cleanupTaggedActors(page, tag);
      }
    }
  );
});
