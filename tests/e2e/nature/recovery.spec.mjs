import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §11 Nature Crisis — RESOLVE path (DH p.119).
 *
 * This spec is the second half of §11. The first checkbox
 * (`tests/e2e/nature/crisis-triggered.spec.mjs`, TEST_PLAN line 343) asserted
 * the PENDING crisis-card shape (flags, DOM, select options) and explicitly
 * deferred the resolve click to this file. Here we exercise the resolve
 * click path and assert every observable effect of the handler.
 *
 * Resolve handler (module/dice/post-roll.mjs `activateNatureCrisisListeners`
 * lines 639-708):
 *   1. Reads `.crisis-trait-select` value (trait itemId) and
 *      `.crisis-new-name` value (new trait name) from the DOM (lines 654-658).
 *   2. Refuses if either is empty (line 660-663).
 *   3. **Renames the selected trait** — `traitItem.update({ name: newName })`
 *      (line 668). Note: the trait is RENAMED in place; it is NOT deleted
 *      and a new Item is NOT created. Level, beneficial, checks, and isClass
 *      are preserved.
 *   4. Reduces `abilities.nature.max` by 1 (line 671, clamped to >=0) and
 *      sets `rating = newMax` (line 674), `pass = 0`, `fail = 0`
 *      (lines 675-676). Per DH p.119: "Maximum Nature is reduced by 1 and
 *      all advancement progress is lost."
 *   5. Sets `flags.tb2e.crisisResolved: true` on the chat message (line 680).
 *   6. Re-renders the card with `resolved: true, replacedTrait: newName,
 *      newMax, isRetired: newMax === 0` (lines 692-706). The resolved branch
 *      of `templates/chat/nature-crisis.hbs` (lines 10-24) renders
 *      `.crisis-resolved`, the DH p. 68 reference bar, and the
 *      `.card-banner.banner-amber` (Resolved or Retired).
 *
 * Staging mirrors line 343 (the crisis-triggered spec) so the observed
 * crisis card is structurally identical. Nature rating=1, max=4 so that
 * after resolve: max=3, rating=3 (nontrivially non-zero, non-retired). One
 * non-class trait "Curious" so the select has exactly one real option and
 * picking it is unambiguous.
 *
 * Scope (narrow, per briefing):
 *   - DO assert: crisisResolved flag set, nature.max decremented, nature.
 *     rating restored to newMax, pass/fail zeroed, trait renamed (not
 *     replaced), card transitioned from pending to resolved (confirm button
 *     gone, .crisis-resolved + banner present).
 *   - DO NOT re-test the pending-card shape (line 343) — only sanity-check
 *     that the pending card exists before we click confirm.
 *   - DO NOT test `conserveNature` / `recoverNature` (§2 line 120) — those
 *     are sheet-driven and unrelated to the crisis-card resolve path.
 */
