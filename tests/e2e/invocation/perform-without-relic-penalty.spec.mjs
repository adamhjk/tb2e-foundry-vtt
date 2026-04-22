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
 * §7 Invocations & Relics — perform a VERSUS-type Theurge invocation WITHOUT
 * a relic. The rules-as-written penalty is a -1s post-timing success modifier
 * applied to the caster's versus pool (NOT a +1 Ob bump — that's the
 * fixed-Ob branch at invocation-casting.mjs:50-55). Bone Knitter's sibling
 * specs cover the fixed-Ob no-relic path (line 261) and the with-relic auto-
 * detection path (line 262); this one covers the versus branch at
 * invocation-casting.mjs:64-76.
 *
 * Rules under test:
 *   - `performInvocation` (invocation-casting.mjs:64-76) routes versus-type
 *     invocations through `rollTest` with `testContext.isVersus = true`. The
 *     roll dialog pre-sets versus mode (tb2e-roll.mjs:929-937), same as
 *     cast-versus.spec.mjs.
 *   - When `!hasRelic`, a post-timing `success` modifier with value -1 is
 *     pushed into `contextModifiers` with label `TB2E.Invocation.NoRelicPenalty`
 *     ("No Relic (-1s)" per lang/en.json:896) — invocation-casting.mjs:66-74.
 *   - `_handleVersusRoll` (tb2e-roll.mjs:1566-1653) stores the raw successes
 *     on `flags.tb2e.roll.successes` AND an adjusted `finalSuccesses =
 *     max(successes + postSuccessBonus, 0)` on `flags.tb2e.roll.finalSuccesses`
 *     (tb2e-roll.mjs:1577-1583). The `postSuccessMods` array is serialized
 *     onto the message flags (tb2e-roll.mjs:1457) so the penalty is provable
 *     on the initiator's card.
 *   - At resolution, `_executeVersusResolution` (versus.mjs:146-147) reads
 *     `iRoll.finalSuccesses ?? iRoll.successes`, so the caster's effective
 *     successes on the resolution card reflect the penalty.
 *   - `testContext.burdenAmount` is still set to the full `burden` (not
 *     `burdenWithRelic`) on the caster's flags, because `hasRelic=false` —
 *     invocation-casting.mjs:39 picks `burden` over `burdenWithRelic`. The
 *     burden is NOT actually applied here, though: post-roll.mjs:507-521
 *     takes the versus branch and returns BEFORE the
 *     `processInvocationPerformed` call at post-roll.mjs:582-584. Versus
 *     resolution (versus.mjs:137-267) also does not call it — only
 *     `processSpellCast` (line 258-266). So for versus invocations the
 *     burden/performed side-effects are a separate production concern
 *     outside this spec's scope; we only assert `burdenAmount` survives on
 *     the roll flags.
 *
 * Source invocation: `Wrath of the Lords of Law`
 * (packs/_source/theurge-invocations/Wrath_of_the_Lords_of_Law_a00000000000001b.yml,
 * `_id: a00000000000001b`). `castingType: versus`, `versusDefense: nature`,
 * `burden: 3`, `burdenWithRelic: 2`, `sacramental: ''`, `relic: "Crown of
 * the Lords of Law"`. DH p.223.
 *
 * Dice determinism:
 *   - Caster PRNG stub `u=0.001 ⇒ every die = 6` ⇒ Ritualist 4 = 4 raw
 *     successes, 3 after the -1s penalty (versus.mjs:146 reads
 *     finalSuccesses).
 *   - Opponent PRNG stub `u=0.5 ⇒ every die = 3` ⇒ Will 3 = 0 successes (all
 *     wyrms). Caster deterministically wins 3 vs 0, margin 3.
 *
 * Actor-scoping for `--repeat-each`:
 *   - Both actors use `Date.now()` suffixes.
 *   - Flag queries filter by actor id; the VersusCard POMs pin message ids
 *     by versus.type + invocationId so stale cards from earlier iterations
 *     can't satisfy polls.
 *
 * Narrow scope — out of scope (other §7 checkboxes):
 *   - Fixed-Ob no-relic +1 Ob bump (line 261 — perform-basic.spec.mjs).
 *   - Relic auto-detection / burdenWithRelic (line 262 — perform-with-relic.
 *     spec.mjs).
 *   - Sacramental behavior (line 264).
 *   - Shaman invocations (line 265).
 *   - Dropped-relic NOT auto-detected (line 266).
 *   - Deep versus resolution (covered by §5 — initiate-respond.spec.mjs).
 */
