import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';
import { AdvancementDialog } from '../pages/AdvancementDialog.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §4 Advancement — cancel the advancement prompt.
 *
 * Companion to `advancement/auto-trigger.spec.mjs` (opens the dialog) and
 * `advancement/accept.spec.mjs` (accepts it). This spec verifies that
 * clicking Cancel on the advancement prompt leaves the actor in the
 * threshold-met state from the triggering roll: rating unchanged, pips
 * unchanged.
 *
 * BLOCKED — Production bug in `module/dice/advancement.mjs` (the cancel
 * handler). The dialog is constructed via
 * `foundry.applications.api.DialogV2.wait({ buttons: [...] })` and the
 * guard at advancement.mjs:54 is `if ( !result ) return;`. BUT in Foundry
 * v13's DialogV2 `_onSubmit`
 * (foundry-vtt/client/applications/api/dialog.mjs:242):
 *
 *     const result = (await button?.callback?.(event, target, this))
 *                    ?? button?.action;
 *
 * The "cancel" button has NO `callback` (advancement.mjs:45-49 only
 * declares `action`, `label`, `icon`). So `result` falls through to
 * `button?.action` — the STRING `"cancel"`, which is TRUTHY. The guard
 * at advancement.mjs:54 only fires when result is falsy (null from
 * Escape-dismiss via `close: () => null`, or undefined). Clicking the
 * visible "Cancel" button therefore resolves the promise with the
 * truthy `"cancel"` and runs the accept mutation anyway — rating jumps
 * +1 and pips zero, identical to clicking Advance.
 *
 * Empirical confirmation: running this spec WITHOUT test.fixme asserts
 * the expected post-cancel state of (rating 2, pass 2, fail 1) and
 * instead sees (rating 3, pass 0, fail 0) — the accept mutation. See
 * test-results screenshot for visual confirmation.
 *
 * Fix options (for a follow-up change, outside this test's scope):
 *   Option A: Add `callback: () => false` to the cancel button
 *     (advancement.mjs:45-49). Keeps accept-as-sentinel contract
 *     (accept's callback already returns `true`).
 *   Option B: Tighten the guard at advancement.mjs:54 to
 *     `if ( result !== true ) return;` — matches accept's `() => true`
 *     sentinel explicitly.
 *   Option C: Change cancel button's `action` to a falsy-by-convention
 *     value — fragile and not idiomatic; NOT recommended.
 *
 * Once fixed, remove the `test.fixme` below and the assertions will
 * validate the documented semantic:
 *   - rating stays at 2 (not bumped to 3)
 *   - pips stay at the post-tick values (2, 1) — the pip tick in
 *     `_logAdvancement` (tb2e-roll.mjs:192-203) lands BEFORE the dialog
 *     opens, and cancel is intended to be a pure no-op that leaves that
 *     tick in place (not roll it back).
 *   - NO celebration chat card is posted (advancement.mjs:72-85 runs
 *     AFTER the guard on line 54).
 *
 * Source mechanics (cited for review traceability):
 *   - DH p.84 — Rating N advances at N passes + N-1 fails
 *     (`advancementNeeded` in module/config.mjs:89-94).
 *   - module/dice/advancement.mjs:37-52 — button declarations. Only
 *     "accept" defines a callback (`() => true`); "cancel" does not.
 *   - module/dice/advancement.mjs:51 — `close: () => null`. Escape-dismiss
 *     IS correctly a no-op; the failing path is specifically the visible
 *     Cancel button.
 *   - module/dice/advancement.mjs:54 — `if ( !result ) return;`. Checks
 *     falsiness, not "was this an accept".
 *   - module/dice/tb2e-roll.mjs:192-203 — `_logAdvancement` ticks the
 *     pip BEFORE calling `showAdvancementDialog`, so the actor is in the
 *     threshold-met state (2P, 1F) while the dialog is modal.
 *
 * Dice determinism: `CONFIG.Dice.randomUniform = () => 0.001` forces every
 * d6 to a 6, so a 2D pool vs Ob 1 is a deterministic PASS with 2 successes
 * (same recipe as accept-spec and auto-trigger-spec).
 */
test.describe('§4 Advancement — cancel', () => {
  test.afterEach(async ({ page }) => {
    // Restore the dice PRNG so this spec's stub does not leak into other
    // tests sharing the same Foundry world.
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });
  });

  // BLOCKED — see describe-level comment above. The cancel button in
  // `showAdvancementDialog` has no callback, so DialogV2 resolves the
  // `wait()` promise with the truthy string "cancel", which passes the
  // `if (!result) return` guard at advancement.mjs:54 and runs the accept
  // mutation. Remove `test.fixme` once the cancel button is fixed per
  // Option A or B above.
  test.fixme('Cancel leaves rating and pips at their threshold-met values; no celebration card', async ({ page }) => {
    const actorName = `E2E Advance Cancel ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Stage Fighter at rating 2, pass:1, fail:1 — exactly one pass-pip below
    // the (2P, 1F) threshold for rating 2 (DH p.84). Matches the accept
    // spec's stage so we share a known-good pipeline, then diverge only at
    // the final button click.
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
          // Data-model default `conditions.fresh = true` adds +1D via
          // gatherConditionModifiers (DH p.85); disabling keeps the pool
          // exactly at the Fighter rating (2D).
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
    // inside `_handleFinalize` → `_logAdvancement` (tb2e-roll.mjs:197-202),
    // not at roll-post time.
    const pipsBefore = await page.evaluate((id) => {
      const f = game.actors.get(id).system.skills.fighter;
      return { pass: f.pass, fail: f.fail, rating: f.rating };
    }, actorId);
    expect(pipsBefore).toEqual({ pass: 1, fail: 1, rating: 2 });

    // Snapshot the roll-card message id BEFORE the advancement dialog opens,
    // so we can separately assert post-cancel that the roll card still
    // exists (i.e. cancel isn't accidentally deleting upstream messages).
    const rollMessageId = await page.evaluate((id) => {
      const m = game.messages.contents.slice().reverse()
        .find(msg => msg?.flags?.tb2e?.actorId === id && msg?.flags?.tb2e?.roll);
      return m ? m.id : null;
    }, actorId);
    expect(rollMessageId).toBeTruthy();

    // Dispatch a native click on Finalize (don't use card.clickFinalize()
    // which waits for the button to detach — the re-render that strips it
    // runs AFTER the awaited DialogV2.wait resolves, so the wait would
    // deadlock against the modal dialog). See auto-trigger spec lines
    // 165-175 for the detailed rationale.
    await expect(card.finalizeButton).toBeVisible();
    await card.finalizeButton.evaluate(btn => btn.click());

    const advDialog = new AdvancementDialog(page);
    await advDialog.waitForOpen();

    // Sanity-check we're in the same state as the accept-spec before the
    // button divergence — this guards against a silent refactor of the
    // dialog contents from drifting between specs. Label is uppercased
    // by CSS `text-transform`, compare case-insensitively.
    expect((await advDialog.getLabel()).toLowerCase()).toBe('fighter');
    expect(await advDialog.getCurrentRating()).toBe(2);
    expect(await advDialog.getNewRating()).toBe(3);

    // Snapshot the chat count while the dialog is modal — the pip tick has
    // already landed (advancement.mjs:54 has not yet been evaluated, but
    // `_logAdvancement` updated the actor BEFORE calling the dialog), and
    // no celebration card can have posted yet (that's past line 54).
    const chatCountBeforeCancel = await page.evaluate(() => game.messages.contents.length);

    // Pip tick landed pre-dialog: pass 1 → 2 (capped at rating-2 max),
    // fail still 1. This is the state the cancel handler inherits.
    const pipsAfterTick = await page.evaluate((id) => {
      const f = game.actors.get(id).system.skills.fighter;
      return { pass: f.pass, fail: f.fail, rating: f.rating };
    }, actorId);
    expect(pipsAfterTick).toEqual({ pass: 2, fail: 1, rating: 2 });

    // Cancel. The POM waits for the dialog to detach. Per advancement.mjs:54
    // (`if (!result) return;`) this SHOULD be a pure no-op, but per the
    // describe-level comment the current implementation mistakenly treats
    // a clicked-cancel as an accept. Once the bug is fixed, the assertions
    // below will validate the intended behavior.
    await advDialog.clickCancel();

    // Assertion 1: rating unchanged at 2, pips unchanged at (2, 1) — the
    // threshold-met values from `_logAdvancement`, NOT rolled back to the
    // pre-roll (1, 1) state. Cancel does not undo the pip tick.
    await expect
      .poll(() => page.evaluate((id) => {
        const f = game.actors.get(id).system.skills.fighter;
        return { pass: f.pass, fail: f.fail, rating: f.rating };
      }, actorId), { timeout: 5_000 })
      .toEqual({ pass: 2, fail: 1, rating: 2 });

    // Assertion 2: NO celebration chat card posted. Mirror the accept-spec's
    // filter: scope to the actor via speaker.actor (the accept handler
    // populates it via `ChatMessage.getSpeaker({ actor })` at
    // advancement.mjs:82) AND match on the unique `.advancement-card-rating`
    // body class from advancement-result.hbs, so we don't false-positive
    // on the roll card that IS present for this actor.
    const celebrationCount = await page.evaluate((id) => {
      return game.messages.contents
        .filter(m => m?.speaker?.actor === id
                  && typeof m.content === 'string'
                  && m.content.includes('advancement-card-rating'))
        .length;
    }, actorId);
    expect(celebrationCount).toBe(0);

    // Assertion 3: the chat count didn't grow over the cancel transition
    // (no card of ANY kind was posted). Stronger than just counting
    // celebration cards — guards against a regression that posts some
    // other "you declined" card.
    const chatCountAfterCancel = await page.evaluate(() => game.messages.contents.length);
    expect(chatCountAfterCancel).toBe(chatCountBeforeCancel);

    // Assertion 4: the originating roll's chat card still exists (cancel
    // doesn't clobber upstream state). A cheap positive control that
    // distinguishes "no celebration card" from "all cards for this actor
    // got vacuumed."
    const rollMessageStillPresent = await page.evaluate((mid) => {
      return !!game.messages.get(mid);
    }, rollMessageId);
    expect(rollMessageStillPresent).toBe(true);

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });
});
