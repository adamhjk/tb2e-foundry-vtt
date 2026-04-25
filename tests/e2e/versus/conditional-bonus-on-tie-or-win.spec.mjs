import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §5 Versus Tests — +s post mods (Order of Might per SG p.80, L3 trait
 * benefit) only apply to the side that tied or won the raw comparison.
 *
 * SG p.80 "The Greater the Might, the More You Hurt": "+1s per point of
 * Might greater than your opponent's for all successful or tied actions
 * in kill, capture, and drive off conflicts."
 *
 * Until both sides have rolled, we cannot tell whether the rolling side
 * was successful (won the versus) or tied. `_handleVersusRoll`
 * (`module/dice/tb2e-roll.mjs`) therefore applies only -s post mods
 * (Hungry/Exhausted team penalties — unconditional per SG pp.47, 54)
 * and DEFERS +s post mods to versus resolution. `_executeVersusResolution`
 * (`module/dice/versus.mjs`) then applies each side's stored +s mods only
 * if that side tied or won the raw (post-auto-mod) comparison.
 *
 * This spec doesn't drive the conflict UI — it pre-fabricates two paired
 * versus chat messages with the same flag shape that `_handleVersusRoll`
 * would produce, then triggers resolution via the public
 * `processVersusFinalize` path. That keeps the spec focused on the
 * resolution arithmetic without dragging in conflict setup, weapon
 * assignment, scripting, etc.
 *
 * Three scenarios:
 *   1. Loser carries a +s mod (e.g. Order of Might from a higher-Might
 *      side that lost the raw comparison). The bonus must NOT fire — the
 *      raw winner wins.
 *   2. Both sides tie raw, only one carries a +s mod. The mod applies
 *      and breaks the tie in that side's favor (resolution card posts,
 *      not a tied card).
 *   3. Winner carries a +s mod. It applies and increases the margin.
 */

const SYSTEM_VERSUS_PATH = '/systems/tb2e/module/dice/versus.mjs';

/**
 * Build a pair of versus chat messages directly. Mirrors the flag shape
 * of `_handleVersusRoll` (tb2e-roll.mjs) but bypasses the dice roll —
 * `successes` and `finalSuccesses` are set directly to the desired
 * post-auto-mod values, and `postSuccessMods` carries the +s mods that
 * resolution should consider.
 */
async function createPairedVersusMessages(page, args) {
  return page.evaluate(async (a) => {
    const initiator = await ChatMessage.create({
      content: '<div class="tb2e-roll-card"></div>',
      type: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        tb2e: {
          roll: {
            type: 'ability',
            key: 'will',
            label: 'Will',
            baseDice: a.iSuccesses,
            poolSize: a.iSuccesses,
            successes: a.iSuccesses,
            finalSuccesses: a.iSuccesses,
            obstacle: null,
            pass: null,
            modifiers: [],
            isBL: false,
            blAbilityKey: null,
            baseObstacle: null,
            logAdvancement: false
          },
          postSuccessMods: a.iCondBonus > 0 ? [{
            label: `Order of Might +${a.iCondBonus}s`,
            type: 'success',
            value: a.iCondBonus,
            source: 'conflict',
            icon: 'fa-solid fa-hand-fist',
            color: '--tb-amber',
            timing: 'post',
            display: `+${a.iCondBonus}s`
          }] : [],
          actorId: a.iActorId,
          resolved: true,
          versus: {
            type: 'initiator',
            initiatorActorId: a.iActorId,
            rollType: 'ability',
            rollKey: 'will',
            label: 'Will',
            baseDice: a.iSuccesses,
            logAdvancement: false,
            isBL: false,
            resolved: false
          }
        }
      }
    });

    const opponent = await ChatMessage.create({
      content: '<div class="tb2e-roll-card"></div>',
      type: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        tb2e: {
          roll: {
            type: 'ability',
            key: 'will',
            label: 'Will',
            baseDice: a.oSuccesses,
            poolSize: a.oSuccesses,
            successes: a.oSuccesses,
            finalSuccesses: a.oSuccesses,
            obstacle: null,
            pass: null,
            modifiers: [],
            isBL: false,
            blAbilityKey: null,
            baseObstacle: null,
            logAdvancement: false
          },
          postSuccessMods: a.oCondBonus > 0 ? [{
            label: `Order of Might +${a.oCondBonus}s`,
            type: 'success',
            value: a.oCondBonus,
            source: 'conflict',
            icon: 'fa-solid fa-hand-fist',
            color: '--tb-amber',
            timing: 'post',
            display: `+${a.oCondBonus}s`
          }] : [],
          actorId: a.oActorId,
          resolved: true,
          versus: {
            type: 'opponent',
            initiatorMessageId: initiator.id,
            initiatorActorId: a.iActorId,
            opponentActorId: a.oActorId,
            rollType: 'ability',
            rollKey: 'will',
            label: 'Will',
            baseDice: a.oSuccesses,
            logAdvancement: false,
            isBL: false,
            resolved: false
          }
        }
      }
    });

    // Mirror what resolveVersus does: link opponent message id onto
    // initiator. Without this, processVersusFinalize will bail out at the
    // !vs.opponentMessageId guard.
    await initiator.setFlag('tb2e', 'versus.opponentMessageId', opponent.id);

    return { initiatorId: initiator.id, opponentId: opponent.id };
  }, args);
}

async function runResolution(page, opponentMessageId, opponentActorId) {
  return page.evaluate(async ({ msgId, actorId }) => {
    const mod = await import('/systems/tb2e/module/dice/versus.mjs');
    const actor = game.actors.get(actorId);
    // processVersusFinalize requires both messages to be flagged
    // resolved (tb2e.flags.resolved). The pre-fab already sets that on
    // each message; we just call it for the opponent side.
    await mod.processVersusFinalize(actor, { messageId: msgId });
  }, { msgId: opponentMessageId, actorId: opponentActorId });
}

