import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import {
  VersusPendingCard,
  VersusResolutionCard,
  VersusDialogExtras
} from '../pages/VersusCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §5 Versus Tests — non-GM finalize-via-mailbox path (DH p.89).
 *
 * Rules under test:
 *   - Versus mailbox contract (CLAUDE.md §Mailbox Pattern): players can't
 *     update documents they don't own, so when a non-GM player finalizes
 *     a versus roll they write `flags.tb2e.pendingVersusFinalize =
 *     { messageId }` to their OWN actor; the GM's `updateActor` hook
 *     detects the write and runs `processVersusFinalize`, which unsets
 *     the mailbox flag and resolves the versus (posts the resolution
 *     card / tied card / no-op if the partner hasn't finalized yet).
 *
 * Implementation map:
 *   - Player-side write: module/dice/post-roll.mjs line 507-521. In the
 *     versus branch of `_handleFinalize`, the non-GM path sets the actor
 *     flag:
 *       await actor.setFlag("tb2e", "pendingVersusFinalize",
 *         { messageId: message.id });
 *     (line 518). The GM path on the same branch bypasses the mailbox
 *     entirely (line 515-516) — that's what all three prior §5 specs
 *     exercise. This spec exclusively drives the non-GM branch by
 *     simulating the player-side write via `page.evaluate`.
 *   - Payload shape: `{ messageId: <finalized versus roll message id> }`
 *     (post-roll.mjs line 518 → processed in versus.mjs line 102-129).
 *     This is the ONLY field the GM processor reads from the mailbox.
 *   - GM hook dispatcher: tb2e.mjs line 185-192. Guards on `!game.user.isGM`
 *     (line 186), picks off `changes.flags?.tb2e?.pendingVersusFinalize`,
 *     and — if it has `.messageId` — calls
 *     `processVersusFinalize(actor, pendingVersus)` (line 191-192).
 *   - GM processor: module/dice/versus.mjs line 102-129. In order:
 *       1. Load the message by id (line 103).
 *       2. **Unset the mailbox flag** (line 106 `unsetFlag`) — this
 *          happens BEFORE any partner-message lookup, so the flag is
 *          cleared even if the partner hasn't finalized yet (the
 *          processor simply returns without posting a resolution card
 *          in that case). This is the "idempotent clear" per
 *          CLAUDE.md — the mailbox is always drained, success or no-op.
 *       3. If both initiator + opponent are `resolved:true`, invoke
 *          `_executeVersusResolution` which posts the versus-resolution
 *          card (versus.mjs line 137-267) or a tied card (line 149-158 →
 *          `_handleVersusTied` line 309-394).
 *
 * E2E harness constraint:
 *   - All Playwright browser sessions authenticate as GM
 *     (tests/e2e/auth.setup.mjs, `login.spec.mjs` line 28-37). There is
 *     NO connected player browser to drive the non-GM branch via the UI.
 *   - Approach chosen (per CLAUDE.md guidance in the §5 briefing): use
 *     `page.evaluate` to BYPASS the `_handleFinalize` GM short-circuit
 *     and write the mailbox payload directly, then let the in-browser
 *     GM-side `updateActor` hook observe the change and process it.
 *     This exercises the EXACT contract under test — the write, hook
 *     dispatch, processor side-effects, and flag-clear — without
 *     requiring a second connected client.
 *   - We still perform the player-side `message.update({ "flags.tb2e.resolved":
 *     true })` before setting the mailbox flag (post-roll.mjs line 508 does
 *     this first in both branches). Without it, `processVersusFinalize`
 *     would early-return at versus.mjs line 126 (`if ( !opponentMsg.getFlag(
 *     "tb2e", "resolved") ) return`) and no resolution card would post.
 *
 * Why we don't impersonate a non-GM user (alternative approach rejected):
 *   - Foundry's `game.user` is pinned at session-auth and not re-assignable
 *     mid-client. `Actor.create`'s ownership defaults to the creating user,
 *     so any actor we create in an E2E browser is GM-owned regardless of
 *     nominal ownership overrides. The mailbox path is a pure data-flow
 *     contract (flag write → hook observation → processor), not a
 *     permissions contract — simulating the write is equivalent to
 *     exercising it via a player browser.
 *
 * Dice determinism (matches initiate-respond.spec.mjs at line 132-145):
 *   - `u=0.5` → `Math.ceil((1-u)*6) = 3` on every d6 → 0 successes on
 *     3D Will.
 *   - `u=0.001` → `Math.ceil((1-u)*6) = 6` on every d6 → 3 successes on
 *     3D Will.
 *   - Swap the stub between the initiator roll and the opponent roll so
 *     A lands on 0 successes and B on 3 — a clean non-tied win so the
 *     GM processor hits `_executeVersusResolution` (not `_handleVersusTied`).
 *
 * Actor-scoping for `--repeat-each=N`:
 *   - Actor names + resolution/pending messages all scoped by per-actor
 *     `Date.now()` suffixes. Resolution card lookup filters by both
 *     `initiatorMessageId` and `opponentMessageId` so stale resolution
 *     cards from earlier iterations can't satisfy the query.
 */
