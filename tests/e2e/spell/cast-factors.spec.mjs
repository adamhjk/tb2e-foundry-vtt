import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §6 Spells — cast a factors spell (DH pp.99–101; Arcanist DH p.161).
 *
 * Rules under test:
 *   - Factor-type spells open a factor-selection dialog. Each factor
 *     group contributes one option's integer value to the obstacle; the
 *     total sum of selected options is the spell's obstacle for the
 *     Arcanist roll (spell-casting.mjs:59-64, _showFactorDialog at
 *     spell-casting.mjs:77-139).
 *   - The factor-dialog `cast` callback sums all checked radio values
 *     (spell-casting.mjs:104-111) and passes the total as
 *     `testContext.obstacle` into the roll pipeline (spell-casting.mjs:62).
 *   - The roll dialog pre-fills its obstacle input from
 *     `testContext.obstacle` (tb2e-roll.mjs:513-515).
 *
 * Implementation map:
 *   - Magic tab button `data-action="castSpell"`
 *     (templates/actors/tabs/character-magic.hbs) → CharacterSheet
 *     `#onCastSpell` (character-sheet.mjs:1396) → `castSpell` in
 *     module/dice/spell-casting.mjs:11.
 *   - For `castingType === "factors"` the entry point calls
 *     `_showFactorDialog` which renders templates/dice/spell-factors.hbs
 *     inside a `new foundry.applications.api.DialogV2(...)`. Each factor
 *     group becomes a `<fieldset class="factor-group-select">` with
 *     `<input type="radio" name="factor-<groupIndex>" value="<value>">`
 *     options; the template checks the first option per group by default.
 *
 * Source spell: `Wyrd Lights` (packs/_source/spells/wyrd-lights.yml,
 * `_id: a1b2c3d4e5f60010`) — castingType `factors`, two factor groups:
 *   - Number: One light (1), Two lights (2), Three lights (3), Four lights (4)
 *   - Duration: Two turns (0), Three turns (1), Four turns (2), Phase (3)
 *
 * This spec picks "Three lights" (3) + "Three turns" (1) = Ob 4 to prove
 * that (a) the dialog actually reads all groups and (b) a non-default
 * selection flows through. `materials`/`focus` are nulled so the pool is
 * exactly the Arcanist rating (spell-casting.mjs:27-43).
 *
 * Dice determinism:
 *   - Same PRNG stub as cast-fixed-obstacle.spec.mjs — u=0.001 ⇒ every
 *     d6 face is 6, so Arcanist rating 4 vs Ob 4 is a deterministic PASS.
 *
 * Narrow scope — out of scope (covered by other §6 checkboxes):
 *   - versus casting, scroll/spellbook variants, skillSwap, materials/
 *     focus +1D bonuses, exhaustive factor-obstacle arithmetic.
 */
const SPELL_NAME = 'Wyrd Lights';
const SPELL_ID = 'a1b2c3d4e5f60010'; // packs/_source/spells/wyrd-lights.yml
const SPELLS_PACK = 'tb2e.spells';

// Factor selections: Number group (index 0) "Three lights" = value 3,
// Duration group (index 1) "Three turns" = value 1 → total Ob 4.
const NUMBER_GROUP_INDEX = 0;
const DURATION_GROUP_INDEX = 1;
const NUMBER_VALUE = 3;
const DURATION_VALUE = 1;
const EXPECTED_OBSTACLE = NUMBER_VALUE + DURATION_VALUE;

