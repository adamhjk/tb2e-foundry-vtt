import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §6 Spells — cast from a scroll; verify scroll is consumed (DH p.116).
 *
 * Rules under test:
 *   - A scroll is a separate Item type (`scroll`) whose data model carries a
 *     `spellId` pointing at the spell it bottles (module/data/item/scroll.mjs:9).
 *   - The spell row on the Magic tab renders the `castSpell` button when
 *     `canCast` is true — that flag becomes true if the spell is memorized,
 *     has a spellbookId, is skillSwap, OR the actor owns a scroll for that
 *     spell (character-sheet.mjs:725-728).
 *   - `#onCastSpell` collects available sources; when the only source is a
 *     scroll (no memorization, no spellbook), it bypasses the source chooser
 *     and passes `opts.scrollItemId = scrollsForSpell[0].id` into `castSpell`
 *     (character-sheet.mjs:1410-1411, 1418-1420, 1431-1433).
 *   - `castSpell(actor, spell, "scroll", { scrollItemId })` stamps
 *     `testContext = { spellId, spellName, castingSource: "scroll",
 *     scrollItemId }` and rolls Arcanist vs the spell's fixedObstacle
 *     (spell-casting.mjs:45-56).
 *   - On Finalize, `_handleFinalize` → `processSpellCast` routes the scroll
 *     branch FIRST (before the pass gate), marking `spell.system.cast = true`
 *     and posting a `spell-source` chat card with a "Consume Scroll" button
 *     (spell-casting.mjs:148-158, post-roll.mjs:575-579). Scrolls are consumed
 *     whether the roll passed or failed per the code.
 *   - Clicking the card's `.spell-source-confirm` button deletes the scroll
 *     Item from the actor (spell-casting.mjs:255-262).
 *
 * Implementation map:
 *   - `castSpell` button on spell row — templates/actors/tabs/character-magic.hbs:44-47
 *   - Scroll section — templates/actors/tabs/character-magic.hbs:119-135
 *   - Spell-source card template — templates/chat/spell-source.hbs
 *   - Button wired via `activateSpellSourceListeners` in tb2e.mjs:161 →
 *     spell-casting.mjs:248-289.
 *
 * Source spell: `Beast Cloak` (packs/_source/spells/beast-cloak.yml,
 * `_id: a1b2c3d4e5f63003`) — fixed Ob 3, castingType "fixed". We copy the
 * compendium entry onto the actor with `memorized=false`, `materials=""`,
 * `focus=""` so (a) scroll is the ONLY available source (no chooser dialog),
 * and (b) the dice pool equals the Arcanist rating exactly (no +1D from
 * materials/focus; see spell-casting.mjs:27-43).
 *
 * Then a `scroll` Item is created on the actor with `system.spellId =
 * <spellItemId>` — mirroring what `#onAddScroll` at character-sheet.mjs:
 * 1312-1340 does (`type: "scroll", system.spellId`).
 *
 * Dice determinism: same PRNG stub as other §6 specs — u=0.001 ⇒ every d6
 * face is 6, so Arcanist rating 3 vs Ob 3 is a deterministic PASS.
 *
 * Narrow scope — out of scope:
 *   - Spellbook source (separate checkbox, spell/spellbook-source.spec.mjs).
 *   - skillSwap, versus, factor casting (covered by sibling §6 specs).
 *   - Multi-scroll inventory / quantity > 1 (scrolls today are single-use
 *     binary per DH p.116 and the code deletes the whole Item on confirm).
 *   - Scroll item-sheet edit UI.
 */
const SPELL_NAME = 'Beast Cloak';
const SPELL_ID = 'a1b2c3d4e5f63003'; // packs/_source/spells/beast-cloak.yml
const SPELLS_PACK = 'tb2e.spells';
const EXPECTED_OBSTACLE = 3; // beast-cloak.yml:9 — fixedObstacle