test.describe('§5 Versus Tests — finalize via pendingVersusFinalize mailbox', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });
  });

  test('player-side mailbox write triggers GM hook, posts resolution, clears flag (DH p.89)', async ({ page }) => {
    const suffix = Date.now();
    const initiatorName = `E2E Mailbox A ${suffix}`;
    const opponentName = `E2E Mailbox B ${suffix}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Two characters with Will=3 each. Fresh disabled so the baseline pool
    // is the ability rating exactly (fresh would add +1D via
    // gatherConditionModifiers). Same shape as initiate-respond.spec.mjs
    // line 102-128.
    const { initiatorId, opponentId } = await page.evaluate(async ({ iN, oN }) => {
      const init = await Actor.create({
        name: iN,
        type: 'character',
        system: {
          abilities: {
            will:   { rating: 3, pass: 0, fail: 0 },
            health: { rating: 3, pass: 0, fail: 0 },
            nature: { rating: 3, max: 3, pass: 0, fail: 0 }
          },
          conditions: { fresh: false }
        }
      });
      const opp = await Actor.create({
        name: oN,
        type: 'character',
        system: {
          abilities: {
            will:   { rating: 3, pass: 0, fail: 0 },
            health: { rating: 3, pass: 0, fail: 0 },
            nature: { rating: 3, max: 3, pass: 0, fail: 0 }
          },
          conditions: { fresh: false }
        }
      });
      return { initiatorId: init.id, opponentId: opp.id };
    }, { iN: initiatorName, oN: opponentName });
    expect(initiatorId).toBeTruthy();
    expect(opponentId).toBeTruthy();

    /* ---------- Phase 1 — initiator rolls + finalizes (GM path) ---------- */

    // All-3s → 0 successes for A (3D Will).
    await page.evaluate(() => {
      globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => 0.5;
    });

    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, initiatorId);

    const initiatorSheet = new CharacterSheet(page, initiatorName);
    await initiatorSheet.expectOpen();
    await initiatorSheet.openAbilitiesTab();

    await initiatorSheet.rollAbilityRow('will').click();

    const initDialog = new RollDialog(page);
    await initDialog.waitForOpen();
    await VersusDialogExtras.switchToVersus(initDialog);
    await initDialog.submit();

    const initiatorMessageId = await page.evaluate(async (actorId) => {
      const started = Date.now();
      while (Date.now() - started < 10_000) {
        const msg = game.messages.contents.find(m => {
          const vs = m.flags?.tb2e?.versus;
          return vs?.type === 'initiator' && vs.initiatorActorId === actorId;
        });
        if (msg) return msg.id;
        await new Promise(r => setTimeout(r, 100));
      }
      return null;
    }, initiatorId);
    expect(initiatorMessageId).toBeTruthy();

    const initCard = new VersusPendingCard(page, initiatorMessageId);
    await initCard.expectPresent();
    await initCard.expectPending();

    // Initiator finalizes via the GM path (this is NOT the mailbox path
    // under test — A's finalize is a pre-req to set `initiatorMessage.
    // flags.tb2e.resolved = true` so that when B's mailbox write is
    // eventually processed, `_executeVersusResolution` doesn't early-
    // return at versus.mjs line 125). Using the UI here mirrors
    // initiate-respond.spec.mjs exactly.
    await initCard.clickFinalize();
    await expect(initCard.resolvedBanner).toBeVisible();

    // Close the initiator sheet before opening B's.
    await page.evaluate((id) => {
      for (const app of Object.values(foundry.applications.instances)) {
        if (app?.actor?.id === id) app.close();
      }
    }, initiatorId);

    /* ---------- Phase 2 — opponent rolls (creates opponent message) ---------- */

    // Swap PRNG → 3 successes for B.
    await page.evaluate(() => {
      CONFIG.Dice.randomUniform = () => 0.001;
    });

    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, opponentId);

    const opponentSheet = new CharacterSheet(page, opponentName);
    await opponentSheet.expectOpen();
    await opponentSheet.openAbilitiesTab();

    await opponentSheet.rollAbilityRow('will').click();

    const oppDialog = new RollDialog(page);
    await oppDialog.waitForOpen();

    await VersusDialogExtras.switchToVersus(oppDialog);
    await VersusDialogExtras.selectChallenge(oppDialog, initiatorMessageId);
    await oppDialog.submit();

    const opponentMessageId = await page.evaluate(async ({ actorId, initId }) => {
      const started = Date.now();
      while (Date.now() - started < 10_000) {
        const msg = game.messages.contents.find(m => {
          const vs = m.flags?.tb2e?.versus;
          return vs?.type === 'opponent'
            && vs.opponentActorId === actorId
            && vs.initiatorMessageId === initId;
        });
        if (msg) return msg.id;
        await new Promise(r => setTimeout(r, 100));
      }
      return null;
    }, { actorId: opponentId, initId: initiatorMessageId });
    expect(opponentMessageId).toBeTruthy();

    const oppCard = new VersusPendingCard(page, opponentMessageId);
    await oppCard.expectPresent();
    await oppCard.expectPending();

    /* ---------- Phase 3 — simulate the non-GM mailbox write ---------- */

    // Instead of clicking Finalize (which would take the GM fast path at
    // post-roll.mjs line 513-516), we reproduce the EXACT two steps
    // post-roll.mjs line 508-518 performs on the non-GM branch:
    //
    //   1. `message.update({ "flags.tb2e.resolved": true })` — required
    //      or `_executeVersusResolution` early-returns at versus.mjs
    //      line 125-126.
    //   2. `actor.setFlag("tb2e", "pendingVersusFinalize",
    //        { messageId: message.id })` — the mailbox write.
    //
    // The in-browser GM-side `updateActor` hook (tb2e.mjs line 185-192)
    // observes `changes.flags.tb2e.pendingVersusFinalize` and dispatches
    // to `processVersusFinalize` (versus.mjs line 102), which clears the
    // flag and posts the resolution card.
    //
    // CLAUDE.md §Mailbox Pattern: the hook runs in the GM's client;
    // since our E2E session IS the GM, the hook fires immediately on
    // setFlag — no cross-client latency to wait out.

    // Pre-conditions: mailbox flag is not currently set on B.
    const preFlag = await page.evaluate((id) => {
      return game.actors.get(id)?.getFlag('tb2e', 'pendingVersusFinalize') ?? null;
    }, opponentId);
    expect(preFlag).toBeNull();

    // The resolution card doesn't exist yet.
    const preResolutionCount = await page.evaluate(({ initId, oppId }) => {
      return game.messages.contents.filter(m => {
        const vs = m.flags?.tb2e?.versus;
        return vs?.type === 'resolution'
          && vs.initiatorMessageId === initId
          && vs.opponentMessageId === oppId;
      }).length;
    }, { initId: initiatorMessageId, oppId: opponentMessageId });
    expect(preResolutionCount).toBe(0);

    // Mirror post-roll.mjs line 508 — mark B's roll as resolved so the
    // GM processor's "both-sides-finalized" check (versus.mjs line
    // 125-126) passes.
    await page.evaluate(async (mid) => {
      const msg = game.messages.get(mid);
      await msg.update({ "flags.tb2e.resolved": true });
    }, opponentMessageId);

    // Mirror post-roll.mjs line 518 — the mailbox write itself. This is
    // the act under test. We fire-and-observe: setFlag triggers the
    // `updateActor` hook synchronously on the same client, so by the
    // time subsequent polling fires, the hook has at least begun.
    await page.evaluate(async ({ actorId, mid }) => {
      const actor = game.actors.get(actorId);
      await actor.setFlag('tb2e', 'pendingVersusFinalize', { messageId: mid });
    }, { actorId: opponentId, mid: opponentMessageId });

    /* ---------- Phase 4 — assert GM hook processed + cleared ---------- */

    // Resolution card appears — posted by `_executeVersusResolution`
    // (versus.mjs line 206-222). Poll to absorb the async chain: setFlag
    // → updateActor hook → processVersusFinalize → ChatMessage.create.
    const resolutionMessageId = await page.evaluate(async ({ initId, oppId }) => {
      const started = Date.now();
      while (Date.now() - started < 10_000) {
        const msg = game.messages.contents.find(m => {
          const vs = m.flags?.tb2e?.versus;
          return vs?.type === 'resolution'
            && vs.initiatorMessageId === initId
            && vs.opponentMessageId === oppId;
        });
        if (msg) return msg.id;
        await new Promise(r => setTimeout(r, 100));
      }
      return null;
    }, { initId: initiatorMessageId, oppId: opponentMessageId });
    expect(resolutionMessageId).toBeTruthy();

    // Mailbox flag has been cleared by the GM processor
    // (versus.mjs line 106 `actor.unsetFlag("tb2e", "pendingVersusFinalize")`).
    // Poll because unsetFlag is async relative to the setFlag we just
    // performed; by the time the resolution card is present the clear
    // has definitely occurred (unsetFlag is line 106, BEFORE the
    // ChatMessage.create at line 206), but poll anyway for robustness.
    await expect.poll(
      async () => await page.evaluate(
        (id) => game.actors.get(id)?.getFlag('tb2e', 'pendingVersusFinalize') ?? null,
        opponentId
      ),
      { timeout: 10_000, message: 'pendingVersusFinalize should be cleared by GM hook' }
    ).toBeNull();

    // Resolution card shape — winner is B (opponent, 3 successes vs A's 0).
    const resolution = new VersusResolutionCard(page, resolutionMessageId);
    await resolution.expectPresent();
    expect(await resolution.initiatorIsWinner()).toBe(false);
    expect(await resolution.getWinnerName()).toBe(opponentName);
    expect(await resolution.getInitiatorSuccesses()).toBe(0);
    expect(await resolution.getOpponentSuccesses()).toBe(3);
    expect(await resolution.getMargin()).toBe(3);

    // Server-side versus state consistent with what the card shows.
    const flags = await page.evaluate((mid) => {
      const msg = game.messages.get(mid);
      const vs = msg?.flags?.tb2e?.versus;
      if (!vs) return null;
      return {
        type: vs.type,
        winnerId: vs.winnerId,
        initiatorActorId: vs.initiatorActorId,
        opponentActorId: vs.opponentActorId,
        initiatorMessageId: vs.initiatorMessageId,
        opponentMessageId: vs.opponentMessageId
      };
    }, resolutionMessageId);
    expect(flags).toEqual({
      type: 'resolution',
      winnerId: opponentId,
      initiatorActorId: initiatorId,
      opponentActorId: opponentId,
      initiatorMessageId,
      opponentMessageId
    });

    // Both roll messages are marked resolved (versus.mjs line 225-226).
    const resolvedFlags = await page.evaluate(({ initId, oppId }) => {
      const init = game.messages.get(initId);
      const opp = game.messages.get(oppId);
      return {
        initResolved: !!init?.flags?.tb2e?.versus?.resolved,
        oppResolved: !!opp?.flags?.tb2e?.versus?.resolved
      };
    }, { initId: initiatorMessageId, oppId: opponentMessageId });
    expect(resolvedFlags).toEqual({ initResolved: true, oppResolved: true });

    // Registry is cleaned up (versus.mjs line 229).
    const stillRegistered = await page.evaluate(async (id) => {
      const { PendingVersusRegistry } = await import(
        '/systems/tb2e/module/dice/versus.mjs'
      );
      return PendingVersusRegistry._pending.has(id);
    }, initiatorMessageId);
    expect(stillRegistered).toBe(false);

    /* ---------- Cleanup ---------- */

    await page.evaluate(({ iId, oId }) => {
      game.actors.get(iId)?.delete();
      game.actors.get(oId)?.delete();
    }, { iId: initiatorId, oId: opponentId });
  });
});
