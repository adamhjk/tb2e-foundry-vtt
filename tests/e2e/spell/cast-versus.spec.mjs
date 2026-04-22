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
 * §6 Spells — cast a versus spell (DH p.99, p.116; Wizard's Bane DH p.199;
 * Arcanist DH p.161).
 *
 * Rules under test:
 *   - Versus-type spells (spell.mjs schema `castingType: "versus"`) set
 *     `testContext.isVersus = true` in `castSpell` (spell-casting.mjs:66-69)
 *     and route the caster's Arcanist roll through the versus pipeline —
 *     the opponent rolls their own ability/skill and the highest-successes
 *     side wins (DH p.89, versus.mjs:_executeVersusResolution).
 *   - The caster's roll dialog opens already in versus mode — tb2e-roll.mjs
 *     lines 929-937 read `testContext.isVersus` and pre-set the mode input,
 *     un-hide the challenge block, and show the versus-specific label.
 *   - The initiator's chat card carries BOTH the standard spell flags
 *     (`flags.tb2e.testContext.spellId/spellName/castingSource`) AND the
 *     versus flags (`flags.tb2e.versus = { type: "initiator", ... }`) —
 *     `_handleVersusRoll` at tb2e-roll.mjs:1630-1652 registers the message
 *     with `PendingVersusRegistry`, making it selectable in the opponent's
 *     challenge dropdown.
 *   - Memory-sourced spell consumption runs at RESOLUTION (not at individual
 *     finalize): `_executeVersusResolution` calls `processSpellCast` for
 *     whichever side had `testContext.spellId` (versus.mjs:261-266). On an
 *     initiator-wins outcome this flips `system.cast = true` and
 *     `system.memorized = false` on the caster's spell (spell-casting.mjs:
 *     162-173). The plain-versus finalize branch (post-roll.mjs:507-522)
 *     returns early without calling `processSpellCast` — so until the
 *     OPPONENT finalizes and resolution executes, the spell stays
 *     memorized.
 *
 * Implementation map:
 *   - Magic tab button `data-action="castSpell"`
 *     (templates/actors/tabs/character-magic.hbs:46) → CharacterSheet
 *     `#onCastSpell` (character-sheet.mjs:1396) → with memorized as the sole
 *     source the chooser is bypassed (1418-1420) → `castSpell(actor, item,
 *     "memory")` → spell-casting.mjs:66-69 versus branch → rollTest.
 *   - Roll dialog pre-selects versus mode via `testContext.isVersus`
 *     (tb2e-roll.mjs:929-937). No mode-toggle click needed on the caster
 *     side — this is the ONE place the versus spec differs from the plain-
 *     versus pattern in `initiate-respond.spec.mjs`.
 *   - Opponent flow mirrors §5 Versus — opponent opens their own roll,
 *     clicks `.roll-dialog-mode-toggle` once to switch to versus, selects
 *     the caster's message id from `select[name="challengeMessageId"]`.
 *
 * Source spell: `Wizard's Bane` (packs/_source/spells/wizards-bane.yml,
 * `_id: a1b2c3d4e5f6200c`) — castingType `versus`, `versusDefense:
 * "willOrNature"`. Note: `versusDefense` is metadata for display/docs
 * only — the code does NOT force the opponent to roll a specific
 * defense (no branch in spell-casting.mjs or versus.mjs reads it). The
 * opponent picks their own ability/skill, same as any versus roll. This
 * spec has B roll Will because that's what Wizard's Bane calls out as
 * the primary defense.
 *
 * Dice determinism:
 *   - Same PRNG-stub pattern as initiate-respond.spec.mjs — swap between
 *     u=0.001 (all 6s) for the caster and u=0.5 (all 3s) for the opponent
 *     so A deterministically wins (4 successes vs 0, margin 4).
 *
 * Actor-scoping for `--repeat-each`:
 *   - Both actors use `Date.now()` suffixes.
 *   - All flag queries filter by actor id; the VersusCard POMs pin the
 *     message id lookup with a specific shape (`versus.type` + spell id)
 *     so prior iterations' cards can't satisfy our polls.
 *
 * Narrow scope — out of scope (other §6 checkboxes):
 *   - factors / fixed-Ob / skillSwap variants (separate checkboxes).
 *   - materials/focus +1D bonuses.
 *   - scroll / spellbook source consumption cards.
 *   - Ties / concession / maneuver spending (§5 territory — covered by
 *     tie-break.spec.mjs and tie-no-trait.spec.mjs).
 */
const SPELL_NAME = "Wizard's Bane";
const SPELL_ID = 'a1b2c3d4e5f6200c'; // packs/_source/spells/wizards-bane.yml
const SPELLS_PACK = 'tb2e.spells';

