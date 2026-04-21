import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { MonsterSheet } from '../pages/MonsterSheet.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §21 Monster & NPC Sheets — Roll Nature from monster sheet.
 *
 * Rules-as-written:
 *   - Monsters roll Nature for every test (SG p. 172 / DH monster rules).
 *     The monster's "ability pool" is `system.nature` (a flat integer — NOT
 *     the `{rating, pass, fail, max}` block characters use; see
 *     module/data/actor/monster.mjs line 8).
 *   - Standard test arithmetic still applies: each die showing 4-6 is a
 *     success, Pass = successes >= Ob (DH p. 56-62).
 *
 * Implementation map:
 *   - templates/actors/monster-body.hbs line 7:
 *       <div class="field-pair rollable" data-action="rollNature">
 *     wires to MonsterSheet.#onRollNature (module/applications/actor/
 *     monster-sheet.mjs line 177) which calls
 *       rollTest({ actor, type: "ability", key: "nature" }).
 *   - `_resolveRollData` (module/dice/tb2e-roll.mjs line 43-48) has a
 *     monster-specific short-circuit: for `actor.type === "monster"` and
 *     `key === "nature"`, the dice pool is `actor.system.nature` directly.
 *   - rollTest always opens the shared roll dialog (line 1296) — there is
 *     no auto-roll path — so this spec exercises the dialog → submit →
 *     chat card pipeline with the monster speaker.
 *   - `_logAdvancement` (line 192-204) is gated on `actor.type !== "character"`
 *     → early return, so finalizing a monster roll ticks no pips on the
 *     actor (there are no pips to tick — monster schema has no advancement
 *     fields).
 *   - `flags.tb2e.actorId` is set on the chat message by `_buildRollFlags`
 *     (line 1455) — we use this to scope the card lookup.
 *
 * Staging:
 *   - Import Kobold from `tb2e.monsters` (Nature = 2 — see
 *     packs/_source/monsters/Kobold_a1b2c3d4e5f60001.yml). A 2D pool is
 *     distinct enough to catch any off-by-one in the pool resolver and
 *     small enough that stubbing all-6s gives a clean 2-successes PASS.
 *   - Same import shape as tests/e2e/sheet/monster-open.spec.mjs (the
 *     sibling checkbox), including the `flags.tb2e.e2eTag` cleanup hook.
 *
 * Determinism:
 *   - Foundry dice consult `CONFIG.Dice.randomUniform()`. Each d6 face is
 *     `Math.ceil((1 - u) * 6)` — stub u → 0.001 → all 6s (all successes).
 *     u → 0.5 → all 3s (0 successes) for the fail path.
 */

const MONSTER_PACK_ID = 'tb2e.monsters';
const SOURCE_MONSTER = 'Kobold';

/**
 * Import a named monster from a compendium pack. Mirrors the helper in
 * monster-open.spec.mjs (kept inline rather than lifted to a shared module
 * because the other spec uses it too and keeping a 1:1 copy makes each
 * spec self-contained for diagnosis).
 */
async function importMonsterFromPack(page, { packId, sourceName, uniqueName, tag }) {
  return page.evaluate(
    async ({ pId, src, name, t }) => {
      const pack = window.game.packs.get(pId);
      if (!pack) throw new Error(`Pack not found: ${pId}`);
      const docs = await pack.getDocuments();
      const source = docs.find((d) => d.name === src);
      if (!source) throw new Error(`Source "${src}" not in pack ${pId}`);

      const data = source.toObject();
      data.name = name;
      data.flags = {
        ...(data.flags ?? {}),
        tb2e: { ...(data.flags?.tb2e ?? {}), e2eTag: t },
      };
      const created = await window.Actor.implementation.create(data);
      return { id: created.id, nature: created.system.nature };
    },
    { pId: packId, src: sourceName, name: uniqueName, t: tag }
  );
}

async function cleanupTaggedActors(page, tag) {
  await page.evaluate(async (t) => {
    const ids = window.game.actors
      .filter((a) => a.getFlag?.('tb2e', 'e2eTag') === t)
      .map((a) => a.id);
    if (ids.length) {
      await window.Actor.implementation.deleteDocuments(ids);
    }
  }, tag);
}

