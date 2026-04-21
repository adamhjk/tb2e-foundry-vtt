import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import {
  VersusPendingCard,
  VersusResolutionCard,
  VersusTiedCard,
  VersusDialogExtras
} from '../pages/VersusCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §5 Versus Tests — tie-break with a Level 3 trait (DH p.80, SG p.33).
 *
 * Rules under test:
 *   - Versus ties: when both sides resolve with the same success count,
 *     either side may spend a Level 3 trait to win the tie outright
 *     (beneficial L3 use — unlimited per session, no checks earned).
 *   - Using a trait "against yourself" (any level) breaks the tie in the
 *     OTHER side's favor and earns the conceder 2 checks; this spec does
 *     NOT exercise that path (covered by `tie-no-trait.spec.mjs` at line
 *     212 for the no-traits scenario).
 *
 * Implementation map:
 *   - Tie detection: module/dice/versus.mjs `_executeVersusResolution`
 *     line 149-158 — `isTied = iSuccesses === oSuccesses` routes to
 *     `_handleVersusTied` instead of posting a resolution.
 *   - Tied card: versus.mjs line 309-394, template
 *     templates/chat/versus-tied.hbs. Tagged `flags.tb2e.versus.type ===
 *     "tied"`, carries `initiatorActorId` / `opponentActorId` /
 *     `initiatorSuccesses` / `opponentSuccesses` / roll-type metadata.
 *   - L3 eligibility: `_getEligibleLevel3Traits` (versus.mjs line 290-294)
 *     filters `actor.itemTypes.trait` to `system.level === 3`. No
 *     `usedAgainst` check — L3 beneficial uses are unlimited per session.
 *   - L3 handler: `handleLevel3TraitBreakTie` (versus.mjs line 485-518).
 *     Guards:
 *       1. trait.system.level === 3 (line 494)
 *       2. not already tiedResolved (line 488)
 *       3. once-per-test — the original roll message must not have a
 *          `flags.tb2e.trait.itemId` (line 503 `_wasTraitUsedOnRoll`)
 *     Effects:
 *       - winner = the acting actor (line 509)
 *       - `_resolveFromTied` (line 523-617) posts a versus-resolution
 *         message with `type: "resolution"` + `winnerId` + a
 *         `tiebrokenBy` block rendered from `TB2E.Trait.WonTie`.
 *       - NO trait mutation — L3 beneficial tie-break does not set
 *         `usedAgainst: true` and does not decrement `beneficial`
 *         (unlimited per session rule).
 *       - tied card flips `flags.tb2e.tiedResolved: true` (line 569).
 *
 * Button wiring: tb2e.mjs `renderChatMessageHTML` hook line 167-180
 * attaches native click listeners to `[data-action="level3-break-tie"]`
 * buttons with `data-actor-id` + `data-trait-id` dataset attributes.
 * Each actor's L3 traits render one button per trait under a
 * `.tied-action-group[data-actor-id=...]` block (versus-tied.hbs line
 * 34-44 / 52-62).
 *
 * Dice determinism: same PRNG-stub pattern as initiate-respond.spec.mjs
 * and wise-aid / fate-reroll — swap `CONFIG.Dice.randomUniform` mid-test
 * since each side's roll happens in its own invocation. We stub u=0.001
 * (all 6s → 3 successes on 3D) for both the initiator and the opponent
 * roll so both resolve to 3 successes and the tie-handler is exercised.
 *
 * Actor scoping: like initiate-respond.spec.mjs, we pin every locator to
 * a specific message id (from a `page.evaluate` poll that filters on
 * `flags.tb2e.versus.type` + actor id) so `--repeat-each=N` can't cross-
 * contaminate from prior iterations' chat cards.
 */
