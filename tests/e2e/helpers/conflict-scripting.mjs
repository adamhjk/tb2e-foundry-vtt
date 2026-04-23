import { expect } from '../test.mjs';

/**
 * Script both teams' actions, lock them, and (optionally) begin resolve.
 * Encapsulates the three-step conflict-scripting dance along with the
 * expect.poll gates that absorb async document-update propagation.
 *
 * Why the polls are load-bearing:
 *   - combat.mjs `#applyLockActions` (L525-L540) silently bails when any
 *     of the 3 action slots is missing `{action, combatantId}`.
 *   - combat.mjs `beginResolve` (L357-L373) silently bails when any
 *     team's `round.locked` is falsy — it only emits a
 *     `ui.notifications.warn`.
 *   - Under parallel / contested runs the awaited `setActions` /
 *     `lockActions` Combat.update calls return before the world-scoped
 *     document state a subsequent read observes has fully settled —
 *     chaining the three steps in back-to-back `page.evaluate` blocks
 *     can race, with the symptom being `activeTabId` stuck on `"script"`
 *     past the resolve transition.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} opts
 * @param {string} opts.combatId
 * @param {string} opts.partyGroupId
 * @param {string} opts.gmGroupId
 * @param {Array<{action: string, combatantId: string}>} opts.partyActions
 * @param {Array<{action: string, combatantId: string}>} opts.gmActions
 * @param {boolean} [opts.beginResolve=true]
 *   Whether to invoke `combat.beginResolve()` after both sides lock.
 *   Set false for script-phase-only specs (peek, change-before-lock, etc.).
 * @param {number} [opts.timeout=10_000]
 *   Per-poll timeout. Keep generous — under 8-worker parallel load the
 *   Combat.update chain can take several seconds to propagate.
 */
export async function scriptAndLockActions(page, {
  combatId,
  partyGroupId,
  gmGroupId,
  partyActions,
  gmActions,
  beginResolve = true,
  timeout = 10_000
}) {
  // 1. setActions for both sides.
  await page.evaluate(async ({ cId, pId, gId, pa, ga }) => {
    const c = game.combats.get(cId);
    await c.setActions(pId, pa);
    await c.setActions(gId, ga);
  }, {
    cId: combatId, pId: partyGroupId, gId: gmGroupId,
    pa: partyActions, ga: gmActions
  });

  // 2. Poll for both sides' round.actions to land with all 3 slots populated.
  await expect
    .poll(() => page.evaluate(({ cId, pId, gId }) => {
      const c = game.combats.get(cId);
      const round = c?.system.rounds?.[c.system.currentRound];
      const pSlots = (round?.actions?.[pId] || []).filter(a => a?.action && a?.combatantId).length;
      const gSlots = (round?.actions?.[gId] || []).filter(a => a?.action && a?.combatantId).length;
      return { pSlots, gSlots };
    }, { cId: combatId, pId: partyGroupId, gId: gmGroupId }), { timeout })
    .toEqual({ pSlots: 3, gSlots: 3 });

  // 3. lockActions for both sides.
  await page.evaluate(async ({ cId, pId, gId }) => {
    const c = game.combats.get(cId);
    await c.lockActions(pId);
    await c.lockActions(gId);
  }, { cId: combatId, pId: partyGroupId, gId: gmGroupId });

  // 4. Poll for both sides' round.locked flags to flip true.
  await expect
    .poll(() => page.evaluate(({ cId, pId, gId }) => {
      const c = game.combats.get(cId);
      const round = c?.system.rounds?.[c.system.currentRound];
      return {
        p: round?.locked?.[pId] ?? false,
        g: round?.locked?.[gId] ?? false
      };
    }, { cId: combatId, pId: partyGroupId, gId: gmGroupId }), { timeout })
    .toEqual({ p: true, g: true });

  // 5. beginResolve (optional — default true).
  if ( beginResolve ) {
    await page.evaluate(async ({ cId }) => {
      const c = game.combats.get(cId);
      await c.beginResolve();
    }, { cId: combatId });
  }
}
