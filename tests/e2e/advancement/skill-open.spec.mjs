import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';
import { AdvancementDialog } from '../pages/AdvancementDialog.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §4 Advancement — Beginner's Luck opens a skill (DH pp.58-59 / DH p.75).
 *
 * Rules under test (RAW, Dungeoneer's Handbook):
 *   - DH pp.58-59 "Beginner's Luck": when you attempt a test of a skill you
 *     don't have, you roll the skill's BL ability (Will or Health per the
 *     per-skill table) at half dice (round up the halvable portion). Traits,
 *     persona, channeled Nature, fresh, and other specials are NOT halved.
 *   - DH p.75 "Learning a New Skill": each BL attempt — pass or fail — ticks
 *     one "learning" bubble on the sheet. Once the character has made a
 *     number of BL attempts equal to their maximum Nature rating, the skill
 *     opens at rating 2, and the learning bubbles + pass/fail pips reset.
 *     The code explicitly cites this ("Pass or fail doesn't matter ... just
 *     the number of tests"), so a single stubbed PASS is enough to open the
 *     skill provided we stage `learning = natureMax - 1`.
 *
 * Implementation map:
 *   - `_detectBeginnersLuck` (module/dice/tb2e-roll.mjs:131-146) — returns
 *     `{ isBL: true, blAbilityKey, blAbilityLabel, blDice }` when a skill's
 *     `rating === 0`. Fighter's BL ability is Health (module/config.mjs:53
 *     `bl: "H"`), so `blDice` = `actor.system.abilities.health.rating`.
 *   - `_applyBLHalving` (module/dice/tb2e-roll.mjs:155-177) + the dialog's
 *     live-preview halving at line 647-663 — halvable sources (base, help,
 *     manual dice) are halved via `ceil(halvable/2)`; non-halvable sources
 *     (trait, persona, nature, condition) pass through. The dialog's
 *     `<input name="poolSize">` is populated with `baseDice` (pre-halving);
 *     the halving shows up as a negative-dice modifier in the summary.
 *   - `logAdvancementForSide` (module/dice/roll-utils.mjs:194-200) — when
 *     `isBL` is true, delegates to `logBLLearning` (the normal
 *     `_logAdvancement` + advancement-dialog path is bypassed entirely).
 *   - `_logBLLearning` (module/dice/tb2e-roll.mjs:213-232) — the meat:
 *       - Early-returns if `skillData.rating > 0`.
 *       - `newCount = (skillData.learning ?? 0) + 1`.
 *       - If `newCount >= actor.system.abilities.nature.max`: update
 *         `rating → 2`, `pass → 0`, `fail → 0`, `learning → 0`, and post the
 *         skill-opened card via `_postSkillOpenedCard`.
 *       - Else: just bump `learning → newCount`.
 *   - `_postSkillOpenedCard` (module/dice/tb2e-roll.mjs:239-251) — posts a
 *     ChatMessage with content rendered from
 *     `templates/chat/skill-opened.hbs` (speaker-scoped to the actor via
 *     `ChatMessage.getSpeaker`). The card markup is
 *     `.tb2e-chat-card.card-accent--green` with a
 *     `.card-body.advancement-card-rating` containing a
 *     `.advancement-rating.new` span showing the new rating (2).
 *   - No advancement dialog fires on a BL attempt (neither the trigger-open
 *     path nor the skill-opened path). `_logBLLearning` does not call
 *     `showAdvancementDialog`, so `card.clickFinalize()` (which waits for
 *     the card-actions re-render to strip the button) is safe here — unlike
 *     the trigger-open spec which had to use a native click to avoid a
 *     deadlock against the modal advancement DialogV2.
 *
 * Dice determinism: `CONFIG.Dice.randomUniform = () => 0.001` forces every
 * d6 face to 6 → stubbed PASS. Same recipe as auto-trigger.spec.mjs and
 * accept.spec.mjs.
 *
 * Staging rationale:
 *   - Fighter is rated 0 (pure BL; `_detectBeginnersLuck` early-returns
 *     `null` for `rating > 0`, line 138).
 *   - BL ability (Health for Fighter) is rated >0 so the pool isn't
 *     empty. The dialog's baseDice input pre-fills from Health.
 *   - `learning = natureMax - 1`. One more BL attempt pushes `newCount` to
 *     `natureMax`, which trips the `>= natureMax` branch and opens the
 *     skill at rating 2.
 *   - `conditions.fresh = false` so the +1D Fresh modifier doesn't pad the
 *     halvable pool (keeps the halving assertion arithmetic crisp).
 *   - Actor is NOT `afraid` — per tb2e-roll.mjs:1248, afraid+BL short-
 *     circuits with a UI warn and no dialog opens at all (SG p.48).
 */
test.describe('§4 Advancement — BL opens the skill', () => {
  test.afterEach(async ({ page }) => {
    // Restore the dice PRNG so this spec's stub does not leak across specs
    // sharing the same Foundry world. Same pattern as auto-trigger /
    // accept / cancel.
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });
  });

  test('BL attempt at learning = natureMax-1 opens the skill at rating 2', async ({ page }) => {
    const actorName = `E2E BL Skill Open ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Nature.max = 3, learning = 2 → next BL attempt is attempt #3 →
    // `newCount (3) >= natureMax (3)` → open path in _logBLLearning:221.
    // Health rating 4 is chosen so the halved pool is a clean ceil(4/2)=2
    // (2D deterministic PASS at Ob 1 with u=0.001).
    const actorId = await page.evaluate(async (n) => {
      const actor = await Actor.create({
        name: n,
        type: 'character',
        system: {
          abilities: {
            will:   { rating: 4, pass: 0, fail: 0 },
            health: { rating: 4, pass: 0, fail: 0 },
            nature: { rating: 3, max: 3, pass: 0, fail: 0 }
          },
          skills: {
            fighter: { rating: 0, pass: 0, fail: 0, learning: 2 }
          },
          // Default `conditions.fresh = true` adds +1D via
          // gatherConditionModifiers (DH p.85). Disable so the halvable
          // portion is exactly Health rating — halved to ceil(4/2) = 2.
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

    // Same click-target pattern as skill-test-basic.spec.mjs — `.skill-name`
    // span sidesteps `#onRollTest`'s input / button / .btn-advance filter
    // (character-sheet.mjs:1190-1191). For rating-0 skills the template
    // still renders the `<input>` rating cell (not the ✕ learning marker),
    // because `isLearning` in the template guards on `learning > 0 &&
    // rating === 0` combo; the skill-name label is always present.
    await sheet.rollSkillRow('fighter').locator('.skill-name').click();

    const dialog = new RollDialog(page);
    await dialog.waitForOpen();

    // Base dice input reflects the BL ability rating (Health = 4), NOT
    // the skill's 0 — `rollTest` passes `baseDice = blInfo.blDice` when
    // `blInfo` is non-null (tb2e-roll.mjs:1245).
    expect(await dialog.getPoolSize()).toBe(4);

    // Live summary reflects the HALVED pool: 4 halvable / 2 = 2D.
    // The dialog's live-preview halving at tb2e-roll.mjs:647-663 computes
    // `ceil(halvable/2) - halvable` as a bl-halving modifier and the
    // summary's pool integer reflects the post-halving value.
    await expect.poll(() => dialog.getSummaryPool(), { timeout: 5_000 }).toBe(2);

    await dialog.fillObstacle(1);
    await dialog.submit();

    await expect
      .poll(() => page.evaluate(() => game.messages.contents.length), { timeout: 10_000 })
      .toBeGreaterThan(initialChatCount);

    // Actor-scope the card lookup so --repeat-each iterations can't cross-
    // contaminate. Roll card carries `flags.tb2e.actorId`.
    const cardMessageId = await page.evaluate((id) => {
      const m = game.messages.contents.slice().reverse()
        .find(msg => msg?.flags?.tb2e?.actorId === id && msg?.flags?.tb2e?.roll);
      return m ? m.id : null;
    }, actorId);
    expect(cardMessageId).toBeTruthy();

    const card = new RollChatCard(page);
    await card.expectPresent();

    // 2D all-6s vs Ob 1 is a deterministic PASS with 2 successes; the
    // final pool size is 2 per BL halving.
    expect(await card.getPool()).toBe(2);
    expect(await card.getSuccesses()).toBe(2);
    expect(await card.getObstacle()).toBe(1);
    expect(await card.isPass()).toBe(true);

    // Flag sanity check — the flags payload tells us isBL was set and
    // baseDice is the halved pool (roll-utils.mjs:110-156 builds template
    // data but tb2e-roll.mjs:1418-1440 builds the flags; isBL is set from
    // `!!blInfo`).
    const flags = await page.evaluate(() => {
      const msg = game.messages.contents.at(-1);
      const f = msg?.flags?.tb2e?.roll;
      return f ? { type: f.type, key: f.key, isBL: !!f.isBL, pass: f.pass } : null;
    });
    expect(flags).toEqual({ type: 'skill', key: 'fighter', isBL: true, pass: true });

    // Pre-Finalize: skill data untouched. The learning tick + skill-open
    // happens inside `_handleFinalize` → `logAdvancementForSide` →
    // `_logBLLearning`, not at roll-post time.
    const skillBefore = await page.evaluate((id) => {
      const f = game.actors.get(id).system.skills.fighter;
      return { rating: f.rating, pass: f.pass, fail: f.fail, learning: f.learning };
    }, actorId);
    expect(skillBefore).toEqual({ rating: 0, pass: 0, fail: 0, learning: 2 });

    // Clicking Finalize runs `_handleFinalize` → `logAdvancementForSide`
    // (roll-utils.mjs:194) → `_logBLLearning` (tb2e-roll.mjs:213). No
    // advancement dialog fires for BL, so the standard POM helper works
    // (no deadlock-avoidance needed as in auto-trigger.spec.mjs:170-175).
    await card.clickFinalize();

    // Post-Finalize: skill opens at rating 2, all pips + learning reset.
    // See tb2e-roll.mjs:221-227 — the update is a hard reset of all four
    // fields, not a carry-over of the pre-open pass/fail state.
    await expect
      .poll(() => page.evaluate((id) => {
        const f = game.actors.get(id).system.skills.fighter;
        return { rating: f.rating, pass: f.pass, fail: f.fail, learning: f.learning };
      }, actorId), { timeout: 5_000 })
      .toEqual({ rating: 2, pass: 0, fail: 0, learning: 0 });

    // Skill-opened card (templates/chat/skill-opened.hbs) is posted via
    // `_postSkillOpenedCard` (tb2e-roll.mjs:239-251). Its speaker is
    // `ChatMessage.getSpeaker({ actor })` — no `flags.tb2e.actorId` is set
    // on this card, so we scope by `speaker.actor === actorId` + a unique
    // marker from the template body. The advancement-result celebration
    // card (advancement.mjs:72-85) uses the SAME `.advancement-card-rating`
    // body class, but BL NEVER runs the advancement dialog path (the
    // `logAdvancementForSide` branch at roll-utils.mjs:194-199 delegates to
    // `_logBLLearning`, bypassing `_logAdvancement` entirely), so the only
    // card with that marker for this actor in this test is the skill-
    // opened one. We additionally assert the unique `card-accent--green`
    // class from the skill-opened template root (skill-opened.hbs:1) plus
    // the unique "DH p. 75" reference text to disambiguate if that ever
    // changes.
    await expect
      .poll(() => page.evaluate((id) => {
        return game.messages.contents
          .filter(m => m?.speaker?.actor === id)
          .some(m => typeof m.content === 'string'
                 && m.content.includes('advancement-card-rating')
                 && m.content.includes('card-accent--green')
                 && m.content.includes('DH p. 75'));
      }, actorId), { timeout: 5_000 })
      .toBe(true);

    // Exactly one skill-opened card — not N.
    const openedCount = await page.evaluate((id) => {
      return game.messages.contents
        .filter(m => m?.speaker?.actor === id
                 && typeof m.content === 'string'
                 && m.content.includes('advancement-card-rating')
                 && m.content.includes('DH p. 75'))
        .length;
    }, actorId);
    expect(openedCount).toBe(1);

    // Negative control: no advancement-dialog prompt was opened by the BL
    // path. `_logBLLearning` does not invoke `showAdvancementDialog`, so
    // the AdvancementDialog root must be absent after Finalize.
    const advDialog = new AdvancementDialog(page);
    await expect(advDialog.root).toHaveCount(0);

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });

  test('BL attempt below the nature-max threshold just ticks learning', async ({ page }) => {
    const actorName = `E2E BL Skill Learn ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Nature.max = 4, learning = 0 → post-Finalize `newCount` = 1 < 4 →
    // `_logBLLearning` takes the else branch (line 229-230): bump learning
    // to 1, no rating change, no skill-opened card.
    const actorId = await page.evaluate(async (n) => {
      const actor = await Actor.create({
        name: n,
        type: 'character',
        system: {
          abilities: {
            will:   { rating: 4, pass: 0, fail: 0 },
            health: { rating: 4, pass: 0, fail: 0 },
            nature: { rating: 4, max: 4, pass: 0, fail: 0 }
          },
          skills: {
            fighter: { rating: 0, pass: 0, fail: 0, learning: 0 }
          },
          conditions: { fresh: false }
        }
      });
      return actor.id;
    }, actorName);

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

    await sheet.rollSkillRow('fighter').locator('.skill-name').click();

    const dialog = new RollDialog(page);
    await dialog.waitForOpen();
    expect(await dialog.getPoolSize()).toBe(4);
    await expect.poll(() => dialog.getSummaryPool(), { timeout: 5_000 }).toBe(2);
    await dialog.fillObstacle(1);
    await dialog.submit();

    await expect
      .poll(() => page.evaluate(() => game.messages.contents.length), { timeout: 10_000 })
      .toBeGreaterThan(initialChatCount);

    const card = new RollChatCard(page);
    await card.expectPresent();
    expect(await card.isPass()).toBe(true);

    await card.clickFinalize();

    // Post-Finalize: learning ticks 0 → 1; rating, pass, fail unchanged.
    // _logBLLearning:230 — `actor.update({ learning: newCount })`.
    await expect
      .poll(() => page.evaluate((id) => {
        const f = game.actors.get(id).system.skills.fighter;
        return { rating: f.rating, pass: f.pass, fail: f.fail, learning: f.learning };
      }, actorId), { timeout: 5_000 })
      .toEqual({ rating: 0, pass: 0, fail: 0, learning: 1 });

    // No skill-opened card for this actor — `_postSkillOpenedCard` is
    // only called from the `newCount >= natureMax` branch
    // (tb2e-roll.mjs:228). Wait briefly to rule out a delayed post, then
    // assert the card is absent.
    await page.waitForTimeout(300);
    const openedCount = await page.evaluate((id) => {
      return game.messages.contents
        .filter(m => m?.speaker?.actor === id
                 && typeof m.content === 'string'
                 && m.content.includes('advancement-card-rating')
                 && m.content.includes('DH p. 75'))
        .length;
    }, actorId);
    expect(openedCount).toBe(0);

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });
});
