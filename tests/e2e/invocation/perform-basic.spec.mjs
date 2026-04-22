import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §7 Invocations & Relics — perform a Theurge invocation with no relic; verify
 * the full burden is applied to Urðr on Finalize (DH pp.116-119, Bone Knitter
 * DH p.209).
 *
 * Rules under test:
 *   - An invocation's `burden` is applied when the invoker performs WITHOUT a
 *     relic; `burdenWithRelic` applies when WITH. `performInvocation` writes
 *     the chosen amount to `testContext.burdenAmount` at
 *     module/dice/invocation-casting.mjs:39-48 — `hasRelic ? burdenWithRelic :
 *     burden`.
 *   - Fixed-obstacle invocations roll Ritualist against
 *     `system.fixedObstacle`, and without a relic the Ob is bumped +1
 *     (invocation-casting.mjs:50-55). For Bone Knitter (fixedObstacle 3) that
 *     means Ob 4 on this path.
 *   - Post-roll, `processInvocationPerformed` (invocation-casting.mjs:231-262)
 *     adds `burdenAmount` to `actor.system.urdr.burden` and posts a chat
 *     message with the TB2E.Invocation.BurdenAdded flavor. The burden is
 *     applied regardless of pass/fail (invocation-casting.mjs:239-243 — the
 *     comment is explicit: "Add burden regardless of pass/fail").
 *   - `processInvocationPerformed` runs from the Finalize pathway in
 *     module/dice/post-roll.mjs:582-584, gated on
 *     `tbFlags.testContext?.invocationId`.
 *
 * Implementation map:
 *   - Magic tab button `data-action="performInvocation"`
 *     (templates/actors/tabs/character-magic.hbs:166) → CharacterSheet
 *     `#onPerformInvocation` (character-sheet.mjs:62, 1372-1377) →
 *     `performInvocation(actor, invocation)` in
 *     module/dice/invocation-casting.mjs:9.
 *   - `_askRelicStatus` (invocation-casting.mjs:104-137) shows a DialogV2
 *     with two buttons — `data-action="yes"` ("With Relic") and
 *     `data-action="no"` ("Without Relic"). For a character with no relic
 *     Items AND a `relic` text on the invocation, the fallback branch
 *     renders the `TB2E.Invocation.RelicPrompt` localization
 *     (invocation-casting.mjs:111-116). We click `data-action="no"` to
 *     select the no-relic path.
 *   - The roll dialog is pre-filled with obstacle = fixedObstacle + 1
 *     (invocation-casting.mjs:52 — `obstacle += 1` when !hasRelic).
 *
 * Source invocation: `Bone Knitter`
 * (packs/_source/theurge-invocations/Bone_Knitter_b2c3d4e5f6a7b8c9.yml,
 * `_id: b2c3d4e5f6a7b8c9`). castingType `fixed`, `fixedObstacle: 3`, `burden:
 * 2`, `burdenWithRelic: 1`, `sacramental: ''` (no sacramental bonus — that's a
 * later §7 checkbox). DH p.209.
 *
 * Dice determinism:
 *   - Same PRNG stub as spell specs: `u=0.001 ⇒ ceil((1-0.001)*6) = 6` on
 *     every die. Ritualist rating 4 vs Ob 4 ⇒ deterministic PASS. (Ob 4,
 *     not 3, because no-relic bumps the fixed obstacle by +1.)
 *
 * Narrow scope — out of scope (covered by sibling §7 checkboxes at TEST_PLAN
 * lines 262-266):
 *   - Relic auto-detection / reduced burden (line 262).
 *   - Without-relic versus-test -1s penalty (line 263).
 *   - Sacramental behavior (line 264).
 *   - Shaman invocations (line 265).
 *   - Dropped-relic exclusion (line 266).
 *   - Deep assertions on the "BurdenAdded" chat card text.
 *   - The Urðr-capacity exceeded card path (invocation-casting.mjs:257-260)
 *     — we set capacity=0 so the check `newBurden > capacity` passes, but
 *     we do NOT assert on the styled burden-exceeded card (separate concern).
 */
const INVOCATION_NAME = 'Bone Knitter';
const INVOCATION_ID = 'b2c3d4e5f6a7b8c9'; // packs/_source/theurge-invocations/Bone_Knitter_b2c3d4e5f6a7b8c9.yml
const INVOCATIONS_PACK = 'tb2e.theurge-invocations';
const FIXED_OBSTACLE = 3;                // Bone_Knitter.yml — fixedObstacle
const EXPECTED_OBSTACLE = FIXED_OBSTACLE + 1; // invocation-casting.mjs:52 — +1 when !hasRelic
const EXPECTED_BURDEN = 2;               // Bone_Knitter.yml — burden (full, no-relic path)