test.describe('§6 Spells — cast versus spell', () => {
  test.afterEach(async ({ page }) => {
    // Match all other spell / versus specs: clean up any leaked PRNG stub
    // so downstream specs see real randomness.
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });
  });

  test('caster rolls Arcanist in versus mode, opponent responds with Will; resolution posts, spell consumed on win', async ({ page }) => {
    const suffix = Date.now();
    const casterName = `E2E Spell Versus Caster ${suffix}`;
    const opponentName = `E2E Spell Versus Opponent ${suffix}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Stage caster (Arcanist 4) + opponent (Will 3), both GM-owned. Fresh
    // disabled on both so the dialog pool is the rating exactly (no +1D
    // fresh bonus from gatherConditionModifiers — DH p.85).
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
            arcanist: { rating: 4, pass: 0, fail: 0, learning: 0 }
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
      return { casterId: caster.id, opponentId: opp.id };
    }, { cN: casterName, oN: opponentName });
    expect(casterId).toBeTruthy();
    expect(opponentId).toBeTruthy();

    // Seed Wizard's Bane from the compendium, flip memorized=true so
    // `canCast === true` on the spell row, and null out materials/focus so
    // the pool equals the Arcanist rating exactly (spell-casting.mjs:27-43
    // only adds the +1D per bonus when the string is truthy).
    const spellItemId = await page.evaluate(
      async ({ id, packId, entryId }) => {
        const actor = game.actors.get(id);
        const pack = game.packs.get(packId);
        const src = await pack.getDocument(entryId);
        const data = src.toObject();
        data.system.memorized = true;
        data.system.materials = '';
        data.system.focus = '';
        const [created] = await actor.createEmbeddedDocuments('Item', [data]);
        return created.id;
      },
      { id: casterId, packId: SPELLS_PACK, entryId: SPELL_ID }
    );
    expect(spellItemId).toBeTruthy();

    // Sanity-check the embedded spell has the versus shape we expect.
    const spellState = await page.evaluate(
      ({ id, iid }) => {
        const item = game.actors.get(id).items.get(iid);
        return item ? {
          name: item.name,
          castingType: item.system.castingType,
          memorized: item.system.memorized,
          materials: item.system.materials,
          focus: item.system.focus,
          cast: item.system.cast,
          versusDefense: item.system.versusDefense
        } : null;
      },
      { id: casterId, iid: spellItemId }
    );
    expect(spellState).toEqual({
      name: SPELL_NAME,
      castingType: 'versus',
      memorized: true,
      materials: '',
      focus: '',
      cast: false,
      versusDefense: 'willOrNature'
    });

    /* ---------- Phase 1 — caster rolls ---------- */

    // Stub PRNG → all-6s. 4D Arcanist for caster = 4 successes.
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

    const castButton = casterSheet
      .spellRow(spellItemId)
      .locator('button[data-action="castSpell"]');
    await expect(castButton).toBeVisible();

    await castButton.click();

    // Roll dialog opens already in versus mode — tb2e-roll.mjs:929-937
    // reads `testContext.isVersus` and pre-sets the hidden mode input
    // AND un-hides the challenge block. We ASSERT this pre-state rather
    // than cycling the mode toggle (which is what the non-spell versus
    // spec has to do).
    const casterDialog = new RollDialog(page);
    await casterDialog.waitForOpen();

    // Pool is Arcanist rating 4; no obstacle field is relevant in versus
    // mode (obstacle block is hidden — tb2e-roll.mjs:932).
    expect(await casterDialog.getPoolSize()).toBe(4);
    await expect(casterDialog.modeInput).toHaveValue('versus');
    const extras = VersusDialogExtras.scopeOf(casterDialog);
    // The challenge block's `hidden` class is removed at dialog render
    // time (tb2e-roll.mjs:933). Assert the class absence directly rather
    // than `toBeVisible` because DialogV2 layout can be finicky.
    await expect(extras.challengeBlock).not.toHaveClass(
      /(^|\s)hidden(\s|$)/
    );

    await casterDialog.submit();

    // Poll for the initiator message — scope by actor id AND spell id so
    // a stale card from a prior iteration can't satisfy this query.
    const casterMessageId = await page.evaluate(async ({ actorId, sid }) => {
      const started = Date.now();
      while (Date.now() - started < 10_000) {
        const msg = game.messages.contents.find(m => {
          const vs = m.flags?.tb2e?.versus;
          const tc = m.flags?.tb2e?.testContext;
          return vs?.type === 'initiator'
            && vs.initiatorActorId === actorId
            && tc?.spellId === sid;
        });
        if (msg) return msg.id;
        await new Promise(r => setTimeout(r, 100));
      }
      return null;
    }, { actorId: casterId, sid: spellItemId });
    expect(casterMessageId).toBeTruthy();

    // The pending card is visible and carries the pending banner.
    const casterCard = new VersusPendingCard(page, casterMessageId);
    await casterCard.expectPresent();
    await casterCard.expectPending();

    // Flag-level proof for the caster's card: roll is Arcanist at 4 dice,
    // spell fields are stamped on testContext, versus fields are set.
    // NOTE: `testContext.isVersus` is a dialog-render-time hint only
    // (tb2e-roll.mjs:929-937) — it is NOT whitelisted into the serialized
    // `flags.tb2e.testContext` at _buildRollFlags (tb2e-roll.mjs:1461-1479).
    // The presence of `flags.tb2e.versus` with `type === "initiator"` is
    // the source of truth that this was a versus cast.
    const casterFlags = await page.evaluate((mid) => {
      const msg = game.messages.get(mid);
      const tb = msg?.flags?.tb2e;
      const r = tb?.roll;
      const vs = tb?.versus;
      const tc = tb?.testContext;
      return (r && vs && tc) ? {
        rollType: r.type,
        rollKey: r.key,
        baseDice: r.baseDice,
        poolSize: r.poolSize,
        successes: r.successes,
        spellId: tc.spellId ?? null,
        spellName: tc.spellName ?? null,
        castingSource: tc.castingSource ?? null,
        versusType: vs.type,
        versusInitiatorActorId: vs.initiatorActorId
      } : null;
    }, casterMessageId);
    expect(casterFlags).toEqual({
      rollType: 'skill',
      rollKey: 'arcanist',
      baseDice: 4,
      poolSize: 4,
      successes: 4,
      spellId: spellItemId,
      spellName: SPELL_NAME,
      castingSource: 'memory',
      versusType: 'initiator',
      versusInitiatorActorId: casterId
    });

    // Caster finalizes their own card. The versus branch in
    // post-roll.mjs:507-522 marks resolved and (for GM) calls
    // processVersusFinalize — which is a no-op until the opponent rolls.
    // Critically, `processSpellCast` is NOT called here (post-roll.mjs
    // returns early for versus rolls), so the spell stays memorized.
    await casterCard.clickFinalize();
    await expect(casterCard.resolvedBanner).toBeVisible();

    // Prove the spell state has NOT yet been consumed (resolution hasn't
    // run — the opponent still needs to roll and finalize).
    const preResolutionSpellState = await page.evaluate(
      ({ id, iid }) => {
        const item = game.actors.get(id).items.get(iid);
        return item ? {
          cast: item.system.cast,
          memorized: item.system.memorized
        } : null;
      },
      { id: casterId, iid: spellItemId }
    );
    expect(preResolutionSpellState).toEqual({ cast: false, memorized: true });

    // Close caster sheet so the opponent's sheet opens cleanly.
    await page.evaluate((id) => {
      for (const app of Object.values(foundry.applications.instances)) {
        if (app?.actor?.id === id) app.close();
      }
    }, casterId);

    /* ---------- Phase 2 — opponent responds ---------- */

    // Swap PRNG → all-3s. 3D Will for opponent = 0 successes (all wyrms).
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

    // Opponent's dialog opens in independent mode — they have no
    // testContext.isVersus. Cycle the mode toggle once to enter versus,
    // then pick the caster's message from the challenge dropdown.
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

    // Poll for the resolution card. versus.mjs:210-217 stamps type
    // "resolution" with winnerId = whichever side had more successes
    // (caster here — 4 vs 0).
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

    /* ---------- Phase 4 — assert winner + spell consumed ---------- */

    const resolution = new VersusResolutionCard(page, resolutionMessageId);
    await resolution.expectPresent();

    // Caster (initiator, first combatant) should win — 4 vs 0.
    expect(await resolution.initiatorIsWinner()).toBe(true);
    expect(await resolution.getWinnerName()).toBe(casterName);
    expect(await resolution.getInitiatorSuccesses()).toBe(4);
    expect(await resolution.getOpponentSuccesses()).toBe(0);
    expect(await resolution.getMargin()).toBe(4);

    // Flag-level proof on the resolution card — winnerId is the caster.
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

    // `processSpellCast` runs inside `_executeVersusResolution` for
    // whichever side had `testContext.spellId` — versus.mjs:261-262.
    // Caster wins, so `passed` is true and memory-source spells flip to
    // `cast: true, memorized: false` (spell-casting.mjs:162-173).
    const postResolutionSpellState = await page.evaluate(
      ({ id, iid }) => {
        const item = game.actors.get(id).items.get(iid);
        return item ? {
          cast: item.system.cast,
          memorized: item.system.memorized
        } : null;
      },
      { id: casterId, iid: spellItemId }
    );
    expect(postResolutionSpellState).toEqual({ cast: true, memorized: false });

    /* ---------- Cleanup ---------- */

    await page.evaluate(({ cId, oId }) => {
      game.actors.get(cId)?.delete();
      game.actors.get(oId)?.delete();
    }, { cId: casterId, oId: opponentId });
  });
});
