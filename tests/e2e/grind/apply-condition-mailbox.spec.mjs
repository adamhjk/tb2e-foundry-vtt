import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §10 Grind Tracker — player-triggered condition routes through the
 * `flags.tb2e.pendingGrindApply` mailbox (DH p.53 conditions / p.75 grind
 * phases).
 *
 * Rules under test (CLAUDE.md §Mailbox Pattern):
 *   - Players can't update documents they don't own, so when a non-GM
 *     player clicks "Apply" on a consolidated grind condition chat card
 *     they write `flags.tb2e.pendingGrindApply = <messageId>` to their own
 *     actor in the SAME update() call that sets the condition flag
 *     (module/applications/grind-tracker.mjs L538-542). The GM's
 *     `updateActor` hook observes the mailbox write, calls
 *     `processGrindApplyMailbox` which marks the entry applied on the
 *     shared chat message and unsets the actor flag
 *     (module/applications/grind-tracker.mjs L595-599, dispatched from
 *     tb2e.mjs L245-246).
 *
 * Implementation map:
 *   - Consolidated card shape: ChatMessage with
 *     `flags.tb2e.grindCondition = true`, `flags.tb2e.turn = <number>`,
 *     and `flags.tb2e.entries = [{ actorId, condKey, applied }]`
 *     (grind-tracker.mjs L390-399 posts the card; L453-461 routes the
 *     consolidated branch of `activateGrindConditionListeners`).
 *   - Player-side mailbox write: grind-tracker.mjs L537-543. The non-GM
 *     branch bundles the condition set + mailbox flag into a single
 *     actor.update() — NOT a separate `setFlag` — so the `updateActor`
 *     hook sees the flag in the same `changes` diff that contains the
 *     condition change.
 *   - GM hook dispatcher: tb2e.mjs L245-246.
 *       `const pendingGrindApply = changes.flags?.tb2e?.pendingGrindApply;`
 *       `if ( pendingGrindApply ) processGrindApplyMailbox(actor, pendingGrindApply);`
 *   - GM processor: grind-tracker.mjs L595-599. Loads the message by id,
 *     calls `_applyGrindEntry` (L579-587) to mark the entry applied + re-
 *     render the card, then ALWAYS `actor.unsetFlag("tb2e",
 *     "pendingGrindApply")`. The unset runs even if the message is gone
 *     (the `if (message)` gate short-circuits the apply but not the
 *     clear) — that orthogonal clear path is covered by
 *     sheet/toggle-conditions.spec.mjs L178-217 using a bogus messageId.
 *     This spec exercises the happy path: real message → apply + clear.
 *
 * E2E harness constraint (shared with versus/finalize-via-mailbox.spec.mjs):
 *   - All Playwright sessions authenticate as GM (tests/e2e/test.mjs L18-20,
 *     tests/e2e/auth.setup.mjs). There is no connected player browser to
 *     drive the non-GM button-click branch at grind-tracker.mjs L537-543.
 *   - Approach (matches versus/finalize-via-mailbox.spec.mjs L106-150):
 *     simulate the player-side write via `page.evaluate` and let the in-
 *     browser GM-side `updateActor` hook pick it up. The hook fires in
 *     the same client as the write, so polling sees the effect with
 *     sub-second latency. We reproduce the EXACT shape grind-tracker.mjs
 *     L539-542 would have written: a single `actor.update({...})` with
 *     both the condition boolean and the mailbox flag.
 *
 * Payload shape: `flags.tb2e.pendingGrindApply` is just the message id
 * string (grind-tracker.mjs L541 + L595 — `const message = game.messages.
 * get(messageId)`). Not an object. This is deliberately minimal — the
 * processor re-derives everything else from the stored `entries` flag on
 * the message.
 *
 * Scope (narrow per briefing):
 *   - One actor, one entry. The mailbox write sets `hungry = true` and
 *     routes through the GM hook.
 *   - Assertions: condition applied on the actor, mailbox flag cleared,
 *     chat message's `entries[0].applied === true`. Chat-card UI shape
 *     (disabled buttons, "Apply All" state, etc.) is out of scope —
 *     covered by the consolidated-card spec (TEST_PLAN.md L327).
 *
 * World-state hygiene: the test creates its own throwaway actor + chat
 * message, both cleaned up in afterEach alongside any mailbox-flag
 * stragglers. We do NOT touch `tb2e.grindTurn` / `grindPhase` settings —
 * we author the grind message directly rather than advance the tracker.
 */
