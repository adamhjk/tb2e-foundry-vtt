import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §12 Conflict: Setup — assign a captain per side via the setup tab UI;
 * verify the captain id is persisted on the Combat document and surfaced
 * in the panel DOM.
 *
 * Rules under test: team captain designation during conflict setup
 * (DH pp.118-122 — each side names a captain who rolls disposition,
 * distributes it across the team, and scripts actions).
 *
 * Implementation map (verified against current source):
 *
 *   - Setup-tab UI: `panel-setup.hbs` L82-113 renders one
 *     `<button class="setup-captain-btn" data-action="setCaptain"
 *     data-combatant-id>` per combatant row (GM-only — L91). The `<li>`
 *     row gets an `is-captain` class (L88) and the button gets an `active`
 *     class (L92) when `isCaptain` is true. Non-GMs see a
 *     `.setup-captain-badge` instead (L109-111).
 *
 *   - Action dispatch: `ConflictPanel.#onSetCaptain` (conflict-panel.mjs
 *     L1479-1486) pulls `combatantId` + `groupId` from the closest
 *     `data-*` ancestors and calls `combat.setCaptain(groupId, combatantId)`.
 *
 *   - Storage: `TB2ECombat.setCaptain` (combat.mjs L101-106) writes to
 *     `system.groupDispositions[groupId].captainId` via `this.update(...)`.
 *     Read-back path in the panel: `gd[group.id]?.captainId` at
 *     conflict-panel.mjs L638-639, L646 (what drives `isCaptain` in the
 *     Handlebars context).
 *
 *   - Gating: `canBeginDisposition` (conflict-panel.mjs L709-710) is only
 *     true when every group has a captainId — so the "Next" button's
 *     disabled state doubles as an integration assertion that the captain
 *     flag was stored.
 *
 *   - Synthetic token rule (CLAUDE.md): we read captain state through the
 *     combat document itself, not via `game.actors.get(actorId)`, so the
 *     assertions are correct for unlinked monster tokens as well.
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

