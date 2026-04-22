import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §13 Conflict: Disposition — monster side uses the flat (predetermined)
 * disposition path. Each stat-block lists a flat HP value per conflict
 * type (DH p.122, SG pp.180/191 — "listed conflict" dispositions); the GM
 * stamps that value directly instead of rolling, then distributes across
 * the monster team the same way the roll path does.
 *
 * Rules under test:
 *   - `captainActor.system.dispositions[*]` (monster.mjs L30-33) holds the
 *     per-conflict-type HP from the stat block. When the current
 *     `conflictType` matches (case-insensitive `.includes`), the panel
 *     marks the group as `isListedConflict = true` and pre-fills
 *     `suggestedDisposition = matchingDisp.hp + additional` where
 *     `additional = max(monsterCount - 1, 0)` (conflict-panel.mjs
 *     L736-761; DH p.122 "group help dice / bonus HP" rule).
 *   - The GM's "set flat" affordance (panel-disposition.hbs L60-72) is
 *     rendered regardless of `canRoll`; clicking it dispatches to
 *     `ConflictPanel.#onSetFlatDisposition` (conflict-panel.mjs
 *     L1509-1521), which calls `combat.storeDispositionRoll(groupId,
 *     { rolled, diceResults: [], cardHtml })` — the SAME storage mutator
 *     as the roll path (combat.mjs L201-210). The only difference is no
 *     `rollTest` is invoked, no roll dialog opens, and no chat-card
 *     "Finalize" button is clicked.
 *   - For a listed monster conflict the roll button is suppressed
 *     (`canRoll = !hasRolled && !isListedConflict && …` — conflict-panel.mjs
 *     L838-840), so the flat path is the ONLY way to set the monster
 *     side's disposition.
 *
 * Scope notes (per agent briefing, TEST_PLAN.md L391):
 *   - We verify the monster-side flat path in isolation. The player-side
 *     stays unrolled/unhp'd as the negative control, and the roll-path
 *     test is covered by `disposition-roll-captain.spec.mjs` (L390).
 *   - Distribution-mailbox and order-of-might / precedence are separate
 *     checkboxes (L392-394) and NOT touched here.
 *
 * Implementation map (file:line refs verified against current source):
 *   - Setup phase → disposition transition: `ConflictPanel.#onBeginDisposition`
 *     (conflict-panel.mjs L1543-1574) calls `combat.beginDisposition()`
 *     (combat.mjs L144-174); the auto-advance logic flips the active tab
 *     to "disposition" (conflict-panel.mjs L1546).
 *   - Flat-set path: `#onSetFlatDisposition` (conflict-panel.mjs
 *     L1509-1521) parses `input.value` into an int, guards `<= 0`, and
 *     calls `combat.storeDispositionRoll` directly.
 *   - Storage: `storeDispositionRoll` (combat.mjs L201-210) writes
 *     `system.groupDispositions[groupId].{rolled,diceResults,cardHtml}`
 *     — the same record the roll-path test asserts on.
 *   - Distribute: `#onDistribute` (conflict-panel.mjs L1661-1683) reads
 *     each `.dist-value` input and calls `combat.distributeDisposition`
 *     (combat.mjs L219-242), which writes `system.conflict.hp.{value,max}`
 *     on each member's ACTOR — and for monsters, those actors are the
 *     synthetic token actors (CLAUDE.md "unlinked actors" section), which
 *     is why we read HP via `combatant.actor` rather than
 *     `game.actors.get(combatant.actorId)`.
 *
 * Selected monsters: Bugbear (captain; Kill disposition hp=7 per
 * `packs/_source/monsters/Bugbear_a1b2c3d4e5f60005.yml` L23-29) and Goblin
 * (member; hp=7 per `packs/_source/monsters/Goblin_a1b2c3d4e5f6000c.yml`).
 * With 2 monsters, `additional = 1`, so the pre-filled suggestion is
 * `7 + 1 = 8`. Our test explicitly types `8` into the input so the
 * expected total is deterministic even if the stat-block HP changes.
 *
 * Cleanup: every tagged actor and every combat is removed in the finally
 * block so sibling specs on the same worker start with a clean world.
 */

const MONSTER_PACK_ID = 'tb2e.monsters';
const EXPECTED_FLAT_DISPOSITION = 8; // Bugbear Kill hp=7 + 1 (Goblin helps).

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

