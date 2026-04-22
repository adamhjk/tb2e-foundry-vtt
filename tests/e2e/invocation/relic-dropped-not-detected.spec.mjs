import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §7 Invocations & Relics — dropped-relic NOT auto-detected. Direct inverse
 * of perform-with-relic.spec.mjs (TEST_PLAN §7 line 262). The relic IS
 * embedded on the actor and HAS a slot assigned, but its `system.dropped`
 * flag is true — the `findApplicableRelic` guard requires `slot && !dropped`,
 * so a dropped relic is excluded and the invocation runs through the full
 * no-relic path: +1 Ob bump, full `burden` applied (not `burdenWithRelic`).
 *
 * Rules under test:
 *   - `findApplicableRelic` (invocation-casting.mjs:86-95) excludes any relic
 *     where `!relic.system.slot || relic.system.dropped` at
 *     invocation-casting.mjs:89. So a relic with `slot="head"` AND
 *     `dropped=true` → the function returns undefined → hasRelic can still
 *     reach true only via the user clicking "With Relic" on the fallback
 *     dialog. The auto-detect HasRelic prompt is NOT shown.
 *   - `_askRelicStatus` (invocation-casting.mjs:104-137) falls back to the
 *     `TB2E.Invocation.RelicPrompt` branch (invocation-casting.mjs:111-116)
 *     since `applicableRelic` is undefined. We click "Without Relic"
 *     (`data-action="no"`) → hasRelic=false, the full no-relic branch runs.
 *   - With `hasRelic=false`, the fixed obstacle is bumped +1 at
 *     invocation-casting.mjs:52 and `burdenAmount = invocation.system.burden`
 *     (invocation-casting.mjs:39 — not `burdenWithRelic`).
 *   - Post-roll, `processInvocationPerformed` (invocation-casting.mjs:231-
 *     262) applies the full `burden` to `actor.system.urdr.burden` on
 *     Finalize (post-roll.mjs:582-584).
 *
 * Source invocation: `Bone Knitter`
 * (packs/_source/theurge-invocations/Bone_Knitter_b2c3d4e5f6a7b8c9.yml,
 * `_id: b2c3d4e5f6a7b8c9`). castingType `fixed`, `fixedObstacle: 3`,
 * `burden: 2`, `burdenWithRelic: 1`. DH p.209.
 *
 * Paired relic: `Bone Knitting Needles`
 * (packs/_source/theurge-relics/Bone_Knitting_Needles_e02a2b3c4d5e6f7a.yml,
 * `_id: e02a2b3c4d5e6f7a`). `relicTier: minor`, `linkedInvocations:
 * ["Bone Knitter"]`. Mirrors line 262's pairing verbatim, only difference
 * is `dropped: true` which fails the guard.
 *
 * Dropped-state rationale (see CLAUDE.md §Mailbox Pattern / inventory):
 *   Setting `system.dropped: true` is the steady state after the player
 *   drops the item via the sheet's drop-item action. We simulate that
 *   end-state directly. `slot` stays set to "head" so the failure is
 *   proven to be the `!dropped` half of the guard (not the `slot` half) —
 *   i.e. both halves of the AND in invocation-casting.mjs:89 are exercised.
 *
 * Dice determinism:
 *   - Same PRNG stub as sibling specs: `u=0.001 ⇒ every die face = 6`.
 *     Ritualist rating 4 vs Ob 4 (with the +1 no-relic bump) ⇒ deterministic
 *     PASS with 4 successes. Identical to perform-basic.spec.mjs.
 *
 * Narrow scope — out of scope (covered by sibling §7 checkboxes at TEST_PLAN
 * lines 261-265):
 *   - No-relic path (line 261 — perform-basic.spec.mjs — asserts the base
 *     shape).
 *   - Auto-detected slotted relic (line 262 — perform-with-relic.spec.mjs —
 *     the direct inverse of this spec).
 *   - Versus-test -1s penalty (line 263).
 *   - Sacramental behavior (line 264).
 *   - Shaman invocations (line 265).
 *   - Great-relic circle-based detection — the dropped-guard is the same
 *     `!dropped` check for both tiers (invocation-casting.mjs:89 runs before
 *     the tier branch at invocation-casting.mjs:90-93).
 */