const INVOCATION_NAME = 'Wrath of the Lords of Law';
const INVOCATION_ID = 'a00000000000001b'; // packs/_source/theurge-invocations/Wrath_of_the_Lords_of_Law_a00000000000001b.yml
const INVOCATIONS_PACK = 'tb2e.theurge-invocations';
const EXPECTED_BURDEN = 3;          // Wrath_of_the_Lords_of_Law.yml — burden (full, no-relic path)
const NO_RELIC_PENALTY_LABEL = 'No Relic (-1s)'; // lang/en.json:896 — TB2E.Invocation.NoRelicPenalty

test.describe('§7 Invocations — perform versus Theurge invocation without relic (-1s penalty)', () => {
  test.afterEach(async ({ page }) => {
    // Match sibling §7 + versus specs: clean up the PRNG stub so downstream
    // specs see real randomness.
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });
  });

  test('performs Wrath of the Lords of Law with no relic → -1s modifier applied to versus pool; caster wins with 3 effective successes', async ({ page }) => {
    const suffix = Date.now();
    const casterName = `E2E Invocation Versus NoRelic Caster ${suffix}`;
    const opponentName = `E2E Invocation Versus NoRelic Opponent ${suffix}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Stage caster (Ritualist 4 — invocations roll Ritualist per
    // invocation-casting.mjs:75) + opponent (Will 3). `fresh: false` on
    // both pins pools to the rating exactly (no +1D fresh bonus from
    // gatherConditionModifiers — DH p.85). Urðr capacity 5 so burden 0 → 3
    // stays under capacity (avoids the separate burden-exceeded card path
    // at invocation-casting.mjs:257-260).
    const { casterId, opponentId } = await page.evaluate(async ({ cN, oN }) => {
      const caster = await Actor.create({
        name: cN,
        type: 'character',
        system: {
          abilities: {
            will:   { rating: 4, pass: 0, fail: 0 },
            health: { rating: 3, pass: 0, fail: 0 },
            nature: { rating: 3, max: 3, pass: 0, fail: 0 }
          },
          skills: {
            ritualist: { rating: 4, pass: 0, fail: 0, learning: 0 }
          },
          conditions: { fresh: false },
          urdr: { capacity: 5, burden: 0 }
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
      return { casterId: caster.id, opponentId: opp.id };
    }, { cN: casterName, oN: opponentName });
    expect(casterId).toBeTruthy();
    expect(opponentId).toBeTruthy();

    // Embed invocation on caster — no relic items on the actor, so
    // `findApplicableRelic` returns undefined and `_askRelicStatus` shows
    // the fallback dialog referencing `invocation.system.relic` ("Crown of
    // the Lords of Law") per invocation-casting.mjs:111-116.
    const invocationItemId = await page.evaluate(
      async ({ id, packId, entryId }) => {
        const actor = game.actors.get(id);
        const pack = game.packs.get(packId);
        const src = await pack.getDocument(entryId);
        const data = src.toObject();
        const [created] = await actor.createEmbeddedDocuments('Item', [data]);
        return created.id;
      },
      { id: casterId, packId: INVOCATIONS_PACK, entryId: INVOCATION_ID }
    );
    expect(invocationItemId).toBeTruthy();

    // Sanity-check the embedded invocation is the versus-type Wrath we
    // want, with no sacramental bonus. Also confirm no relic items on the
    // actor (so the no-relic penalty branch fires).
    const invocationState = await page.evaluate(
      ({ id, iid }) => {
        const actor = game.actors.get(id);
        const item = actor.items.get(iid);
        return {
          name: item?.name,
          castingType: item?.system.castingType,
          versusDefense: item?.system.versusDefense,
          burden: item?.system.burden,
          burdenWithRelic: item?.system.burdenWithRelic,
          sacramental: item?.system.sacramental,
          performed: item?.system.performed,
          relicCount: (actor.itemTypes.relic || []).length,
          startingBurden: actor.system.urdr.burden
        };
      },
      { id: casterId, iid: invocationItemId }
    );
    expect(invocationState).toEqual({
      name: INVOCATION_NAME,
      castingType: 'versus',
      versusDefense: 'nature',
      burden: EXPECTED_BURDEN,
      burdenWithRelic: 2,
      sacramental: '',
      performed: false,
      relicCount: 0,
      startingBurden: 0
    });

    /* ---------- Phase 1 — caster performs the invocation ---------- */

    // Stub PRNG → all-6s. 4D Ritualist for caster = 4 raw successes, which
    // the -1s post-timing penalty will reduce to 3 effective.
    await page.evaluate(() => {
      globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => 0.001;
    });

    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, casterId);

    const casterSheet = new CharacterSheet(page, casterName);
    await casterSheet.expectOpen();
    await casterSheet.openMagicTab();

    const invocationRow = casterSheet.invocationRow(invocationItemId);
    await expect(invocationRow).toBeVisible();
    const performButton = invocationRow.locator(
      'button[data-action="performInvocation"]'
    );
    await expect(performButton).toBeVisible();

    await performButton.click();

    // _askRelicStatus (invocation-casting.mjs:118-136) opens a DialogV2 with
    // two buttons: `data-action="yes"` / `data-action="no"`. The fallback
    // branch (invocation-casting.mjs:111-116) shows `RelicPrompt` with the
    // invocation's `relic` name ("Crown of the Lords of Law"). Click
    // "Without Relic" — resolves hasRelic=false, triggering the -1s
    // penalty push at invocation-casting.mjs:66-74.
    const relicDialog = page
      .locator('dialog.application.dialog')
      .filter({ has: page.locator('button[data-action="no"]') })
      .last();
    await expect(relicDialog).toBeVisible();
    await relicDialog.locator('button[data-action="no"]').click();
    await expect(relicDialog).toBeHidden();

    // Roll dialog: pre-set to versus mode because `testContext.isVersus`
    // (tb2e-roll.mjs:929-937). Pool = Ritualist rating 4 (no obstacle —
    // obstacle field hidden in versus mode).
    const casterDialog = new RollDialog(page);
    await casterDialog.waitForOpen();
    expect(await casterDialog.getPoolSize()).toBe(4);
    await expect(casterDialog.modeInput).toHaveValue('versus');
    const dialogExtras = VersusDialogExtras.scopeOf(casterDialog);
    await expect(dialogExtras.challengeBlock).not.toHaveClass(
      /(^|\s)hidden(\s|$)/
    );

    // -1s "No Relic" modifier row renders in the dialog BEFORE submit —
    // tb2e-roll.mjs:517-544 iterates `contextModifiers` including the one
    // pushed by invocation-casting.mjs:66-74. Label text from
    // lang/en.json:896 — `TB2E.Invocation.NoRelicPenalty` = "No Relic (-1s)".
    const noRelicModRow = casterDialog.root
      .locator('.roll-modifier', { hasText: NO_RELIC_PENALTY_LABEL });
    await expect(noRelicModRow).toBeVisible();

    await casterDialog.submit();

    // Poll for the initiator message, scoped by actor id + invocationId so
    // stale cards from earlier iterations can't satisfy this query.
    const casterMessageId = await page.evaluate(async ({ actorId, iid }) => {
      const started = Date.now();
      while (Date.now() - started < 10_000) {
        const msg = game.messages.contents.find(m => {
          const vs = m.flags?.tb2e?.versus;
          const tc = m.flags?.tb2e?.testContext;
          return vs?.type === 'initiator'
            && vs.initiatorActorId === actorId
            && tc?.invocationId === iid;
        });
        if (msg) return msg.id;
        await new Promise(r => setTimeout(r, 100));
      }
      return null;
    }, { actorId: casterId, iid: invocationItemId });
    expect(casterMessageId).toBeTruthy();

    const casterCard = new VersusPendingCard(page, casterMessageId);
    await casterCard.expectPresent();
    await casterCard.expectPending();

    // Flag-level proof: the raw 4 successes survive on roll.successes, but
    // finalSuccesses is 3 (4 + -1). postSuccessMods carries the -1s entry
    // (tb2e-roll.mjs:1457). testContext carries hasRelic=false and
    // burdenAmount=burden (full, no-relic path per invocation-casting.mjs:39).
    const casterFlags = await page.evaluate((mid) => {
      const msg = game.messages.get(mid);
      const tb = msg?.flags?.tb2e;
      const r = tb?.roll;
      const vs = tb?.versus;
      const tc = tb?.testContext;
      const psm = tb?.postSuccessMods;
      return (r && vs && tc && psm) ? {
        rollType: r.type,
        rollKey: r.key,
        baseDice: r.baseDice,
        poolSize: r.poolSize,
        successes: r.successes,
        finalSuccesses: r.finalSuccesses,
        invocationId: tc.invocationId,
        invocationName: tc.invocationName,
        hasRelic: tc.hasRelic,
        burdenAmount: tc.burdenAmount,
        versusType: vs.type,
        postSuccessMods: psm.map(m => ({
          label: m.label, type: m.type, value: m.value, source: m.source, timing: m.timing
        }))
      } : null;
    }, casterMessageId);
    expect(casterFlags).toEqual({
      rollType: 'skill',
      rollKey: 'ritualist',
      baseDice: 4,
      poolSize: 4,
      successes: 4,
      finalSuccesses: 3,
      invocationId: invocationItemId,
      invocationName: INVOCATION_NAME,
      hasRelic: false,
      burdenAmount: EXPECTED_BURDEN,
      versusType: 'initiator',
      postSuccessMods: [{
        label: NO_RELIC_PENALTY_LABEL,
        type: 'success',
        value: -1,
        source: 'invocation',
        timing: 'post'
      }]
    });

    // Finalize the caster's card. For versus, post-roll.mjs:507-521 takes
    // the versus branch and returns early — processInvocationPerformed is
    // NOT called here (compare to fixed-Ob path at post-roll.mjs:582-584).
    // Versus resolution (versus.mjs:258-266) only calls processSpellCast,
    // never processInvocationPerformed. So burden/performed side-effects
    // for versus invocations are out of scope for this spec — we only
    // assert the -1s penalty on the caster's roll.
    await casterCard.clickFinalize();
    await expect(casterCard.resolvedBanner).toBeVisible();

    // Close caster sheet so opponent sheet opens cleanly.
    await page.evaluate((id) => {
      for (const app of Object.values(foundry.applications.instances)) {
        if (app?.actor?.id === id) app.close();
      }
    }, casterId);

    /* ---------- Phase 2 — opponent responds ---------- */

    // Swap PRNG → all-3s (wyrms). 3D Will for opponent = 0 successes.
    await page.evaluate(() => {
      CONFIG.Dice.randomUniform = () => 0.5;
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

    // Opponent's dialog opens independent — cycle once to versus + pick
    // the caster's message from the challenge dropdown.
    await VersusDialogExtras.switchToVersus(oppDialog);
    await VersusDialogExtras.selectChallenge(oppDialog, casterMessageId);
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
    }, { actorId: opponentId, initId: casterMessageId });
    expect(opponentMessageId).toBeTruthy();

    const oppCard = new VersusPendingCard(page, opponentMessageId);
    await oppCard.expectPresent();
    await oppCard.expectPending();

    /* ---------- Phase 3 — opponent finalizes, resolution posts ---------- */

    await oppCard.clickFinalize();

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
    }, { initId: casterMessageId, oppId: opponentMessageId });
    expect(resolutionMessageId).toBeTruthy();

    /* ---------- Phase 4 — assert -1s penalty reflected in resolution ---------- */

    const resolution = new VersusResolutionCard(page, resolutionMessageId);
    await resolution.expectPresent();

    // Core assertion: the caster's effective successes on the resolution
    // card are 3 (4 raw - 1s penalty). versus.mjs:146-147 reads
    // finalSuccesses for the comparison. Without the penalty, this would
    // read 4. Opponent rolled 0.
    expect(await resolution.initiatorIsWinner()).toBe(true);
    expect(await resolution.getWinnerName()).toBe(casterName);
    expect(await resolution.getInitiatorSuccesses()).toBe(3);
    expect(await resolution.getOpponentSuccesses()).toBe(0);
    expect(await resolution.getMargin()).toBe(3);

    const resolutionFlags = await page.evaluate((mid) => {
      const msg = game.messages.get(mid);
      const vs = msg?.flags?.tb2e?.versus;
      if (!vs) return null;
      return {
        type: vs.type,
        winnerId: vs.winnerId,
        initiatorActorId: vs.initiatorActorId,
        opponentActorId: vs.opponentActorId
      };
    }, resolutionMessageId);
    expect(resolutionFlags).toEqual({
      type: 'resolution',
      winnerId: casterId,
      initiatorActorId: casterId,
      opponentActorId: opponentId
    });

    /* ---------- Cleanup ---------- */

    await page.evaluate(({ cId, oId }) => {
      game.actors.get(cId)?.delete();
      game.actors.get(oId)?.delete();
    }, { cId: casterId, oId: opponentId });
  });
});
