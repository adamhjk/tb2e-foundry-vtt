import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §4 Advancement — wise advancement perk choice (DH p.87; pp.77-78).
 *
 * Scope:
 *   Prior spec `tests/e2e/roll/wise-aid-persona.spec.mjs` already covers
 *   milestone DETECTION — i.e. after marking all four advancement boxes
 *   (pass / fail / fate / persona) the wise-advancement chat card posts
 *   with three perk buttons (`wise-change`, `wise-bl`, `wise-skill-test`).
 *   This spec narrowly covers the PERK-CHOICE flow: clicking one of those
 *   buttons mutates the actor's wise entry and re-renders the card as
 *   resolved.
 *
 * Perk semantics (post-roll.mjs lines 781-805 — verified on disk):
 *   All three perks perform the same reset — they zero the four advancement
 *   marks (`pass`/`fail`/`fate`/`persona`) on the chosen wise. `wise-change`
 *   additionally clears the wise's `name` field (post-roll.mjs line 783),
 *   matching DH p.87 "You can change the name of a wise after advancing it"
 *   — no rename dialog is opened; the player is expected to rename in the
 *   sheet afterwards. No perk opens a follow-up dialog and no perk writes
 *   to a mailbox. "wise-bl" and "wise-skill-test" are pure mark-resets;
 *   the actual BL attempt / skill advancement they grant is assumed to be
 *   performed by the GM/player outside of this system (the rules note them
 *   as narrative rewards, not data mutations).
 *
 *   After the mutation, the handler re-renders the card template with
 *   `resolved: true` (post-roll.mjs lines 808-819) and sets
 *   `flags.tb2e.wiseAdvResolved = true` (line 823), which also gates the
 *   listener from re-firing on subsequent renders
 *   (`activateWiseAdvancementListeners` early-returns at line 764 when the
 *   resolved flag is truthy).
 *
 * "Rating bump" footnote: the TEST_PLAN.md briefing mentions a "rating
 * bump", but wises have no numeric rating. They are `{name, pass, fail,
 * fate, persona}` entries on `actor.system.wises`. The "bump" is the mark
 * reset — the wise becomes ready to track a NEW advancement cycle.
 * The three perk options are the players' reward for hitting the milestone;
 * choosing one consumes the current milestone. No rating field exists to
 * increment.
 *
 * Milestone staging:
 *   Seed `wises[0]` with pass=true, fail=true, fate=true, persona=false,
 *   plus `persona.current >= 1` so the Of Course post-roll button is
 *   eligible. Roll with PRNG stubbed to all-3s (0 successes, all wyrms) and
 *   select the wise pre-roll so `wiseSelected` is true on the chat card.
 *   Click Of Course → wise.persona flips true → all 4 boxes true →
 *   `_checkWiseAdvancement` posts the wise-advancement card (same route as
 *   wise-aid-persona.spec.mjs test 2). This is borrowed only to land us at
 *   the perk-choice surface; the assertions below target the perk flow.
 *
 * Dice determinism:
 *   - u=0.5 → Math.ceil((1-u)*6) = 3 on every d6 (all wyrms → hasWyrms).
 *   - The Of Course reroll's outcome is irrelevant to this spec — we only
 *     need it to flip wise.persona to trip the milestone.
 *
 * Listener gating:
 *   `activateWiseAdvancementListeners` (post-roll.mjs line 761) short-
 *   circuits if `!flags` (not a wise-advancement card) or
 *   `wiseAdvResolved` is set (line 764). It also short-circuits inside the
 *   click handler if `!actor || !actor.isOwner` (line 773). Our GM-driven
 *   test always satisfies isOwner; a future player-only test would need the
 *   character to be owned by that player for the perk click to take effect.
 */
test.describe('§4 Advancement — wise advancement perk choice', () => {
  test.afterEach(async ({ page }) => {
    // Restore the PRNG stub so subsequent specs on a shared Page see real
    // randomness. Same pattern as wise-aid-persona.spec.mjs / ability-test.
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });
  });

  test('clicking wise-change resets the four advancement marks and clears the name (DH p.87)', async ({ page }) => {
    const suffix = Date.now();
    const actorName = `E2E Wise Perk ${suffix}`;
    const wiseName = `Kobold-wise ${suffix}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Pre-stage pass=fail=fate=true so that Of Course (which flips
    // persona=true) is the 4th mark and trips `_checkWiseAdvancement`.
    // persona.current=1 satisfies the `hasPersona` gate for the Of Course
    // button. conditions.fresh=false keeps the pool at exactly Will rating.
    const actorId = await page.evaluate(async ({ n, w }) => {
      const actor = await Actor.create({
        name: n,
        type: 'character',
        system: {
          abilities: {
            will:   { rating: 4, pass: 0, fail: 0 },
            health: { rating: 3, pass: 0, fail: 0 },
            nature: { rating: 3, max: 3, pass: 0, fail: 0 }
          },
          persona: { current: 1, spent: 0 },
          fate:    { current: 0, spent: 0 },
          wises: [
            { name: w, pass: true, fail: true, fate: true, persona: false }
          ],
          conditions: { fresh: false }
        }
      });
      return actor.id;
    }, { n: actorName, w: wiseName });
    expect(actorId).toBeTruthy();

    await page.evaluate(() => {
      globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => 0.5;
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
    await dialog.selectWise(0);
    await dialog.fillObstacle(3);
    await dialog.submit();

    // Wait for the roll-result card.
    await expect
      .poll(() => page.evaluate(() => game.messages.contents.length), { timeout: 10_000 })
      .toBeGreaterThan(initialChatCount);

    const card = new RollChatCard(page);
    await card.expectPresent();
    await expect(card.ofCourseButton).toBeVisible();

    // Trip the milestone — Of Course flips wise.persona = true, and with
    // pass/fail/fate already true, `_checkWiseAdvancement` posts the
    // wise-advancement card (see wise-aid-persona.spec.mjs test 2 for the
    // detailed citation chain).
    await card.clickOfCourse();

    // Wait for the wise-advancement card to post. Actor-scoped filter to
    // avoid stale cards from earlier --repeat-each iterations on a shared
    // Foundry world (post-roll.mjs line 752 sets `flags.tb2e.actorId`).
    await expect
      .poll(() => page.evaluate((id) => {
        return game.messages.contents.filter(
          m => m.flags?.tb2e?.wiseAdvancement && m.flags.tb2e.actorId === id
        ).length;
      }, actorId), { timeout: 10_000 })
      .toBe(1);

    // Sanity: the actor's wise is at all-four-marks before perk choice.
    const wiseBefore = await page.evaluate((id) => {
      const w = game.actors.get(id).system.wises[0];
      return { name: w.name, pass: w.pass, fail: w.fail, fate: w.fate, persona: w.persona };
    }, actorId);
    expect(wiseBefore).toEqual({
      name: wiseName,
      pass: true,
      fail: true,
      fate: true,
      persona: true
    });

    // Click the "wise-change" perk button inside the advancement card. The
    // button is attached via `activateWiseAdvancementListeners` (post-roll.mjs
    // line 766-827) using a plain addEventListener, so a native dispatch
    // fires the production handler — same rationale as the RollChatCard
    // native-click pattern. We scope by the actor-tagged `data-actor-id`
    // on the card root (templates/chat/wise-advancement.hbs line 1) so
    // parallel workers / --repeat-each iterations cannot cross-contaminate.
    const clicked = await page.evaluate((id) => {
      const cards = document.querySelectorAll(`.tb2e-chat-card[data-actor-id="${id}"]`);
      const card = cards[cards.length - 1];
      if (!card) return false;
      const btn = card.querySelector('.wise-adv-btn[data-action="wise-change"]');
      if (!btn) return false;
      btn.click();
      return true;
    }, actorId);
    expect(clicked).toBe(true);

    // Assert the mutation. Per post-roll.mjs:782-788 (wise-change branch),
    // name is cleared and all four marks are reset. This is the clearest
    // data signal that the production handler ran end-to-end.
    await expect
      .poll(() => page.evaluate((id) => {
        const w = game.actors.get(id).system.wises[0];
        return { name: w.name, pass: w.pass, fail: w.fail, fate: w.fate, persona: w.persona };
      }, actorId), { timeout: 5_000 })
      .toEqual({
        name: '',
        pass: false,
        fail: false,
        fate: false,
        persona: false
      });

    // The chat message flips `wiseAdvResolved: true` (post-roll.mjs line
    // 823), which prevents re-listening on subsequent renders (line 764).
    await expect
      .poll(() => page.evaluate((id) => {
        const m = game.messages.contents.find(
          msg => msg.flags?.tb2e?.wiseAdvancement && msg.flags.tb2e.actorId === id
        );
        return m ? !!m.flags.tb2e.wiseAdvResolved : false;
      }, actorId), { timeout: 5_000 })
      .toBe(true);

    // The card re-renders with the resolved branch of the template
    // (wise-advancement.hbs lines 10-18): the `.wise-adv-resolved` body
    // replaces the `.wise-adv-actions` button row, so the perk buttons
    // must be gone.
    await expect
      .poll(() => page.evaluate((id) => {
        const m = game.messages.contents.find(
          msg => msg.flags?.tb2e?.wiseAdvancement && msg.flags.tb2e.actorId === id
        );
        if (!m) return -1;
        const tmp = document.createElement('div');
        tmp.innerHTML = m.content;
        return tmp.querySelectorAll('.wise-adv-btn').length;
      }, actorId), { timeout: 5_000 })
      .toBe(0);

    // The resolved body text should be the `PerkChangeResolved` string
    // (post-roll.mjs line 788). Assert the content contains the resolved
    // className so we don't depend on the exact localized text.
    const hasResolvedBody = await page.evaluate((id) => {
      const m = game.messages.contents.find(
        msg => msg.flags?.tb2e?.wiseAdvancement && msg.flags.tb2e.actorId === id
      );
      return m ? m.content.includes('wise-adv-resolved') : false;
    }, actorId);
    expect(hasResolvedBody).toBe(true);

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });

  test('clicking wise-bl resets the four marks but PRESERVES the name (DH p.87)', async ({ page }) => {
    // Covers the second code path in activateWiseAdvancementListeners
    // (post-roll.mjs lines 789-794). wise-bl is a pure mark-reset: unlike
    // wise-change, it must NOT clear the name. This lightweight second
    // case proves the three branches are distinguishable in the handler
    // (and by symmetry covers wise-skill-test, which has identical data
    // semantics at lines 795-800 — only the `resolvedText` localization
    // key differs between them).
    const suffix = Date.now();
    const actorName = `E2E Wise Perk BL ${suffix}`;
    const wiseName = `Troll-wise ${suffix}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    const actorId = await page.evaluate(async ({ n, w }) => {
      const actor = await Actor.create({
        name: n,
        type: 'character',
        system: {
          abilities: {
            will:   { rating: 4, pass: 0, fail: 0 },
            health: { rating: 3, pass: 0, fail: 0 },
            nature: { rating: 3, max: 3, pass: 0, fail: 0 }
          },
          persona: { current: 1, spent: 0 },
          fate:    { current: 0, spent: 0 },
          wises: [
            { name: w, pass: true, fail: true, fate: true, persona: false }
          ],
          conditions: { fresh: false }
        }
      });
      return actor.id;
    }, { n: actorName, w: wiseName });
    expect(actorId).toBeTruthy();

    await page.evaluate(() => {
      globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => 0.5;
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
    await dialog.selectWise(0);
    await dialog.fillObstacle(3);
    await dialog.submit();

    await expect
      .poll(() => page.evaluate(() => game.messages.contents.length), { timeout: 10_000 })
      .toBeGreaterThan(initialChatCount);

    const card = new RollChatCard(page);
    await card.expectPresent();
    await expect(card.ofCourseButton).toBeVisible();
    await card.clickOfCourse();

    await expect
      .poll(() => page.evaluate((id) => {
        return game.messages.contents.filter(
          m => m.flags?.tb2e?.wiseAdvancement && m.flags.tb2e.actorId === id
        ).length;
      }, actorId), { timeout: 10_000 })
      .toBe(1);

    const clicked = await page.evaluate((id) => {
      const cards = document.querySelectorAll(`.tb2e-chat-card[data-actor-id="${id}"]`);
      const card = cards[cards.length - 1];
      if (!card) return false;
      const btn = card.querySelector('.wise-adv-btn[data-action="wise-bl"]');
      if (!btn) return false;
      btn.click();
      return true;
    }, actorId);
    expect(clicked).toBe(true);

    // wise-bl resets the four marks but keeps the name (post-roll.mjs
    // lines 789-794 — no assignment to `wises[wiseIndex].name`).
    await expect
      .poll(() => page.evaluate((id) => {
        const w = game.actors.get(id).system.wises[0];
        return { name: w.name, pass: w.pass, fail: w.fail, fate: w.fate, persona: w.persona };
      }, actorId), { timeout: 5_000 })
      .toEqual({
        name: wiseName,
        pass: false,
        fail: false,
        fate: false,
        persona: false
      });

    // Re-rendered as resolved — perk buttons gone.
    await expect
      .poll(() => page.evaluate((id) => {
        const m = game.messages.contents.find(
          msg => msg.flags?.tb2e?.wiseAdvancement && msg.flags.tb2e.actorId === id
        );
        if (!m) return -1;
        const tmp = document.createElement('div');
        tmp.innerHTML = m.content;
        return tmp.querySelectorAll('.wise-adv-btn').length;
      }, actorId), { timeout: 5_000 })
      .toBe(0);

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });
});