async function findResolutionFlags(page, initiatorMessageId, opponentMessageId) {
  return page.evaluate(async ({ iId, oId }) => {
    const started = Date.now();
    while ( Date.now() - started < 5000 ) {
      const msg = game.messages.contents.find((m) => {
        const vs = m.flags?.tb2e?.versus;
        return vs?.type === 'resolution'
          && vs.initiatorMessageId === iId
          && vs.opponentMessageId === oId;
      });
      if ( msg ) {
        return { type: 'resolution', winnerId: msg.flags.tb2e.versus.winnerId };
      }
      const tied = game.messages.contents.find((m) => {
        const vs = m.flags?.tb2e?.versus;
        return vs?.type === 'tied'
          && vs.initiatorMessageId === iId
          && vs.opponentMessageId === oId;
      });
      if ( tied ) {
        return {
          type: 'tied',
          initiatorSuccesses: tied.flags.tb2e.versus.initiatorSuccesses,
          opponentSuccesses: tied.flags.tb2e.versus.opponentSuccesses
        };
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  }, { iId: initiatorMessageId, oId: opponentMessageId });
}

test.describe('§5 Versus — conditional +s mods (Order of Might) gate on tie/win', () => {
  let initiatorActorId;
  let opponentActorId;

  test.beforeEach(async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    const ids = await page.evaluate(async () => {
      const stamp = Date.now();
      const init = await Actor.create({
        name: `E2E VsCond Init ${stamp}`,
        type: 'character',
        flags: { tb2e: { e2eTag: `versus-cond-${stamp}` } },
        system: { conditions: { fresh: false } }
      });
      const opp = await Actor.create({
        name: `E2E VsCond Opp ${stamp}`,
        type: 'character',
        flags: { tb2e: { e2eTag: `versus-cond-${stamp}` } },
        system: { conditions: { fresh: false } }
      });
      return { initiatorActorId: init.id, opponentActorId: opp.id };
    });
    initiatorActorId = ids.initiatorActorId;
    opponentActorId = ids.opponentActorId;
  });

  test.afterEach(async ({ page }) => {
    await page.evaluate(async ({ iId, oId }) => {
      try { game.actors.get(iId)?.delete(); } catch {}
      try { game.actors.get(oId)?.delete(); } catch {}
    }, { iId: initiatorActorId, oId: opponentActorId });
  });

  test('loser carries +s mod: bonus does not fire, raw winner wins', async ({ page }) => {
    // Initiator: 6 raw, no +s mod.
    // Opponent:  5 raw, +3s mod (e.g., Order of Might from higher Might).
    // Per SG p.80 the opponent's +3s does NOT fire (they lost raw).
    // Final: initiator 6, opponent 5 → initiator wins.
    // Without the conditional gate: opponent would be 5 + 3 = 8 → opponent wins
    // (which is the bug this spec guards).
    const { initiatorId, opponentId } = await createPairedVersusMessages(page, {
      iActorId: initiatorActorId, iSuccesses: 6, iCondBonus: 0,
      oActorId: opponentActorId, oSuccesses: 5, oCondBonus: 3
    });

    await runResolution(page, opponentId, opponentActorId);

    const result = await findResolutionFlags(page, initiatorId, opponentId);
    expect(result).toEqual({ type: 'resolution', winnerId: initiatorActorId });

    // Loser's roll message should not have had its finalSuccesses bumped
    // by the conditional bonus.
    const oFinal = await page.evaluate((id) => {
      return game.messages.get(id)?.flags?.tb2e?.roll?.finalSuccesses ?? null;
    }, opponentId);
    expect(oFinal).toBe(5);
  });

  test('raw tie + one side has +s mod: mod breaks the tie for that side', async ({ page }) => {
    // Both raw 5. Opponent has +2s. Per SG p.80 both sides "tied or won",
    // so both apply — but only opponent has a bonus. Final: initiator 5,
    // opponent 7 → opponent wins. The result is a resolution card, NOT a
    // tied card.
    const { initiatorId, opponentId } = await createPairedVersusMessages(page, {
      iActorId: initiatorActorId, iSuccesses: 5, iCondBonus: 0,
      oActorId: opponentActorId, oSuccesses: 5, oCondBonus: 2
    });

    await runResolution(page, opponentId, opponentActorId);

    const result = await findResolutionFlags(page, initiatorId, opponentId);
    expect(result).toEqual({ type: 'resolution', winnerId: opponentActorId });

    const oFinal = await page.evaluate((id) => {
      return game.messages.get(id)?.flags?.tb2e?.roll?.finalSuccesses ?? null;
    }, opponentId);
    expect(oFinal).toBe(7);
  });

  test('winner carries +s mod: mod applies and grows the margin', async ({ page }) => {
    // Initiator: 7 raw, +2s mod. Opponent: 4 raw, no mod.
    // Initiator already won raw, so the +2s applies and pushes margin
    // from 3 to 5.
    const { initiatorId, opponentId } = await createPairedVersusMessages(page, {
      iActorId: initiatorActorId, iSuccesses: 7, iCondBonus: 2,
      oActorId: opponentActorId, oSuccesses: 4, oCondBonus: 0
    });

    await runResolution(page, opponentId, opponentActorId);

    const result = await findResolutionFlags(page, initiatorId, opponentId);
    expect(result).toEqual({ type: 'resolution', winnerId: initiatorActorId });

    const iFinal = await page.evaluate((id) => {
      return game.messages.get(id)?.flags?.tb2e?.roll?.finalSuccesses ?? null;
    }, initiatorId);
    expect(iFinal).toBe(9);
  });
});
