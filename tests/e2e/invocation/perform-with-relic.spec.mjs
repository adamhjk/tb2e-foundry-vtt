import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §7 Invocations & Relics — perform a Theurge invocation while a matching
 * relic is SLOTTED on the actor. Auto-detection routes us into the "with
 * relic" branch, yielding (a) no no-relic Ob bump and (b) `burdenWithRelic`
 * (not `burden`) applied to Urðr on Finalize.
 *
 * Rules under test:
 *   - `findApplicableRelic` (invocation-casting.mjs:86-95) picks a relic that
 *     is (1) slotted (`system.slot` truthy) AND (2) not dropped
 *     (`system.dropped === false`). For a MINOR relic the match is by
 *     `linkedInvocations.includes(invocation.name)` (invocation-casting.mjs:
 *     92-93). Bone Knitting Needles → ["Bone Knitter"], so auto-detect hits.
 *   - `_askRelicStatus` (invocation-casting.mjs:104-137) then renders the
 *     `TB2E.Relic.HasRelic` prompt with the relic's name (invocation-casting.
 *     mjs:108-109). Clicking "With Relic" (`data-action="yes"`) resolves
 *     hasRelic=true.
 *   - `performInvocation` (invocation-casting.mjs:39) then picks
 *     `burdenWithRelic` over `burden` and, for a fixed-Ob invocation, does
 *     NOT bump the obstacle — the `if ( !hasRelic ) obstacle += 1` at
 *     invocation-casting.mjs:52 is SKIPPED when hasRelic=true.
 *   - Post-roll, `processInvocationPerformed` (invocation-casting.mjs:231-
 *     262) adds `testContext.burdenAmount` (= `burdenWithRelic`) to
 *     `actor.system.urdr.burden` and flips `invocation.system.performed`
 *     true. Wired from Finalize (post-roll.mjs:582-584).
 *
 * Source invocation: `Bone Knitter`
 * (packs/_source/theurge-invocations/Bone_Knitter_b2c3d4e5f6a7b8c9.yml,
 * `_id: b2c3d4e5f6a7b8c9`). `castingType: fixed`, `fixedObstacle: 3`,
 * `burden: 2`, `burdenWithRelic: 1`. DH p.209.
 *
 * Paired relic: `Bone Knitting Needles`
 * (packs/_source/theurge-relics/Bone_Knitting_Needles_e02a2b3c4d5e6f7a.yml,
 * `_id: e02a2b3c4d5e6f7a`). `relicTier: minor`, `linkedInvocations:
 * ["Bone Knitter"]`, `slotOptions: { head: 1, pack: 1 }`. Slotting into
 * "head" slot index 0 (or "pack") satisfies the `slot truthy && !dropped`
 * guard in `findApplicableRelic`.
 *
 * Dice determinism:
 *   - Same PRNG stub as the no-relic spec: `u=0.001 ⇒ every die face = 6`.
 *     Ritualist rating 4 vs Ob 3 (NO +1 bump — we have a relic) ⇒
 *     deterministic PASS with 4 successes.
 *
 * Narrow scope — out of scope (covered by sibling §7 checkboxes):
 *   - Without-relic path (§7 line 261 — perform-basic.spec.mjs).
 *   - Versus-test -1s penalty (§7 line 263).
 *   - Sacramental behavior (§7 line 264).
 *   - Shaman invocations (§7 line 265).
 *   - Dropped-relic NOT auto-detected (§7 line 266).
 *   - Great-relic circle-based auto-detection (distinct branch — lesser
 *     relic linkedInvocations is the common case).
 *   - Urðr-capacity-exceeded styled chat card (separate concern — set
 *     capacity=2 here so 0 + 1 = 1 stays under capacity and no burden-
 *     exceeded card posts).
 */
const INVOCATION_NAME = 'Bone Knitter';
const INVOCATION_ID = 'b2c3d4e5f6a7b8c9'; // packs/_source/theurge-invocations/Bone_Knitter_b2c3d4e5f6a7b8c9.yml
const INVOCATIONS_PACK = 'tb2e.theurge-invocations';
const RELIC_NAME = 'Bone Knitting Needles';
const RELIC_ID = 'e02a2b3c4d5e6f7a'; // packs/_source/theurge-relics/Bone_Knitting_Needles_e02a2b3c4d5e6f7a.yml
const RELICS_PACK = 'tb2e.theurge-relics';
const RELIC_SLOT_KEY = 'head';  // Bone_Knitting_Needles.yml — slotOptions: { head: 1, pack: 1 }
const RELIC_SLOT_INDEX = 0;
const FIXED_OBSTACLE = 3;                // Bone_Knitter.yml — fixedObstacle (NOT bumped when hasRelic)
const EXPECTED_OBSTACLE = FIXED_OBSTACLE; // invocation-casting.mjs:52 skipped because hasRelic=true
const EXPECTED_BURDEN = 1;               // Bone_Knitter.yml — burdenWithRelic (with-relic path)