test.describe('§11 Nature Crisis — recovery via crisis-card resolve (DH p.119)', () => {
  test.afterEach(async ({ page }) => {
    // Restore PRNG so subsequent specs on a shared Page get real randomness.
    // Same pattern as crisis-triggered.spec.mjs / nature-tax-decrement.spec.mjs.
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });
  });

  test('resolve click renames trait, decrements max, restores rating, transitions card (DH p.119)', async ({ page }) => {
    const actorName = `E2E Nature Crisis Resolve ${Date.now()}`;
    const newTraitName = `Pariah ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Will 2, Nature 1/4 → tax-to-0 trigger lands rating at 0 (same shape
    // as line 343). Persona 1 to afford Channel Your Nature. One non-class
    // trait so the select renders one eligible option; no class trait noise
    // required here since line 343 already covered the isClass filter.
    const { actorId, traitId } = await page.evaluate(async (n) => {
      const actor = await Actor.create({
        name: n,
        type: 'character',
        system: {
          abilities: {
            will:   { rating: 2, pass: 0, fail: 0 },
            health: { rating: 3, pass: 0, fail: 0 },
            nature: { rating: 1, max: 4, pass: 0, fail: 0 }
          },
          persona: { current: 1, spent: 0 },
          fate:    { current: 0, spent: 0 },
          conditions: { fresh: false }
        }
      });
      const [trait] = await actor.createEmbeddedDocuments('Item', [
        // Pre-resolve level=2 with beneficial/checks set — we assert these
        // carry through the rename (the handler's `item.update({ name })`
        // only touches `name`, per post-roll.mjs line 668).
        { name: 'Curious', type: 'trait', system: { level: 2, beneficial: 1, checks: 0, isClass: false } }
      ]);
      return { actorId: actor.id, traitId: trait.id };
    }, actorName);
    expect(actorId).toBeTruthy();
    expect(traitId).toBeTruthy();

    // Stub: every d6 rolls 6 (success). Will 2 + Nature 1 (channel) = 3D,
    // Ob 2 → PASS → calculateNatureTax on pass = 1 → rating 1 → 0 →
    // `_postNatureCrisis` runs.
    await page.evaluate(() => {
      globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => 0.001;
    });

    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, actorId);

    const sheet = new CharacterSheet(page, actorName);
    await sheet.expectOpen();
    await sheet.openAbilitiesTab();

    await sheet.rollAbilityRow('will').click();

    const dialog = new RollDialog(page);
    await dialog.waitForOpen();
    await dialog.toggleChannelNature();
    await dialog.fillObstacle(2);
    await dialog.submit();

    const card = new RollChatCard(page);
    await card.expectPresent();
    await expect(card.natureTaxPrompt).toBeVisible();

    const beforeCrisisMsgCount = await page.evaluate(() => game.messages.contents.length);

    await card.clickNatureTaxNo();

    // Wait for the crisis card to post (actor-scoped to avoid shared-page
    // contamination — mirrors line 343's query pattern).
    await expect
      .poll(() =>
        page.evaluate(() => game.messages.contents.length), { timeout: 10_000 }
      )
      .toBeGreaterThan(beforeCrisisMsgCount);

    const crisisMessageId = await page.evaluate((id) => {
      const m = game.messages.contents
        .filter(msg => msg.flags?.tb2e?.natureCrisis && msg.flags?.tb2e?.actorId === id)
        .at(-1);
      return m?.id ?? null;
    }, actorId);
    expect(crisisMessageId).toBeTruthy();

    // Sanity pre-resolve state (matches line 343's final assertions —
    // just enough to establish the baseline we're transitioning FROM).
    const natureBeforeResolve = await page.evaluate((id) => {
      const n = game.actors.get(id).system.abilities.nature;
      return { rating: n.rating, max: n.max, pass: n.pass, fail: n.fail };
    }, actorId);
    expect(natureBeforeResolve).toEqual({ rating: 0, max: 4, pass: 0, fail: 0 });

    // Locate the crisis card (scope by message id + actor id — same
    // scoping idiom as line 343).
    const crisisCard = page.locator(
      `.chat-message[data-message-id="${crisisMessageId}"] .tb2e-chat-card[data-actor-id="${actorId}"]`
    ).first();
    await expect(crisisCard).toBeVisible();
    // Pending state sanity: confirm button present, resolved banner NOT.
    await expect(crisisCard.locator('button.nature-crisis-confirm')).toBeVisible();
    await expect(crisisCard.locator('.crisis-resolved')).toHaveCount(0);
    await expect(crisisCard.locator('.card-banner.banner-amber')).toHaveCount(0);

    // Fill the form and click confirm.
    await crisisCard.locator('.crisis-trait-select').selectOption(traitId);
    await crisisCard.locator('input.crisis-new-name').fill(newTraitName);
    await crisisCard.locator('button.nature-crisis-confirm').click();

    // Assert 1: crisisResolved flag flipped on the message
    // (post-roll.mjs line 680).
    await expect
      .poll(() =>
        page.evaluate((mid) => !!game.messages.get(mid)?.flags?.tb2e?.crisisResolved, crisisMessageId),
        { timeout: 10_000 }
      )
      .toBe(true);

    // Assert 2: nature mutation — max decremented by 1, rating reset to
    // newMax, pass/fail zeroed (post-roll.mjs lines 671-677).
    await expect
      .poll(() =>
        page.evaluate((id) => {
          const n = game.actors.get(id).system.abilities.nature;
          return { rating: n.rating, max: n.max, pass: n.pass, fail: n.fail };
        }, actorId),
        { timeout: 10_000 }
      )
      .toEqual({ rating: 3, max: 3, pass: 0, fail: 0 });

    // Assert 3: trait RENAMED in place (not deleted, not re-created).
    // `traitItem.update({ name: newName })` at post-roll.mjs line 668
    // only touches `name` — level/beneficial/checks/isClass are preserved.
    // Item count unchanged (1 trait before, 1 trait after).
    const traitAfter = await page.evaluate(({ id, tid }) => {
      const actor = game.actors.get(id);
      const traits = actor.itemTypes.trait || [];
      const sameItem = actor.items.get(tid);
      return {
        traitCount: traits.length,
        sameItemName: sameItem?.name ?? null,
        sameItemLevel: sameItem?.system?.level ?? null,
        sameItemBeneficial: sameItem?.system?.beneficial ?? null,
        sameItemIsClass: sameItem?.system?.isClass ?? null
      };
    }, { id: actorId, tid: traitId });
    expect(traitAfter).toEqual({
      traitCount: 1,
      sameItemName: newTraitName,
      sameItemLevel: 2,
      sameItemBeneficial: 1,
      sameItemIsClass: false
    });

    // Assert 4: card DOM transitioned to resolved branch. The pending form
    // is gone (template line 10 `{{#if resolved}}` renders the .crisis-
    // resolved block instead of .crisis-form), the confirm button is gone,
    // and the amber Resolved banner is present (templates/chat/nature-
    // crisis.hbs lines 11-24). Scope to the same message id so we pick
    // the re-rendered content.
    const resolvedCard = page.locator(
      `.chat-message[data-message-id="${crisisMessageId}"] .tb2e-chat-card[data-actor-id="${actorId}"]`
    ).first();
    await expect(resolvedCard.locator('.crisis-resolved')).toBeVisible();
    await expect(resolvedCard.locator('.card-banner.banner-amber')).toBeVisible();
    await expect(resolvedCard.locator('button.nature-crisis-confirm')).toHaveCount(0);
    await expect(resolvedCard.locator('.crisis-form')).toHaveCount(0);

    // Resolved body text cites the new trait name and new max — sanity
    // check the template got the right interpolation values (template
    // line 12: "Trait replaced with <strong>{{replacedTrait}}</strong>.
    // Nature max is now {{newMax}}.").
    const resolvedText = await resolvedCard.locator('.crisis-resolved .crisis-text').innerText();
    expect(resolvedText).toContain(newTraitName);
    expect(resolvedText).toContain('Nature max is now 3');

    // Banner says "Resolved" (not "Retired" — newMax=3, not 0; template
    // line 19-23 branches on `isRetired`).
    const banner = resolvedCard.locator('.card-banner.banner-amber');
    await expect(banner).toContainText('Resolved');
    // No retirement copy on a non-retiring resolve.
    await expect(resolvedCard.locator('.crisis-retirement')).toHaveCount(0);

    // Cleanup — delete the actor; leaves the chat messages in place (scoped
    // by actorId + Date.now() suffix so they're harmless for other specs).
    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });
});
