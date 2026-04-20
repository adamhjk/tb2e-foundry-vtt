import { test, expect } from '@playwright/test';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * DH p.85 — once-per-session (per-level) trait use. A new session restores
 * beneficial uses and clears any "used against" flag set by a versus roll.
 *
 * Data-model facts (module/data/item/trait.mjs + module/session.mjs):
 *   - "Session usage" lives entirely on each trait Item (no actor-level map):
 *       * `system.beneficial` — NumberField, min 0. Tracks the number of
 *         +1D uses REMAINING this session. For L1 that's 1, L2 that's 2,
 *         and for L3 it's 0 because L3 is unlimited +1s (not counted).
 *       * `system.usedAgainst` — BooleanField. Set by module/dice/versus.mjs
 *         when the trait is invoked against the character for a reward.
 *   - There is NO actor-level map of trait usage; no `system.usedThisSession`
 *     flag; no spell or invocation state that applies to traits.
 *
 * Handler facts (module/session.mjs `resetTraitsForSession`):
 *   For every trait Item on the actor, the handler writes:
 *     - `system.beneficial` = level >= 3 ? 0 : level   (restore remaining uses)
 *     - `system.usedAgainst` = false                   (clear versus flag)
 *   It also resets `system.cast` on spells and `system.performed` on
 *   invocations, but those aren't exercised here (this spec is scoped to
 *   traits per the TEST_PLAN entry).
 *
 * Handler flow (module/applications/actor/character-sheet.mjs #onResetSession):
 *   Clicking the "New Session" button opens a DialogV2.confirm. On Yes,
 *   `resetTraitsForSession(this.document)` runs and an info notification is
 *   shown. On No/dismiss, nothing changes.
 *
 * Scope: mark each of an L1, L2, and L3 trait as "used" (drain `beneficial`
 * to 0 and set `usedAgainst` true), click New Session, confirm the dialog,
 * and assert every trait is restored to its level-appropriate post-reset
 * state. Also spot-check the no-op path (cancel the dialog) leaves state
 * unchanged.
 */
test.describe('Character sheet session reset', () => {
  test('resetSession restores trait.beneficial and clears trait.usedAgainst', async ({ page }) => {
    const actorName = `E2E Session ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Create the actor + three traits (L1, L2, L3) programmatically.
    const { actorId, traits } = await page.evaluate(async (n) => {
      const actor = await Actor.create({ name: n, type: 'character' });
      const [t1, t2, t3] = await actor.createEmbeddedDocuments('Item', [
        { name: `${n} L1`, type: 'trait', system: { level: 1, beneficial: 1 } },
        { name: `${n} L2`, type: 'trait', system: { level: 2, beneficial: 2 } },
        { name: `${n} L3`, type: 'trait', system: { level: 3, beneficial: 0 } }
      ]);
      return { actorId: actor.id, traits: { t1: t1.id, t2: t2.id, t3: t3.id } };
    }, actorName);
    expect(actorId).toBeTruthy();

    // Mark every trait as "used this session": drain remaining beneficial
    // uses to 0 (simulating consumption) and set usedAgainst true
    // (simulating a versus invoke against the character). For L3 the
    // beneficial field is already 0 by reset rule; we still set
    // usedAgainst so we can prove reset clears it on L3 traits too.
    await page.evaluate(
      async ({ id, ids }) => {
        const actor = game.actors.get(id);
        await actor.updateEmbeddedDocuments('Item', [
          { _id: ids.t1, 'system.beneficial': 0, 'system.usedAgainst': true },
          { _id: ids.t2, 'system.beneficial': 0, 'system.usedAgainst': true },
          { _id: ids.t3, 'system.beneficial': 0, 'system.usedAgainst': true }
        ]);
      },
      { id: actorId, ids: traits }
    );

    // Sanity check the pre-reset state landed as expected.
    const preState = await page.evaluate(
      ({ id, ids }) => {
        const actor = game.actors.get(id);
        const read = (iid) => {
          const it = actor.items.get(iid);
          return { beneficial: it.system.beneficial, usedAgainst: it.system.usedAgainst, level: it.system.level };
        };
        return { t1: read(ids.t1), t2: read(ids.t2), t3: read(ids.t3) };
      },
      { id: actorId, ids: traits }
    );
    expect(preState.t1).toEqual({ beneficial: 0, usedAgainst: true, level: 1 });
    expect(preState.t2).toEqual({ beneficial: 0, usedAgainst: true, level: 2 });
    expect(preState.t3).toEqual({ beneficial: 0, usedAgainst: true, level: 3 });

    // Open the sheet (header is always rendered; no tab switch needed).
    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, actorId);

    const sheet = new CharacterSheet(page, actorName);
    await sheet.expectOpen();

    // Click "New Session" — opens a DialogV2.confirm.
    await expect(sheet.resetSessionButton).toBeVisible();
    await sheet.resetSessionButton.click();

    // DialogV2 renders as a <dialog class="application dialog"> with a
    // button[data-action="yes"] (see foundry/client/applications/api/dialog.mjs).
    const dialog = page.locator('dialog.application.dialog').last();
    await expect(dialog).toBeVisible();
    await dialog.locator('button[data-action="yes"]').click();

    // Expect every trait to have been reset per the handler:
    //   - beneficial: L1 → 1, L2 → 2, L3 → 0
    //   - usedAgainst: false (all levels)
    await expect
      .poll(() =>
        page.evaluate(
          ({ id, ids }) => {
            const actor = game.actors.get(id);
            const read = (iid) => {
              const it = actor.items.get(iid);
              return { beneficial: it.system.beneficial, usedAgainst: it.system.usedAgainst };
            };
            return { t1: read(ids.t1), t2: read(ids.t2), t3: read(ids.t3) };
          },
          { id: actorId, ids: traits }
        )
      )
      .toEqual({
        t1: { beneficial: 1, usedAgainst: false },
        t2: { beneficial: 2, usedAgainst: false },
        t3: { beneficial: 0, usedAgainst: false }
      });

    // And the DOM reflects the restored beneficial counts on the Traits tab.
    await sheet.openTraitsTab();
    await expect(sheet.traitBeneficialInput(traits.t1)).toHaveValue('1');
    await expect(sheet.traitBeneficialInput(traits.t2)).toHaveValue('2');
    await expect(sheet.traitBeneficialInput(traits.t3)).toHaveValue('0');

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });

  test('cancelling the confirm dialog leaves trait usage state unchanged', async ({ page }) => {
    const actorName = `E2E SessionCancel ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    const { actorId, traitId } = await page.evaluate(async (n) => {
      const actor = await Actor.create({ name: n, type: 'character' });
      // L2 trait, drained to 0 remaining and flagged usedAgainst.
      const [item] = await actor.createEmbeddedDocuments('Item', [
        { name: `${n} L2`, type: 'trait',
          system: { level: 2, beneficial: 0, usedAgainst: true } }
      ]);
      return { actorId: actor.id, traitId: item.id };
    }, actorName);
    expect(actorId).toBeTruthy();
    expect(traitId).toBeTruthy();

    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, actorId);

    const sheet = new CharacterSheet(page, actorName);
    await sheet.expectOpen();

    await expect(sheet.resetSessionButton).toBeVisible();
    await sheet.resetSessionButton.click();

    // Dismiss the dialog by clicking No — the default button in
    // DialogV2.confirm (see foundry/client/applications/api/dialog.mjs).
    const dialog = page.locator('dialog.application.dialog').last();
    await expect(dialog).toBeVisible();
    await dialog.locator('button[data-action="no"]').click();
    await expect(dialog).toBeHidden();

    // State must be unchanged.
    const post = await page.evaluate(
      ({ id, tid }) => {
        const it = game.actors.get(id).items.get(tid);
        return { beneficial: it.system.beneficial, usedAgainst: it.system.usedAgainst };
      },
      { id: actorId, tid: traitId }
    );
    expect(post).toEqual({ beneficial: 0, usedAgainst: true });

    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });
});
