import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §7 Invocations & Relics — perform a Shaman invocation end-to-end.
 *
 * Goal: confirm the shaman class code path runs at parity with the theurge
 * path already covered by sibling §7 specs (TEST_PLAN lines 261-264). The
 * invocation handler `performInvocation`
 * (module/dice/invocation-casting.mjs:9-77) has NO class branching — there is
 * no `actor.system.class === "shaman"` check anywhere in the file — so
 * shaman-class actors performing entries from `tb2e.shamanic-invocations`
 * flow through the exact same fixed/factors/versus switch as theurge. Burden
 * lives on the shared `actor.system.urdr.burden` field
 * (module/data/actor/character.mjs:155-157), which is common to all character
 * classes (not theurge-only). This spec is therefore a pack-parity test:
 *   1) a shamanic invocation compendium entry can be embedded on a character,
 *   2) the Perform button on the magic tab reaches `performInvocation`,
 *   3) the no-relic path bumps Ob by +1, rolls Ritualist, and posts a roll
 *      card whose `flags.tb2e.testContext.invocationId` points back at the
 *      embedded item,
 *   4) Finalize applies the full `burden` to `actor.system.urdr.burden` and
 *      flips `invocation.system.performed` to true — identical side-effects
 *      to the theurge basic spec.
 *
 * Source invocation: `Hound of the Hunt`
 * (packs/_source/shamanic-invocations/Hound_of_the_Hunt_c1c2c3c4c5c61003.yml,
 * `_id: c1c2c3c4c5c61003`). `castingType: fixed`, `fixedObstacle: 3`,
 * `burden: 2`, `burdenWithRelic: 1`, `sacramental: ''`. Lore Master's Manual
 * p.42. Deliberately chosen as the shaman analogue of Bone Knitter (same Ob,
 * same burdens, empty sacramental) so the parity is provable number-for-
 * number against TEST_PLAN line 261.
 *
 * Casting type is `fixed` by design — versus and sacramental paths are
 * covered by lines 263/264 respectively; skillSwap returns before the roll
 * (invocation-casting.mjs:14-22) and factors requires a radio pick in an
 * extra dialog. Fixed-Ob isolates the parity claim to the shortest possible
 * code path.
 *
 * Dice determinism:
 *   - Same PRNG stub as every other §7 spec: `u=0.001 ⇒ ceil((1-0.001)*6) = 6`
 *     on every die. Ritualist rating 4 vs Ob 4 ⇒ deterministic PASS with 4
 *     successes. (Ob 4 because no-relic bumps fixedObstacle 3 by +1 at
 *     invocation-casting.mjs:52.)
 *
 * Class field: `system.class` is a plain StringField on CharacterData
 * (module/data/actor/character.mjs:17). We set it to "shaman" as a
 * self-documenting marker so the test intent is visible in actor data, but
 * the invocation handler does not read it — the parity claim does not depend
 * on the string value. The only actor state that materially affects the roll
 * is Ritualist rating + `conditions.fresh=false` (no +1D condition bonus)
 * and starting `urdr.burden=0` (clean delta assertion).
 *
 * Narrow scope — out of scope (sibling §7 checkboxes cover these):
 *   - Shaman relic pairing (line 262 covers the pattern with theurge; shaman
 *     follows the same `findApplicableRelic` code path — no class-specific
 *     divergence to test).
 *   - Versus / sacramental / factors / skillSwap casting types.
 *   - Dropped-relic exclusion (line 266).
 *   - Urðr capacity exceeded card path (invocation-casting.mjs:257-260).
 */
const INVOCATION_NAME = 'Hound of the Hunt';
const INVOCATION_ID = 'c1c2c3c4c5c61003'; // packs/_source/shamanic-invocations/Hound_of_the_Hunt_c1c2c3c4c5c61003.yml
const INVOCATIONS_PACK = 'tb2e.shamanic-invocations';
const FIXED_OBSTACLE = 3;                 // Hound_of_the_Hunt.yml — fixedObstacle
const EXPECTED_OBSTACLE = FIXED_OBSTACLE + 1; // invocation-casting.mjs:52 — +1 when !hasRelic
const EXPECTED_BURDEN = 2;                // Hound_of_the_Hunt.yml — burden (full, no-relic path)