test.describe('§5 Versus Tests — tie-break with Level 3 trait', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });
  });

  test('tied versus — A spends an L3 trait and wins (DH p.80)', async ({ page }) => {
    const suffix = Date.now();
    const initiatorName = `E2E VersusTie A ${suffix}`;
    const opponentName = `E2E VersusTie B ${suffix}`;
    const l3TraitName = `E2E L3 Trait ${suffix}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Seed A with a Level 3 trait Item and B with only a Level 1 trait
    // (so B has nothing to spend in the tied card). Both actors get
    // Will = 3 so a 3D pool of all-6s = 3 successes both ways (tie).
    // `fresh: false` so conditions don't nudge the pool; pip state is
    // zeroed so advancement logging doesn't interfere with assertions.
    // See module/data/item/trait.mjs — `level` is NumberField min=1 max=3,
    // `beneficial` is unused for L3 (maxBeneficial getter returns 0;
    // unlimited per session).
    const { initiatorId, opponentId, l3TraitId, l1TraitId } = await page.evaluate(
      async ({ iN, oN, tN }) => {
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
        // A: one L3 trait, eligible for beneficial tie-break.
        const [l3] = await init.createEmbeddedDocuments('Item', [
          { name: tN, type: 'trait', system: { level: 3, beneficial: 0 } }
        ]);
        // B: one L1 trait — not eligible for L3 tie-break (level !== 3).
        // Present just to prove the UI's per-side asymmetry holds.
        const [l1] = await opp.createEmbeddedDocuments('Item', [
          { name: `${tN} (B L1)`, type: 'trait', system: { level: 1, beneficial: 1 } }
        ]);
        return { initiatorId: init.id, opponentId: opp.id, l3TraitId: l3.id, l1TraitId: l1.id };
      },
      { iN: initiatorName, oN: opponentName, tN: l3TraitName }
    );
    expect(initiatorId).toBeTruthy();
    expect(opponentId).toBeTruthy();
    expect(l3TraitId).toBeTruthy();
    expect(l1TraitId).toBeTruthy();

    /* ---------- Phase 1 — initiator rolls (all 6s → 3 successes) ---------- */

    await page.evaluate(() => {
      globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => 0.001;
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
    await initCard.clickFinalize();

    await page.evaluate((id) => {
      for (const app of Object.values(foundry.applications.instances)) {
        if (app?.actor?.id === id) app.close();
      }
    }, initiatorId);

    /* ---------- Phase 2 — opponent rolls (all 6s → 3 successes, TIE) ---------- */

    // PRNG still on 0.001 from Phase 1 — both sides land on 3 successes.
    // (Explicit re-stub anyway for resilience against any production code
    // that might swap the RNG between phases.)
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

    /* ---------- Phase 3 — opponent finalizes, tied card posts ---------- */

    // With both sides resolved AND iSuccesses === oSuccesses, the
    // `_executeVersusResolution` branch at versus.mjs line 153-158
    // delegates to `_handleVersusTied`, posting a versus-tied card
    // instead of a resolution card. Both original roll messages get
    // their `versus.resolved` set and are removed from
    // PendingVersusRegistry (versus.mjs lines 391-393).
    await oppCard.clickFinalize();

    const tiedMessageId = await page.evaluate(async ({ initId, oppId, iActorId, oActorId }) => {
      const started = Date.now();
      while (Date.now() - started < 10_000) {
        const msg = game.messages.contents.find(m => {
          const vs = m.flags?.tb2e?.versus;
          return vs?.type === 'tied'
            && vs.initiatorMessageId === initId
            && vs.opponentMessageId === oppId
            && vs.initiatorActorId === iActorId
            && vs.opponentActorId === oActorId;
        });
        if (msg) return msg.id;
        await new Promise(r => setTimeout(r, 100));
      }
      return null;
    }, {
      initId: initiatorMessageId, oppId: opponentMessageId,
      iActorId: initiatorId, oActorId: opponentId
    });
    expect(tiedMessageId).toBeTruthy();

    const tiedCard = new VersusTiedCard(page, tiedMessageId);
    await tiedCard.expectPresent();

    // A's L3 button is present and clickable. B has no L3 trait, so
    // B's L3 button list is empty — the `{{else}}` branch in
    // versus-tied.hbs line 59-61 renders a `.tied-no-traits` span
    // instead of a button. This proves per-side asymmetry: only actors
    // with L3 traits see a tie-win button.
    await expect(tiedCard.level3BreakTieButton(initiatorId, l3TraitId)).toBeVisible();
    await expect(tiedCard.level3BreakTieButtonsFor(opponentId)).toHaveCount(0);

    // Tied flags shape: both sides' successes are 3, flags carry enough
    // metadata for _resolveFromTied to post the resolution and to log
    // advancement if desired (we don't assert advancement here — that's
    // covered by other roll specs).
    const tiedFlags = await page.evaluate((mid) => {
      const msg = game.messages.get(mid);
      const vs = msg?.flags?.tb2e?.versus;
      if (!vs) return null;
      return {
        type: vs.type,
        initiatorSuccesses: vs.initiatorSuccesses,
        opponentSuccesses: vs.opponentSuccesses,
        tiedResolved: !!msg.flags?.tb2e?.tiedResolved
      };
    }, tiedMessageId);
    expect(tiedFlags).toEqual({
      type: 'tied',
      initiatorSuccesses: 3,
      opponentSuccesses: 3,
      tiedResolved: false
    });

    // Both roll messages are now marked `versus.resolved: true` (the
    // tied path also flips this so the initiator message won't show up
    // in future challenge dropdowns).
    const pendingResolved = await page.evaluate(({ initId, oppId }) => {
      const init = game.messages.get(initId);
      const opp = game.messages.get(oppId);
      return {
        initResolved: !!init?.flags?.tb2e?.versus?.resolved,
        oppResolved: !!opp?.flags?.tb2e?.versus?.resolved
      };
    }, { initId: initiatorMessageId, oppId: opponentMessageId });
    expect(pendingResolved).toEqual({ initResolved: true, oppResolved: true });

    // Close the opponent sheet to clean up the DOM before the resolution
    // card assertions.
    await page.evaluate((id) => {
      for (const app of Object.values(foundry.applications.instances)) {
        if (app?.actor?.id === id) app.close();
      }
    }, opponentId);

    /* ---------- Phase 4 — A spends L3 trait, resolution posts ---------- */

    // Click A's "Win the tie" button for the L3 trait. Handler path:
    //   tb2e.mjs line 174-180 → handleLevel3TraitBreakTie(versus.mjs
    //   line 485-518) → _resolveFromTied (line 523-617) posts a
    //   versus-resolution message with A as winner.
    await tiedCard.clickLevel3BreakTie(initiatorId, l3TraitId);

    const resolutionMessageId = await page.evaluate(async ({ initId, oppId, iActorId }) => {
      const started = Date.now();
      while (Date.now() - started < 10_000) {
        const msg = game.messages.contents.find(m => {
          const vs = m.flags?.tb2e?.versus;
          return vs?.type === 'resolution'
            && vs.initiatorMessageId === initId
            && vs.opponentMessageId === oppId
            && vs.winnerId === iActorId;
        });
        if (msg) return msg.id;
        await new Promise(r => setTimeout(r, 100));
      }
      return null;
    }, { initId: initiatorMessageId, oppId: opponentMessageId, iActorId: initiatorId });
    expect(resolutionMessageId).toBeTruthy();

    const resolution = new VersusResolutionCard(page, resolutionMessageId);
    await resolution.expectPresent();

    // A wins the tie; initiator block is the winner.
    expect(await resolution.initiatorIsWinner()).toBe(true);
    expect(await resolution.getWinnerName()).toBe(initiatorName);

    // Both sides show 3 successes — the tie-break doesn't alter the
    // recorded success counts, only the winner.
    expect(await resolution.getInitiatorSuccesses()).toBe(3);
    expect(await resolution.getOpponentSuccesses()).toBe(3);
    expect(await resolution.getMargin()).toBe(0);

    // Flag-level resolution card shape.
    const resolutionFlags = await page.evaluate((mid) => {
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
    expect(resolutionFlags).toEqual({
      type: 'resolution',
      winnerId: initiatorId,
      initiatorActorId: initiatorId,
      opponentActorId: opponentId,
      initiatorMessageId,
      opponentMessageId
    });

    // Tied card is now marked resolved (versus.mjs line 569
    // `tiedMessage.update({ "flags.tb2e.tiedResolved": true })`).
    const tiedAfter = await page.evaluate((mid) => {
      const msg = game.messages.get(mid);
      return {
        tiedResolved: !!msg?.flags?.tb2e?.tiedResolved
      };
    }, tiedMessageId);
    expect(tiedAfter).toEqual({ tiedResolved: true });

    // L3 beneficial tie-break is unlimited per session — versus.mjs
    // `handleLevel3TraitBreakTie` does NOT mutate the trait (no
    // `usedAgainst: true`, no `beneficial` decrement). Verify the L3
    // trait remains in its pre-tie-break state: level 3, usedAgainst
    // false, beneficial unchanged.
    const l3After = await page.evaluate(({ aId, tId }) => {
      const item = game.actors.get(aId)?.items.get(tId);
      if (!item) return null;
      return {
        level: item.system.level,
        usedAgainst: item.system.usedAgainst,
        beneficial: item.system.beneficial
      };
    }, { aId: initiatorId, tId: l3TraitId });
    expect(l3After).toEqual({ level: 3, usedAgainst: false, beneficial: 0 });

    /* ---------- Cleanup ---------- */

    await page.evaluate(({ iId, oId }) => {
      game.actors.get(iId)?.delete();
      game.actors.get(oId)?.delete();
    }, { iId: initiatorId, oId: opponentId });
  });
});