test.describe('§7 Invocations — perform Theurge invocation with slotted relic', () => {
  test.afterEach(async ({ page }) => {
    // Restore real PRNG — mirror perform-basic.spec.mjs cleanup.
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });
  });

  test('performs Bone Knitter with auto-detected slotted Bone Knitting Needles → Ob 3 Ritualist PASS; burdenWithRelic=1 added on Finalize', async ({ page }) => {
    const actorName = `E2E Invocation Perform WithRelic ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Stage character: Ritualist 4 (invocations roll Ritualist —
    // invocation-casting.mjs:54,61,75). `fresh: false` pins the pool to the
    // skill rating. Urðr capacity 2 so burden 0 → 1 stays under capacity
    // (avoids the separate "burden exceeded" styled card path —
    // invocation-casting.mjs:257-260).
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

    // Embed invocation + relic from their respective compendiums. The relic
    // is slotted (system.slot = "head", system.slotIndex = 0, system.dropped
    // = false) so `findApplicableRelic` detects it (invocation-casting.mjs:
    // 88-94).
    const { invocationItemId, relicItemId } = await page.evaluate(
      async ({ id, invPackId, invEntryId, relicPackId, relicEntryId, slotKey, slotIndex }) => {
        const actor = game.actors.get(id);
        const invPack = game.packs.get(invPackId);
        const relicPack = game.packs.get(relicPackId);
        const invSrc = await invPack.getDocument(invEntryId);
        const relicSrc = await relicPack.getDocument(relicEntryId);
        const invData = invSrc.toObject();
        const relicData = relicSrc.toObject();
        // Slot the relic at creation time: set system.slot + slotIndex +
        // dropped=false. This matches the end-state that drag-to-slot
        // produces (see compendium/drag-relic-to-slot.spec.mjs — confirms
        // `{ system.slot, system.slotIndex, system.dropped: false }`).
        relicData.system = {
          ...relicData.system,
          slot: slotKey,
          slotIndex,
          dropped: false
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

    // Sanity-check embedded items: invocation is the fixed-Ob Bone Knitter,
    // relic is slotted + not dropped with `linkedInvocations: ["Bone
    // Knitter"]`. Pre-assert auto-detection would succeed.
    const stagedState = await page.evaluate(
      ({ id, iid, rid, expectedName }) => {
        const actor = game.actors.get(id);
        const item = actor.items.get(iid);
        const relic = actor.items.get(rid);
        return {
          name: item?.name,
          castingType: item?.system.castingType,
          fixedObstacle: item?.system.fixedObstacle,
          burden: item?.system.burden,
          burdenWithRelic: item?.system.burdenWithRelic,
          sacramental: item?.system.sacramental,
          performed: item?.system.performed,
          startingBurden: actor.system.urdr.burden,
          relicName: relic?.name,
          relicTier: relic?.system.relicTier,
          relicSlot: relic?.system.slot,
          relicDropped: relic?.system.dropped,
          relicLinkedInvocations: relic?.system.linkedInvocations,
          autoDetectMatches: (actor.itemTypes.relic || []).some(r =>
            !!r.system.slot
            && !r.system.dropped
            && (r.system.linkedInvocations || []).includes(expectedName)
          )
        };
      },
      { id: actorId, iid: invocationItemId, rid: relicItemId, expectedName: INVOCATION_NAME }
    );
    expect(stagedState).toEqual({
      name: INVOCATION_NAME,
      castingType: 'fixed',
      fixedObstacle: FIXED_OBSTACLE,
      burden: 2,
      burdenWithRelic: EXPECTED_BURDEN,
      sacramental: '',
      performed: false,
      startingBurden: 0,
      relicName: RELIC_NAME,
      relicTier: 'minor',
      relicSlot: RELIC_SLOT_KEY,
      relicDropped: false,
      relicLinkedInvocations: [INVOCATION_NAME],
      autoDetectMatches: true
    });

    // PRNG stub: u=0.001 ⇒ every die face is 6 ⇒ Ritualist 4 vs Ob 3 PASS
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

      // _askRelicStatus opens DialogV2 with two buttons. Because
      // findApplicableRelic returned our slotted needles, the dialog's
      // rendered content is `TB2E.Relic.HasRelic` (invocation-casting.mjs:
      // 108-109) referencing the relic name. We click "With Relic"
      // (data-action="yes") — invocation-casting.mjs:122-127 — resolves
      // hasRelic=true.
      const relicDialog = page
        .locator('dialog.application.dialog')
        .filter({ has: page.locator('button[data-action="yes"]') })
        .last();
      await expect(relicDialog).toBeVisible();
      // Dialog content cites the auto-detected relic by name (HasRelic key
      // renders the relic's name — invocation-casting.mjs:108-109).
      await expect(relicDialog).toContainText(RELIC_NAME);

      await relicDialog.locator('button[data-action="yes"]').click();
      await expect(relicDialog).toBeHidden();

      // Roll dialog: obstacle is NOT bumped because hasRelic=true (the
      // `if ( !hasRelic ) obstacle += 1` at invocation-casting.mjs:52 is
      // skipped). Pool = Ritualist 4 (fresh:false blocks the +1D from
      // gatherConditionModifiers — DH p.85).
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

      // Flag-level proof: testContext carries hasRelic=true and
      // burdenAmount=burdenWithRelic (invocation-casting.mjs:39-48).
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
        hasRelic: true,
        burdenAmount: EXPECTED_BURDEN
      });

      // Pre-Finalize: burden NOT yet applied (processInvocationPerformed
      // runs only from Finalize — post-roll.mjs:582-584).
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

      // Finalize → urdr.burden += burdenWithRelic (1), performed → true.
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