test.describe('§10 Grind Tracker — apply condition via mailbox', () => {
  let createdActorId = null;
  let createdMessageId = null;

  test.afterEach(async ({ page }) => {
    // Hand-rolled cleanup — the spec creates one actor + one chat message
    // and tracks their ids via closure vars so afterEach can remove them
    // even on mid-test failure.
    await page.evaluate(async ({ aId, mId }) => {
      if ( aId ) {
        const a = game.actors.get(aId);
        if ( a ) {
          try { await a.unsetFlag('tb2e', 'pendingGrindApply'); } catch {}
          try { await a.delete(); } catch {}
        }
      }
      if ( mId ) {
        const m = game.messages.get(mId);
        if ( m ) { try { await m.delete(); } catch {} }
      }
    }, { aId: createdActorId, mId: createdMessageId });
    createdActorId = null;
    createdMessageId = null;
  });

  test('player-side mailbox write triggers GM hook, applies condition, clears flag (DH p.53)', async ({ page }) => {
    const actorName = `E2E GrindMailbox ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Confirm we're GM — the updateActor hook in tb2e.mjs L245-246 is
    // gated earlier in the same handler (L184-185 `if ( !game.user.isGM )
    // return`), so the mailbox-drain leg runs ONLY in the GM's client.
    const isGM = await page.evaluate(() => game.user.isGM);
    expect(isGM).toBe(true);

    // Create a fresh character (conditions schema init:
    // module/data/actor/character.mjs L60-69 → `fresh: true` + all
    // negatives false). Capture the id in the closure var so afterEach
    // cleans up even on mid-test failure.
    createdActorId = await page.evaluate(async (n) => {
      const actor = await Actor.create({ name: n, type: 'character' });
      return actor.id;
    }, actorName);
    expect(createdActorId).toBeTruthy();

    // Baseline: the condition we're about to apply is off, and no mailbox
    // flag is set.
    const baseline = await page.evaluate((id) => {
      const a = game.actors.get(id);
      return {
        hungry: a?.system.conditions.hungry,
        mailbox: a?.getFlag('tb2e', 'pendingGrindApply') ?? null
      };
    }, createdActorId);
    expect(baseline).toEqual({ hungry: false, mailbox: null });

    // Author a consolidated grind ChatMessage that mirrors the shape
    // posted by #postConsolidatedGrindCard (grind-tracker.mjs L390-399):
    //   - flags.tb2e.grindCondition = true
    //   - flags.tb2e.turn = <turn>
    //   - flags.tb2e.entries = [{ actorId, condKey, applied: false }]
    // The `content` field is derived from `_renderConsolidatedContent`,
    // but since this spec doesn't assert card HTML shape we skip the
    // render and post an empty content string — the flag-driven processor
    // path doesn't read `content`.
    createdMessageId = await page.evaluate(async ({ aId, turn }) => {
      const msg = await ChatMessage.create({
        speaker: { alias: 'E2E Grind Mailbox' },
        content: '<div class="e2e-grind-mailbox-stub"></div>',
        type: CONST.CHAT_MESSAGE_STYLES.OTHER,
        flags: {
          tb2e: {
            grindCondition: true,
            turn,
            entries: [{ actorId: aId, condKey: 'hungry', applied: false }]
          }
        }
      });
      return msg.id;
    }, { aId: createdActorId, turn: 4 });
    expect(createdMessageId).toBeTruthy();

    // Verify the stored flag entry starts unapplied — so the assertion
    // later that it flipped to true is meaningful.
    const preEntries = await page.evaluate((mid) => {
      return game.messages.get(mid)?.getFlag('tb2e', 'entries') ?? null;
    }, createdMessageId);
    expect(preEntries).toEqual([
      { actorId: createdActorId, condKey: 'hungry', applied: false }
    ]);

    // Simulate the non-GM button click (grind-tracker.mjs L537-543):
    // single `actor.update(...)` that bundles both the condition set AND
    // the mailbox-flag write. This matches what the real player-side
    // listener emits — NOT a separate `setFlag` call (that's the idiom in
    // the bogus-message-id sibling test at sheet/toggle-conditions.spec.mjs
    // L205-207, which we deliberately diverge from here to exercise the
    // happy path).
    await page.evaluate(async ({ aId, mId }) => {
      const actor = game.actors.get(aId);
      await actor.update({
        'system.conditions.hungry': true,
        'flags.tb2e.pendingGrindApply': mId
      });
    }, { aId: createdActorId, mId: createdMessageId });

    // GM hook (tb2e.mjs L245-246) fires synchronously on the same client
    // as the write, dispatches to processGrindApplyMailbox (grind-tracker.
    // mjs L595-599), which awaits `_applyGrindEntry` (L579-587) to update
    // the message, then `unsetFlag('tb2e', 'pendingGrindApply')`. Poll the
    // three observable effects — all should converge within seconds.

    // 1. Mailbox cleared — this is the cardinal mailbox contract.
    await expect
      .poll(
        () => page.evaluate(
          (id) => game.actors.get(id)?.getFlag('tb2e', 'pendingGrindApply') ?? null,
          createdActorId
        ),
        { timeout: 10_000, message: 'pendingGrindApply should be cleared by GM hook' }
      )
      .toBeNull();

    // 2. Condition applied on the actor. This was set client-side in the
    //    same `actor.update()` that carried the mailbox flag, so it's
    //    really a sanity check that the update landed — but it's the
    //    first-class assertion the briefing calls out, and confirms the
    //    combined-write idiom is safe.
    const postHungry = await page.evaluate(
      (id) => game.actors.get(id)?.system.conditions.hungry,
      createdActorId
    );
    expect(postHungry).toBe(true);

    // 3. The grind message's entry for this actor flipped to applied.
    //    That's the side-effect added by the GM processor (L579-587) —
    //    player-side update() does NOT touch the message, so if this is
    //    true the hook definitely ran (even if the unset had already
    //    beat it to the assertion).
    await expect
      .poll(
        () => page.evaluate(
          (mid) => game.messages.get(mid)?.getFlag('tb2e', 'entries') ?? null,
          createdMessageId
        ),
        { timeout: 10_000, message: 'message entry should be marked applied by GM processor' }
      )
      .toEqual([
        { actorId: createdActorId, condKey: 'hungry', applied: true }
      ]);
  });
});
