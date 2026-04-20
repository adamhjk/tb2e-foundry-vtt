import { test, expect } from '@playwright/test';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * Conditions (DH p.53 / SG pp.46-52): fresh, hungry, angry, afraid,
 * exhausted, injured, sick, dead.
 *
 * Source-verified behavior (module/applications/actor/character-sheet.mjs
 * `#onToggleCondition`):
 *   - Toggling a non-fresh condition ON: sets that flag true and clears
 *     `fresh`. Toggling it OFF: just sets that flag false (does NOT
 *     restore fresh — that's a separate user action).
 *   - Toggling `fresh` ON: sets fresh true and clears ALL other conditions.
 *     Toggling fresh OFF: just sets fresh false.
 *   - The handler writes directly via `this.document.update(...)`. It
 *     does NOT post a chat card, and it does NOT route through the
 *     `pendingGrindApply` mailbox. That mailbox is only used by the
 *     grind-tracker consolidated chat card (see
 *     module/applications/grind-tracker.mjs) when a non-owner player
 *     clicks "Apply" on the card — the GM-side hook
 *     (`Hooks.on("updateActor", ...)` in `tb2e.mjs`) consumes the flag,
 *     updates the grind message, and unsets the flag.
 *
 * This spec exercises both paths:
 *  1. Sheet-level toggle of each condition (state + fresh interaction).
 *  2. The `pendingGrindApply` mailbox directly — writing the flag as GM
 *     causes the registered updateActor hook to clear it.
 */

const NEGATIVE_CONDITIONS = [
  'hungry', 'angry', 'afraid', 'exhausted', 'injured', 'sick', 'dead'
];

test.describe('Character sheet conditions', () => {
  test('toggles each condition on and off and respects the fresh-clearing rule', async ({ page }) => {
    const actorName = `E2E Conditions ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    const actorId = await page.evaluate(async (n) => {
      const actor = await Actor.create({ name: n, type: 'character' });
      return actor.id;
    }, actorName);
    expect(actorId).toBeTruthy();

    // New characters start fresh (character.mjs conditions schema initial).
    const initialFresh = await page.evaluate(
      (id) => game.actors.get(id)?.system.conditions.fresh,
      actorId
    );
    expect(initialFresh).toBe(true);

    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, actorId);

    const sheet = new CharacterSheet(page, actorName);
    await sheet.expectOpen();

    // Exhaustively toggle each negative condition: on, verify state + fresh
    // cleared, then off, verify cleared.
    for ( const key of NEGATIVE_CONDITIONS ) {
      const toggle = sheet.conditionToggle(key);
      await expect(toggle).toBeVisible();

      // Reset: ensure fresh is on and the target condition is off before
      // each iteration so the "fresh gets cleared" assertion is meaningful.
      await page.evaluate(({ id, k }) => {
        const update = { 'system.conditions.fresh': true };
        update[`system.conditions.${k}`] = false;
        return game.actors.get(id).update(update);
      }, { id: actorId, k: key });

      await expect
        .poll(() =>
          page.evaluate(
            ({ id, k }) => {
              const c = game.actors.get(id)?.system.conditions;
              return { fresh: c.fresh, target: c[k] };
            },
            { id: actorId, k: key }
          )
        )
        .toEqual({ fresh: true, target: false });

      // Toggle ON via the sheet click.
      await toggle.click();

      await expect
        .poll(() =>
          page.evaluate(
            ({ id, k }) => {
              const c = game.actors.get(id)?.system.conditions;
              return { fresh: c.fresh, target: c[k] };
            },
            { id: actorId, k: key }
          )
        )
        .toEqual({ fresh: false, target: true });

      // The toggle button should now carry the `.active` class (from
      // character-conditions.hbs: `class="condition-btn{{#if active}} active{{/if}}"`).
      await expect(toggle).toHaveClass(/(^|\s)active(\s|$)/);

      // Toggle OFF again.
      await toggle.click();

      await expect
        .poll(() =>
          page.evaluate(
            ({ id, k }) => game.actors.get(id)?.system.conditions[k],
            { id: actorId, k: key }
          )
        )
        .toBe(false);

      await expect(toggle).not.toHaveClass(/(^|\s)active(\s|$)/);
    }

    // Now test the Fresh toggle's "clear all others" behavior.
    // First, activate several negative conditions directly, then click
    // Fresh and confirm all negatives are cleared.
    await page.evaluate((id) => game.actors.get(id).update({
      'system.conditions.fresh': false,
      'system.conditions.hungry': true,
      'system.conditions.angry': true,
      'system.conditions.injured': true
    }), actorId);

    await expect
      .poll(() =>
        page.evaluate((id) => {
          const c = game.actors.get(id)?.system.conditions;
          return { fresh: c.fresh, hungry: c.hungry, angry: c.angry, injured: c.injured };
        }, actorId)
      )
      .toEqual({ fresh: false, hungry: true, angry: true, injured: true });

    await sheet.conditionToggle('fresh').click();

    await expect
      .poll(() =>
        page.evaluate((id) => {
          const c = game.actors.get(id)?.system.conditions;
          return {
            fresh: c.fresh,
            hungry: c.hungry,
            angry: c.angry,
            afraid: c.afraid,
            exhausted: c.exhausted,
            injured: c.injured,
            sick: c.sick,
            dead: c.dead
          };
        }, actorId)
      )
      .toEqual({
        fresh: true,
        hungry: false,
        angry: false,
        afraid: false,
        exhausted: false,
        injured: false,
        sick: false,
        dead: false
      });

    // Clean up.
    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });

  test('GM updateActor hook clears the pendingGrindApply mailbox flag', async ({ page }) => {
    // This verifies the mailbox-side behavior wired up in tb2e.mjs:
    //   Hooks.on("updateActor", ...) — when `pendingGrindApply` appears
    //   in the changes, processGrindApplyMailbox() runs and calls
    //   actor.unsetFlag("tb2e", "pendingGrindApply"). If the referenced
    //   chat message doesn't exist, the processor still clears the flag
    //   (see module/applications/grind-tracker.mjs:595-599).
    const actorName = `E2E Mailbox ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    const actorId = await page.evaluate(async (n) => {
      const actor = await Actor.create({ name: n, type: 'character' });
      return actor.id;
    }, actorName);
    expect(actorId).toBeTruthy();

    // Confirm we are running as GM (storageState in playwright.config.mjs
    // loads tests/e2e/.auth/gm.json).
    const isGM = await page.evaluate(() => game.user.isGM);
    expect(isGM).toBe(true);

    // Write the mailbox flag directly. Use a bogus messageId so the
    // processor takes the "message not found" branch and still clears.
    await page.evaluate((id) => {
      return game.actors.get(id).setFlag('tb2e', 'pendingGrindApply', 'nonexistent-message-id');
    }, actorId);

    // The GM-side updateActor hook should fire and unset the flag.
    await expect
      .poll(() =>
        page.evaluate((id) => game.actors.get(id)?.getFlag('tb2e', 'pendingGrindApply') ?? null, actorId)
      )
      .toBeNull();

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });
});
