import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §12 Conflict: Setup — assign a monster boss via the setup tab UI; verify
 * the boss flag is persisted on the Combatant document and surfaced in the
 * panel DOM. Boss is the monster-side analog of captain, but — crucially —
 * it is stored per-combatant (not per-group) and can coexist with (or be
 * independent of) captain designation.
 *
 * Rules under test: monster boss designation during conflict setup
 * (DH pp.118-122 — the captain represents the side for disposition rolls;
 * the boss is the specific monster of consequence on the GM side, used by
 * the distribution phase and certain weapons/abilities). See
 * `panel-disposition.hbs` L94,L118,L146 for the boss icon surfacing
 * downstream, and the boss-aware suggested-distribution logic at
 * conflict-panel.mjs L797-808.
 *
 * Implementation map (verified against current source):
 *
 *   - Setup-tab UI: `panel-setup.hbs` L97-103 renders
 *     `<button class="setup-boss-btn {{active}}" data-action="setBoss"
 *     data-combatant-id>` inside the GM-only branch, gated by
 *     `{{#if this.isMonster}}`. The `isMonster` flag in the context is
 *     derived at conflict-panel.mjs L648 from `actor?.type === "monster"`
 *     — so the button only renders on rows whose combatant resolves to a
 *     monster world-actor. The button's `.active` class reflects
 *     `this.isBoss` (context L647, sourced directly from
 *     `c.system.isBoss`).
 *
 *   - Action dispatch: `ConflictPanel.#onSetBoss` (conflict-panel.mjs
 *     L1494-1501) pulls `combatantId` from the closest `data-combatant-id`
 *     ancestor and calls `combatant.update({ "system.isBoss": !current })`.
 *     This is a *toggle* — a second click clears the boss bit — which we
 *     exercise explicitly below.
 *
 *   - Storage: `CombatantData` at `module/data/combat/combatant.mjs` L8
 *     defines `isBoss: BooleanField({ initial: false })` directly on the
 *     Combatant system schema. Unlike captain (stored per-group at
 *     `combat.system.groupDispositions[groupId].captainId`, combat.mjs
 *     L101-106), boss is a per-combatant bit — so re-assigning "the boss"
 *     to a different monster does NOT clear the prior boss. Both can be
 *     set simultaneously. This spec verifies that explicit contract (set
 *     monA boss → still boss after setting monB; clear monA → monB
 *     remains).
 *
 *   - isMonster guard: the button is not rendered on character rows, so a
 *     spec that attempts to click it on a party-side combatant would hit
 *     zero elements. We assert button count per side (0 on party, 2 on
 *     gm) rather than just "first boss button" so a regression that
 *     removed the monster-gate would fail loud.
 *
 *   - Synthetic token rule (CLAUDE.md): boss is stored directly on the
 *     embedded Combatant document, not on the world actor — so this
 *     storage path is correct for unlinked monster tokens (where
 *     `game.actors.get(actorId)` returns the template without
 *     per-token state). The panel's own context code at L647 reads
 *     `c.system.isBoss` straight off the Combatant, so we do the same in
 *     our assertions.
 *
 * Cleanup: deletes every Combat this test created and every tagged actor
 * so sibling specs sharing the worker don't inherit an orphan conflict.
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