test.describe('§7 Invocations — perform Theurge invocation without relic', () => {
  test.afterEach(async ({ page }) => {
    // Match sibling specs: clean up the PRNG stub so downstream specs see
    // real randomness.
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });
  });

  test('performs Bone Knitter with no relic → Ob 4 Ritualist PASS; burden 2 added on Finalize', async ({ page }) => {
    const actorName = `E2E Invocation Perform Basic ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Stage character: Ritualist rating 4 (invocations roll Ritualist per
    // invocation-casting.mjs:54,61,75). `fresh: false` pins the dialog pool
    // to the skill rating exactly (gatherConditionModifiers would add +1D
    // otherwise — DH p.85). Urðr starts at burden 0 so we can assert the
    // exact delta after Finalize.
    const actorId = await page.evaluate(async (n) => {
      const actor = await Actor.create({
        name: n,
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
          urdr: { capacity: 0, burden: 0 }
        }
      });
      return actor.id;
    }, actorName);
    expect(actorId).toBeTruthy();

    // Embed the invocation from the compendium — no relic items on the
    // actor, so `findApplicableRelic` returns undefined and `_askRelicStatus`
    // shows the fallback dialog (invocation-casting.mjs:111-116).
    const invocationItemId = await page.evaluate(
      async ({ id, packId, entryId }) => {
        const actor = game.actors.get(id);
        const pack = game.packs.get(packId);
        const src = await pack.getDocument(entryId);
        const data = src.toObject();
        const [created] = await actor.createEmbeddedDocuments('Item', [data]);
        return created.id;
      },
      { id: actorId, packId: INVOCATIONS_PACK, entryId: INVOCATION_ID }
    );
    expect(invocationItemId).toBeTruthy();

    // Sanity-check the embedded invocation is the fixed-Ob Bone Knitter we
    // want, with no sacramental. Also confirm no relic items on the actor.
    const invocationState = await page.evaluate(
      ({ id, iid }) => {
        const actor = game.actors.get(id);
        const item = actor.items.get(iid);
        return {
          name: item?.name,
          castingType: item?.system.castingType,
          fixedObstacle: item?.system.fixedObstacle,
          burden: item?.system.burden,
          burdenWithRelic: item?.system.burdenWithRelic,
          sacramental: item?.system.sacramental,
          performed: item?.system.performed,
          relicCount: (actor.itemTypes.relic || []).length,
          startingBurden: actor.system.urdr.burden
        };
      },
      { id: actorId, iid: invocationItemId }
    );
    expect(invocationState).toEqual({
      name: INVOCATION_NAME,
      castingType: 'fixed',
      fixedObstacle: FIXED_OBSTACLE,
      burden: EXPECTED_BURDEN,
      burdenWithRelic: 1,
      sacramental: '',
      performed: false,
      relicCount: 0,
      startingBurden: 0
    });

    // PRNG stub BEFORE opening the sheet: u=0.001 ⇒ every die face is 6 ⇒
    // Ritualist 4 vs Ob 4 ⇒ deterministic PASS (4 successes).
    await page.evaluate(() => {
      globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => 0.001;
    });

    try {
      await page.evaluate((id) => {
        game.actors.get(id).sheet.render(true);
      }, actorId);

      const sheet = new CharacterSheet(page, actorName);
      await sheet.expectOpen();
      await sheet.openMagicTab();

      // Invocation row renders with the Perform button
      // (character-magic.hbs:166). Clicking it → `#onPerformInvocation` →
      // `performInvocation(actor, item)` (character-sheet.mjs:1372-1377).
      const invocationRow = sheet.invocationRow(invocationItemId);
      await expect(invocationRow).toBeVisible();
      const performButton = invocationRow.locator(
        'button[data-action="performInvocation"]'
      );
      await expect(performButton).toBeVisible();

      const initialChatCount = await page.evaluate(
        () => game.messages.contents.length
      );

      await performButton.click();

      // _askRelicStatus opens a DialogV2 (invocation-casting.mjs:118-136)
      // with two buttons: `data-action="yes"` / `data-action="no"`. Scope
      // by the `data-action="no"` button + the invocation name in the title
      // to avoid matching any stale dialog.
      const relicDialog = page
        .locator('dialog.application.dialog')
        .filter({ has: page.locator('button[data-action="no"]') })
        .last();
      await expect(relicDialog).toBeVisible();

      // Click "Without Relic" (data-action="no") — invocation-casting.mjs:
      // 128-133 — resolves hasRelic=false. `performInvocation` then bumps
      // the obstacle (+1) and passes `burdenAmount = burden` into
      // testContext.
      await relicDialog.locator('button[data-action="no"]').click();
      await expect(relicDialog).toBeHidden();

      // Roll dialog opens with the (no-relic-bumped) obstacle pre-filled.
      const dialog = new RollDialog(page);
      await dialog.waitForOpen();
      expect(await dialog.getPoolSize()).toBe(4);
      expect(await dialog.getObstacle()).toBe(EXPECTED_OBSTACLE);
      await dialog.submit();

      await expect
        .poll(
          () => page.evaluate(() => game.messages.contents.length),
          { timeout: 10_000 }
        )
        .toBeGreaterThan(initialChatCount);

      // Scope chat-card to this actor via flag filter — avoids picking up
      // any stale card in the worker's chat log.
      const card = new RollChatCard(page);
      await card.expectPresent();

      expect(await card.getPool()).toBe(4);
      await expect(card.diceResults).toHaveCount(4);
      expect(await card.getSuccesses()).toBe(4);
      expect(await card.getObstacle()).toBe(EXPECTED_OBSTACLE);
      expect(await card.isPass()).toBe(true);

      // Invocation label on the roll card — roll-result.hbs:27-30 renders
      // `.roll-card-spell` (shared class with spells) when `invocationName`
      // is set in chat data; the flag travels via tb2e-roll.mjs:1468.
      const invocationLine = card.root.locator('.roll-card-spell');
      await expect(invocationLine).toBeVisible();
      await expect(invocationLine).toContainText(INVOCATION_NAME);

      // Flag-level proof of the invocation testContext: invocationId/Name
      // set, hasRelic=false, burdenAmount=burden (full, no-relic).
      const rollFlags = await page.evaluate((id) => {
        const msg = game.messages.contents
          .filter(m => m.flags?.tb2e?.actorId === id && m.flags?.tb2e?.roll)
          .at(-1);
        const tb = msg?.flags?.tb2e;
        const r = tb?.roll;
        return r ? {
          type: r.type,
          key: r.key,
          baseDice: r.baseDice,
          poolSize: r.poolSize,
          obstacle: r.obstacle,
          pass: r.pass,
          invocationId: tb.testContext?.invocationId ?? null,
          invocationName: tb.testContext?.invocationName ?? null,
          hasRelic: tb.testContext?.hasRelic ?? null,
          burdenAmount: tb.testContext?.burdenAmount ?? null
        } : null;
      }, actorId);
      expect(rollFlags).toEqual({
        type: 'skill',
        key: 'ritualist',
        baseDice: 4,
        poolSize: 4,
        obstacle: EXPECTED_OBSTACLE,
        pass: true,
        invocationId: invocationItemId,
        invocationName: INVOCATION_NAME,
        hasRelic: false,
        burdenAmount: EXPECTED_BURDEN
      });

      // Pre-Finalize: burden NOT yet applied — processInvocationPerformed
      // only fires from `_handleFinalize` (post-roll.mjs:582-584).
      // `performed` also flips in that pathway (invocation-casting.mjs:
      // 234-237).
      const preFinalize = await page.evaluate(
        ({ id, iid }) => {
          const actor = game.actors.get(id);
          const item = actor.items.get(iid);
          return {
            burden: actor.system.urdr.burden,
            performed: item?.system.performed
          };
        },
        { id: actorId, iid: invocationItemId }
      );
      expect(preFinalize).toEqual({ burden: 0, performed: false });

      // Finalize → processInvocationPerformed → urdr.burden += burdenAmount
      // (invocation-casting.mjs:240-243) + invocation.performed flipped
      // (invocation-casting.mjs:234-237).
      await card.clickFinalize();

      await expect
        .poll(
          () => page.evaluate((id) => {
            return game.actors.get(id).system.urdr.burden;
          }, actorId),
          { timeout: 10_000 }
        )
        .toBe(EXPECTED_BURDEN);

      // Post-Finalize state: actor's urdr.burden went from 0 → burden (2),
      // invocation flipped to performed=true.
      const postFinalize = await page.evaluate(
        ({ id, iid }) => {
          const actor = game.actors.get(id);
          const item = actor.items.get(iid);
          return {
            burden: actor.system.urdr.burden,
            performed: item?.system.performed
          };
        },
        { id: actorId, iid: invocationItemId }
      );
      expect(postFinalize).toEqual({
        burden: EXPECTED_BURDEN,
        performed: true
      });
    } finally {
      await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
    }
  });
});