test.describe('§6 Spells — cast from scroll (one use)', () => {
  test.afterEach(async ({ page }) => {
    // Clean up the PRNG stub installed below so downstream specs see real
    // randomness (same pattern as cast-fixed-obstacle).
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });
  });

  test('casts Beast Cloak from a scroll → card marked; Consume Scroll deletes the scroll Item', async ({ page }) => {
    const actorName = `E2E Spell Scroll Cast ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Stage character: Arcanist 3, fresh=false to avoid +1D, nature sized
    // high so no nature-tax surprises (channel is off by default anyway).
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

    // Embed the spell from the compendium, but DO NOT memorize it — the
    // scroll is the only source, which means `#onCastSpell` bypasses the
    // source chooser (character-sheet.mjs:1418-1420). Zero materials/focus
    // so the pool is exactly the Arcanist rating (spell-casting.mjs:27-43).
    const spellItemId = await page.evaluate(
      async ({ id, packId, entryId }) => {
        const actor = game.actors.get(id);
        const pack = game.packs.get(packId);
        const src = await pack.getDocument(entryId);
        const data = src.toObject();
        data.system.memorized = false;
        data.system.materials = '';
        data.system.focus = '';
        data.system.cast = false;
        data.system.spellbookId = '';
        const [created] = await actor.createEmbeddedDocuments('Item', [data]);
        return created.id;
      },
      { id: actorId, packId: SPELLS_PACK, entryId: SPELL_ID }
    );
    expect(spellItemId).toBeTruthy();

    // Create a scroll Item pointing at the embedded spell. Mirrors the
    // runtime shape of `#onAddScroll` at character-sheet.mjs:1312-1340.
    const scrollItemId = await page.evaluate(
      async ({ id, sid, spellName }) => {
        const actor = game.actors.get(id);
        const [created] = await actor.createEmbeddedDocuments('Item', [{
          name: `Scroll of ${spellName}`,
          type: 'scroll',
          img: 'icons/sundries/scrolls/scroll-bound-ruby-red.webp',
          system: { spellId: sid }
        }]);
        return created.id;
      },
      { id: actorId, sid: spellItemId, spellName: SPELL_NAME }
    );
    expect(scrollItemId).toBeTruthy();

    // Sanity-check initial state: spell not memorized, not cast, and the
    // scroll references it.
    const initialState = await page.evaluate(
      ({ id, iid, sid }) => {
        const actor = game.actors.get(id);
        const spell = actor.items.get(iid);
        const scroll = actor.items.get(sid);
        return {
          spell: spell ? {
            name: spell.name,
            castingType: spell.system.castingType,
            fixedObstacle: spell.system.fixedObstacle,
            memorized: spell.system.memorized,
            cast: spell.system.cast
          } : null,
          scroll: scroll ? {
            type: scroll.type,
            spellId: scroll.system.spellId
          } : null
        };
      },
      { id: actorId, iid: spellItemId, sid: scrollItemId }
    );
    expect(initialState).toEqual({
      spell: {
        name: SPELL_NAME,
        castingType: 'fixed',
        fixedObstacle: EXPECTED_OBSTACLE,
        memorized: false,
        cast: false
      },
      scroll: { type: 'scroll', spellId: spellItemId }
    });

    // PRNG stub: u=0.001 ⇒ Math.ceil((1-0.001)*6) = 6 on every die ⇒ 3D PASS.
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

      // The cast button is rendered on the SPELL row (not on the scroll row
      // — templates/actors/tabs/character-magic.hbs:44-47 only emits
      // `castSpell` inside `.spell-actions`). `canCast` is true here via the
      // scroll-count branch at character-sheet.mjs:725-728.
      const spellRow = sheet.spellRow(spellItemId);
      await expect(spellRow).toBeVisible();
      const castButton = spellRow.locator('button[data-action="castSpell"]');
      await expect(castButton).toBeVisible();

      // Scroll section shows the scroll card pre-cast. The template emits
      // `.scroll-card` inside `.scrolls-section` (character-magic.hbs:120-131).
      const scrollsSection = sheet.root.locator(
        'section[data-tab="magic"] fieldset.scrolls-section'
      );
      await expect(scrollsSection.locator('.scroll-card')).toHaveCount(1);

      const initialChatCount = await page.evaluate(
        () => game.messages.contents.length
      );

      await castButton.click();

      // Only one source (scroll) ⇒ no chooser dialog (character-sheet.mjs:
      // 1418-1420). The roll dialog opens directly with obstacle pre-filled
      // from testContext.obstacle.
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

      // Spell source on the roll card.
      const spellLine = card.root.locator('.roll-card-spell');
      await expect(spellLine).toBeVisible();
      await expect(spellLine).toContainText(SPELL_NAME);

      // Flag-level proof: the roll message carries castingSource: "scroll"
      // and the scroll's id in testContext (spell-casting.mjs:45-51).
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
        castingSource: 'scroll',
        scrollItemId
      });

      // Pre-Finalize: no state mutation yet — processSpellCast fires in
      // _handleFinalize (post-roll.mjs:575-579).
      const preFinalize = await page.evaluate(
        ({ id, iid, sid }) => {
          const actor = game.actors.get(id);
          return {
            spellCast: actor.items.get(iid)?.system.cast,
            scrollExists: !!actor.items.get(sid)
          };
        },
        { id: actorId, iid: spellItemId, sid: scrollItemId }
      );
      expect(preFinalize).toEqual({ spellCast: false, scrollExists: true });

      // Finalize → processSpellCast scroll branch (spell-casting.mjs:153-158).
      // This (a) sets spell.system.cast=true and (b) posts a spell-source
      // confirmation chat card. The scroll is NOT deleted yet — the player
      // has to click "Consume Scroll".
      await card.clickFinalize();

      await expect
        .poll(
          () => page.evaluate((id) => {
            return game.messages.contents.some(
              m => m.flags?.tb2e?.spellSource?.type === 'scroll'
                && m.flags.tb2e.spellSource.actorId === id
            );
          }, actorId),
          { timeout: 10_000 }
        )
        .toBe(true);

      // Spell marked cast; scroll still present.
      const postFinalize = await page.evaluate(
        ({ id, iid, sid }) => {
          const actor = game.actors.get(id);
          return {
            spellCast: actor.items.get(iid)?.system.cast,
            scrollExists: !!actor.items.get(sid)
          };
        },
        { id: actorId, iid: spellItemId, sid: scrollItemId }
      );
      expect(postFinalize).toEqual({ spellCast: true, scrollExists: true });

      // Find the spell-source card and click "Consume Scroll". The card
      // template is templates/chat/spell-source.hbs; its confirm button is
      // `.spell-source-confirm` (spell-casting.mjs:252) — wired via
      // `activateSpellSourceListeners` (tb2e.mjs:161). We scope by the
      // tb2e flag to avoid picking up other cards.
      const sourceCard = page.locator('.chat-message').filter({
        has: page.locator('.spell-source-confirm')
      }).last();
      await expect(sourceCard).toBeVisible();
      const confirmButton = sourceCard.locator('button.spell-source-confirm');
      await expect(confirmButton).toBeVisible();

      // Native click dispatch — same pattern RollChatCard uses for
      // Finalize/Fate buttons because the chat log's inner overflow scroller
      // can confuse Playwright's viewport math on the sidebar (see
      // RollChatCard.clickFinalize comments). The button's click handler is
      // wired via plain addEventListener in activateSpellSourceListeners
      // (spell-casting.mjs:255-288), so button.click() exercises the
      // production code path.
      await confirmButton.evaluate(btn => btn.click());

      // After consumption: scroll Item deleted from actor, card re-rendered
      // as resolved. The confirm button should disappear (template branch
      // `{{#if resolved}}` in spell-source.hbs:10-16 omits the action row).
      await expect
        .poll(
          () => page.evaluate(
            ({ id, sid }) => !!game.actors.get(id).items.get(sid),
            { id: actorId, sid: scrollItemId }
          ),
          { timeout: 10_000 }
        )
        .toBe(false);

      // Flag-level: the source card's `resolved` flag flips to true
      // (spell-casting.mjs:275).
      const resolvedFlag = await page.evaluate((id) => {
        const msg = game.messages.contents
          .filter(m => m.flags?.tb2e?.spellSource?.actorId === id
            && m.flags.tb2e.spellSource.type === 'scroll')
          .at(-1);
        return msg?.flags?.tb2e?.spellSource?.resolved ?? null;
      }, actorId);
      expect(resolvedFlag).toBe(true);

      // And the sheet re-render drops the scroll card from the Scrolls
      // section (the context only includes `scroll` Items still on the
      // actor — character-sheet.mjs:702, 788-798).
      await expect(scrollsSection.locator('.scroll-card')).toHaveCount(0);
    } finally {
      await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
    }
  });
});
