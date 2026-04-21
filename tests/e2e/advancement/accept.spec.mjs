import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';
import { AdvancementDialog } from '../pages/AdvancementDialog.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §4 Advancement — accept the advancement prompt.
 *
 * Builds on `tests/e2e/advancement/auto-trigger.spec.mjs` which exercised the
 * opening path. This spec drives the "Advance" button and asserts the actor
 * mutation performed by the dialog's accept handler.
 *
 * Source mechanics (cited for review traceability):
 *   - DH p.84 — Rating N advances at N passes + N-1 fails. Encoded by
 *     `advancementNeeded` in module/config.mjs:89-94 as
 *     { pass: rating, fail: Math.max(rating - 1, 0) }.
 *   - module/dice/advancement.mjs:54 — `if (!result) return;` short-circuits
 *     on Cancel. Accept returns `true` (advancement.mjs:43) so the handler
 *     below runs.
 *   - module/dice/advancement.mjs:57-61 — the accept mutation writes exactly
 *     three fields onto the actor:
 *       rating → currentRating + 1
 *       pass   → 0
 *       fail   → 0
 *     i.e. a hard reset to zero, NOT overflow carry. (Nature has additional
 *     branches at lines 64-67 but this spec exercises the skill path.)
 *   - module/dice/advancement.mjs:72-85 — after `actor.update`, a celebration
 *     chat card (`templates/chat/advancement-result.hbs`) is posted with
 *     speaker-scoped to the actor. No `flags.tb2e.actorId` is set on the
 *     card, but `speaker.actor === <actorId>` is populated via
 *     `ChatMessage.getSpeaker({ actor })` at advancement.mjs:82 — we use that
 *     to scope the assertion without relying on stale message order.
 *   - module/dice/post-roll.mjs:560-566 → module/dice/roll-utils.mjs
 *     (`logAdvancementForSide`) → module/dice/tb2e-roll.mjs:192-203
 *     (`_logAdvancement`). Pip tick happens BEFORE the dialog opens, so
 *     the dialog's `getCurrentRating()` reflects the pre-accept rating.
 *
 * Dice determinism: `CONFIG.Dice.randomUniform = () => 0.001` forces every
 * d6 to a 6, so a 2D pool vs Ob 1 is a deterministic PASS with 2 successes.
 * (`Math.ceil((1 - 0.001) * 6) = 6`.) Same recipe as the §3 roll specs and
 * auto-trigger.spec.mjs.
 */
