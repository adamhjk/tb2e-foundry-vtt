import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §7 Invocations & Relics — the `sacramental` flag on an invocation adds a
 * pre-timing +1D context modifier to the casting roll. This is the only side
 * effect (the Dungeoneer's Handbook treats sacramentals as consumed material
 * components that bolster the performance; the codebase does NOT model a
 * separate supply decrement — it's a pure dice bonus).
 *
 * Rules under test:
 *   - `performInvocation` (module/dice/invocation-casting.mjs:30-37) pushes a
 *     pre-timing `dice` modifier with `value: 1`, `source: "invocation"`, and
 *     label `TB2E.Invocation.SacramentalBonus` ("Sacramental (+1D)", lang/en.json:895)
 *     WHEN `invocationItem.system.sacramental` is truthy (StringField — empty
 *     string is falsy, any non-empty material name like "A bit of blubber or
 *     fine incense" is truthy). The code path is shared across fixed / factors
 *     / versus casting — it runs before the castingType switch.
 *   - `_showRollDialog` (tb2e-roll.mjs:376-485) passes `contextModifiers` into
 *     the dialog render, and `_collectAllModifiers` (tb2e-roll.mjs:549-666)
 *     seeds its active list from `[...conditionModifiers, ...contextModifiers]`
 *     — so the sacramental row renders in the dialog without any user action.
 *   - `updateSummary` (tb2e-roll.mjs:939-962) sums `pre/dice` modifiers and
 *     shows `pool = baseDice + diceBonus` as the live "ND vs Ob M" summary.
 *     The `poolSize` INPUT stays at the rating; the bonus only shows in the
 *     summary until roll-time.
 *   - At roll-time `rollTest` (tb2e-roll.mjs:1316-1319) computes
 *     `poolSize = Math.max(config.baseDice + diceBonus, 1)` — so the chat
 *     card's `flags.tb2e.roll.poolSize` reflects the +1D and the dice grid
 *     shows `baseDice + 1` glyphs.
 *   - `allModifiers` are serialized onto `flags.tb2e.roll.modifiers`
 *     (tb2e-roll.mjs:1431) — we can assert the sacramental entry is present.
 *   - The downstream burden/performed pipeline is unchanged:
 *     `processInvocationPerformed` (invocation-casting.mjs:231-262) still
 *     applies `burdenAmount` and flips `performed: true` on Finalize — the
 *     sacramental is orthogonal to burden.
 *
 * Source invocation: `Breath of the Burning Lord`
 * (packs/_source/theurge-invocations/Breath_of_the_Burning_Lord_c3d4e5f6a7b8c9d0.yml,
 * `_id: c3d4e5f6a7b8c9d0`). `castingType: fixed`, `fixedObstacle: 2`,
 * `burden: 2`, `burdenWithRelic: 1`, `sacramental: "A bit of blubber or fine
 * incense"`. DH p.210.
 *
 * Chosen deliberately as a FIXED-Ob sacramental invocation to isolate the
 * sacramental bonus from confounds:
 *   - Not `factors` (would require picking a radio option in the factor
 *     dialog, and the sacramental bonus path is identical in all three
 *     casting types — fixed is the simplest to assert).
 *   - Not `versus` (versus burden/performed side-effects are a known
 *     production gap — see perform-without-relic-penalty.spec.mjs §7 line
 *     263 — and mixing that with the sacramental assertion would require
 *     two-actor orchestration).
 *   - Not `skillSwap` (returns early at invocation-casting.mjs:14-22
 *     WITHOUT ever reaching the sacramental push at invocation-casting.mjs:
 *     30-37 — verified by code inspection; skillSwap has no roll, so there's
 *     no dice bonus to apply).
 *
 * No-relic path to keep the obstacle predictable: the actor has no relic
 * items, so `_askRelicStatus` shows the fallback prompt and clicking
 * "Without Relic" sets `hasRelic=false`. For fixed-Ob invocations this
 * bumps Ob by +1 (invocation-casting.mjs:52), so Breath at fixedObstacle 2
 * rolls at Ob 3, and the no-relic burden is the full `burden: 2` (not
 * `burdenWithRelic: 1`).
 *
 * Dice determinism:
 *   - Same all-6s PRNG stub as the other §7 specs: `u=0.001 ⇒ every die = 6`.
 *     Ritualist rating 4 + sacramental +1D = 5D vs Ob 3 ⇒ deterministic PASS
 *     with 5 successes.
 *
 * Narrow scope — out of scope (other §7 checkboxes):
 *   - Relic auto-detection / reduced burden (line 262 — perform-with-relic.
 *     spec.mjs).
 *   - Versus invocation -1s penalty (line 263 —
 *     perform-without-relic-penalty.spec.mjs).
 *   - Shaman invocations (line 265).
 *   - Dropped-relic NOT auto-detected (line 266).
 *   - Supply-type consumption: there is NO supply-item decrement pipeline
 *     for sacramentals in the current codebase — `supplyType: "sacramental"`
 *     (module/data/item/supply.mjs:12) is an enum value used by the
 *     Sacramentals supply-entry in magical-religious, but there is no
 *     production wiring that consumes it on invocation performance. Only
 *     the +1D dice bonus is asserted here.
 *   - Sacramental-with-relic interaction: redundant — the +1D comes from the
 *     same contextModifiers push regardless of hasRelic (invocation-casting.
 *     mjs:30-37 runs BEFORE the hasRelic branch at invocation-casting.mjs:
 *     50-76).
 */
const INVOCATION_NAME = 'Breath of the Burning Lord';
const INVOCATION_ID = 'c3d4e5f6a7b8c9d0'; // packs/_source/theurge-invocations/Breath_of_the_Burning_Lord_c3d4e5f6a7b8c9d0.yml
const INVOCATIONS_PACK = 'tb2e.theurge-invocations';
const FIXED_OBSTACLE = 2;                     // Breath_of_the_Burning_Lord.yml — fixedObstacle
const EXPECTED_OBSTACLE = FIXED_OBSTACLE + 1; // invocation-casting.mjs:52 — +1 when !hasRelic
const EXPECTED_BURDEN = 2;                    // Breath_of_the_Burning_Lord.yml — burden (full, no-relic path)
const SACRAMENTAL_MATERIAL = 'A bit of blubber or fine incense';
const SACRAMENTAL_LABEL = 'Sacramental (+1D)'; // lang/en.json:895 — TB2E.Invocation.SacramentalBonus
const EXPECTED_RITUALIST_RATING = 4;
const EXPECTED_POOL = EXPECTED_RITUALIST_RATING + 1; // rating + sacramental +1D (invocation-casting.mjs:30-37)

test.describe('§7 Invocations — sacramental invocation (+1D dice bonus)', () => {
  test.afterEach(async ({ page }) => {
    // Match sibling §7 specs: clean up the PRNG stub so downstream specs see
    // real randomness.
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });
  });

  test('performs Breath of the Burning Lord (sacramental) → +1D modifier applied; 5D vs Ob 3 PASS; burden 2 on Finalize', async ({ page }) => {
    const actorName = `E2E Invocation Sacramental ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Stage character: Ritualist 4 (invocations roll Ritualist —
    // invocation-casting.mjs:54). `fresh: false` pins the base pool to the
    // skill rating (gatherConditionModifiers would add +1D fresh otherwise —
    // DH p.85), so the only dice bonus visible is the sacramental +1D.
    // Urðr capacity 5 keeps 0 + 2 under capacity (avoids the burden-
    // exceeded styled card path at invocation-casting.mjs:257-260).
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
          urdr: { capacity: 5, burden: 0 }
        }
      });
      return actor.id;
    }, actorName);
    expect(actorId).toBeTruthy();

    // Embed the invocation from the compendium. No relic items on the actor
    // → `findApplicableRelic` returns undefined and `_askRelicStatus` shows
    // the fallback dialog. We'll pick "Without Relic" to route through the
    // +1 Ob bump at invocation-casting.mjs:52.
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

    // Sanity-check the embedded invocation: confirm this is the fixed-Ob
    // Breath variant with a truthy `sacramental` string (any non-empty
    // value triggers the +1D push — invocation-casting.mjs:30-37). Also
    // confirm no relic items on the actor.
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
      sacramental: SACRAMENTAL_MATERIAL,
      performed: false,
      relicCount: 0,
      startingBurden: 0
    });

    // PRNG stub BEFORE opening the sheet: u=0.001 ⇒ every die face is 6 ⇒
    // Ritualist 4 + sacramental +1D = 5D vs Ob 3 ⇒ deterministic PASS
    // (5 successes).
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

      // _askRelicStatus (invocation-casting.mjs:118-136) opens a DialogV2 —
      // no relic items + the invocation's `relic` field is empty for Breath
      // (see the yml), so the fallback path renders `TB2E.Relic.NoRelic`
      // (invocation-casting.mjs:114-115). We click "Without Relic"
      // (`data-action="no"`) to resolve hasRelic=false.
      const relicDialog = page
        .locator('dialog.application.dialog')
        .filter({ has: page.locator('button[data-action="no"]') })
        .last();
      await expect(relicDialog).toBeVisible();
      await relicDialog.locator('button[data-action="no"]').click();
      await expect(relicDialog).toBeHidden();

      // Roll dialog opens with:
      //   - poolSize INPUT = 4 (Ritualist rating) — the sacramental bonus
      //     does NOT mutate the input; it's added at summary/roll-time.
      //   - obstacle INPUT = 3 (fixed 2 + 1 no-relic bump per
      //     invocation-casting.mjs:52).
      //   - A `.roll-modifier` row with label "Sacramental (+1D)" rendered
      //     from the contextModifiers push at invocation-casting.mjs:30-37.
      //   - Summary text "5D vs Ob 3" — updateSummary at tb2e-roll.mjs:
      //     939-962 adds `diceBonus` from pre/dice modifiers.
      const dialog = new RollDialog(page);
      await dialog.waitForOpen();
      expect(await dialog.getPoolSize()).toBe(EXPECTED_RITUALIST_RATING);
      expect(await dialog.getObstacle()).toBe(EXPECTED_OBSTACLE);

      // Sacramental modifier row is pre-rendered in the dialog — proof
      // that `contextModifiers` carried the push from invocation-casting.mjs
      // through to `_collectAllModifiers` (tb2e-roll.mjs:549-551).
      const sacramentalModRow = dialog.root
        .locator('.roll-modifier', { hasText: SACRAMENTAL_LABEL });
      await expect(sacramentalModRow).toBeVisible();

      // Summary reflects base 4 + sacramental 1 = 5D.
      expect(await dialog.getSummaryPool()).toBe(EXPECTED_POOL);

      await dialog.submit();

      await expect
        .poll(
          () => page.evaluate(() => game.messages.contents.length),
          { timeout: 10_000 }
        )
        .toBeGreaterThan(initialChatCount);

      const card = new RollChatCard(page);
      await card.expectPresent();

      // Chat card asserts: poolSize 5 (4 + sacramental), 5 dice glyphs,
      // 5 successes (all 6s), Ob 3, PASS.
      expect(await card.getPool()).toBe(EXPECTED_POOL);
      await expect(card.diceResults).toHaveCount(EXPECTED_POOL);
      expect(await card.getSuccesses()).toBe(EXPECTED_POOL);
      expect(await card.getObstacle()).toBe(EXPECTED_OBSTACLE);
      expect(await card.isPass()).toBe(true);

      const invocationLine = card.root.locator('.roll-card-spell');
      await expect(invocationLine).toBeVisible();
      await expect(invocationLine).toContainText(INVOCATION_NAME);

      // Flag-level proof: baseDice=4 (Ritualist), poolSize=5 (after +1D),
      // modifiers list contains the sacramental entry from invocation-
      // casting.mjs:31-36 (serialized at tb2e-roll.mjs:1431).
      const rollFlags = await page.evaluate((id) => {
        const msg = game.messages.contents
          .filter(m => m.flags?.tb2e?.actorId === id && m.flags?.tb2e?.roll)
          .at(-1);
        const tb = msg?.flags?.tb2e;
        const r = tb?.roll;
        if (!r) return null;
        const sacramentalMod = (r.modifiers || []).find(
          m => m.source === 'invocation' && m.type === 'dice' && m.value === 1
        );
        return {
          type: r.type,
          key: r.key,
          baseDice: r.baseDice,
          poolSize: r.poolSize,
          obstacle: r.obstacle ?? null,
          pass: r.pass ?? null,
          invocationId: tb.testContext?.invocationId ?? null,
          invocationName: tb.testContext?.invocationName ?? null,
          hasRelic: tb.testContext?.hasRelic ?? null,
          burdenAmount: tb.testContext?.burdenAmount ?? null,
          sacramentalMod: sacramentalMod ? {
            label: sacramentalMod.label,
            type: sacramentalMod.type,
            value: sacramentalMod.value,
            source: sacramentalMod.source,
            timing: sacramentalMod.timing
          } : null
        };
      }, actorId);
      expect(rollFlags).toEqual({
        type: 'skill',
        key: 'ritualist',
        baseDice: EXPECTED_RITUALIST_RATING,
        poolSize: EXPECTED_POOL,
        obstacle: EXPECTED_OBSTACLE,
        pass: true,
        invocationId: invocationItemId,
        invocationName: INVOCATION_NAME,
        hasRelic: false,
        burdenAmount: EXPECTED_BURDEN,
        sacramentalMod: {
          label: SACRAMENTAL_LABEL,
          type: 'dice',
          value: 1,
          source: 'invocation',
          timing: 'pre'
        }
      });

      // Pre-Finalize: burden NOT yet applied, performed NOT yet flipped.
      // processInvocationPerformed only fires from `_handleFinalize`
      // (post-roll.mjs:582-584).
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

      // Finalize → processInvocationPerformed applies burdenAmount (still
      // the full `burden: 2` because hasRelic=false — the sacramental bonus
      // is orthogonal to burden selection at invocation-casting.mjs:39)
      // and flips `performed: true` (invocation-casting.mjs:234-237).
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