test.describe('§7 Invocations — perform Shaman invocation without relic', () => {
  test.afterEach(async ({ page }) => {
    // Match sibling §7 specs: restore the PRNG stub so downstream specs see
    // real randomness.
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });
  });

  test('performs Hound of the Hunt with no relic → Ob 4 Ritualist PASS; burden 2 added on Finalize', async ({ page }) => {
    const actorName = `E2E Shaman Invocation ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Stage a SHAMAN-class character with Ritualist 4 and clean Urðr.
    // `system.class` is a StringField (character.mjs:17); `invocation-
    // casting.mjs` does NOT read it (no class gating in the handler), so the
    // value is documentation for test intent — the code path is identical to
    // theurge. `conditions.fresh: false` pins the dialog pool to the rating
    // (no +1D fresh bonus — DH p.85).
    const actorId = await page.evaluate(async (n) => {
      const actor = await Actor.create({
        name: n,
        type: 'character',
        system: {
          class: 'shaman',
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

    // Embed the shamanic invocation. No relic items on the actor →
    // `findApplicableRelic` (invocation-casting.mjs:86-95) returns undefined →
    // `_askRelicStatus` shows the fallback dialog (invocation-casting.mjs:
    // 111-116) where we click "Without Relic".
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

    // Sanity: confirm the embedded entry is the fixed-Ob Hound of the Hunt
    // from the shamanic pack with no sacramental, plus starting state. Also
    // verify the actor's class marker survived creation.
    const invocationState = await page.evaluate(
      ({ id, iid }) => {
        const actor = game.actors.get(id);
        const item = actor.items.get(iid);
        return {
          actorClass: actor.system.class,
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
      actorClass: 'shaman',
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

    // PRNG stub BEFORE opening the sheet: u=0.001 ⇒ all-6s ⇒ Ritualist 4 vs
    // Ob 4 ⇒ deterministic PASS (4 successes).
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

      // Perform button on the magic tab — same template+handler as theurge.
      // `character-magic.hbs` renders `data-action="performInvocation"` for
      // every `invocation`-typed item regardless of class; handler
      // `#onPerformInvocation` (character-sheet.mjs:1372-1377) calls
      // `performInvocation(actor, item)` unconditionally.
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

      // _askRelicStatus dialog — two `data-action` buttons ("yes" / "no").
      // Scope by the `no` button to avoid matching any other open dialog.
      const relicDialog = page
        .locator('dialog.application.dialog')
        .filter({ has: page.locator('button[data-action="no"]') })
        .last();
      await expect(relicDialog).toBeVisible();

      // Click "Without Relic" → hasRelic=false → Ob +1, full burden.
      await relicDialog.locator('button[data-action="no"]').click();
      await expect(relicDialog).toBeHidden();

      // Roll dialog opens with obstacle = fixedObstacle + 1 = 4.
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

      const card = new RollChatCard(page);
      await card.expectPresent();

      expect(await card.getPool()).toBe(4);
      await expect(card.diceResults).toHaveCount(4);
      expect(await card.getSuccesses()).toBe(4);
      expect(await card.getObstacle()).toBe(EXPECTED_OBSTACLE);
      expect(await card.isPass()).toBe(true);

      // Invocation label shares the `.roll-card-spell` class with spells
      // (roll-result.hbs:27-30) — the flag travels via tb2e-roll.mjs:1468.
      const invocationLine = card.root.locator('.roll-card-spell');
      await expect(invocationLine).toBeVisible();
      await expect(invocationLine).toContainText(INVOCATION_NAME);

      // Flag-level proof: testContext.invocationId matches the embedded
      // shamanic invocation's item id, hasRelic=false, burdenAmount=full.
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

      // Pre-Finalize: burden not yet applied — processInvocationPerformed
      // only fires from Finalize (post-roll.mjs:582-584).
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

      // Finalize → processInvocationPerformed → urdr.burden += burden (2),
      // performed flipped true. Identical pathway to theurge — the shared
      // handler makes no class distinction (invocation-casting.mjs:231-262).
      await card.clickFinalize();

      await expect
        .poll(
          () => page.evaluate((id) => {
            return game.actors.get(id).system.urdr.burden;
          }, actorId),
          { timeout: 10_000 }
        )
        .toBe(EXPECTED_BURDEN);

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