test.describe('§4 Advancement — accept', () => {
  test.afterEach(async ({ page }) => {
    // Restore the dice PRNG so this spec's stub does not leak into other
    // tests sharing the same Foundry world (see auto-trigger.spec.mjs).
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });
  });

  test('Advance button bumps rating +1 and resets pips to 0', async ({ page }) => {
    const actorName = `E2E Advance Accept ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Stage Fighter at rating 2, pass:1, fail:1 — exactly one pass-pip below
    // the (2P, 1F) threshold for rating 2 (DH p.84). The stubbed PASS roll
    // ticks pass 1 → 2 inside _logAdvancement (tb2e-roll.mjs:197-202), which
    // meets both thresholds and opens the dialog.
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
            fighter: { rating: 2, pass: 1, fail: 1, learning: 0 }
          },
          // Data-model default `conditions.fresh = true` would add +1D via
          // gatherConditionModifiers (DH p.85); disabling it keeps the pool
          // at exactly the Fighter rating (2D).
          conditions: { fresh: false }
        }
      });
      return actor.id;
    }, actorName);
    expect(actorId).toBeTruthy();

    await page.evaluate(() => {
      globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => 0.001;
    });

    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, actorId);

    const sheet = new CharacterSheet(page, actorName);
    await sheet.expectOpen();
    await sheet.openSkillsTab();

    const initialChatCount = await page.evaluate(() => game.messages.contents.length);

    // Click the Fighter row's name span — #onRollTest ignores clicks on
    // input / button.bubble / .btn-advance (same pattern as the §3
    // skill-test spec).
    await sheet.rollSkillRow('fighter').locator('.skill-name').click();

    const dialog = new RollDialog(page);
    await dialog.waitForOpen();
    expect(await dialog.getPoolSize()).toBe(2);
    await dialog.fillObstacle(1);
    await dialog.submit();

    await expect
      .poll(() => page.evaluate(() => game.messages.contents.length), { timeout: 10_000 })
      .toBeGreaterThan(initialChatCount);

    const card = new RollChatCard(page);
    await card.expectPresent();
    expect(await card.isPass()).toBe(true);
    expect(await card.getSuccesses()).toBe(2);

    // Pre-Finalize: pips are still at the seeded (1, 1). The pip tick runs
    // inside _handleFinalize, not at roll-post time (see auto-trigger spec
    // for the full pipeline citation).
    const pipsBefore = await page.evaluate((id) => {
      const f = game.actors.get(id).system.skills.fighter;
      return { pass: f.pass, fail: f.fail, rating: f.rating };
    }, actorId);
    expect(pipsBefore).toEqual({ pass: 1, fail: 1, rating: 2 });

    // Dispatch a native click on Finalize (don't use card.clickFinalize()
    // which waits for the button to detach — the re-render that strips it
    // runs AFTER the awaited DialogV2.wait resolves, so the wait would
    // deadlock against the modal dialog). See auto-trigger spec lines
    // 165-175 for the detailed rationale.
    await expect(card.finalizeButton).toBeVisible();
    await card.finalizeButton.evaluate(btn => btn.click());

    const advDialog = new AdvancementDialog(page);
    await advDialog.waitForOpen();

    // Sanity-check the dialog is offering the advancement we expect before
    // we click Accept. CSS `text-transform: uppercase` capitalises the
    // label in the DOM — compare case-insensitively against the source
    // string from lang/en.json ("TB2E.Skill.Fighter": "Fighter").
    expect((await advDialog.getLabel()).toLowerCase()).toBe('fighter');
    expect(await advDialog.getCurrentRating()).toBe(2);
    expect(await advDialog.getNewRating()).toBe(3);

    // Snapshot the chat count before accepting, so we can cleanly detect
    // the celebration card the accept handler posts
    // (advancement.mjs:72-85).
    const chatCountBeforeAccept = await page.evaluate(() => game.messages.contents.length);

    // Accept. The POM waits for the dialog to detach, which — combined
    // with the async actor.update below — means a subsequent read of the
    // actor reflects the post-accept state. DialogV2 awaits the button
    // callback (`() => true` at advancement.mjs:43), then the accept
    // handler runs lines 57-69 serially.
    await advDialog.clickAccept();

    // Assert the mutation. Per advancement.mjs:57-61 the accept handler
    // sets rating → currentRating + 1 and zeroes pass/fail. The checkbox
    // description says "pips reset" — the code's semantics are a hard
    // reset, not overflow carry.
    await expect
      .poll(() => page.evaluate((id) => {
        const f = game.actors.get(id).system.skills.fighter;
        return { pass: f.pass, fail: f.fail, rating: f.rating };
      }, actorId), { timeout: 5_000 })
      .toEqual({ pass: 0, fail: 0, rating: 3 });

    // Assert the celebration chat card fired (advancement.mjs:72-85).
    // The card's speaker is `ChatMessage.getSpeaker({ actor })` which
    // populates `speaker.actor` with our actor id — scope on that rather
    // than chat-message order, which is unreliable under --repeat-each
    // when a shared Foundry world accumulates cards.
    await expect
      .poll(() => page.evaluate((id) => {
        return game.messages.contents
          .filter(m => m?.speaker?.actor === id)
          // The celebration card's content uses the advancement-result
          // template's unique `.advancement-card-rating` body class — a
          // more specific match than just speaker in case other cards
          // (e.g. the originating roll) share this actor.
          .some(m => typeof m.content === 'string'
                 && m.content.includes('advancement-card-rating'));
      }, actorId), { timeout: 5_000 })
      .toBe(true);

    // A single celebration card, not N.
    const celebrationCount = await page.evaluate((id) => {
      return game.messages.contents
        .filter(m => m?.speaker?.actor === id
                 && typeof m.content === 'string'
                 && m.content.includes('advancement-card-rating'))
        .length;
    }, actorId);
    expect(celebrationCount).toBe(1);

    // Guard against a false-positive where we counted messages that
    // already existed before accept.
    const chatCountAfterAccept = await page.evaluate(() => game.messages.contents.length);
    expect(chatCountAfterAccept).toBeGreaterThan(chatCountBeforeAccept);

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });
});