async function createCharacter(page, { name, tag }) {
  return page.evaluate(
    async ({ n, t }) => {
      const actor = await Actor.implementation.create({
        name: n,
        type: 'character',
        flags: { tb2e: { e2eTag: t } }
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

async function readIsBoss(page, combatId, combatantId) {
  return page.evaluate(
    ({ cId, coId }) => {
      const c = game.combats.get(cId);
      return !!c?.combatants.get(coId)?.system.isBoss;
    },
    { cId: combatId, coId: combatantId }
  );
}

test.describe('§12 Conflict: Setup — assign boss', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(async () => {
      try { await game.tb2e.conflictPanel?.close(); } catch {}
      const ids = Array.from(game.combats ?? []).map((c) => c.id);
      if ( ids.length ) await Combat.deleteDocuments(ids);
    });
  });

  test('GM assigns monster boss; flag persists on combatant + UI reflects it', async ({
    page
  }, testInfo) => {
    const tag = `e2e-setup-boss-${testInfo.parallelIndex}-${Date.now()}`;
    const charAName = `E2E Char A ${Date.now()}`;
    const charBName = `E2E Char B ${Date.now()}`;
    const monsterAName = `E2E Kobold ${Date.now()}`;
    const monsterBName = `E2E Bugbear ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    try {
      // Arrange — four world actors: 2 characters, 2 monsters from the
      // tb2e.monsters compendium (mirrors setup-assign-captain.spec.mjs).
      const charA = await createCharacter(page, { name: charAName, tag });
      const charB = await createCharacter(page, { name: charBName, tag });
      const monA = await importMonster(page, {
        sourceName: 'Kobold', uniqueName: monsterAName, tag
      });
      const monB = await importMonster(page, {
        sourceName: 'Bugbear', uniqueName: monsterBName, tag
      });

      // Create the conflict via the tracker (shipped in line 365).
      const tracker = new ConflictTracker(page);
      await tracker.open();
      await tracker.clickCreateConflict();

      await expect
        .poll(
          () =>
            page.evaluate(() => {
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

      // Seed 2 characters + 2 monsters. Boss is monster-only, so we need
      // two monsters to cover "re-assign to a different monster".
      const cmb = {};
      cmb.charA = await panel.addCombatant({ combatId, actorId: charA, groupId: partyGroupId });
      cmb.charB = await panel.addCombatant({ combatId, actorId: charB, groupId: partyGroupId });
      cmb.monA = await panel.addCombatant({ combatId, actorId: monA, groupId: gmGroupId });
      cmb.monB = await panel.addCombatant({ combatId, actorId: monB, groupId: gmGroupId });
      for ( const [key, id] of Object.entries(cmb) ) {
        expect(id, `expected combatant id for ${key}`).toBeTruthy();
      }
      await expect(panel.setupCombatants).toHaveCount(4);

      // Assert — boss button only rendered on monster rows (the
      // `{{#if this.isMonster}}` guard at panel-setup.hbs L97). Party side
      // should have zero boss buttons; gm side should have two.
      await expect(
        panel.setupGroup(partyGroupId).locator('button.setup-boss-btn')
      ).toHaveCount(0);
      await expect(
        panel.setupGroup(gmGroupId).locator('button.setup-boss-btn')
      ).toHaveCount(2);

      // Precondition: neither monster combatant has isBoss set yet
      // (CombatantData.schema initial: false).
      expect(await readIsBoss(page, combatId, cmb.monA)).toBe(false);
      expect(await readIsBoss(page, combatId, cmb.monB)).toBe(false);
      await expect(panel.bossButton(cmb.monA)).not.toHaveClass(/\bactive\b/);
      await expect(panel.bossButton(cmb.monB)).not.toHaveClass(/\bactive\b/);

      // Act 1 — set monA as boss via the shield button.
      await panel.clickBossButton(cmb.monA);

      // Assert — storage: monA.system.isBoss === true; monB unchanged.
      expect(await readIsBoss(page, combatId, cmb.monA)).toBe(true);
      expect(await readIsBoss(page, combatId, cmb.monB)).toBe(false);
      // DOM: monA's boss button is .active; monB's is not.
      await expect(panel.bossButton(cmb.monA)).toHaveClass(/\bactive\b/);
      await expect(panel.bossButton(cmb.monB)).not.toHaveClass(/\bactive\b/);

      // Act 2 — also set monB as boss. Because boss is a per-combatant bit
      // (data/combat/combatant.mjs L8), setting monB does NOT clear monA —
      // this is the key divergence from captain (which is stored per-group
      // and thus single-valued). We assert both are flagged simultaneously.
      await panel.clickBossButton(cmb.monB);
      expect(await readIsBoss(page, combatId, cmb.monA)).toBe(true);
      expect(await readIsBoss(page, combatId, cmb.monB)).toBe(true);
      await expect(panel.bossButton(cmb.monA)).toHaveClass(/\bactive\b/);
      await expect(panel.bossButton(cmb.monB)).toHaveClass(/\bactive\b/);
      await expect(
        panel.setupGroup(gmGroupId).locator('button.setup-boss-btn.active')
      ).toHaveCount(2);

      // Act 3 — click the boss button on monA a second time. The handler
      // (#onSetBoss at conflict-panel.mjs L1494-1501) toggles via
      // `!combatant.system.isBoss`, so this should clear monA's boss bit
      // while leaving monB's intact.
      await panel.clickBossButton(cmb.monA, { expectActive: false });
      expect(await readIsBoss(page, combatId, cmb.monA)).toBe(false);
      expect(await readIsBoss(page, combatId, cmb.monB)).toBe(true);
      await expect(panel.bossButton(cmb.monA)).not.toHaveClass(/\bactive\b/);
      await expect(panel.bossButton(cmb.monB)).toHaveClass(/\bactive\b/);
      await expect(
        panel.setupGroup(gmGroupId).locator('button.setup-boss-btn.active')
      ).toHaveCount(1);
    } finally {
      await cleanupTaggedActors(page, tag);
    }
  });
});
