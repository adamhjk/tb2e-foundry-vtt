import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §6 Spells — cast from a spellbook; chat card surfaces the spellbook as the
 * casting source (DH pp.99-100).
 *
 * Rules under test:
 *   - A `spellbook` is a distinct Item type (module/data/item/spellbook.mjs)
 *     with a `folios` capacity. An owned `spell` records its binding via
 *     `system.spellbookId` — the id of the spellbook Item on the same actor
 *     (module/data/item/spell.mjs:63 `spellbookId: StringField, initial: ""`).
 *   - `#prepareMagicContext` flips `canCast = true` for a spell whose
 *     `system.spellbookId` is truthy (`inSpellbook` branch at
 *     character-sheet.mjs:726-728), so the Magic-tab spell row renders the
 *     `castSpell` button (templates/actors/tabs/character-magic.hbs:44-47).
 *   - `#onCastSpell` pushes a `"spellbook"` source descriptor when
 *     `item.system.spellbookId` is truthy (character-sheet.mjs:1409). With
 *     no other source (spell not memorized, no scroll), the length-1 short-
 *     circuit at character-sheet.mjs:1418-1420 bypasses the source chooser
 *     and calls `castSpell(actor, spell, "spellbook")` with NO `opts`
 *     (character-sheet.mjs:1431-1433 — only scroll adds `scrollItemId`; the
 *     spellbook branch relies on the spell's own `spellbookId` field).
 *   - `castSpell` stamps
 *     `testContext = { spellId, spellName, castingSource: "spellbook",
 *     scrollItemId: null, ... }` and rolls Arcanist vs `fixedObstacle`
 *     (spell-casting.mjs:45-56).
 *   - On Finalize — when the roll passed — `processSpellCast` routes the
 *     spellbook branch at spell-casting.mjs:168-173: flips
 *     `spell.system.cast = true` and then posts a `spell-source` chat card
 *     via `_postSpellSourceCard` (spell-casting.mjs:187-241).
 *   - The spellbook branch of `_postSpellSourceCard` looks up the spellbook
 *     name via `actor.items.get(spell.system.spellbookId)` (spell-casting.mjs:
 *     201-204) and renders templates/chat/spell-source.hbs with the flavor
 *     text from lang/en.json:866 — `"{name} casts {spellName} from
 *     {spellbookName}. The ink burns away from the page."` (the user-visible
 *     proof that the spellbook is the source).
 *   - Clicking the card's `.spell-source-confirm` button runs
 *     `activateSpellSourceListeners` at spell-casting.mjs:263-265 and updates
 *     the spell with `system.spellbookId = ""` — the spell is NOT deleted;
 *     only its binding to the spellbook is severed (matching the "ink burns
 *     away from the page" flavor per DH p.100). The card then re-renders in
 *     the `{{#if resolved}}` branch of spell-source.hbs:10-16.
 *
 * Delta from scroll-one-use:
 *   - No separate Item to delete — instead a field update on the spell.
 *   - No `opts.scrollItemId`: the spell's own `spellbookId` is the pointer
 *     (testContext.scrollItemId stays null per spell-casting.mjs:49).
 *   - `processSpellCast` spellbook branch gates on `passed` (spell-casting.mjs:
 *     161) whereas scrolls burn regardless — so we assert the PASS path.
 *
 * Narrow scope — out of scope:
 *   - Spellbook item-sheet editing, adding/removing spells from spellbooks
 *     via UI, folio capacity enforcement (separate concerns).
 *   - Multi-source chooser dialog (covered implicitly by scroll-one-use's
 *     single-source short-circuit; the chooser itself is a distinct path).
 *   - skillSwap / factor / versus casting types (sibling §6 specs).
 *   - Failure path — processSpellCast only mutates on pass for spellbook
 *     per spell-casting.mjs:161, and asserting the no-op adds noise.
 */
const SPELL_NAME = 'Beast Cloak';
const SPELL_ID = 'a1b2c3d4e5f63003'; // packs/_source/spells/beast-cloak.yml
const SPELLS_PACK = 'tb2e.spells';
const EXPECTED_OBSTACLE = 3; // beast-cloak.yml — fixedObstacle

test.describe('§6 Spells — cast from spellbook (source)', () => {
  test.afterEach(async ({ page }) => {
    // Clean up the PRNG stub so downstream specs see real randomness.
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });
  });

  test('casts Beast Cloak from a spellbook → card shows spellbook name; Remove from Spellbook clears binding', async ({ page }) => {
    const actorName = `E2E Spellbook Source ${Date.now()}`;
    const SPELLBOOK_NAME = `Tome of Trials ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Stage character: Arcanist 3, fresh=false (no +1D fresh bonus).
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

    // Create a spellbook Item on the actor. Spellbooks use the standard
    // inventory fields (module/data/item/spellbook.mjs) — we don't need to
    // slot it; the spellbookId linkage is what matters.
    const spellbookItemId = await page.evaluate(
      async ({ id, bookName }) => {
        const actor = game.actors.get(id);
        const [created] = await actor.createEmbeddedDocuments('Item', [{
          name: bookName,
          type: 'spellbook',
          img: 'icons/sundries/books/book-worn-brown-gold.webp',
          system: { folios: 5 }
        }]);
        return created.id;
      },
      { id: actorId, bookName: SPELLBOOK_NAME }
    );
    expect(spellbookItemId).toBeTruthy();

    // Embed the spell from the compendium, bound to the spellbook.
    // memorized=false so spellbook is the ONLY source (#onCastSpell takes
    // the length-1 short-circuit). Zero materials/focus so the dice pool is
    // exactly the Arcanist rating (spell-casting.mjs:27-43).
    const spellItemId = await page.evaluate(
      async ({ id, packId, entryId, bookId }) => {
        const actor = game.actors.get(id);
        const pack = game.packs.get(packId);
        const src = await pack.getDocument(entryId);
        const data = src.toObject();
        data.system.memorized = false;
        data.system.materials = '';
        data.system.focus = '';
        data.system.cast = false;
        data.system.spellbookId = bookId;
        const [created] = await actor.createEmbeddedDocuments('Item', [data]);
        return created.id;
      },
      { id: actorId, packId: SPELLS_PACK, entryId: SPELL_ID, bookId: spellbookItemId }
    );
    expect(spellItemId).toBeTruthy();

    // Sanity-check initial state.
    const initialState = await page.evaluate(
      ({ id, iid, bid }) => {
        const actor = game.actors.get(id);
        const spell = actor.items.get(iid);
        const book = actor.items.get(bid);
        return {
          spell: spell ? {
            name: spell.name,
            castingType: spell.system.castingType,
            fixedObstacle: spell.system.fixedObstacle,
            memorized: spell.system.memorized,
            cast: spell.system.cast,
            spellbookId: spell.system.spellbookId
          } : null,
          spellbook: book ? {
            type: book.type,
            name: book.name
          } : null
        };
      },
      { id: actorId, iid: spellItemId, bid: spellbookItemId }
    );
    expect(initialState).toEqual({
      spell: {
        name: SPELL_NAME,
        castingType: 'fixed',
        fixedObstacle: EXPECTED_OBSTACLE,
        memorized: false,
        cast: false,
        spellbookId: spellbookItemId
      },
      spellbook: { type: 'spellbook', name: SPELLBOOK_NAME }
    });

    // PRNG stub: u=0.001 ⇒ ceil((1-0.001)*6) = 6 on every die ⇒ 3D PASS.
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

      // The cast button is rendered on the spell row — canCast flips true
      // via the inSpellbook branch at character-sheet.mjs:726-728.
      const spellRow = sheet.spellRow(spellItemId);
      await expect(spellRow).toBeVisible();
      const castButton = spellRow.locator('button[data-action="castSpell"]');
      await expect(castButton).toBeVisible();

      const initialChatCount = await page.evaluate(
        () => game.messages.contents.length
      );

      await castButton.click();

      // Only one source (spellbook) ⇒ no chooser dialog (character-sheet.mjs:
      // 1418-1420). Roll dialog opens directly with obstacle pre-filled.
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

      const card = new RollChatCard(page);
      await card.expectPresent();
      expect(await card.getPool()).toBe(3);
      await expect(card.diceResults).toHaveCount(3);
      expect(await card.getSuccesses()).toBe(3);
      expect(await card.getObstacle()).toBe(EXPECTED_OBSTACLE);
      expect(await card.isPass()).toBe(true);

      // Spell label on the roll card (roll-result.hbs `.roll-card-spell`).
      const spellLine = card.root.locator('.roll-card-spell');
      await expect(spellLine).toBeVisible();
      await expect(spellLine).toContainText(SPELL_NAME);

      // Flag-level proof: castingSource="spellbook", scrollItemId null
      // (spell-casting.mjs:45-51).
      const rollFlags = await page.evaluate((id) => {
        const msg = game.messages.contents
          .filter(m => m.flags?.tb2e?.actorId === id && m.flags?.tb2e?.roll)
          .at(-1);
        const tb = msg?.flags?.tb2e;
        return tb ? {
          pass: tb.roll.pass,
          spellId: tb.testContext?.spellId ?? null,
          spellName: tb.testContext?.spellName ?? null,
          castingSource: tb.testContext?.castingSource ?? null,
          scrollItemId: tb.testContext?.scrollItemId ?? null
        } : null;
      }, actorId);
      expect(rollFlags).toEqual({
        pass: true,
        spellId: spellItemId,
        spellName: SPELL_NAME,
        castingSource: 'spellbook',
        scrollItemId: null
      });

      // Pre-Finalize: no state mutation yet — processSpellCast fires in
      // _handleFinalize (post-roll.mjs).
      const preFinalize = await page.evaluate(
        ({ id, iid }) => {
          const actor = game.actors.get(id);
          const spell = actor.items.get(iid);
          return {
            cast: spell?.system.cast,
            spellbookId: spell?.system.spellbookId
          };
        },
        { id: actorId, iid: spellItemId }
      );
      expect(preFinalize).toEqual({ cast: false, spellbookId: spellbookItemId });

      // Finalize → processSpellCast spellbook branch (spell-casting.mjs:
      // 168-173). Posts the spell-source card with "Remove from Spellbook"
      // button and flips spell.system.cast=true. Binding NOT yet cleared.
      await card.clickFinalize();

      await expect
        .poll(
          () => page.evaluate((id) => {
            return game.messages.contents.some(
              m => m.flags?.tb2e?.spellSource?.type === 'spellbook'
                && m.flags.tb2e.spellSource.actorId === id
            );
          }, actorId),
          { timeout: 10_000 }
        )
        .toBe(true);

      // Source card flags include the spellbook name (spell-casting.mjs:236).
      const sourceCardFlags = await page.evaluate((id) => {
        const msg = game.messages.contents
          .filter(m => m.flags?.tb2e?.spellSource?.actorId === id
            && m.flags.tb2e.spellSource.type === 'spellbook')
          .at(-1);
        const s = msg?.flags?.tb2e?.spellSource;
        return s ? {
          type: s.type,
          actorId: s.actorId,
          spellId: s.spellId,
          spellName: s.spellName,
          spellbookName: s.spellbookName,
          scrollItemId: s.scrollItemId,
          resolved: s.resolved ?? false
        } : null;
      }, actorId);
      expect(sourceCardFlags).toEqual({
        type: 'spellbook',
        actorId,
        spellId: spellItemId,
        spellName: SPELL_NAME,
        spellbookName: SPELLBOOK_NAME,
        scrollItemId: null,
        resolved: false
      });

      // DOM-level: the card body text includes the spellbook name
      // (templates/chat/spell-source.hbs:19 — flavorText from
      // lang/en.json:866 "TB2E.Spell.SpellbookSourceText"). This is the
      // user-visible surface of the spellbook as casting source.
      const sourceCard = page.locator('.chat-message').filter({
        has: page.locator('.spell-source-confirm')
      }).last();
      await expect(sourceCard).toBeVisible();
      await expect(sourceCard).toContainText(SPELLBOOK_NAME);
      await expect(sourceCard).toContainText(SPELL_NAME);

      // Post-Finalize: spell flagged cast; binding to spellbook still intact
      // until the player confirms.
      const postFinalize = await page.evaluate(
        ({ id, iid }) => {
          const actor = game.actors.get(id);
          const spell = actor.items.get(iid);
          return {
            cast: spell?.system.cast,
            spellbookId: spell?.system.spellbookId
          };
        },
        { id: actorId, iid: spellItemId }
      );
      expect(postFinalize).toEqual({ cast: true, spellbookId: spellbookItemId });

      // Click "Remove from Spellbook". Same native-click pattern as the
      // scroll spec — the handler is a plain addEventListener in
      // activateSpellSourceListeners (spell-casting.mjs:255-288), so
      // button.click() dispatches the production code path.
      const confirmButton = sourceCard.locator('button.spell-source-confirm');
      await expect(confirmButton).toBeVisible();
      await confirmButton.evaluate(btn => btn.click());

      // After confirm: spell.system.spellbookId cleared (spell-casting.mjs:
      // 263-265). Spell Item itself remains — only the binding breaks.
      await expect
        .poll(
          () => page.evaluate(
            ({ id, iid }) => {
              const spell = game.actors.get(id).items.get(iid);
              return spell?.system.spellbookId ?? null;
            },
            { id: actorId, iid: spellItemId }
          ),
          { timeout: 10_000 }
        )
        .toBe('');

      // Spell Item still exists; spellbook Item still exists.
      const afterConfirm = await page.evaluate(
        ({ id, iid, bid }) => {
          const actor = game.actors.get(id);
          return {
            spellExists: !!actor.items.get(iid),
            spellbookExists: !!actor.items.get(bid)
          };
        },
        { id: actorId, iid: spellItemId, bid: spellbookItemId }
      );
      expect(afterConfirm).toEqual({ spellExists: true, spellbookExists: true });

      // Card flipped to resolved (spell-casting.mjs:275).
      const resolvedFlag = await page.evaluate((id) => {
        const msg = game.messages.contents
          .filter(m => m.flags?.tb2e?.spellSource?.actorId === id
            && m.flags.tb2e.spellSource.type === 'spellbook')
          .at(-1);
        return msg?.flags?.tb2e?.spellSource?.resolved ?? null;
      }, actorId);
      expect(resolvedFlag).toBe(true);
    } finally {
      await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
    }
  });
});
