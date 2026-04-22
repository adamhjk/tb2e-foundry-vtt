import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §6 Spells — materials + focus add +1D each to a casting roll
 * (DH p.99-101 — a spell's listed materials and focus are consumables/
 * foci that, when brought to bear, grant +1D each to the casting test;
 * Arcanist DH p.161).
 *
 * Rules under test:
 *   - `castSpell` (module/dice/spell-casting.mjs:27-43) pushes one
 *     pre-timing dice modifier for each of `system.materials` /
 *     `system.focus` that is a truthy string:
 *       materials → `{ type: "dice", value: 1, source: "spell",
 *                      label: i18n("TB2E.Spell.MaterialsBonus"),
 *                      timing: "pre" }` (spell-casting.mjs:28-34)
 *       focus     → same shape with the focus label (spell-casting.mjs:36-42)
 *   - Both are passed into `testContext.contextModifiers` and surface in
 *     the roll dialog as rows in `.roll-dialog-modifiers`. They do NOT
 *     inflate the `input[name="poolSize"]` base-dice value — that stays at
 *     the actor's Arcanist rating; the +1D per modifier is summed into the
 *     dialog summary (`updateSummary` at tb2e-roll.mjs:939-962 computes
 *     `pool = poolSize.value + diceBonus`) and into the final `poolSize`
 *     on the chat-card payload (`rollTest` at tb2e-roll.mjs:1316-1319
 *     computes `poolSize = baseDice + diceBonus`).
 *   - Hence for Arcanist rating 3 + materials + focus, the summary reads
 *     "5D vs Ob 3" and the card carries `baseDice: 3, poolSize: 5`.
 *
 * Implementation map:
 *   - Same cast entry as cast-fixed-obstacle.spec.mjs — Magic tab button
 *     `data-action="castSpell"` → `#onCastSpell` (character-sheet.mjs:1396)
 *     → `castSpell(actor, item, "memory")` (spell-casting.mjs:11). Only
 *     difference here is that the embedded spell has truthy material/
 *     focus strings, so the context-modifier branch runs.
 *
 * Source spell: `Beast Cloak` (packs/_source/spells/beast-cloak.yml,
 * `_id: a1b2c3d4e5f63003`) — castingType `fixed`, `fixedObstacle: 3`.
 * The source entry already ships with a non-empty `focus` string; we
 * additionally set `materials` to a non-empty string so both +1D modifiers
 * fire. This is the mirror of the fixed-Ob spec, which cleared both to
 * pin the pool at the raw Arcanist rating.
 *
 * Dice determinism:
 *   - Same PRNG stub as cast-fixed-obstacle.spec.mjs — u=0.001 ⇒
 *     Math.ceil((1-0.001)*6) = 6 on every die ⇒ 5 successes in a 5-die
 *     pool ⇒ PASS vs Ob 3 (margin 2).
 *
 * Narrow scope — out of scope (other §6 checkboxes):
 *   - factor / versus / skillSwap casting (separate specs).
 *   - scroll / spellbook source consumption.
 *   - Toggling materials/focus via the spell item sheet UI (not exposed
 *     as a single-click checkbox — materials/focus are StringFields per
 *     module/data/item/spell.mjs:41-42, storing the description of the
 *     component/focus object. The +1D rule fires whenever the string is
 *     truthy, which is the mechanic under test here. The spell item
 *     sheet's field-editing coverage belongs to §22.)
 *   - Finalize / pip advancement / post-roll spell consumption (covered
 *     by cast-fixed-obstacle.spec.mjs note + skill-test-basic).
 */
const SPELL_NAME = 'Beast Cloak';
const SPELL_ID = 'a1b2c3d4e5f63003'; // packs/_source/spells/beast-cloak.yml
const SPELLS_PACK = 'tb2e.spells';
const EXPECTED_OBSTACLE = 3; // beast-cloak.yml:9 — fixedObstacle
const ARCANIST_RATING = 3;
const EXPECTED_POOL = ARCANIST_RATING + 2; // +1D materials, +1D focus — spell-casting.mjs:27-43

test.describe('§6 Spells — materials + focus each add +1D', () => {
  test.afterEach(async ({ page }) => {
    // Restore any leaked PRNG stub so downstream specs see real randomness
    // (matches cast-fixed-obstacle.spec.mjs / skill-test-basic.spec.mjs).
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });
  });

  test('Beast Cloak with materials + focus rolls 5D (3 Arcanist + 2 components) vs Ob 3 — PASS', async ({ page }) => {
    const actorName = `E2E Spell Materials Focus ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Stage an Arcanist-3 character. `fresh: false` pins the base pool to
    // the rating (the model default `conditions.fresh = true` would add a
    // separate +1D fresh modifier via `gatherConditionModifiers`, DH p.85).
    const actorId = await page.evaluate(async (n) => {
      const actor = await Actor.create({
        name: n,
        type: 'character',
        system: {
          abilities: {
            will:   { rating: 4, pass: 0, fail: 0 },
            health: { rating: 3, pass: 0, fail: 0 },
            nature: { rating: 3, max: 3, pass: 0, fail: 0 }
          },
          skills: {
            arcanist: { rating: 3, pass: 0, fail: 0, learning: 0 }
          },
          conditions: { fresh: false }
        }
      });
      return actor.id;
    }, actorName);
    expect(actorId).toBeTruthy();

    // Seed Beast Cloak memorized with BOTH materials AND focus set to
    // non-empty strings so the context-modifier branch in spell-casting.mjs
    // pushes both +1D rows. The pack source already has a non-empty focus,
    // but we set both explicitly for symmetry + robustness against future
    // pack edits.
    const spellItemId = await page.evaluate(
      async ({ id, packId, entryId }) => {
        const actor = game.actors.get(id);
        const pack = game.packs.get(packId);
        const src = await pack.getDocument(entryId);
        const data = src.toObject();
        data.system.memorized = true;
        data.system.materials = 'A pinch of beast hair';
        data.system.focus = 'A cloak made from the skins of your chosen beast';
        const [created] = await actor.createEmbeddedDocuments('Item', [data]);
        return created.id;
      },
      { id: actorId, packId: SPELLS_PACK, entryId: SPELL_ID }
    );
    expect(spellItemId).toBeTruthy();

    // Sanity: embedded spell is the fixed-Ob Beast Cloak with materials +
    // focus truthy.
    const spellState = await page.evaluate(
      ({ id, iid }) => {
        const item = game.actors.get(id).items.get(iid);
        return item ? {
          name: item.name,
          castingType: item.system.castingType,
          fixedObstacle: item.system.fixedObstacle,
          memorized: item.system.memorized,
          hasMaterials: !!item.system.materials,
          hasFocus: !!item.system.focus
        } : null;
      },
      { id: actorId, iid: spellItemId }
    );
    expect(spellState).toEqual({
      name: SPELL_NAME,
      castingType: 'fixed',
      fixedObstacle: EXPECTED_OBSTACLE,
      memorized: true,
      hasMaterials: true,
      hasFocus: true
    });

    // Stub PRNG → all-6s. 5D pool = 5 successes vs Ob 3 = PASS.
    await page.evaluate(() => {
      globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => 0.001;
    });

    try {
      await page.evaluate((id) => {
        game.actors.get(id).sheet.render(true);
      }, actorId);

      const sheet = new CharacterSheet(page, actorName);
      await sheet.expectOpen();
      await sheet.openMagicTab();

      const castButton = sheet
        .spellRow(spellItemId)
        .locator('button[data-action="castSpell"]');
      await expect(castButton).toBeVisible();

      const initialChatCount = await page.evaluate(
        () => game.messages.contents.length
      );

      await castButton.click();

      const dialog = new RollDialog(page);
      await dialog.waitForOpen();

      // Base dice input stays at Arcanist rating — the materials/focus
      // +1D modifiers are rendered as separate rows in
      // `.roll-dialog-modifiers`, not merged into the input. Source:
      // _showRollDialog hands `dice: baseDice` to the template as the
      // poolSize initial value (tb2e-roll.mjs:454/1298), and
      // `_collectAllModifiers` + `updateSummary` sum pre-timing dice mods
      // on top (tb2e-roll.mjs:549-550, 939-943).
      expect(await dialog.getPoolSize()).toBe(ARCANIST_RATING);
      expect(await dialog.getObstacle()).toBe(EXPECTED_OBSTACLE);

      // The summary reads "5D vs Ob 3" — RollDialog.getSummaryPool parses
      // the leading ND integer out of the `.roll-dialog-summary-text`
      // block written by `updateSummary` (tb2e-roll.mjs:939-962).
      expect(await dialog.getSummaryPool()).toBe(EXPECTED_POOL);

      // Both modifier rows must be present with the localized labels from
      // spell-casting.mjs:30,38 (lang/en.json:851-852). Scope to the
      // dialog's modifier list so other condition rows don't confuse the
      // assertion. We use text filters (not index math) so the test is
      // robust to modifier-list ordering changes.
      const materialsRow = dialog.modifierRows.filter({
        hasText: 'Materials (+1D)'
      });
      const focusRow = dialog.modifierRows.filter({
        hasText: 'Focus (+1D)'
      });
      await expect(materialsRow).toHaveCount(1);
      await expect(focusRow).toHaveCount(1);

      await dialog.submit();

      await expect
        .poll(
          () => page.evaluate(() => game.messages.contents.length),
          { timeout: 10_000 }
        )
        .toBeGreaterThan(initialChatCount);

      const card = new RollChatCard(page);
      await card.expectPresent();

      // Card assertions — 5 dice rolled, 5 successes (all 6s), Ob 3, PASS.
      expect(await card.getPool()).toBe(EXPECTED_POOL);
      await expect(card.diceResults).toHaveCount(EXPECTED_POOL);
      expect(await card.getSuccesses()).toBe(EXPECTED_POOL);
      expect(await card.getObstacle()).toBe(EXPECTED_OBSTACLE);
      expect(await card.isPass()).toBe(true);

      // Spell source line still renders with the spell name (same path as
      // cast-fixed-obstacle.spec.mjs — roll-result.hbs:21-26).
      const spellLine = card.root.locator('.roll-card-spell');
      await expect(spellLine).toBeVisible();
      await expect(spellLine).toContainText(SPELL_NAME);

      // Flag-level proof — `_buildRollFlags` (tb2e-roll.mjs:1417-1480)
      // stamps `baseDice` (= Arcanist rating, 3) and `poolSize` (= 5 after
      // the materials + focus dice bonuses sum in at tb2e-roll.mjs:
      // 1316-1319). Scoped to this actor to avoid cross-test leakage.
      const flags = await page.evaluate((id) => {
        const msg = game.messages.contents
          .filter(m => m.flags?.tb2e?.actorId === id)
          .at(-1);
        const tb = msg?.flags?.tb2e;
        const r = tb?.roll;
        return r ? {
          type: r.type,
          key: r.key,
          baseDice: r.baseDice,
          poolSize: r.poolSize,
          successes: r.successes,
          obstacle: r.obstacle,
          pass: r.pass,
          spellId: tb.testContext?.spellId ?? null,
          spellName: tb.testContext?.spellName ?? null,
          castingSource: tb.testContext?.castingSource ?? null
        } : null;
      }, actorId);
      expect(flags).toEqual({
        type: 'skill',
        key: 'arcanist',
        baseDice: ARCANIST_RATING,
        poolSize: EXPECTED_POOL,
        successes: EXPECTED_POOL,
        obstacle: EXPECTED_OBSTACLE,
        pass: true,
        spellId: spellItemId,
        spellName: SPELL_NAME,
        castingSource: 'memory'
      });
    } finally {
      await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
    }
  });
});
