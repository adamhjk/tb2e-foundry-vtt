import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §6 Spells — cast a fixed-obstacle spell (DH pp.99–101; Arcanist DH p.161).
 *
 * Rules under test:
 *   - Fixed-obstacle spells roll Arcanist against the spell's `fixedObstacle`
 *     (spell-casting.mjs:53-57). No factor dialog; no versus pending card.
 *   - The spell's name flows into the chat card via `testContext.spellName`
 *     (spell-casting.mjs:47) → `flags.tb2e.roll.testContext.spellName`
 *     (tb2e-roll.mjs:1464) → rendered as `.roll-card-spell` in
 *     templates/chat/roll-result.hbs:21-26.
 *   - On PASS the spell is marked cast, and when the casting source is
 *     `memory` it is un-memorized (spell-casting.mjs:162-173).
 *
 * Implementation map:
 *   - Magic tab button `data-action="castSpell"`
 *     (templates/actors/tabs/character-magic.hbs:46) → CharacterSheet
 *     `#onCastSpell` (character-sheet.mjs:1396) → `castSpell` in
 *     module/dice/spell-casting.mjs:11.
 *   - `#onCastSpell` only renders a button when `canCast` is true — that
 *     flag is set if the spell is `memorized`, has a `spellbookId`, has a
 *     matching scroll, or is `skillSwap` (character-sheet.mjs:727-728).
 *     This spec memorizes the spell to unambiguously exercise the memory
 *     source path.
 *   - With a single source available `#onCastSpell` bypasses the source
 *     dialog (character-sheet.mjs:1418-1420) and invokes
 *     `castSpell(actor, item, "memory")` directly → `rollTest({ type:
 *     "skill", key: "arcanist", testContext: { obstacle, spellId,
 *     spellName, castingSource } })`.
 *   - The roll dialog pre-fills its obstacle input from
 *     `testContext.obstacle` (tb2e-roll.mjs:513-515).
 *
 * Source spell: `Beast Cloak` (packs/_source/spells/beast-cloak.yml,
 * `_id: a1b2c3d4e5f63003`) — castingType `fixed`, `fixedObstacle: 3`,
 * `materials: ""`, no default focus on the owned item (focus is a text field
 * describing the focus object, not a dice bonus — materials/focus dice
 * bonuses come from spell-casting.mjs:27-43 and require truthy string
 * values; but even if the pack entry has a `focus` string, this spec does
 * NOT stage it as truthy because we copy the source and deliberately clear
 * both fields to pin the pool at the Arcanist rating alone). Materials/
 * focus bonuses are covered by a separate §6 checkbox.
 *
 * Dice determinism:
 *   - Same PRNG stub as ability-test / skill-test specs — u=0.001 ⇒ every
 *     d6 face is 6, so Arcanist rating 3 vs Ob 3 is a deterministic PASS.
 *
 * Narrow scope — out of scope (covered by other §6 checkboxes):
 *   - factor casting, versus casting, scroll/spellbook variants,
 *     skillSwap, materials/focus +1D bonuses, spell-source confirmation
 *     cards (only emitted for spellbook/scroll sources).
 */
const SPELL_NAME = 'Beast Cloak';
const SPELL_ID = 'a1b2c3d4e5f63003'; // packs/_source/spells/beast-cloak.yml
const SPELLS_PACK = 'tb2e.spells';
const EXPECTED_OBSTACLE = 3; // beast-cloak.yml:9 — fixedObstacle