test.describe('§13 Conflict: Disposition — monster flat path', () => {
  test.afterEach(async ({ page }) => {
    // Defensive cleanup even if a mid-test assertion skipped the finally.
    await page.evaluate(() => {
      try { game.tb2e?.conflictPanel?.close(); } catch {}
    });
    await page.evaluate(async () => {
      const ids = Array.from(game.combats ?? []).map((c) => c.id);
      if ( ids.length ) await Combat.deleteDocuments(ids);
    });
  });

  test(
    'GM sets monster disposition from stat block → HP distributed without rolling',
    async ({ page }, testInfo) => {
      const tag = `e2e-disp-flat-${testInfo.parallelIndex}-${Date.now()}`;
      const stamp = Date.now();
      const charAName = `E2E Captain ${stamp}`;
      const charBName = `E2E Char B ${stamp}`;
      const monsterAName = `E2E Bugbear ${stamp}`;
      const monsterBName = `E2E Goblin ${stamp}`;

      await page.goto('/game');
      const ui = new GameUI(page);
      await ui.waitForReady();
      await ui.dismissTours();

      try {
        // Arrange — two characters + two monsters. Characters are here only
        // so that beginDisposition's "every group needs a captain" validation
        // (combat.mjs L149-154) passes; they stay unrolled as the negative
        // control that the flat path didn't silently touch the other side.
        const captainId = await createCharacter(page, { name: charAName, tag });
        const charBId = await createCharacter(page, { name: charBName, tag });
        const monAId = await importMonster(page, {
          sourceName: 'Bugbear', uniqueName: monsterAName, tag
        });
        const monBId = await importMonster(page, {
          sourceName: 'Goblin', uniqueName: monsterBName, tag
        });

        // Create conflict + resolve group ids (same pattern as the
        // disposition-roll-captain spec).
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

        // "kill" matches Bugbear's `Kill` stat-block disposition (hp=7)
        // → panel computes `isListedConflict = true`,
        // `suggestedDisposition = 7 + 1 = 8` (one help per extra monster).
        await panel.selectConflictType('kill');

        await expect(panel.beginDispositionButton).toBeEnabled();
        await panel.clickBeginDisposition();

        // Precondition: HP is 0 on every member on both sides.
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

        // For a listed monster conflict, the roll button is SUPPRESSED —
        // only the flat block appears (conflict-panel.mjs L838-840 gating).
        // This is the negative control that the test exercises the correct
        // path.
        await expect(panel.rollDispositionButton(gmGroupId)).toHaveCount(0);
        await expect(panel.flatDispositionSection(gmGroupId)).toBeVisible();

        // The monster-side input is pre-filled with the computed
        // suggestion (panel-disposition.hbs L63, conflict-panel.mjs L751).
        await expect(panel.flatDispositionInput(gmGroupId)).toHaveValue(
          String(EXPECTED_FLAT_DISPOSITION)
        );
        // The hint span surfaces the "flat + group-help" math.
        await expect(panel.monsterDispositionHint(gmGroupId)).toBeVisible();

        // Record chat count so we can assert no roll card is posted.
        const chatBefore = await page.evaluate(
          () => game.messages.contents.length
        );

        // Act — click the flat "set" button. The input already has the
        // suggested value; the handler reads it directly, so we don't
        // need to retype.
        await panel.setFlatDispositionButton(gmGroupId).click();

        // Assert — disposition total stored on the monster group; the
        // party group is still unrolled.
        await expect
          .poll(() => page.evaluate(({ cId, gId }) => {
            const c = game.combats.get(cId);
            return c?.system.groupDispositions?.[gId]?.rolled ?? null;
          }, { cId: combatId, gId: gmGroupId }), { timeout: 10_000 })
          .toBe(EXPECTED_FLAT_DISPOSITION);

        const gd = await page.evaluate(
          ({ cId }) => {
            const c = game.combats.get(cId);
            return foundry.utils.deepClone(c.system.groupDispositions || {});
          },
          { cId: combatId }
        );
        expect(gd[gmGroupId]?.rolled).toBe(EXPECTED_FLAT_DISPOSITION);
        expect(gd[gmGroupId]?.distributed ?? false).toBe(false);
        // The flat-set path writes an empty dice array, unlike the roll
        // path which records per-die results.
        expect(gd[gmGroupId]?.diceResults ?? null).toEqual([]);
        // Party side is the negative control — still unrolled.
        expect(gd[partyGroupId]?.rolled ?? null).toBeNull();

        // Negative control: no chat card was posted by the flat path
        // (storeDispositionRoll is invoked with a cardHtml string but
        // doesn't call ChatMessage.create — conflict-panel.mjs L1516-1520
        // + combat.mjs L201-210).
        const chatAfter = await page.evaluate(
          () => game.messages.contents.length
        );
        expect(chatAfter).toBe(chatBefore);

        // Panel DOM — the monster group now shows the rolled value and
        // the distribute form renders with the suggested split.
        await expect(panel.dispositionRolledValue(gmGroupId)).toHaveText(
          String(EXPECTED_FLAT_DISPOSITION)
        );
        await expect(panel.distributionSection(gmGroupId)).toBeVisible();
        await expect(panel.distributeButton(gmGroupId)).toBeVisible();

        // Pre-populated distribution inputs should sum to the flat total.
        // Bugbear is captain — and on Kill, `isBoss` is false by default,
        // so the panel uses the even-split branch (conflict-panel.mjs
        // L810-819): ceil(8/2)=4 and floor(8/2)=4.
        const distInputs = panel
          .distributionSection(gmGroupId)
          .locator('.dist-value');
        await expect(distInputs).toHaveCount(2);
        const suggested = await distInputs.evaluateAll((els) =>
          els.map((el) => Number(el.value))
        );
        expect(suggested.reduce((a, b) => a + b, 0)).toBe(
          EXPECTED_FLAT_DISPOSITION
        );
        expect(suggested).toEqual([4, 4]);

        // Distribute — this is the "HP set without roll" assertion.
        await panel.distributeButton(gmGroupId).click();

        await expect
          .poll(() => page.evaluate((ids) => {
            return ids.every((id) => {
              const co = game.combats.contents[0]?.combatants.get(id);
              return (co?.actor?.system.conflict?.hp?.max ?? 0) > 0;
            });
          }, [cmb.monA, cmb.monB]), { timeout: 10_000 })
          .toBe(true);

        const hpAfter = await page.evaluate((cId) => {
          const c = game.combats.get(cId);
          return Array.from(c.combatants).map((co) => ({
            id: co.id,
            name: co.name,
            groupId: co._source.group,
            // Per CLAUDE.md: read HP via `combatant.actor`, not
            // `game.actors.get(combatant.actorId)` — monsters are
            // unlinked tokens, so their world actor's HP stays at 0.
            hp: co.actor?.system.conflict?.hp?.value ?? null,
            max: co.actor?.system.conflict?.hp?.max ?? null
          }));
        }, combatId);
        const party = hpAfter.filter((x) => x.groupId === partyGroupId);
        const monsters = hpAfter.filter((x) => x.groupId === gmGroupId);

        // Monster HP matches the even-split suggestion.
        const monsterValues = monsters.map((x) => x.hp).sort((a, b) => a - b);
        expect(monsterValues).toEqual([4, 4]);
        for ( const row of monsters ) {
          expect(row.hp, `hp set on ${row.name}`).toBe(4);
          expect(row.max, `max set on ${row.name}`).toBe(row.hp);
        }
        expect(monsterValues.reduce((a, b) => a + b, 0)).toBe(
          EXPECTED_FLAT_DISPOSITION
        );
        // Party side is the negative control — no roll, no distribution,
        // HP still 0 on every member.
        for ( const row of party ) {
          expect(row.hp, `party hp for ${row.name}`).toBe(0);
          expect(row.max, `party max for ${row.name}`).toBe(0);
        }

        // Panel DOM — the "Distributed" badge renders on the monster
        // side; the distribution form is gone.
        await expect(panel.dispositionDistributedBadge(gmGroupId)).toBeVisible();
        await expect(panel.distributionSection(gmGroupId)).toHaveCount(0);
        // Party side still has no post-roll UI.
        await expect(panel.dispositionRolledValue(partyGroupId)).toHaveCount(0);
        await expect(panel.dispositionDistributedBadge(partyGroupId)).toHaveCount(0);

        // Storage flag: groupDispositions reflects the distributed marker.
        const gdAfter = await page.evaluate(
          ({ cId }) => {
            const c = game.combats.get(cId);
            return foundry.utils.deepClone(c.system.groupDispositions || {});
          },
          { cId: combatId }
        );
        expect(gdAfter[gmGroupId]?.distributed).toBe(true);
        expect(gdAfter[partyGroupId]?.distributed ?? false).toBe(false);
      } finally {
        await cleanupTaggedActors(page, tag);
      }
    }
  );
});
