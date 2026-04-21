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
 * §5 Versus Tests — initiator rolls, opponent responds, resolution posted
 * (DH pp.56, 89).
 *
 * Rules under test:
 *   - Versus: both sides roll; highest successes wins. Margin = |iS - oS|.
 *   - Ties are resolved separately (`tie-break.spec.mjs`,
 *     `tie-no-trait.spec.mjs` at lines 211-212) — this spec only exercises
 *     the clear-winner path.
 *
 * Implementation map:
 *   - Roll dialog mode toggle: templates/dice/roll-dialog.hbs line 3-8
 *     + tb2e-roll.mjs lines 964-1005 cycle the `mode` hidden input between
 *     "independent" / "versus" / "disposition".
 *   - Initiator path: tb2e-roll.mjs `_handleVersusRoll` line 1630-1652
 *     creates a roll-result card tagged `flags.tb2e.versus.type === "initiator"`
 *     and registers the message in `PendingVersusRegistry`.
 *   - Opponent path: same handler line 1597-1629 creates an opponent card
 *     tagged `versus.type === "opponent"` + `initiatorMessageId` linking back.
 *   - Resolve: on `createChatMessage` for the opponent card, the GM-only
 *     hook in tb2e.mjs line 143-146 calls `resolveVersus(message)` which
 *     sets `initiator.versus.opponentMessageId` (versus.mjs line 85).
 *   - Finalize: `_handleFinalize` in post-roll.mjs line 506-522 routes
 *     versus cards into `processVersusFinalize` (for the GM path) —
 *     `_executeVersusResolution` (versus.mjs line 137-267) posts the
 *     final card from templates/chat/versus-resolution.hbs when both
 *     sides are `resolved: true`.
 *
 * Winner / margin shape on the resolution card:
 *   - `winnerId = initiatorWins ? initiatorVs.initiatorActorId : opponentVs.opponentActorId`
 *     (versus.mjs line 160).
 *   - Resolution template renders the winner's `.versus-combatant` block
 *     with an extra `.versus-winner` class, plus a `banner-pass` block
 *     containing `.versus-winner-name`.
 *   - Margin is NOT rendered as a numeric field on the card — it's
 *     computed in versus.mjs line 170 (`Math.abs(iS - oS)`) and only
 *     propagates visibly when a conflict maneuver is being spent. We
 *     assert margin via the difference between the two
 *     `.versus-successes` text lines.
 *
 * Dice determinism (same PRNG-stub pattern as ability-test-basic /
 * wise-aid-persona):
 *   - u=0.5 → Math.ceil((1-u)*6) = 3 on every d6 (all wyrms, 0 successes)
 *   - u=0.001 → Math.ceil((1-u)*6) = 6 on every d6 (all suns)
 *   - We swap the stub between the initiator roll and the opponent roll
 *     so A lands on 0 successes and B lands on 3 — margin 3, B wins.
 *
 * Multi-user constraint:
 *   - E2E auth is GM-only (tests/e2e/auth.setup.mjs). Both actors are GM-
 *     owned by default, and the versus code path only distinguishes
 *     initiator vs opponent by the `challengeMessageId` value on submit
 *     (tb2e-roll.mjs line 1569) — not by the user session. A single GM
 *     browser can drive both sides end-to-end, exercising the full
 *     `_executeVersusResolution` flow directly (no `pendingVersusFinalize`
 *     mailbox needed; `_handleFinalize` takes the GM fast-path at post-
 *     roll.mjs line 513-516). The mailbox variant is reserved for
 *     `finalize-via-mailbox.spec.mjs` (line 213).
 *
 * Actor-scoping to avoid cross-iteration contamination:
 *   - `--repeat-each=N` reuses the same world; a prior iteration's
 *     versus-resolution card could otherwise satisfy `last()` queries in
 *     the new iteration. All locators index by `data-message-id` (scoped
 *     via the VersusCard POMs) and all flag queries filter to the two
 *     actors we just created.
 */