test.describe('§6 Spells — cast fixed-obstacle spell', () => {
  test.afterEach(async ({ page }) => {
    // Match skill-test-basic.spec.mjs: clean up any leaked PRNG stub so
    // downstream specs see real randomness.
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });
  });

  test('casts Beast Cloak from memory vs fixed Ob 3 — PASS; card has spell source', async ({ page }) => {
    const actorName = `E2E Spell Fixed Cast ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Stage a character with Arcanist rating 3 and memorize the spell.
    // `fresh: false` pins the dialog pool to the Arcanist rating exactly —
    // the data-model default `conditions.fresh = true` would add +1D via
    // `gatherConditionModifiers` (DH p.85).
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

    // Seed the spell from the compendium entry, then force memorized=true
    // and null out materials/focus so the pool is exactly Arcanist rating
    // (spell-casting.mjs:27-43 only adds the +1D if the string is truthy).
    const spellItemId = await page.evaluate(
      async ({ id, packId, entryId }) => {
        const actor = game.actors.get(id);
        const pack = game.packs.get(packId);
        const src = await pack.getDocument(entryId);
        const data = src.toObject();
        data.system.memorized = true;
        data.system.materials = '';
        data.system.focus = '';
        const [created] = await actor.createEmbeddedDocuments('Item', [data]);
        return created.id;
      },
      { id: actorId, packId: SPELLS_PACK, entryId: SPELL_ID }
    );
    expect(spellItemId).toBeTruthy();

    // Sanity-check the embedded spell is the fixed-Ob Beast Cloak we want.
    const spellState = await page.evaluate(
      ({ id, iid }) => {
        const item = game.actors.get(id).items.get(iid);
        return item ? {
          name: item.name,
          castingType: item.system.castingType,
          fixedObstacle: item.system.fixedObstacle,
          memorized: item.system.memorized,
          materials: item.system.materials,
          focus: item.system.focus,
          cast: item.system.cast
        } : null;
      },
      { id: actorId, iid: spellItemId }
    );
    expect(spellState).toEqual({
      name: SPELL_NAME,
      castingType: 'fixed',
      fixedObstacle: EXPECTED_OBSTACLE,
      memorized: true,
      materials: '',
      focus: '',
      cast: false
    });

    // Stub PRNG BEFORE opening the sheet (same pattern as skill-test-basic):
    // u=0.001 ⇒ Math.ceil((1-0.001)*6) = 6 on every die ⇒ deterministic
    // all-6s ⇒ 3 successes vs Ob 3 ⇒ PASS.
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

      // The cast button is rendered on the spell row because `canCast` is
      // true (memorized). There's exactly one source (memory), so
      // `#onCastSpell` bypasses the source chooser dialog
      // (character-sheet.mjs:1418-1420).
      const castButton = sheet
        .spellRow(spellItemId)
        .locator('button[data-action="castSpell"]');
      await expect(castButton).toBeVisible();

      const initialChatCount = await page.evaluate(
        () => game.messages.contents.length
      );

      await castButton.click();

      // The roll dialog opens with obstacle pre-filled from
      // `testContext.obstacle` (tb2e-roll.mjs:513-515).
      const dialog = new RollDialog(page);
      await dialog.waitForOpen();
      expect(await dialog.getPoolSize()).toBe(3);
      expect(await dialog.getObstacle()).toBe(EXPECTED_OBSTACLE);
      await dialog.submit();

      await expect
        .poll(
          () => page.evaluate(() => game.messages.contents.length),
          { timeout: 10_000 }
        )
        .toBeGreaterThan(initialChatCount);

      // Scope the chat-card POM to the actor's most recent message so we
      // don't pick up a stale card from a parallel spec (even with
      // per-worker Foundry instances the chat log persists within a worker).
      const card = new RollChatCard(page);
      await card.expectPresent();

      expect(await card.getPool()).toBe(3);
      await expect(card.diceResults).toHaveCount(3);
      expect(await card.getSuccesses()).toBe(3);
      expect(await card.getObstacle()).toBe(EXPECTED_OBSTACLE);
      expect(await card.isPass()).toBe(true);

      // Spell source on the card — templates/chat/roll-result.hbs:21-26
      // renders `.roll-card-spell` with the spell name icon + text when
      // `spellName` is present in the chat data.
      const spellLine = card.root.locator('.roll-card-spell');
      await expect(spellLine).toBeVisible();
      await expect(spellLine).toContainText(SPELL_NAME);

      // Flag-level proof: the message carries the roll/testContext payload
      // built by `_buildRollFlags` in tb2e-roll.mjs:1427-1480. That object
      // is assigned as `flags.tb2e`, so the shape on the message is:
      //   flags.tb2e.actorId      (tb2e-roll.mjs:1455)
      //   flags.tb2e.roll.{type,key,baseDice,poolSize,successes,
      //                    obstacle,pass,...}  (writes at 1427-1436 +
      //                    obstacle/pass written post-roll at 1508-1509)
      //   flags.tb2e.testContext.{spellId,spellName,castingSource,...}
      //                           (tb2e-roll.mjs:1461-1479)
      // Scoped to this actor to avoid cross-test leakage in the worker's
      // chat log.
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
        baseDice: 3,
        poolSize: 3,
        successes: 3,
        obstacle: EXPECTED_OBSTACLE,
        pass: true,
        spellId: spellItemId,
        spellName: SPELL_NAME,
        castingSource: 'memory'
      });

      // NOTE: post-roll spell-state mutations (`system.cast = true`,
      // `system.memorized = false`) are NOT verified here. They're applied
      // by `processSpellCast` in spell-casting.mjs:148 — but that runs from
      // `_handleFinalize` in post-roll.mjs:575-579, which only fires when
      // the player clicks the card's Finalize button. That pathway is
      // exercised in skill-test-basic.spec.mjs (pip advancement after
      // Finalize) and belongs to a separate §6 checkbox focused on memory/
      // scroll consumption. This spec's scope is the casting ROLL — pool,
      // obstacle, pass outcome, spell-source label on the card.
      const postRollSpellState = await page.evaluate(
        ({ id, iid }) => {
          const item = game.actors.get(id).items.get(iid);
          return item ? {
            cast: item.system.cast,
            memorized: item.system.memorized
          } : null;
        },
        { id: actorId, iid: spellItemId }
      );
      // Pre-Finalize: no mutation applied yet.
      expect(postRollSpellState).toEqual({ cast: false, memorized: true });
    } finally {
      await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
    }
  });
});
