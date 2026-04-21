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
 * §5 Versus Tests — tie, no side has a Level 3 trait to spend. One side
 * uses a lower-level trait **against themselves** — conceding the tie in
 * the opponent's favor and earning 2 checks (SG p.33, DH p.80).
 *
 * Rules under test (SG p.33 "Breaking Ties"):
 *   - When a versus test is tied, the list of tie-break options includes
 *     "Use a trait to break a tie in your opponent's favor and earn two
 *     checks for use in the next camp phase." This rule applies to ANY
 *     trait level — it is the "concession" path, distinct from the
 *     Level 3 "+1s wins the tie in your favor" beneficial path covered by
 *     `tie-break.spec.mjs` (line 211).
 *   - Advancement: SG p.34 "Ties and Advancement" — breaking a tie in
 *     your opponent's favor via a trait marks a FAILED test for the
 *     conceder's ability/skill. That's the same `logAdvancementForSide`
 *     call the resolution path makes (versus.mjs line 572-585); this
 *     spec doesn't assert advancement logging (covered by the roll specs).
 *
 * Implementation map (what the concession path actually does in code):
 *   - Eligibility surface: `_getEligibleTieBreakTraits`
 *     (module/dice/versus.mjs line 278-282) filters
 *     `actor.itemTypes.trait` to traits that have a name and whose
 *     `system.usedAgainst` is still false. Level is NOT restricted —
 *     L1/L2/L3 all qualify for this button set. The template renders one
 *     amber `[data-action="trait-break-tie"]` button per eligible trait
 *     (templates/chat/versus-tied.hbs line 76-79 / 90-93).
 *   - Handler: `handleTraitBreakTie` (versus.mjs line 435-476). Guards:
 *       1. message's `versus.type === "tied"` and not already `tiedResolved`
 *          (line 437-438)
 *       2. trait exists and `!trait.system.usedAgainst` (line 443-447)
 *       3. once-per-test — the original roll message must not have a
 *          `flags.tb2e.trait.itemId` (line 450-456 `_wasTraitUsedOnRoll`)
 *   - Effects (the "earn 2 checks" rule):
 *       - trait.update: `system.checks += 2`, `system.usedAgainst = true`
 *         (line 459-462) — `usedAgainst` is the DH's "once per session"
 *         gate; the 2 checks live on the trait item itself.
 *       - actor.update: `system.checks += 2` — ONLY for characters
 *         (`actor.type === "character"`, line 463-467). NPC/monster
 *         concession paths skip this actor-level counter.
 *       - winnerId = the OTHER actor (line 471); the conceder's actor is
 *         the loser. `_resolveFromTied` (line 523-617) posts a
 *         versus-resolution card with a `tiebrokenBy` body block rendered
 *         from `TB2E.Trait.BrokeTie` ("<Name> broke the tie with
 *         <Trait>") — visible in `.versus-tiebroken` (versus-resolution.hbs
 *         line 24-28).
 *       - Tied card flips `flags.tb2e.tiedResolved: true` (line 569).
 *
 * Why a character's `system.checks` and the trait's `system.checks` both
 * increase by 2: `actor.system.checks` is the aggregate counter consumed
 * by the camp phase (module/data/actor/character.mjs line 57). The trait
 * item also tracks `system.checks` (module/data/item/trait.mjs line 12)
 * so the sheet can show which specific trait earned the check — the
 * handler writes both (versus.mjs line 459-467). Both are asserted.
 *
 * Shape decision — why this spec tests the concession path rather than a
 * "pure stand-off":
 *   - The tied card remains open indefinitely. There is no auto-resolved
 *     "compromise / stand-off" outcome in code (no timer, no empty-state
 *     resolution card). If neither actor has any trait AT ALL, the card
 *     shows empty buttons + a tiebreaker-roll instruction banner pointing
 *     players to SG p.33's "Tiebreaker Rolls" flow (a fresh Will/Health/
 *     Nature versus test) — that flow is out of scope for the automated
 *     suite and lives in the tie-break list on SG p.32 as a separate
 *     mechanic. The TEST_PLAN.md phrasing "compromise / stand-off" is
 *     read here as the conceder branch which IS the codepath that closes
 *     the tied card without the players rolling again.
 *   - `tie-break.spec.mjs` covers the L3 beneficial path. This spec
 *     covers the non-L3 concession path, so together the two specs
 *     exhaust the tied-card button handlers.
 *
 * Dice determinism: same PRNG-stub pattern as `tie-break.spec.mjs` and
 * `initiate-respond.spec.mjs` — stub `CONFIG.Dice.randomUniform` to
 * `() => 0.001` (all 6s) so 3D × all-6s = 3 successes on both sides →
 * `_executeVersusResolution` detects `iSuccesses === oSuccesses` and
 * routes to `_handleVersusTied`.
 *
 * Actor-scoping: message lookups filter by the actor ids we create here,
 * and locators pin to `data-message-id` via the VersusCard POMs, so
 * `--repeat-each=N` cannot cross-contaminate from prior iterations'
 * chat log entries.
 */