test.describe('§5 Versus Tests — initiate, respond, resolve', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });
  });

  test('A rolls versus, B responds, resolution card shows winner and margin (DH p.89)', async ({ page }) => {
    const suffix = Date.now();
    const initiatorName = `E2E Versus A ${suffix}`;
    const opponentName = `E2E Versus B ${suffix}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Two characters with Will = 3 each. Fresh disabled so the baseline
    // pool is the ability rating exactly (fresh adds +1D via
    // gatherConditionModifiers). Both actors' abilities seeded with
    // pass=0/fail=0 so no pip-state interferes with later assertions.
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

    /* ---------- Phase 1 — initiator rolls ---------- */

    // Stub PRNG → all-3s. 3D Will for A = 0 successes (all wyrms, A will lose).
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

    const chatCountBeforeInit = await page.evaluate(
      () => game.messages.contents.length
    );

    await initiatorSheet.rollAbilityRow('will').click();

    const initDialog = new RollDialog(page);
    await initDialog.waitForOpen();

    // Switch this roll to versus mode. The dialog starts in "independent" —
    // one click cycles to "versus", un-hides the `.roll-dialog-challenge`
    // dropdown, and flips the summary label from "ND vs Ob M" to
    // "ND Versus" (tb2e-roll.mjs line 951-955).
    await VersusDialogExtras.switchToVersus(initDialog);

    // Leave challengeMessageId blank → `isOpponent = false` on submit
    // (tb2e-roll.mjs line 1569). The dialog's `hasChallenge` evaluation
    // uses `!!config.challengeMessageId` so an empty option value means
    // "I'm the initiator".
    await initDialog.submit();

    // A new ChatMessage with `flags.tb2e.versus.type === "initiator"` should
    // post. Poll by filtering game.messages for that signature so we can
    // pick up the right message id even if the PRNG stub or another
    // production hook also posts a card around the same time.
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

    // Initiator card renders with the pending banner. Sanity check — the
    // banner is sourced from the `banner-pending` class in roll-result.hbs
    // line 174-177 (gated by `isVersus && !versusFinalized`).
    const initCard = new VersusPendingCard(page, initiatorMessageId);
    await initCard.expectPresent();
    await initCard.expectPending();

    // Initiator clicks Finalize on their own card. `_handleFinalize`
    // (post-roll.mjs line 506-522) versus-branch marks the card resolved
    // and (GM path) calls `processVersusFinalize` — which is a no-op at
    // this stage because the opponent hasn't rolled yet (versus.mjs line
    // 116 `if ( !vs.opponentMessageId ) return`). The card re-renders with
    // the resolved banner.
    await initCard.clickFinalize();

    // Resolved banner is now visible in the re-rendered card.
    await expect(initCard.resolvedBanner).toBeVisible();

    // Close the initiator sheet to clean up before opening B's.
    await page.evaluate((id) => {
      for (const app of Object.values(foundry.applications.instances)) {
        if (app?.actor?.id === id) app.close();
      }
    }, initiatorId);

    /* ---------- Phase 2 — opponent responds ---------- */

    // Swap PRNG → all-6s. 3D Will for B = 3 successes. B wins by margin 3.
    await page.evaluate(() => {
      CONFIG.Dice.randomUniform = () => 0.001;
    });

    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, opponentId);

    const opponentSheet = new CharacterSheet(page, opponentName);
    await opponentSheet.expectOpen();
    await opponentSheet.openAbilitiesTab();

    const chatCountBeforeOpp = await page.evaluate(
      () => game.messages.contents.length
    );

    await opponentSheet.rollAbilityRow('will').click();

    const oppDialog = new RollDialog(page);
    await oppDialog.waitForOpen();

    await VersusDialogExtras.switchToVersus(oppDialog);
    // The initiator's message should be in the challenge dropdown — it was
    // registered by `PendingVersusRegistry.register` (versus.mjs line 18)
    // AND by the live-update hook in tb2e-roll.mjs line 1033-1045 before
    // this dialog opened.
    await VersusDialogExtras.selectChallenge(oppDialog, initiatorMessageId);

    await oppDialog.submit();

    // Poll for the opponent message with `versus.type === "opponent"`
    // linked to our initiator.
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

    /* ---------- Phase 3 — opponent finalizes, resolution posts ---------- */

    // Opponent Finalize triggers processVersusFinalize; with both sides
    // resolved, _executeVersusResolution posts the resolution card.
    await oppCard.clickFinalize();

    // Poll for the resolution card. `flags.tb2e.versus.type === "resolution"`
    // is set at versus.mjs line 211-217; `winnerId` is whichever actor had
    // more finalSuccesses — opponent here (3 vs 0).
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

    /* ---------- Phase 4 — assert winner + margin shape on the card ---------- */

    const resolution = new VersusResolutionCard(page, resolutionMessageId);
    await resolution.expectPresent();

    // Opponent (B, second combatant) should be the winner — opponent block
    // gets `.versus-winner` class, initiator block does not (versus-
    // resolution.hbs line 7 vs 16).
    expect(await resolution.initiatorIsWinner()).toBe(false);
    // Banner names the winner.
    expect(await resolution.getWinnerName()).toBe(opponentName);

    // Successes per side — A = 0, B = 3. DH p.89: "highest successes wins";
    // versus.mjs line 146-150 reads `finalSuccesses ?? successes` from each
    // side's `flags.tb2e.roll` and compares.
    expect(await resolution.getInitiatorSuccesses()).toBe(0);
    expect(await resolution.getOpponentSuccesses()).toBe(3);

    // Margin = |0 - 3| = 3. versus.mjs line 170 computes this; the
    // resolution card does not render margin as a standalone field but
    // the pair of successes figures lets us verify the margin shape end-
    // to-end (critical for downstream conflict-maneuver consumers that
    // DO surface margin on the card).
    expect(await resolution.getMargin()).toBe(3);

    // Flag-level assertions — confirms the server-side versus state is
    // internally consistent with what the card displays.
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

    // Both source cards are now `resolved: true` (versus.mjs line 225-226).
    const resolvedFlags = await page.evaluate(({ initId, oppId }) => {
      const init = game.messages.get(initId);
      const opp = game.messages.get(oppId);
      return {
        initResolved: !!init?.flags?.tb2e?.versus?.resolved,
        oppResolved: !!opp?.flags?.tb2e?.versus?.resolved
      };
    }, { initId: initiatorMessageId, oppId: opponentMessageId });
    expect(resolvedFlags).toEqual({ initResolved: true, oppResolved: true });

    // Registry cleaned — `PendingVersusRegistry.remove(initiator.id)` at
    // versus.mjs line 229 clears the entry so a reopen of the roll dialog
    // wouldn't see it in the challenge dropdown.
    const stillRegistered = await page.evaluate(async (id) => {
      const { PendingVersusRegistry } = await import(
        '/systems/tb2e/module/dice/versus.mjs'
      );
      return PendingVersusRegistry._pending.has(id);
    }, initiatorMessageId);
    expect(stillRegistered).toBe(false);

    // Sanity on chat log growth: we posted at least 3 new messages (A's
    // pending card, B's opponent card, the resolution card). Advancement
    // and wise-aid side-effects could add more; just assert the bound.
    const finalCount = await page.evaluate(() => game.messages.contents.length);
    expect(finalCount).toBeGreaterThanOrEqual(chatCountBeforeInit + 3);
    expect(finalCount).toBeGreaterThanOrEqual(chatCountBeforeOpp + 2);

    /* ---------- Cleanup ---------- */

    await page.evaluate(({ iId, oId }) => {
      game.actors.get(iId)?.delete();
      game.actors.get(oId)?.delete();
    }, { iId: initiatorId, oId: opponentId });
  });
});
