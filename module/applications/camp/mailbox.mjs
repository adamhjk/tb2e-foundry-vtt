/**
 * Camp mailbox — GM-side processor for `flags.tb2e.pendingCampAction` writes
 * on PC actors. Players cannot update world settings (where camp session
 * state lives) or other players' actors, so they express intent by flagging
 * their own actor; the GM client picks the flag up via `updateActor` and
 * performs the actual state mutation on their behalf.
 *
 * See `CLAUDE.md` → Mailbox Pattern for the general rule.
 *
 * Supported action kinds (see `CampPanel` actions for the UI side):
 *   - spend-check:  deduct 1 check + append log entry
 *   - share-check:  { toActorId } — transfer 1 check to another PC (DH p. 81)
 *   - memorize:     deduct 1 check, mark memorized (SG p. 95, once per camp)
 *   - purify:       deduct 1 check, mark purified (SG p. 95, once per camp)
 *   - avert:        { success } — record an avert outcome (SG p. 94)
 *   - instinct:     free unless exhausted (SG p. 95)
 */

import * as campState from "../../data/camp/state.mjs";

/**
 * Called from `tb2e.mjs`'s `updateActor` hook on the GM client only. If
 * `flags.tb2e.pendingCampAction` was set by this update, process it and
 * clear the flag.
 */
export async function processCampActionMailbox(actor, changes) {
  if ( !game.user.isGM ) return;
  const payload = changes.flags?.tb2e?.pendingCampAction;
  if ( !payload ) return;

  try {
    await dispatch(actor, payload);
  } catch ( err ) {
    console.error("TB2E | Camp mailbox error:", err);
  } finally {
    // Clear the flag so subsequent identical intents are recognized as new.
    await actor.unsetFlag("tb2e", "pendingCampAction");
  }
}

async function dispatch(actor, { kind, payload = {} } = {}) {
  switch ( kind ) {
    case "spend-check": return doSpendCheck(actor, payload.purpose || "test");
    case "share-check": return doShareCheck(actor, payload.toActorId);
    case "memorize":    return doMemorize(actor);
    case "purify":      return doPurify(actor);
    case "instinct":    return doInstinct(actor);
    case "avert":       return doAvert(actor, payload.success);
    default:
      console.warn(`TB2E | Camp mailbox: unknown kind "${kind}"`);
  }
}

async function doSpendCheck(actor, purpose) {
  if ( (actor.system.checks ?? 0) <= 0 ) return;
  await actor.update({ "system.checks": actor.system.checks - 1 });
  await campState.recordTest({ actorId: actor.id, kind: purpose, detail: "" });
}

async function doShareCheck(giver, toActorId) {
  const receiver = game.actors.get(toActorId);
  if ( !receiver || (giver.system.checks ?? 0) <= 0 ) return;
  await giver.update({ "system.checks": giver.system.checks - 1 });
  await receiver.update({ "system.checks": (receiver.system.checks ?? 0) + 1 });
  await campState.recordTest({
    actorId: giver.id, kind: "share", toActorId: receiver.id, detail: ""
  });
}

async function doMemorize(actor) {
  const state = campState.getCampState();
  if ( state.memorizedBy?.includes(actor.id) ) return;
  if ( (actor.system.checks ?? 0) <= 0 ) return;
  await actor.update({ "system.checks": actor.system.checks - 1 });
  await campState.recordTest({ actorId: actor.id, kind: "memorize", detail: "Memorized a spell" });
}

async function doPurify(actor) {
  const state = campState.getCampState();
  if ( state.purifiedBy?.includes(actor.id) ) return;
  if ( (actor.system.checks ?? 0) <= 0 ) return;
  await actor.update({ "system.checks": actor.system.checks - 1 });
  await campState.recordTest({ actorId: actor.id, kind: "purify", detail: "Purified burden" });
}

async function doInstinct(actor) {
  const exhausted = !!actor.system.conditions?.exhausted;
  if ( exhausted ) {
    if ( (actor.system.checks ?? 0) <= 0 ) return;
    await actor.update({ "system.checks": actor.system.checks - 1 });
  }
  await campState.recordTest({
    actorId: actor.id, kind: "instinct",
    detail: exhausted ? "Used instinct (exhausted — 1 ✓)" : "Used instinct (free)"
  });
}

async function doAvert(actor, success) {
  await campState.markAvertAttempt({ success: !!success, actorId: actor.id });
}
