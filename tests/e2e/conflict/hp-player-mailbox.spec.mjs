import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §18 Conflict: HP & KO — player-side HP change routes through the
 * `flags.tb2e.pendingConflictHP` mailbox; GM hook applies to combatant
 * actor and clears the flag (TEST_PLAN L501, CLAUDE.md §Mailbox Pattern).
 *
 * Rules under test (CLAUDE.md §Mailbox Pattern):
 *   - Foundry restricts document updates to owners. A non-GM player
 *     editing conflict HP on their own combatant, or a party captain
 *     editing another player's HP, cannot `actor.update()` directly.
 *     Instead they write `flags.tb2e.pendingConflictHP = { newValue,
 *     [targetActorId] }` onto their OWN actor. The GM's `updateActor`
 *     hook (tb2e.mjs L193-204) observes the write, resolves
 *     `targetActor` (defaults to the writing actor; overridden by
 *     `targetActorId` for the captain-editing-another-player path —
 *     tb2e.mjs L196), clamps `newValue` to `[0, targetActor.system.
 *     conflict.hp.max]` (L198-199), writes
 *     `system.conflict.hp.value = newVal` on the target (L200), then
 *     `unsetFlag("tb2e", "pendingConflictHP")` on the WRITING actor
 *     (L201 — chained off the target update's .then()).
 *
 * Implementation map:
 *   - GM hook dispatcher + processor (inline): tb2e.mjs L193-204.
 *     Guards on `!game.user.isGM` at L186 (shared with the other
 *     mailbox-drain legs in the same handler). Payload shape:
 *       flags.tb2e.pendingConflictHP = {
 *         newValue: number,         // new hp.value (clamped [0, max])
 *         targetActorId?: string    // optional — defaults to the
 *                                   // writing actor itself
 *       }
 *   - HP field declaration: module/data/actor/character.mjs L161-169.
 *     `system.conflict.hp = { value: int ≥ 0, max: int ≥ 0 }`. Both
 *     initial to 0 — the test seeds `max = 4` so `newValue` 1/2/3
 *     don't get clamped to 0.
 *   - Only known non-mailbox HP write-paths (for context): initial
 *     `distributeDisposition` (combat.mjs L231), manual GM roster
 *     input (conflict-panel.mjs L351), and the `rewardFresh` clear
 *     (combat.mjs L952-953). None are under test here — this spec
 *     exclusively exercises the mailbox edge.
 *
 * E2E harness constraint (shared with versus/finalize-via-mailbox.spec.mjs
 * L56-79 and grind/apply-condition-mailbox.spec.mjs L46-56):
 *   - All Playwright sessions authenticate as GM (tests/e2e/test.mjs
 *     L14-20 via auth.setup.mjs). There is no connected player browser
 *     to drive the non-GM write branch through the UI.
 *   - Approach (matches both prior mailbox specs): simulate the player-
 *     side write via `page.evaluate` calling `actor.update({ "flags.tb2e.
 *     pendingConflictHP": {...} })`. The in-browser GM-side `updateActor`
 *     hook fires synchronously on the same client, so polling observes
 *     the effect with sub-second latency. This exercises the exact
 *     contract under test — the write, hook dispatch, target update,
 *     and flag-clear — without requiring a second connected client.
 *
 * Synthetic token note (CLAUDE.md §Unlinked Actors):
 *   - The mailbox hook operates on the world `Actor` (via
 *     `game.actors.get(pendingHP.targetActorId)` or the `actor` arg to
 *     the updateActor hook, L196). It writes through `actor.update()`,
 *     which for linked character combatants propagates to
 *     `combatant.actor.system.conflict.hp.value`. This spec uses linked
 *     characters (not unlinked monster tokens) — the parity-with-
 *     synthetic-tokens edge is TEST_PLAN L505's scope. We still read
 *     HP via `combatant.actor` per the CLAUDE.md uniformity rule.
 *
 * Scope (narrow per briefing):
 *   - Two assertion shapes are exercised:
 *       (1) Self-write: actor writes `pendingConflictHP` on itself with
 *           only `newValue`; hook applies to same actor, clears flag.
 *       (2) targetActorId route: actor A writes the mailbox on itself
 *           with `{ newValue, targetActorId: actorB.id }`; hook applies
 *           to actor B, clears flag on actor A. This is the party-
 *           captain-editing-another-player's-HP path explicitly
 *           commented at tb2e.mjs L195.
 *   - Out of scope (owned by other checkboxes):
 *       - Auto-apply damage from resolve pipeline — TEST_PLAN L500
 *         (hp-damage-reduces.spec.mjs, fixmed).
 *       - KO-at-zero transition — TEST_PLAN L502.
 *       - Swap / help / synthetic parity — TEST_PLAN L503-L505.
 */

async function createConflictReadyCharacter(page, { name, tag, maxHP, startHP }) {
  return page.evaluate(
    async ({ n, t, m, s }) => {
      const actor = await Actor.implementation.create({
        name: n,
        type: 'character',
        flags: { tb2e: { e2eTag: t } },
        system: {
          abilities: {
            health: { rating: 3, pass: 0, fail: 0 },
            will:   { rating: 3, pass: 0, fail: 0 },
            nature: { rating: 3, max: 3, pass: 0, fail: 0 }
          },
          conflict: { hp: { value: s, max: m } }
        }
      });
      return actor.id;
    },
    { n: name, t: tag, m: maxHP, s: startHP }
  );
}

async function cleanupTaggedActors(page, tag) {
  await page.evaluate(async (t) => {
    const ids = game.actors
      .filter((a) => a.getFlag?.('tb2e', 'e2eTag') === t)
      .map((a) => a.id);
    if ( ids.length ) await Actor.implementation.deleteDocuments(ids);
  }, tag);
}

test.describe('§18 Conflict: HP & KO — player-side pendingConflictHP mailbox', () => {
  test('self-write: mailbox { newValue } on own actor → GM hook applies + clears (tb2e.mjs L193-204)', async ({ page }, testInfo) => {
    const tag = `e2e-hp-mb-self-${testInfo.parallelIndex}-${Date.now()}`;
    const name = `E2E HP Mailbox Self ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // The mailbox-drain leg guards on isGM at tb2e.mjs L186 — this
    // harness IS the GM, so the hook fires on setFlag in the same
    // client.
    expect(await page.evaluate(() => game.user.isGM)).toBe(true);

    try {
      // Seed hp = { value: 4, max: 4 }. Max must be non-zero or the
      // hook's clamp at tb2e.mjs L198-199 would pin newValue to 0 for
      // any request and we couldn't tell a successful write from a
      // silent clamp-to-max=0.
      const actorId = await createConflictReadyCharacter(page, {
        name, tag, maxHP: 4, startHP: 4
      });
      expect(actorId).toBeTruthy();

      // Baseline: HP is 4 (what we seeded) and no mailbox flag set.
      const baseline = await page.evaluate((id) => {
        const a = game.actors.get(id);
        return {
          hp: a?.system.conflict?.hp?.value ?? null,
          max: a?.system.conflict?.hp?.max ?? null,
          mailbox: a?.getFlag('tb2e', 'pendingConflictHP') ?? null
        };
      }, actorId);
      expect(baseline).toEqual({ hp: 4, max: 4, mailbox: null });

      // Simulate the player-side write: `actor.update({"flags.tb2e.
      // pendingConflictHP": { newValue: 2 } })`. Matches the shape the
      // GM hook observes in `changes.flags.tb2e.pendingConflictHP` at
      // tb2e.mjs L193 — the `changes` diff must contain the key for
      // the hook to fire, which `update()` satisfies (setFlag would
      // also work; we use update() because it's the canonical player-
      // side pattern per grind/apply-condition-mailbox.spec.mjs
      // L179-185 — a single update() bundle is what non-GM code paths
      // actually emit).
      await page.evaluate(async (id) => {
        const actor = game.actors.get(id);
        await actor.update({ 'flags.tb2e.pendingConflictHP': { newValue: 2 } });
      }, actorId);

      // 1. HP applied on the target (self) at 2 (= newValue, within
      //    clamp [0, max=4]). Processor chain: setFlag/update() →
      //    updateActor hook tb2e.mjs L193 → targetActor.update(L200).
      //    The target update is async relative to the write, so poll.
      await expect
        .poll(
          () => page.evaluate(
            (id) => game.actors.get(id)?.system.conflict?.hp?.value ?? null,
            actorId
          ),
          { timeout: 10_000, message: 'pendingConflictHP newValue should be applied to hp.value' }
        )
        .toBe(2);

      // 2. Mailbox cleared — this is the cardinal mailbox contract.
      //    Chained off the target update's .then() at tb2e.mjs L201
      //    (`actor.unsetFlag("tb2e", "pendingConflictHP")`).
      await expect
        .poll(
          () => page.evaluate(
            (id) => game.actors.get(id)?.getFlag('tb2e', 'pendingConflictHP') ?? null,
            actorId
          ),
          { timeout: 10_000, message: 'pendingConflictHP should be cleared by GM hook' }
        )
        .toBeNull();
    } finally {
      await cleanupTaggedActors(page, tag);
    }
  });

  test('targetActorId route: captain writes { newValue, targetActorId } → GM hook applies to target, clears flag on writer (tb2e.mjs L195-202)', async ({ page }, testInfo) => {
    const tag = `e2e-hp-mb-tgt-${testInfo.parallelIndex}-${Date.now()}`;
    const stamp = Date.now();
    const captainName = `E2E HP Mailbox Captain ${stamp}`;
    const allyName = `E2E HP Mailbox Ally ${stamp}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    expect(await page.evaluate(() => game.user.isGM)).toBe(true);

    try {
      const captainId = await createConflictReadyCharacter(page, {
        name: captainName, tag, maxHP: 4, startHP: 4
      });
      const allyId = await createConflictReadyCharacter(page, {
        name: allyName, tag, maxHP: 3, startHP: 3
      });
      expect(captainId).toBeTruthy();
      expect(allyId).toBeTruthy();

      // Baseline: ally at 3/3, captain at 4/4, neither carries a flag.
      const baseline = await page.evaluate(({ cId, aId }) => {
        const c = game.actors.get(cId);
        const a = game.actors.get(aId);
        return {
          captainHp: c?.system.conflict?.hp?.value ?? null,
          captainMailbox: c?.getFlag('tb2e', 'pendingConflictHP') ?? null,
          allyHp: a?.system.conflict?.hp?.value ?? null,
          allyMailbox: a?.getFlag('tb2e', 'pendingConflictHP') ?? null
        };
      }, { cId: captainId, aId: allyId });
      expect(baseline).toEqual({
        captainHp: 4, captainMailbox: null,
        allyHp: 3, allyMailbox: null
      });

      // Captain writes the mailbox on herself with a targetActorId
      // pointing at the ally — the path tb2e.mjs L195-196 documents as
      // "captain editing another player's HP". newValue=1 is within
      // ally's max=3, so no clamp.
      await page.evaluate(async ({ cId, aId }) => {
        const captain = game.actors.get(cId);
        await captain.update({
          'flags.tb2e.pendingConflictHP': { newValue: 1, targetActorId: aId }
        });
      }, { cId: captainId, aId: allyId });

      // 1. Ally HP applied to 1 (target resolved via targetActorId).
      await expect
        .poll(
          () => page.evaluate(
            (id) => game.actors.get(id)?.system.conflict?.hp?.value ?? null,
            allyId
          ),
          { timeout: 10_000, message: "target actor's hp.value should be set to newValue" }
        )
        .toBe(1);

      // 2. Flag cleared on the WRITER (captain), not on the target —
      //    tb2e.mjs L201 unsets on `actor` (the hook's first arg, i.e.
      //    the writer), never on `targetActor`.
      await expect
        .poll(
          () => page.evaluate(
            (id) => game.actors.get(id)?.getFlag('tb2e', 'pendingConflictHP') ?? null,
            captainId
          ),
          { timeout: 10_000, message: 'pendingConflictHP should be cleared on the writing actor' }
        )
        .toBeNull();

      // 3. Captain HP untouched — mailbox only writes to `targetActor`
      //    (tb2e.mjs L200); captain is the writer, not the target.
      const captainHpAfter = await page.evaluate(
        (id) => game.actors.get(id)?.system.conflict?.hp?.value ?? null,
        captainId
      );
      expect(captainHpAfter).toBe(4);
    } finally {
      await cleanupTaggedActors(page, tag);
    }
  });
});