test.describe('§6 Spells — cast factors spell', () => {
  test.afterEach(async ({ page }) => {
    // Match cast-fixed-obstacle.spec.mjs: restore any leaked PRNG stub so
    // downstream specs see real randomness.
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });
  });

  test('opens factor dialog, selections compute Ob 4, Arcanist roll resolves PASS', async ({ page }) => {
    const actorName = `E2E Spell Factors Cast ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Stage a character with Arcanist rating 4, fresh=false so the pool
    // isn't inflated by the +1D fresh condition bonus (DH p.85).
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
            arcanist: { rating: 4, pass: 0, fail: 0, learning: 0 }
          },
          conditions: { fresh: false }
        }
      });
      return actor.id;
    }, actorName);
    expect(actorId).toBeTruthy();

    // Seed the spell from the compendium, flip memorized=true so
    // `canCast` is true on the spell row, and null out materials/focus so
    // the pool equals the Arcanist rating exactly.
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

    // Sanity-check the embedded spell has the factor shape we expect.
    const spellState = await page.evaluate(
      ({ id, iid }) => {
        const item = game.actors.get(id).items.get(iid);
        return item ? {
          name: item.name,
          castingType: item.system.castingType,
          memorized: item.system.memorized,
          materials: item.system.materials,
          focus: item.system.focus,
          cast: item.system.cast,
          factorGroupCount: (item.system.factors || []).length,
          factorNames: (item.system.factors || []).map(f => f.name)
        } : null;
      },
      { id: actorId, iid: spellItemId }
    );
    expect(spellState).toEqual({
      name: SPELL_NAME,
      castingType: 'factors',
      memorized: true,
      materials: '',
      focus: '',
      cast: false,
      factorGroupCount: 2,
      factorNames: ['Number', 'Duration']
    });

    // Stub PRNG BEFORE opening the sheet — u=0.001 ⇒ every d6 is a 6 ⇒
    // Arcanist rating 4 rolls 4 successes ⇒ deterministic PASS vs Ob 4.
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

      // Cast button visible because `canCast === true` (memorized).
      // Single source (memory) skips the source-chooser dialog
      // (character-sheet.mjs:1418-1420).
      const castButton = sheet
        .spellRow(spellItemId)
        .locator('button[data-action="castSpell"]');
      await expect(castButton).toBeVisible();

      const initialChatCount = await page.evaluate(
        () => game.messages.contents.length
      );

      await castButton.click();

      // Factor dialog opens. It's rendered by `new DialogV2(...)` with no
      // classes (spell-casting.mjs:96), so scope to the inner
      // `.spell-factors-dialog` element from templates/dice/spell-factors.hbs:1.
      const factorDialog = page
        .locator('dialog.application.dialog')
        .filter({ has: page.locator('.spell-factors-dialog') })
        .last();
      await expect(factorDialog).toBeVisible();
      await expect(factorDialog.locator('.spell-factors-dialog h3')).toHaveText(SPELL_NAME);

      // Every factor group in the template renders as a fieldset with
      // radio inputs named `factor-<groupIndex>`. Confirm both groups
      // render before selecting.
      const numberGroup = factorDialog.locator(
        `input[type="radio"][name="factor-${NUMBER_GROUP_INDEX}"]`
      );
      const durationGroup = factorDialog.locator(
        `input[type="radio"][name="factor-${DURATION_GROUP_INDEX}"]`
      );
      await expect(numberGroup).toHaveCount(4);
      await expect(durationGroup).toHaveCount(4);

      // Select non-default options. The dialog's `cast` callback
      // (spell-casting.mjs:104-111) sums all currently-checked radios
      // via `button.form.querySelectorAll("input[type='radio']:checked")`
      // at click time, so what matters is the DOM `:checked` state on
      // submit — not any live-total updater (which in DialogV2 receives
      // the Application instance as its second arg, not an HTMLElement,
      // so the `html.querySelector(".factor-total-value")` path in
      // spell-casting.mjs:122 is a no-op today).
      await factorDialog
        .locator(
          `input[type="radio"][name="factor-${NUMBER_GROUP_INDEX}"][value="${NUMBER_VALUE}"]`
        )
        .check();
      await factorDialog
        .locator(
          `input[type="radio"][name="factor-${DURATION_GROUP_INDEX}"][value="${DURATION_VALUE}"]`
        )
        .check();

      // Sanity-check: exactly one radio per group is checked, and the
      // checked values are the ones we selected. This is the source of
      // truth that the dialog's `cast` callback will sum.
      const checkedValues = await factorDialog
        .locator('input[type="radio"]:checked')
        .evaluateAll(els => els.map(e => ({
          name: e.getAttribute('name'),
          value: Number(e.value)
        })));
      expect(checkedValues).toEqual([
        { name: `factor-${NUMBER_GROUP_INDEX}`, value: NUMBER_VALUE },
        { name: `factor-${DURATION_GROUP_INDEX}`, value: DURATION_VALUE }
      ]);

      // Confirm the factor dialog — DialogV2 renders the declared buttons
      // with `data-action="<action>"` attributes (action "cast" per
      // spell-casting.mjs:101).
      await factorDialog.locator('button[data-action="cast"]').click();
      await expect(factorDialog).toBeHidden();

      // Roll dialog opens with obstacle pre-filled from
      // `testContext.obstacle` (tb2e-roll.mjs:513-515).
      const dialog = new RollDialog(page);
      await dialog.waitForOpen();
      expect(await dialog.getPoolSize()).toBe(4);
      expect(await dialog.getObstacle()).toBe(EXPECTED_OBSTACLE);
      await dialog.submit();

      await expect
        .poll(
          () => page.evaluate(() => game.messages.contents.length),
          { timeout: 10_000 }
        )
        .toBeGreaterThan(initialChatCount);

      const card = new RollChatCard(page);
      await card.expectPresent();

      expect(await card.getPool()).toBe(4);
      await expect(card.diceResults).toHaveCount(4);
      expect(await card.getSuccesses()).toBe(4);
      expect(await card.getObstacle()).toBe(EXPECTED_OBSTACLE);
      expect(await card.isPass()).toBe(true);

      // Spell source on the card — templates/chat/roll-result.hbs:21-26
      // renders `.roll-card-spell` with the spell name.
      const spellLine = card.root.locator('.roll-card-spell');
      await expect(spellLine).toBeVisible();
      await expect(spellLine).toContainText(SPELL_NAME);

      // Flag-level proof: obstacle / spellName / castingSource. Scope to
      // this actor's most recent message to avoid cross-test leakage.
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
        baseDice: 4,
        poolSize: 4,
        successes: 4,
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
