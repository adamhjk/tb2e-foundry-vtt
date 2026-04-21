import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §3 Rolls — Nature tax (DH p.119). Post-roll, after a roll that channeled
 * Nature (SG p.87 — spend 1 Persona to add `natureRating` dice to the pool),
 * the chat card prompts "Within Nature descriptors?". Answering "No"
 * (outside descriptors) applies a nature tax to the actor:
 *
 *   `calculateNatureTax` (module/dice/roll-utils.mjs line 68-71):
 *     - pass        → tax = 1
 *     - fail        → tax = max(obstacle - finalSuccesses, 1)
 *
 * `_handleNatureTax` (module/dice/post-roll.mjs line 328-365):
 *   1. Reads tax amount via `calculateNatureTax` with the roll's pass flag,
 *      obstacle, and finalSuccesses (lines 334-341). If `withinDescriptors`
 *      is true (the "Yes" button), the tax is 0 and the actor is unchanged.
 *   2. Clamps the tax to >= 0 nature rating: `newNature = max(0, current - tax)`
 *      (line 345). Writes `system.abilities.nature.rating = newNature`
 *      (line 347). `system.abilities.nature.max` is NOT touched — only the
 *      current rating is decremented. (Max is reduced only by the sheet-
 *      driven `conserveNature` / crisis paths — see
 *      tests/e2e/sheet/nature-tax.spec.mjs and `_postNatureCrisis` below.)
 *   3. If the decrement lands nature at 0, posts a nature-crisis chat card
 *      via `_postNatureCrisis` (line 600-632) — a new ChatMessage with
 *      `flags.tb2e.natureCrisis = true` rendered from
 *      `templates/chat/nature-crisis.hbs`. Deep assertions on the crisis
 *      card shape are intentionally out of scope here (covered by
 *      §11 Nature Crisis — `tests/e2e/nature/crisis-triggered.spec.mjs`);
 *      this spec only verifies the card is EMITTED to the chat log.
 *   4. Writes `flags.tb2e.natureTaxResolved: true` and `natureTaxAmount` on
 *      the roll message (lines 359-362), and re-renders the card — the
 *      prompt is gated by `showNatureTax = channelNature && !natureTaxResolved`
 *      (post-roll.mjs line 892) so it disappears.
 *
 * Gating — the Nature Tax prompt only renders when `flags.tb2e.channelNature`
 * is true (set by `_buildRollFlags` line 1452 from `personaState.channelNature`
 * in the dialog submit). In the UI, that requires the "Channel Your Nature"
 * checkbox in the persona section of the roll dialog — which in turn
 * requires `persona.current >= 1` (cost is 1 Persona per SG p.87) and the
 * actor being a character making a non-Resources/Circles test
 * (tb2e-roll.mjs lines 394-398).
 *
 * Dice determinism (Foundry d6 face = Math.ceil((1 - u) * 6)):
 *   - u = 0.001 → face 6 (sun, success).
 *
 * Scope: this spec verifies the primary decrement path (rating - 1) and
 * provides a minimal sanity check that the rating=1 → 0 path emits a
 * nature-crisis card. Full crisis card shape assertions belong to §11.
 */