test.describe('§12 Conflict: Setup — assign captain', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(async () => {
      try { await game.tb2e.conflictPanel?.close(); } catch {}
      const ids = Array.from(game.combats ?? []).map((c) => c.id);
      if ( ids.length ) await Combat.deleteDocuments(ids);
    });
  });

  test('GM assigns a captain per side; captain id persists + UI reflects it', async ({
    page
  }, testInfo) => {
    const tag = `e2e-setup-cap-${testInfo.parallelIndex}-${Date.now()}`;
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
      // tb2e.monsters compendium (mirrors setup-add-combatants.spec.mjs).
      const charA = await createCharacter(page, { name: charAName, tag });
      const charB = await createCharacter(page, { name: charBName, tag });
      const monA = await importMonster(page, {
        sourceName: 'Kobold', uniqueName: monsterAName, tag
      });
      const monB = await importMonster(page, {
        sourceName: 'Bugbear', uniqueName: monsterBName, tag
      });

      // Create the conflict via the tracker footer (setup-create-conflict
      // already covers this path — we lean on it here).
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

      // Seed 2 combatants per side — captain assignment is a per-side
      // choice, so each side needs multiple candidates for the test to
      // mean anything (also lets us assert "only one captain per side").
      const cmb = {};
      cmb.charA = await panel.addCombatant({ combatId, actorId: charA, groupId: partyGroupId });
      cmb.charB = await panel.addCombatant({ combatId, actorId: charB, groupId: partyGroupId });
      cmb.monA = await panel.addCombatant({ combatId, actorId: monA, groupId: gmGroupId });
      cmb.monB = await panel.addCombatant({ combatId, actorId: monB, groupId: gmGroupId });
      for ( const [key, id] of Object.entries(cmb) ) {
        expect(id, `expected combatant id for ${key}`).toBeTruthy();
      }
      await expect(panel.setupCombatants).toHaveCount(4);

      // Precondition: no captain on either side yet, so the "Next"
      // (beginDisposition) button is disabled (conflict-panel.mjs L709-710,
      // panel-setup.hbs L141).
      const nextBtn = panel.setupContent.locator(
        'button.setup-next-btn[data-action="beginDisposition"]'
      );
      await expect(nextBtn).toBeDisabled();
      const gdBefore = await page.evaluate((cId) => {
        const c = game.combats.get(cId);
        return foundry.utils.deepClone(c.system.groupDispositions || {});
      }, combatId);
      expect(gdBefore[partyGroupId]?.captainId ?? null).toBeNull();
      expect(gdBefore[gmGroupId]?.captainId ?? null).toBeNull();

      // Act 1 — assign Char A as party captain via the crown button.
      await panel.clickCaptainButton(cmb.charA);

      // Assert — DOM: only charA's row has `.is-captain`.
      await expect(panel.setupCombatantRow(cmb.charA)).toHaveClass(/\bis-captain\b/);
      await expect(panel.setupCombatantRow(cmb.charB)).not.toHaveClass(/\bis-captain\b/);

      // Assert — storage: party group has the captainId; gm group still null.
      const gdAfterParty = await page.evaluate((cId) => {
        const c = game.combats.get(cId);
        return foundry.utils.deepClone(c.system.groupDispositions || {});
      }, combatId);
      expect(gdAfterParty[partyGroupId]?.captainId).toBe(cmb.charA);
      expect(gdAfterParty[gmGroupId]?.captainId ?? null).toBeNull();

      // Still disabled — gm side has no captain yet.
      await expect(nextBtn).toBeDisabled();

      // Act 2 — assign Kobold as gm captain.
      await panel.clickCaptainButton(cmb.monA);

      await expect(panel.setupCombatantRow(cmb.monA)).toHaveClass(/\bis-captain\b/);
      await expect(panel.setupCombatantRow(cmb.monB)).not.toHaveClass(/\bis-captain\b/);

      const gdBothSides = await page.evaluate((cId) => {
        const c = game.combats.get(cId);
        return foundry.utils.deepClone(c.system.groupDispositions || {});
      }, combatId);
      expect(gdBothSides[partyGroupId]?.captainId).toBe(cmb.charA);
      expect(gdBothSides[gmGroupId]?.captainId).toBe(cmb.monA);

      // With both captains assigned, `canBeginDisposition` flips true and
      // the Next button is enabled (conflict-panel.mjs L709-710,
      // panel-setup.hbs L141).
      await expect(nextBtn).toBeEnabled();

      // Act 3 — re-assign the party captain; verify last-write-wins
      // (setCaptain at combat.mjs L101-106 overwrites `captainId`; there is
      // no multi-captain bucket) and that charA is no longer captain.
      await panel.clickCaptainButton(cmb.charB);

      await expect(panel.setupCombatantRow(cmb.charB)).toHaveClass(/\bis-captain\b/);
      await expect(panel.setupCombatantRow(cmb.charA)).not.toHaveClass(/\bis-captain\b/);

      const gdReassigned = await page.evaluate((cId) => {
        const c = game.combats.get(cId);
        return foundry.utils.deepClone(c.system.groupDispositions || {});
      }, combatId);
      expect(gdReassigned[partyGroupId]?.captainId).toBe(cmb.charB);
      // GM side unchanged by party-side reassignment.
      expect(gdReassigned[gmGroupId]?.captainId).toBe(cmb.monA);

      // Only one `.is-captain` per side at a time — DOM-level confirmation
      // that the UI matches the single-captain-per-side storage contract.
      await expect(
        panel.setupGroup(partyGroupId).locator('li.setup-combatant.is-captain')
      ).toHaveCount(1);
      await expect(
        panel.setupGroup(gmGroupId).locator('li.setup-combatant.is-captain')
      ).toHaveCount(1);
    } finally {
      await cleanupTaggedActors(page, tag);
    }
  });
});