test.describe('§5 Versus Tests — tie, concede with non-L3 trait', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });
  });

  test('tied versus — B concedes with an L1 trait, A wins and B earns 2 checks (SG p.33)', async ({ page }) => {
    const suffix = Date.now();
    const initiatorName = `E2E VersusTieNoTrait A ${suffix}`;
    const opponentName = `E2E VersusTieNoTrait B ${suffix}`;
    const aTraitName = `E2E A L2 Trait ${suffix}`;
    const bTraitName = `E2E B L1 Trait ${suffix}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Seed both actors with a single NON-Level-3 trait (A: L2, B: L1).
    // Neither has a level-3 trait, so the L3 "win the tie" buttons must
    // be absent for both sides (versus-tied.hbs line 41-43 / 59-61 renders
    // `.tied-no-traits` in that case). Both `trait-break-tie` buttons
    // DO render: level is not restricted in `_getEligibleTieBreakTraits`.
    //
    // Abilities: Will = 3 on both sides, so 3D × all-6s → 3 successes
    // each (tie). `conditions.fresh = false` so condition +1s doesn't
    // nudge the pool (see _getConditionDieBonus behavior in character
    // data). Pips zeroed so advancement logging stays predictable.
    const { initiatorId, opponentId, aTraitId, bTraitId } = await page.evaluate(
      async ({ iN, oN, aTN, bTN }) => {
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
        // A: one L2 trait. `beneficial: 2` is the typical max for L2 but
        // the concession path only checks `usedAgainst`, so the initial
        // `beneficial` count doesn't gate the button.
        const [aTrait] = await init.createEmbeddedDocuments('Item', [
          { name: aTN, type: 'trait', system: { level: 2, beneficial: 2 } }
        ]);
        // B: one L1 trait. B is the side that will concede in this spec.
        const [bTrait] = await opp.createEmbeddedDocuments('Item', [
          { name: bTN, type: 'trait', system: { level: 1, beneficial: 1 } }
        ]);
        return {
          initiatorId: init.id, opponentId: opp.id,
          aTraitId: aTrait.id, bTraitId: bTrait.id
        };
      },
      { iN: initiatorName, oN: opponentName, aTN: aTraitName, bTN: bTraitName }
    );
    expect(initiatorId).toBeTruthy();
    expect(opponentId).toBeTruthy();
    expect(aTraitId).toBeTruthy();
    expect(bTraitId).toBeTruthy();

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

    /* ---------- Phase 3 — opponent finalizes; tied card posts ---------- */

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

    // Neither side has a Level 3 trait, so both sides' L3 button lists
    // render empty (the template's `{{else}}` branches in versus-tied.hbs
    // line 41-43 / 59-61 emit `.tied-no-traits` "No Level 3 trait"
    // placeholders instead). This is the KEY distinction from
    // `tie-break.spec.mjs` — neither side can win the tie outright;
    // someone must either concede or go to a tiebreaker roll.
    await expect(tiedCard.level3BreakTieButtonsFor(initiatorId)).toHaveCount(0);
    await expect(tiedCard.level3BreakTieButtonsFor(opponentId)).toHaveCount(0);

    // BOTH sides have their (non-L3) `trait-break-tie` concession button.
    // `_getEligibleTieBreakTraits` (versus.mjs line 278-282) doesn't
    // restrict level — L1/L2/L3 all qualify for the concession action.
    await expect(tiedCard.traitBreakTieButton(initiatorId, aTraitId)).toBeVisible();
    await expect(tiedCard.traitBreakTieButton(opponentId, bTraitId)).toBeVisible();
    await expect(tiedCard.traitBreakTieButtonsFor(initiatorId)).toHaveCount(1);
    await expect(tiedCard.traitBreakTieButtonsFor(opponentId)).toHaveCount(1);

    // Close the opponent sheet before the concession click so the chat
    // log isn't obscured by a sheet window during DOM reads.
    await page.evaluate((id) => {
      for (const app of Object.values(foundry.applications.instances)) {
        if (app?.actor?.id === id) app.close();
      }
    }, opponentId);

    /* ---------- Phase 4 — B concedes with L1 trait, A wins ---------- */

    // Snapshot pre-concession state so the +2 checks deltas are visible.
    // Character starts with `system.checks: 0` (initial value in
    // module/data/actor/character.mjs line 57); trait starts with
    // `system.checks: 0` (trait.mjs line 12). Assert the before-state
    // explicitly so a regression that starts characters with non-zero
    // checks doesn't make the delta assertion silently pass.
    const before = await page.evaluate(({ aId, tId }) => {
      const actor = game.actors.get(aId);
      const trait = actor?.items.get(tId);
      return {
        actorChecks: actor?.system.checks,
        traitChecks: trait?.system.checks,
        traitUsedAgainst: trait?.system.usedAgainst
      };
    }, { aId: opponentId, tId: bTraitId });
    expect(before).toEqual({
      actorChecks: 0,
      traitChecks: 0,
      traitUsedAgainst: false
    });

    // B clicks their concede button. Handler: tb2e.mjs line 167-173
    // wires `trait-break-tie` buttons → `handleTraitBreakTie`
    // (versus.mjs line 435-476) → `_resolveFromTied` posts a resolution
    // card with `winnerId: opponentId`'s OPPOSITE (i.e. A / initiatorId).
    await tiedCard.clickTraitBreakTie(opponentId, bTraitId);

    const resolutionMessageId = await page.evaluate(async ({ initId, oppId, winnerActorId }) => {
      const started = Date.now();
      while (Date.now() - started < 10_000) {
        const msg = game.messages.contents.find(m => {
          const vs = m.flags?.tb2e?.versus;
          return vs?.type === 'resolution'
            && vs.initiatorMessageId === initId
            && vs.opponentMessageId === oppId
            && vs.winnerId === winnerActorId;
        });
        if (msg) return msg.id;
        await new Promise(r => setTimeout(r, 100));
      }
      return null;
    }, { initId: initiatorMessageId, oppId: opponentMessageId, winnerActorId: initiatorId });
    expect(resolutionMessageId).toBeTruthy();

    const resolution = new VersusResolutionCard(page, resolutionMessageId);
    await resolution.expectPresent();

    // A (initiator) is the winner. B conceded, so A wins by the handler
    // line 471: `winnerId = isInitiator ? opponent : initiator`. Here
    // the conceder is opponent, so winner = initiator.
    expect(await resolution.initiatorIsWinner()).toBe(true);
    expect(await resolution.getWinnerName()).toBe(initiatorName);

    // Both sides still show 3 successes — the concession does NOT alter
    // the recorded success counts, only the winner (same as the L3 path).
    expect(await resolution.getInitiatorSuccesses()).toBe(3);
    expect(await resolution.getOpponentSuccesses()).toBe(3);
    expect(await resolution.getMargin()).toBe(0);

    // Flag-level resolution shape — winnerId must be A, both actor ids
    // and message ids carried over from the tied card.
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

    // Tied card is now marked resolved (versus.mjs line 569).
    const tiedAfter = await page.evaluate((mid) => {
      const msg = game.messages.get(mid);
      return {
        tiedResolved: !!msg?.flags?.tb2e?.tiedResolved
      };
    }, tiedMessageId);
    expect(tiedAfter).toEqual({ tiedResolved: true });

    // Concession aftermath on B: +2 checks on the actor AND +2 checks on
    // the trait, trait flipped `usedAgainst: true` (versus.mjs line
    // 459-467). `usedAgainst` is the once-per-session concession gate —
    // the same trait cannot be used to concede a second tie this session.
    const after = await page.evaluate(({ aId, tId }) => {
      const actor = game.actors.get(aId);
      const trait = actor?.items.get(tId);
      return {
        actorChecks: actor?.system.checks,
        traitChecks: trait?.system.checks,
        traitUsedAgainst: trait?.system.usedAgainst,
        traitLevel: trait?.system.level
      };
    }, { aId: opponentId, tId: bTraitId });
    expect(after).toEqual({
      actorChecks: 2,
      traitChecks: 2,
      traitUsedAgainst: true,
      traitLevel: 1
    });

    // A (the winner) did NOT earn checks — only the conceder earns the
    // 2 checks (SG p.33: "earn two checks for your trouble"). Verify A's
    // checks counter and A's L2 trait are both untouched.
    const winnerAfter = await page.evaluate(({ aId, tId }) => {
      const actor = game.actors.get(aId);
      const trait = actor?.items.get(tId);
      return {
        actorChecks: actor?.system.checks,
        traitChecks: trait?.system.checks,
        traitUsedAgainst: trait?.system.usedAgainst
      };
    }, { aId: initiatorId, tId: aTraitId });
    expect(winnerAfter).toEqual({
      actorChecks: 0,
      traitChecks: 0,
      traitUsedAgainst: false
    });

    /* ---------- Cleanup ---------- */

    await page.evaluate(({ iId, oId }) => {
      game.actors.get(iId)?.delete();
      game.actors.get(oId)?.delete();
    }, { iId: initiatorId, oId: opponentId });
  });
});