test.describe('§3 Rolls — Nature tax post-roll decrement (DH p.119)', () => {
  test.afterEach(async ({ page }) => {
    // Restore the PRNG stub so the next spec on a shared Page gets real
    // randomness. Same pattern as ability-test-basic / fate-reroll /
    // persona-deeper-understanding.
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });
  });

  test('applies 1-point nature tax on pass (rating -1, max unchanged) (DH p.119)', async ({ page }) => {
    const actorName = `E2E Nature Tax ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Will 2, Nature rating/max 3/5 (rating starts below max so the -1
    // decrement is unambiguously visible and max-unchanged assertion is
    // meaningful), Persona 1 so we can afford exactly one Channel Your Nature
    // spend. Fresh disabled so the base pool is exactly rating (see
    // ability-test-basic.spec.mjs for rationale).
    const actorId = await page.evaluate(async (n) => {
      const actor = await Actor.create({
        name: n,
        type: 'character',
        system: {
          abilities: {
            will:   { rating: 2, pass: 0, fail: 0 },
            health: { rating: 3, pass: 0, fail: 0 },
            nature: { rating: 3, max: 5, pass: 0, fail: 0 }
          },
          persona: { current: 1, spent: 0 },
          fate:    { current: 0, spent: 0 },
          conditions: { fresh: false }
        }
      });
      return actor.id;
    }, actorName);
    expect(actorId).toBeTruthy();

    // Stub: all 6s → pool rolls all successes. With Ob 3 and a 5D pool
    // (will 2 + nature 3 from channel), the roll PASSES (5 successes >= 3).
    // pass → tax = 1 per calculateNatureTax (roll-utils.mjs line 69).
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

    const initialChatCount = await page.evaluate(() => game.messages.contents.length);

    await sheet.rollAbilityRow('will').click();

    const dialog = new RollDialog(page);
    await dialog.waitForOpen();

    // Will rating 2 → base pool 2D.
    expect(await dialog.getPoolSize()).toBe(2);

    // Channel Your Nature: +natureRating (3) dice, costs 1 Persona
    // (tb2e-roll.mjs line 615-622 / line 1374). Flag channelNature=true
    // on the message — enables the post-roll Nature Tax prompt.
    await dialog.toggleChannelNature();

    // Ob 3, pool 5D → 5 successes on all-6s → clear PASS. The pass path
    // maps to tax = 1 (calculateNatureTax on pass branch).
    await dialog.fillObstacle(3);
    await dialog.submit();

    await expect
      .poll(() => page.evaluate(() => game.messages.contents.length), { timeout: 10_000 })
      .toBeGreaterThan(initialChatCount);

    const card = new RollChatCard(page);
    await card.expectPresent();

    // Roll shape — 5D (will 2 + channel nature 3), all 6s → 5 successes,
    // PASS vs Ob 3.
    expect(await card.getPool()).toBe(5);
    await expect(card.diceResults).toHaveCount(5);
    expect(await card.getSuccesses()).toBe(5);
    expect(await card.getObstacle()).toBe(3);
    expect(await card.isPass()).toBe(true);

    // Persona spent on channel: current 1→0, spent 0→1
    // (tb2e-roll.mjs _applyPreRollActorChanges, line 1376-1377).
    const personaAfterChannel = await page.evaluate((id) => {
      const p = game.actors.get(id).system.persona;
      return { current: p.current, spent: p.spent };
    }, actorId);
    expect(personaAfterChannel).toEqual({ current: 0, spent: 1 });

    // Nature Tax prompt visible — gated on flags.tb2e.channelNature and
    // !natureTaxResolved (post-roll.mjs line 892).
    await expect(card.natureTaxPrompt).toBeVisible();
    await expect(card.natureTaxNoButton).toBeVisible();
    await expect(card.natureTaxYesButton).toBeVisible();

    // Nature state BEFORE the tax.
    const natureBefore = await page.evaluate((id) => {
      const n = game.actors.get(id).system.abilities.nature;
      return { rating: n.rating, max: n.max, pass: n.pass, fail: n.fail };
    }, actorId);
    expect(natureBefore).toEqual({ rating: 3, max: 5, pass: 0, fail: 0 });

    // Click "No" — outside descriptors, tax applies.
    await card.clickNatureTaxNo();

    // Rating 3 → 2 (decrement by 1 on pass). Max UNCHANGED at 5 — the
    // post-roll tax path does NOT touch max (that's the sheet-driven
    // `conserveNature` / `_postNatureCrisis` paths, per CLAUDE.md and the
    // sheet/nature-tax.spec.mjs coverage). Pass/fail pips also unchanged
    // — those are separate ability advancement mechanics (DH p.84).
    await expect
      .poll(() =>
        page.evaluate((id) => {
          const n = game.actors.get(id).system.abilities.nature;
          return { rating: n.rating, max: n.max, pass: n.pass, fail: n.fail };
        }, actorId)
      )
      .toEqual({ rating: 2, max: 5, pass: 0, fail: 0 });

    // Re-rendered card no longer shows the prompt; nature-tax flags
    // on the message reflect the applied tax.
    await expect(card.natureTaxPrompt).toHaveCount(0);
    const msgFlags = await page.evaluate((id) => {
      const m = game.messages.contents
        .filter(msg => msg.flags?.tb2e?.roll && msg.flags.tb2e.actorId === id)
        .slice(-1)[0];
      if (!m) return null;
      return {
        channelNature: !!m.flags.tb2e.channelNature,
        natureTaxResolved: !!m.flags.tb2e.natureTaxResolved,
        natureTaxAmount: m.flags.tb2e.natureTaxAmount ?? null,
        pass: m.flags.tb2e.roll.pass
      };
    }, actorId);
    expect(msgFlags).toEqual({
      channelNature: true,
      natureTaxResolved: true,
      natureTaxAmount: 1,
      pass: true
    });

    // No nature-crisis card should have been posted — rating landed at 2,
    // not 0 (post-roll.mjs line 353 guard). Scope the search by actorId to
    // avoid cross-test contamination on shared Pages.
    const crisisCount = await page.evaluate((id) => {
      return game.messages.contents
        .filter(msg => msg.flags?.tb2e?.natureCrisis && msg.flags?.tb2e?.actorId === id)
        .length;
    }, actorId);
    expect(crisisCount).toBe(0);

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });

  test('clicking "Yes" (within descriptors) leaves nature rating unchanged (DH p.119)', async ({ page }) => {
    const actorName = `E2E Nature Tax Within ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Same shape as test 1 but we'll click "Yes" (within descriptors). The
    // handler short-circuits with taxAmount=0 (post-roll.mjs line 334-335 —
    // withinDescriptors=true skips calculateNatureTax entirely).
    const actorId = await page.evaluate(async (n) => {
      const actor = await Actor.create({
        name: n,
        type: 'character',
        system: {
          abilities: {
            will:   { rating: 2, pass: 0, fail: 0 },
            health: { rating: 3, pass: 0, fail: 0 },
            nature: { rating: 3, max: 5, pass: 0, fail: 0 }
          },
          persona: { current: 1, spent: 0 },
          fate:    { current: 0, spent: 0 },
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
    await sheet.openAbilitiesTab();

    const initialChatCount = await page.evaluate(() => game.messages.contents.length);

    await sheet.rollAbilityRow('will').click();

    const dialog = new RollDialog(page);
    await dialog.waitForOpen();
    await dialog.toggleChannelNature();
    await dialog.fillObstacle(3);
    await dialog.submit();

    await expect
      .poll(() => page.evaluate(() => game.messages.contents.length), { timeout: 10_000 })
      .toBeGreaterThan(initialChatCount);

    const card = new RollChatCard(page);
    await card.expectPresent();
    await expect(card.natureTaxPrompt).toBeVisible();

    // Click "Yes" — within descriptors. No tax.
    await card.clickNatureTaxYes();

    // Rating UNCHANGED at 3 — withinDescriptors skips calculateNatureTax
    // (post-roll.mjs line 334-341) and no actor.update is issued for the
    // nature fields.
    const natureAfter = await page.evaluate((id) => {
      const n = game.actors.get(id).system.abilities.nature;
      return { rating: n.rating, max: n.max, pass: n.pass, fail: n.fail };
    }, actorId);
    expect(natureAfter).toEqual({ rating: 3, max: 5, pass: 0, fail: 0 });

    // Prompt removed; natureTaxResolved flag set on the message with
    // amount 0.
    await expect(card.natureTaxPrompt).toHaveCount(0);
    const msgFlags = await page.evaluate((id) => {
      const m = game.messages.contents
        .filter(msg => msg.flags?.tb2e?.roll && msg.flags.tb2e.actorId === id)
        .slice(-1)[0];
      if (!m) return null;
      return {
        natureTaxResolved: !!m.flags.tb2e.natureTaxResolved,
        natureTaxAmount: m.flags.tb2e.natureTaxAmount ?? null
      };
    }, actorId);
    expect(msgFlags).toEqual({
      natureTaxResolved: true,
      natureTaxAmount: 0
    });

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });

  test('tax decrement to rating=0 emits a nature-crisis chat card (DH p.119)', async ({ page }) => {
    const actorName = `E2E Nature Tax Crisis ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Nature rating = 1 so the -1 tax lands at 0 → crisis. Keep max
    // generous (5) so the pre-crisis state is unambiguous. Give the actor
    // one non-class trait so the crisis card's `hasTraits` branch renders
    // successfully (post-roll.mjs line 604-609 filters out class traits).
    //
    // Note: we intentionally keep this a minimal "card was posted"
    // assertion — full nature-crisis card shape (trait selection UI,
    // resolve button, max decrement) is covered by §11 Nature Crisis
    // (TEST_PLAN.md line 343, `tests/e2e/nature/crisis-triggered.spec.mjs`).
    const { actorId } = await page.evaluate(async (n) => {
      const actor = await Actor.create({
        name: n,
        type: 'character',
        system: {
          abilities: {
            will:   { rating: 2, pass: 0, fail: 0 },
            health: { rating: 3, pass: 0, fail: 0 },
            nature: { rating: 1, max: 5, pass: 0, fail: 0 }
          },
          persona: { current: 1, spent: 0 },
          fate:    { current: 0, spent: 0 },
          conditions: { fresh: false }
        }
      });
      await actor.createEmbeddedDocuments('Item', [{
        name: 'Stubborn',
        type: 'trait',
        system: { level: 1, beneficial: 0, checks: 0, isClass: false }
      }]);
      return { actorId: actor.id };
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
    await sheet.openAbilitiesTab();

    const initialChatCount = await page.evaluate(() => game.messages.contents.length);

    await sheet.rollAbilityRow('will').click();

    const dialog = new RollDialog(page);
    await dialog.waitForOpen();

    // Base pool: will 2. Channel Nature adds natureRating (1). Total 3D.
    await dialog.toggleChannelNature();
    // Ob 2, 3D all-6s → 3 successes → PASS. pass → tax = 1. Rating 1→0.
    await dialog.fillObstacle(2);
    await dialog.submit();

    await expect
      .poll(() => page.evaluate(() => game.messages.contents.length), { timeout: 10_000 })
      .toBeGreaterThan(initialChatCount);

    const card = new RollChatCard(page);
    await card.expectPresent();
    await expect(card.natureTaxPrompt).toBeVisible();

    const rollMsgCountBefore = await page.evaluate(() => game.messages.contents.length);

    await card.clickNatureTaxNo();

    // Rating decremented to 0 (post-roll.mjs line 345 clamp).
    await expect
      .poll(() =>
        page.evaluate((id) => game.actors.get(id).system.abilities.nature.rating, actorId)
      )
      .toBe(0);

    // A new chat message was posted for the crisis card
    // (_postNatureCrisis → ChatMessage.create at post-roll.mjs line 626).
    await expect
      .poll(() => page.evaluate(() => game.messages.contents.length), { timeout: 10_000 })
      .toBeGreaterThan(rollMsgCountBefore);

    // Locate the crisis card by its unique flag and verify it's scoped
    // to our actor. Deeper card-shape assertions are intentionally
    // deferred to §11 (nature/crisis-triggered.spec.mjs).
    const crisisMeta = await page.evaluate((id) => {
      const crisisMsgs = game.messages.contents
        .filter(msg => msg.flags?.tb2e?.natureCrisis && msg.flags?.tb2e?.actorId === id);
      if (!crisisMsgs.length) return null;
      const m = crisisMsgs.at(-1);
      return {
        count: crisisMsgs.length,
        natureCrisis: !!m.flags.tb2e.natureCrisis,
        actorId: m.flags.tb2e.actorId,
        hasContent: typeof m.content === 'string' && m.content.length > 0
      };
    }, actorId);
    expect(crisisMeta).toEqual({
      count: 1,
      natureCrisis: true,
      actorId,
      hasContent: true
    });

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });
});