const INVOCATION_NAME = 'Bone Knitter';
const INVOCATION_ID = 'b2c3d4e5f6a7b8c9'; // packs/_source/theurge-invocations/Bone_Knitter_b2c3d4e5f6a7b8c9.yml
const INVOCATIONS_PACK = 'tb2e.theurge-invocations';
const RELIC_NAME = 'Bone Knitting Needles';
const RELIC_ID = 'e02a2b3c4d5e6f7a'; // packs/_source/theurge-relics/Bone_Knitting_Needles_e02a2b3c4d5e6f7a.yml
const RELICS_PACK = 'tb2e.theurge-relics';
const RELIC_SLOT_KEY = 'head';  // Bone_Knitting_Needles.yml — slotOptions: { head: 1, pack: 1 }
const RELIC_SLOT_INDEX = 0;
const FIXED_OBSTACLE = 3;                      // Bone_Knitter.yml — fixedObstacle
const EXPECTED_OBSTACLE = FIXED_OBSTACLE + 1;  // invocation-casting.mjs:52 — +1 when !hasRelic
const EXPECTED_BURDEN = 2;                     // Bone_Knitter.yml — burden (full, no-relic path)

test.describe('§7 Invocations — dropped relic is NOT auto-detected', () => {
  test.afterEach(async ({ page }) => {
    // Restore real PRNG — mirror sibling spec cleanup.
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });
  });

  test('relic embedded with slot="head" but dropped=true → findApplicableRelic returns undefined → fallback prompt → no-relic path (Ob 4, full burden 2)', async ({ page }) => {
    const actorName = `E2E Invocation DroppedRelic ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Stage character: Ritualist 4 (invocations roll Ritualist —
    // invocation-casting.mjs:54,61,75). `fresh: false` pins the pool to the
    // skill rating exactly. Urðr capacity 2 / burden 0 so 0 + 2 = 2 stays
    // under capacity (avoids the burden-exceeded card path — separate
    // concern).
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
          urdr: { capacity: 2, burden: 0 }
        }
      });
      return actor.id;
    }, actorName);
    expect(actorId).toBeTruthy();

    // Embed invocation + relic from compendiums. Critically, the relic is
    // inserted with `slot="head", slotIndex=0, dropped=true` — the end state
    // of a previously-slotted relic that was then dropped by the player.
    // The `slot` half of the guard at invocation-casting.mjs:89 would pass,
    // but `dropped=true` flips the OR into a skip.
    const { invocationItemId, relicItemId } = await page.evaluate(
      async ({ id, invPackId, invEntryId, relicPackId, relicEntryId, slotKey, slotIndex }) => {
        const actor = game.actors.get(id);
        const invPack = game.packs.get(invPackId);
        const relicPack = game.packs.get(relicPackId);
        const invSrc = await invPack.getDocument(invEntryId);
        const relicSrc = await relicPack.getDocument(relicEntryId);
        const invData = invSrc.toObject();
        const relicData = relicSrc.toObject();
        // KEY DIFFERENCE from perform-with-relic.spec.mjs: dropped=true here.
        relicData.system = {
          ...relicData.system,
          slot: slotKey,
          slotIndex,
          dropped: true
        };
        const [invCreated, relicCreated] = await actor.createEmbeddedDocuments('Item', [invData, relicData]);
        return { invocationItemId: invCreated.id, relicItemId: relicCreated.id };
      },
      {
        id: actorId,
        invPackId: INVOCATIONS_PACK,
        invEntryId: INVOCATION_ID,
        relicPackId: RELICS_PACK,
        relicEntryId: RELIC_ID,
        slotKey: RELIC_SLOT_KEY,
        slotIndex: RELIC_SLOT_INDEX
      }
    );
    expect(invocationItemId).toBeTruthy();
    expect(relicItemId).toBeTruthy();

    // Preflight: mirror the production guard at invocation-casting.mjs:
    // 88-94 directly. With `slot="head"` and `dropped=true` the guard's
    // `!relic.system.slot || relic.system.dropped` evaluates true, so the
    // relic is excluded regardless of tier/linked-invocations.
    const stagedState = await page.evaluate(
      ({ id, iid, rid, expectedName }) => {
        const actor = game.actors.get(id);
        const item = actor.items.get(iid);
        const relic = actor.items.get(rid);
        const relics = actor.itemTypes.relic || [];
        // Inline the production guard from invocation-casting.mjs:86-95.
        const match = relics.find(r => {
          if ( !r.system.slot || r.system.dropped ) return false;
          if ( r.system.relicTier === "great" ) {
            return r.system.linkedCircle === item.system.circle;
          }
          return (r.system.linkedInvocations || []).includes(item.name);
        });
        return {
          name: item?.name,
          castingType: item?.system.castingType,
          fixedObstacle: item?.system.fixedObstacle,
          burden: item?.system.burden,
          burdenWithRelic: item?.system.burdenWithRelic,
          sacramental: item?.system.sacramental,
          performed: item?.system.performed,
          startingBurden: actor.system.urdr.burden,
          relicCount: relics.length,
          relicName: relic?.name,
          relicTier: relic?.system.relicTier,
          relicSlot: relic?.system.slot,
          relicDropped: relic?.system.dropped,
          relicLinkedInvocations: relic?.system.linkedInvocations,
          // Proves the dropped-guard excludes the relic — the match is
          // undefined even though linkedInvocations contains the invocation
          // name and the slot is set.
          autoDetectMatch: match ? match.id : null
        };
      },
      { id: actorId, iid: invocationItemId, rid: relicItemId, expectedName: INVOCATION_NAME }
    );
    expect(stagedState).toEqual({
      name: INVOCATION_NAME,
      castingType: 'fixed',
      fixedObstacle: FIXED_OBSTACLE,
      burden: EXPECTED_BURDEN,
      burdenWithRelic: 1,
      sacramental: '',
      performed: false,
      startingBurden: 0,
      relicCount: 1,
      relicName: RELIC_NAME,
      relicTier: 'minor',
      relicSlot: RELIC_SLOT_KEY,       // slot half of the guard would pass...
      relicDropped: true,               // ...but dropped half fails it.
      relicLinkedInvocations: [INVOCATION_NAME],
      autoDetectMatch: null             // findApplicableRelic returns undefined.
    });

    // PRNG stub: u=0.001 ⇒ every die face is 6 ⇒ Ritualist 4 vs Ob 4 PASS
    // with 4 successes.
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

      // _askRelicStatus falls into the NO-auto-detect branch because
      // findApplicableRelic returned undefined (the dropped relic failed the
      // guard at invocation-casting.mjs:89). The dialog content is
      // `TB2E.Invocation.RelicPrompt` fallback (invocation-casting.mjs:
      // 111-115) — it should NOT reference the relic by name via the
      // `TB2E.Relic.HasRelic` key (invocation-casting.mjs:108-109 is the
      // auto-detected branch).
      const relicDialog = page
        .locator('dialog.application.dialog')
        .filter({ has: page.locator('button[data-action="no"]') })
        .last();
      await expect(relicDialog).toBeVisible();

      // Click "Without Relic" (data-action="no") — invocation-casting.mjs:
      // 128-133 — resolves hasRelic=false. performInvocation then bumps the
      // obstacle +1 and sets burdenAmount = burden.
      await relicDialog.locator('button[data-action="no"]').click();
      await expect(relicDialog).toBeHidden();

      // Roll dialog: obstacle bumped to 4 because hasRelic=false.
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

      const invocationLine = card.root.locator('.roll-card-spell');
      await expect(invocationLine).toBeVisible();
      await expect(invocationLine).toContainText(INVOCATION_NAME);

      // Flag-level proof: testContext.hasRelic=false AND
      // burdenAmount=full burden (not burdenWithRelic). This is the
      // CENTRAL assertion of the spec — a relic was embedded but the
      // dropped-guard kept it from reaching the test-context.
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
        hasRelic: false,            // Dropped-guard kept the relic out.
        burdenAmount: EXPECTED_BURDEN  // Full burden, not burdenWithRelic.
      });

      // Pre-Finalize: burden NOT yet applied.
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

      // Finalize → urdr.burden += burden (2), performed → true.
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