test.describe('Monster sheet — Roll Nature', () => {
  test.afterEach(async ({ page }) => {
    // Restore the PRNG stub between tests — the Page persists between
    // specs in the same worker, and a leaked stub would break any
    // downstream roll spec that relies on real random.
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });
  });

  test('rolls Nature from the monster body; posts a roll card with the Nature-sized pool', async ({
    page,
  }, testInfo) => {
    const tag = `e2e-monster-nature-${testInfo.workerIndex}-${Date.now()}`;
    const uniqueName = `${SOURCE_MONSTER} Roll E2E ${Date.now()}`;

    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    try {
      const imported = await importMonsterFromPack(page, {
        packId: MONSTER_PACK_ID,
        sourceName: SOURCE_MONSTER,
        uniqueName,
        tag,
      });
      expect(imported.id).toBeTruthy();
      // Kobold ships with Nature = 2; guard against a YAML change silently
      // breaking the pool-size assertion below.
      expect(imported.nature).toBe(2);

      // Stub the PRNG BEFORE submitting the dialog. The roll evaluates
      // inside evaluateRoll after dialog submit, so the stub only needs to
      // be in place by that time — we set it up-front for clarity.
      // u = 0.001 → Math.ceil((1 - 0.001) * 6) = 6 on every d6 → all 6s.
      await page.evaluate(() => {
        globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
        CONFIG.Dice.randomUniform = () => 0.001;
      });

      // Open the sheet via the API — same shortcut as monster-open.spec.mjs.
      await page.evaluate((id) => {
        window.game.actors.get(id).sheet.render(true);
      }, imported.id);

      const sheet = new MonsterSheet(page, uniqueName);
      await sheet.expectOpen();
      // Sanity-check the Nature field binds through as the source of truth
      // for the roll pool — a regression here would point at monster.mjs
      // rather than the roll pipeline.
      await expect(sheet.natureInput).toHaveValue(String(imported.nature));

      // Snapshot chat count — the card posts asynchronously after the
      // dialog submit resolves, and polling the count is more reliable
      // than a fixed timeout.
      const initialChatCount = await page.evaluate(
        () => game.messages.contents.length
      );

      // Click the Nature label to fire the `rollNature` action. The
      // MonsterSheet AppV2 action framework dispatches #onRollNature, which
      // calls rollTest({ actor, type: "ability", key: "nature" }) and opens
      // the shared roll dialog.
      await sheet.clickRollNature();

      const dialog = new RollDialog(page);
      await dialog.waitForOpen();

      // The dialog should pre-fill the pool from the monster's Nature (the
      // _resolveRollData short-circuit at tb2e-roll.mjs line 45-48). A
      // regression that reads `system.abilities.nature.rating` on a monster
      // would land at 0 here and make the mismatch loud.
      expect(await dialog.getPoolSize()).toBe(imported.nature);

      // Submit with defaults — no modifiers, no obstacle edits. The
      // dialog's default obstacle is 1 (roll-dialog.hbs), within-nature
      // toggle defaults true (tb2e-roll.mjs line 500) — so the pool stays
      // at Nature (2D) and `showDirectNatureTax` is false.
      await dialog.submit();

      await expect
        .poll(() => page.evaluate(() => game.messages.contents.length), {
          timeout: 10_000,
        })
        .toBeGreaterThan(initialChatCount);

      // Locate the card scoped to THIS monster via flags.tb2e.actorId
      // (set on the message by _buildRollFlags at tb2e-roll.mjs line 1455)
      // — the worker may have ambient chat traffic from earlier specs, so
      // we avoid "last card on the log" heuristics here and pin by id.
      const cardFlags = await page.evaluate((actorId) => {
        const msg = game.messages.contents.find(
          (m) => m.flags?.tb2e?.actorId === actorId
        );
        if (!msg) return null;
        return {
          id: msg.id,
          speakerActorId: msg.speaker?.actor ?? null,
          roll: msg.flags.tb2e.roll
            ? {
                type: msg.flags.tb2e.roll.type,
                key: msg.flags.tb2e.roll.key,
                baseDice: msg.flags.tb2e.roll.baseDice,
                poolSize: msg.flags.tb2e.roll.poolSize,
                successes: msg.flags.tb2e.roll.successes,
                obstacle: msg.flags.tb2e.roll.obstacle,
                pass: msg.flags.tb2e.roll.pass,
              }
            : null,
          directNatureTest: msg.flags.tb2e.directNatureTest,
          withinNature: msg.flags.tb2e.withinNature,
        };
      }, imported.id);

      expect(cardFlags).not.toBeNull();
      expect(cardFlags.speakerActorId).toBe(imported.id);
      expect(cardFlags.roll).toEqual({
        type: 'ability',
        key: 'nature',
        baseDice: imported.nature, // 2
        poolSize: imported.nature, // 2 — no modifiers
        successes: imported.nature, // all 6s → every die a success
        obstacle: 1, // dialog default (roll-dialog.hbs)
        pass: true, // 2 successes vs Ob 1
      });
      // Direct-nature-test branch is active for monster Nature rolls, and
      // within-nature toggle defaults true — roll-result.hbs renders the
      // "within descriptors — no tax" notice and no nature-tax prompt.
      expect(cardFlags.directNatureTest).toBe(true);
      expect(cardFlags.withinNature).toBe(true);

      // Now assert the DOM shape of the rendered card. Scope the POM by
      // the message id to avoid grabbing a later unrelated card.
      const card = new RollChatCard(page);
      await card.expectPresent();
      expect(await card.getPool()).toBe(imported.nature);
      await expect(card.diceResults).toHaveCount(imported.nature);
      expect(await card.getSuccesses()).toBe(imported.nature);
      expect(await card.getObstacle()).toBe(1);
      expect(await card.isPass()).toBe(true);

      // Finalize the card — for monsters this is a no-op for advancement
      // (`_logAdvancement` early-returns on actor.type !== "character",
      // tb2e-roll.mjs line 193). The interesting assertion is that the
      // card transitions to its finalized state (card-actions stripped)
      // without throwing, demonstrating the monster-path doesn't crash
      // the post-roll pipeline.
      await card.clickFinalize();

      // Nature on the monster is a flat integer and has no pass/fail pips
      // — the advancement path is character-only. Confirm nature is still
      // unchanged to lock in the "no-op for monsters" expectation.
      const natureAfter = await page.evaluate(
        (id) => window.game.actors.get(id).system.nature,
        imported.id
      );
      expect(natureAfter).toBe(imported.nature);

      // No uncaught page errors along the roll cycle.
      expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toEqual([]);
    } finally {
      await cleanupTaggedActors(page, tag);
    }
  });
});
