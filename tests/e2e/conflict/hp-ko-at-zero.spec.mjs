import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §18 Conflict: HP & KO — HP hitting 0 marks combatant `knockedOut`
 * (TEST_PLAN L502).
 *
 * Rules under test (as described by the TEST_PLAN line):
 *   - When a combatant's conflict disposition pool (`combatant.actor.
 *     system.conflict.hp.value`, per CLAUDE.md §Unlinked Actors — always
 *     read via `combatant.actor`) reaches 0, the combatant's
 *     `system.knockedOut` flag should be set to `true`. Ideally the
 *     reverse transition (HP restored above 0 — e.g. via a defend MoS
 *     restore per SG p.69, or a direct GM roster edit) should clear
 *     the flag.
 *
 * -------------------------------------------------------------------
 * Production gap — why this spec is `test.fixme`
 * -------------------------------------------------------------------
 * The `knockedOut` field exists as a `BooleanField({ initial: false })`
 * in the combatant data model (module/data/combat/combatant.mjs L7),
 * and is READ widely throughout the codebase:
 *
 *   - module/applications/conflict/conflict-panel.mjs L426, L915,
 *     L978, L1032, L1099, L1214, L1219, L1423, L1449, L1741 — gates
 *     scripting, arming, swap-detection, captain-reassignment,
 *     roster display, etc.
 *   - module/applications/conflict/conflict-tracker.mjs L149 — tracker
 *     body rendering.
 *   - tb2e.mjs L211 — `pendingCaptainReassign` refuses to promote a
 *     KO'd combatant.
 *   - templates/conflict/panel-roster.hbs L4, panel-weapons.hbs L9/L13,
 *     panel-script.hbs L47-48, tracker-body.hbs L25 — visual disabled
 *     states.
 *
 * BUT: nowhere in the codebase is `system.knockedOut` ever set to
 * `true`. Searched via grep for any writer:
 *   - `knockedOut\s*=` / `knockedOut:\s*true` / `"system\.knockedOut"`:
 *     ALL return zero matches against the `module/` tree as of this
 *     writing pass.
 *   - The `pendingConflictHP` mailbox (tb2e.mjs L193-204) — the only
 *     auto-wired HP writer today — writes `system.conflict.hp.value`
 *     and calls `actor.update()`. It does NOT touch the combatant's
 *     `knockedOut` field, nor does any `updateActor`/`updateCombatant`
 *     hook observe the HP→0 transition and flip it.
 *   - The one place that couples HP<=0 and knockedOut is the DISPLAY
 *     derivation at conflict-panel.mjs L1099:
 *       `knockedOut: c.system.knockedOut || (hp.max > 0 && hp.value <= 0)`
 *     — it OR's the persistent flag with a derived predicate for
 *     the script-phase combatant dropdown. This tells us the product
 *     model is that `system.knockedOut` is a PERSISTENT flag that is
 *     SUPPOSED to flip on HP→0, but the auto-flip is not implemented.
 *     Consumers paper over it for their own local views.
 *   - The same HP<=0 predicate — with no `system.knockedOut` coupling
 *     — is the sole gate for help-blocking at module/dice/help.mjs L57
 *     (`conflictHP?.max > 0 && conflictHP.value <= 0 → blocked`). That
 *     spec (tests/e2e/roll/help-blocked-when-ko.spec.mjs, TEST_PLAN
 *     §3) directly sets `hp = { max, value: 0 }` and NEVER touches
 *     `system.knockedOut` — further evidence the field is read-only
 *     dead weight today.
 *
 * Therefore the TEST_PLAN L502 checkbox is asserting a behaviour that
 * is not yet wired. `test.fixme` is the correct guardrail per CLAUDE.md
 * "Feature absent/divergent → test.fixme() + - [ ] ~~skipped~~".
 *
 * -------------------------------------------------------------------
 * Related fixmes / cross-refs
 * -------------------------------------------------------------------
 *   - TEST_PLAN L500 (hp-damage-reduces.spec.mjs) — the upstream
 *     auto-damage gap. When resolve-pipeline auto-damage lands, HP
 *     will drop to 0 on its own; the KO auto-flip at L502 is the
 *     natural follow-on. BOTH gaps must close for a combatant to be
 *     KO'd by normal play without GM intervention.
 *   - TEST_PLAN L501 (hp-player-mailbox.spec.mjs, GREEN) — the
 *     mailbox path this spec uses to drive HP to 0. The mailbox
 *     already clamps to `[0, max]` (tb2e.mjs L198-199), so writing
 *     `newValue: 0` lands `hp.value = 0` regardless of `max`. What
 *     this spec asserts is the MISSING side effect: that the same
 *     write also flips `knockedOut`.
 *
 * -------------------------------------------------------------------
 * Fix shape (suggested)
 * -------------------------------------------------------------------
 * Natural location: inside the GM hook at tb2e.mjs L193-204, after
 * the `targetActor.update({ "system.conflict.hp.value": newVal })`
 * resolves. Find the combatant(s) whose `actorId === targetActor.id`
 * in any active `isConflict` combat, and if `newVal === 0` (and
 * `max > 0`, matching the help.mjs L57 predicate) set
 * `system.knockedOut = true`; if `newVal > 0` clear it. GM-owned
 * combatant update, so the straightforward `combatant.update(...)`
 * is fine (no mailbox needed on this leg).
 *
 * An additional write-path to wire: the resolve-auto-damage fix at
 * TEST_PLAN L500, whose natural call path also lands in the same
 * mailbox, so fixing L500 via the mailbox automatically gets this
 * for free.
 *
 * When both land:
 *   - Drop `test.fixme()` here.
 *   - Flip TEST_PLAN L502 to `- [x]` with citations to the writer
 *     (tb2e.mjs line numbers) and the reverse-transition behaviour
 *     (clear on HP>0).
 *
 * -------------------------------------------------------------------
 * What this spec verifies (when un-fixmed)
 * -------------------------------------------------------------------
 * NARROW scope — ONLY the HP-to-KO-flip assertion. Out of scope:
 *   - Swap when KO'd mid-volley (L503).
 *   - Help blocked when KO'd (L504 — duplicate of §3).
 *   - Synthetic-token parity (L505).
 *   - Auto-apply damage from resolve (L500 — upstream).
 *
 * Fixture (minimal — uses the L501 mailbox idiom, not the full
 * conflict resolve pipeline; the pipeline is L500's fixme):
 *   1. GM-session Playwright (tests/e2e/test.mjs L14-20 via
 *      auth.setup.mjs) — all drivers are GM.
 *   2. Seed a character actor with `conflict.hp = { value: 1, max: 1 }`.
 *      max > 0 is required so the help.mjs L57 / conflict-panel.mjs
 *      L1099 predicate semantics are well-defined (max > 0 AND
 *      value <= 0 is the intended KO condition).
 *   3. Create a conflict Combat containing that actor as a combatant.
 *      Combatant starts with `system.knockedOut === false` (schema
 *      default at combatant.mjs L7).
 *   4. Drive HP → 0 via the mailbox: write
 *      `flags.tb2e.pendingConflictHP = { newValue: 0 }` on the actor.
 *      The GM hook at tb2e.mjs L193-204 processes it synchronously
 *      on this same client (we ARE the GM), writes
 *      `system.conflict.hp.value = 0`, and clears the flag.
 *   5. Assert: `combatant.system.knockedOut === true`. **This is the
 *      fixmed assertion.**
 *   6. Reverse path: write `{ newValue: 1 }`; assert flag clears.
 *      Also fixmed (depends on the same un-wired code path).
 *
 * Cleanup deletes the combat and the tagged actor.
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

async function createConflictWithCombatant(page, actorId) {
  return page.evaluate(async (aId) => {
    const combat = await Combat.implementation.create({
      type: 'conflict',
      active: true
    });
    const combatantData = {
      actorId: aId,
      combatId: combat.id
    };
    const [combatant] = await combat.createEmbeddedDocuments('Combatant', [combatantData]);
    return { combatId: combat.id, combatantId: combatant.id };
  }, actorId);
}

async function cleanupTaggedActorsAndCombats(page, tag, combatId) {
  await page.evaluate(async ({ t, cId }) => {
    if ( cId ) {
      const combat = game.combats?.get(cId);
      if ( combat ) { try { await combat.delete(); } catch {} }
    }
    const ids = game.actors
      .filter((a) => a.getFlag?.('tb2e', 'e2eTag') === t)
      .map((a) => a.id);
    if ( ids.length ) await Actor.implementation.deleteDocuments(ids);
  }, { t: tag, cId: combatId });
}

test.describe('§18 Conflict: HP & KO — HP→0 flips combatant.knockedOut', () => {
  test('HP hitting 0 marks combatant knockedOut; restoring HP clears it (tb2e.mjs L193-204, combatant.mjs L7)',
  async ({ page }, testInfo) => {
    const tag = `e2e-hp-ko-${testInfo.parallelIndex}-${Date.now()}`;
    const name = `E2E HP-KO Actor ${Date.now()}`;
    let combatId = null;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    expect(await page.evaluate(() => game.user.isGM)).toBe(true);

    try {
      // Seed hp = { value: 1, max: 1 }. max > 0 is mandatory so the
      // HP<=0 predicate (help.mjs L57, conflict-panel.mjs L1099) is
      // well-formed — max === 0 is the "not in conflict yet" sentinel
      // used e.g. at conflict-panel.mjs L428/L1034/L1743, which is
      // NOT the KO condition we're asserting.
      const actorId = await createConflictReadyCharacter(page, {
        name, tag, maxHP: 1, startHP: 1
      });
      expect(actorId).toBeTruthy();

      const made = await createConflictWithCombatant(page, actorId);
      combatId = made.combatId;
      expect(made.combatantId).toBeTruthy();

      // Baseline: knockedOut is false (schema default at combatant.mjs L7).
      const baseline = await page.evaluate(({ cId, cbId }) => {
        const c = game.combats.get(cId)?.combatants.get(cbId);
        return {
          hp: c?.actor?.system.conflict?.hp?.value ?? null,
          max: c?.actor?.system.conflict?.hp?.max ?? null,
          ko: c?.system.knockedOut ?? null
        };
      }, { cId: combatId, cbId: made.combatantId });
      expect(baseline).toEqual({ hp: 1, max: 1, ko: false });

      // Drive HP → 0 via the mailbox (TEST_PLAN L501 idiom). The GM
      // hook at tb2e.mjs L193-204 applies synchronously (we are the
      // GM); clamp semantics at L198-199 land `newValue: 0` at 0
      // regardless of max.
      await page.evaluate(async (id) => {
        const actor = game.actors.get(id);
        await actor.update({ 'flags.tb2e.pendingConflictHP': { newValue: 0 } });
      }, actorId);

      // HP itself drops to 0 — this part is ALREADY wired and GREEN
      // at TEST_PLAN L501. We poll it as a pre-condition.
      await expect
        .poll(
          () => page.evaluate(
            ({ cId, cbId }) => game.combats.get(cId)?.combatants.get(cbId)?.actor?.system.conflict?.hp?.value ?? null,
            { cId: combatId, cbId: made.combatantId }
          ),
          { timeout: 10_000, message: 'hp.value should land at 0 via mailbox' }
        )
        .toBe(0);

      // THE fixmed assertion: knockedOut flips to true when HP→0.
      // Read via `combatant.actor` path (CLAUDE.md §Unlinked Actors
      // uniformity rule); the combatant document itself is the
      // holder of `system.knockedOut` (combatant.mjs L7), so we
      // read it off the combatant directly.
      await expect
        .poll(
          () => page.evaluate(
            ({ cId, cbId }) => game.combats.get(cId)?.combatants.get(cbId)?.system.knockedOut ?? null,
            { cId: combatId, cbId: made.combatantId }
          ),
          { timeout: 10_000, message: 'combatant.system.knockedOut should flip true when hp.value hits 0' }
        )
        .toBe(true);

      // Reverse transition: HP restored → knockedOut clears. Also
      // part of the missing auto-flip wiring. Writing newValue=1 via
      // the mailbox passes the [0, max=1] clamp and lands at 1.
      await page.evaluate(async (id) => {
        const actor = game.actors.get(id);
        await actor.update({ 'flags.tb2e.pendingConflictHP': { newValue: 1 } });
      }, actorId);

      await expect
        .poll(
          () => page.evaluate(
            ({ cId, cbId }) => game.combats.get(cId)?.combatants.get(cbId)?.actor?.system.conflict?.hp?.value ?? null,
            { cId: combatId, cbId: made.combatantId }
          ),
          { timeout: 10_000, message: 'hp.value should restore to 1 via mailbox' }
        )
        .toBe(1);

      await expect
        .poll(
          () => page.evaluate(
            ({ cId, cbId }) => game.combats.get(cId)?.combatants.get(cbId)?.system.knockedOut ?? null,
            { cId: combatId, cbId: made.combatantId }
          ),
          { timeout: 10_000, message: 'combatant.system.knockedOut should clear when hp.value > 0' }
        )
        .toBe(false);
    } finally {
      await cleanupTaggedActorsAndCombats(page, tag, combatId);
    }
  });
});
