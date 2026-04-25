/**
 * Session state for the active Camp phase visit. Stored in the world
 * setting `tb2e.campState`. Survives across reloads (it's a world setting)
 * but not across camps — `endCamp` clears it.
 *
 * Rules source: Scholar's Guide pp. 90–96 (Camp), DH p. 81 (Spending
 * Checks). See `tests/e2e/camp/CAMP_PLAN.md` for the full design.
 *
 * This module is the canonical mutator for `tb2e.campState`. The Camp
 * Panel's actions call these helpers rather than writing to the setting
 * directly, so that validation and writeback logic stay in one place.
 *
 * All mutators are GM-gated — players route their intents through the
 * mailbox (see `module/applications/camp/mailbox.mjs`), never directly.
 */

/** Default shape for an empty `tb2e.campState`. Used by the setting default
 *  and when `endCamp` clears the state. */
export function defaultCampState() {
  return {
    active:      false,
    campActorId: null,
    phase:       "site",            // site → setup → decisions → events → strategy → break
    danger:      "typical",         // per-visit override; seeded from campActor.defaultDanger
    survey: {
      performed:    false,
      shelter:      false,          // newly-found amenity this visit
      concealment:  false,
      water:        false
    },
    fire:        "lit",             // "lit" | "dark" (SG p. 92)
    watchers:    [],                // actor IDs
    events: {
      rolled:            false,
      dice:              [0, 0, 0],
      modifier:          0,         // net modifier applied to the roll
      gmSituational:     0,         // GM-editable delta (SG p. 93)
      total:             0,
      resultUuid:        null,      // Compendium.tb2e.camp-events.TableResult.*
                                    // — the TERMINAL (after subtable recursion)
      topResultUuid:     null,      // — the TOP-LEVEL table row (holds disaster
                                    //   flags + avert config; usually === resultUuid
                                    //   unless the top row points at a subtable)
      isDisaster:        false,
      isUnavertable:     false,
      averted:           null,      // null | true | false
      outcome:           "pending", // "pending" | "continuing" | "averted" | "ended"
      // Grind turn stashed on entering events phase. Safe rolls reset
      // grindTurn to 1 (SG p. 96); disaster rolls restore this value
      // (the grind continues — SG pp. 93–94).
      preCampGrindTurn:  1
    },
    log:         [],                // { actorId, kind, detail, ts }
    memorizedBy: [],                // actor IDs (once per camp — SG p. 95)
    purifiedBy:  []                 // actor IDs (once per camp — SG p. 95)
  };
}

/** Fetch the current camp state. Returns a live copy (safe to mutate for
 *  subsequent `writeState`). */
export function getCampState() {
  return foundry.utils.duplicate(game.settings.get("tb2e", "campState"));
}

/** Resolve the active camp actor, if any. */
export function getCampActor(state = getCampState()) {
  return state?.campActorId ? game.actors.get(state.campActorId) : null;
}

/** Low-level write — GM only. */
async function writeState(state) {
  if ( !game.user.isGM ) return null;
  await game.settings.set("tb2e", "campState", state);
  return state;
}

/* -------------------------------------------- */
/*  Lifecycle                                    */
/* -------------------------------------------- */

/**
 * Start a camp visit at an existing camp actor. Seeds `danger` from the
 * actor's `defaultDanger` and advances to the "setup" phase. The panel
 * reads this state next render.
 */
export async function beginCamp(campActorId) {
  if ( !game.user.isGM ) return null;
  const actor = game.actors.get(campActorId);
  if ( !actor || actor.type !== "camp" ) return null;
  const next = defaultCampState();
  next.active = true;
  next.campActorId = campActorId;
  next.danger = actor.system.defaultDanger;
  next.phase = "setup";
  return writeState(next);
}

/** Create a new camp actor and begin a visit to it. */
export async function createAndBeginCamp({ name, type, defaultDanger } = {}) {
  if ( !game.user.isGM ) return null;
  const actor = await Actor.create({
    name: name || game.i18n.localize("TB2E.Camp.Sheet.NamePlaceholder"),
    type: "camp",
    system: {
      type: type || "wilderness",
      defaultDanger: defaultDanger || "typical"
    }
  });
  if ( !actor ) return null;
  return beginCamp(actor.id);
}

/** Select an existing camp from the Site tab. */
export async function selectExistingCamp(campActorId) {
  return beginCamp(campActorId);
}

/**
 * Reset the panel back to a clean state WITHOUT writing anything to the
 * camp actor. Discards session state (selected site, decisions, events
 * roll, log, watchers, etc.), restores the pre-camp grind turn, and
 * returns to adventure phase. Use when the GM wants to back out of a
 * mistakenly-started camp without recording a visit or incrementing
 * disaster counters.
 *
 * Differs from `endCamp` in that:
 *   - No visit entry appended.
 *   - No amenity flush.
 *   - `disastersThisAdventure` is not incremented.
 *   - PC `system.checks` are NOT discarded — they survive the reset.
 */
export async function cancelCamp() {
  if ( !game.user.isGM ) return null;
  const state = getCampState();
  // Restore grind turn to what it was before entering events phase, if
  // a roll had bumped it. Safe roll → grindTurn was set to 1; disaster →
  // already restored. Either way, return to whatever the GM had on the
  // dial when camp was entered.
  if ( state.events?.preCampGrindTurn ) {
    await game.settings.set("tb2e", "grindTurn", state.events.preCampGrindTurn);
  }
  await game.settings.set("tb2e", "grindPhase", "adventure");
  return writeState(defaultCampState());
}

/**
 * End the current camp visit. Writes back to the camp actor and clears
 * session state. By default, discards unspent player checks (SG p. 95).
 *
 * @param {object}  [options]
 * @param {boolean} [options.discardChecks=true]  When false, the camp is
 *   still ended (visit logged, disaster counter incremented if applicable)
 *   but PCs keep their unspent checks. Use when the table judges the
 *   camp ended abruptly enough to count as dangerous, but not
 *   catastrophically enough to wipe the players' check pool — a
 *   deliberate deviation from SG p. 95, surfaced as a GM-controlled
 *   toggle on the Break tab.
 */
export async function endCamp({ discardChecks = true } = {}) {
  if ( !game.user.isGM ) return null;
  const state = getCampState();
  const actor = getCampActor(state);

  // Writeback to the camp actor: merge newly-found amenities, append visit
  // entry, increment disaster counter if applicable.
  if ( actor ) {
    const amenityUpdate = {};
    for ( const key of ["shelter", "concealment", "water"] ) {
      if ( state.survey[key] && !actor.system.amenities[key] ) {
        amenityUpdate[`system.amenities.${key}`] = true;
      }
    }

    // Visit outcome labels — human-readable tags that reflect what
    // actually happened at the site (SG p. 93 "A disaster is any event
    // that forces an early end to a camp phase, regardless if the watch
    // averts it or not."). Internal state uses "continuing / averted /
    // ended" for transitions; visit history uses:
    //   - "safe":     no disaster rolled (or camp never reached events)
    //   - "disaster": a disaster was rolled and averted (camp continued)
    //   - "broken":   a disaster ended the camp
    const stateOutcome = state.events.outcome;
    let visitOutcome = "safe";
    if ( state.events.isDisaster ) {
      visitOutcome = stateOutcome === "averted" ? "disaster" : "broken";
    }
    const visit = {
      ts: Date.now(),
      outcome: visitOutcome,
      disasterKey: state.events.resultUuid ?? "",
      notes: ""
    };
    const visits = [...actor.system.visits, visit];

    // Disaster counter increments on ANY disaster — averted or not (SG p. 93).
    const disasterInc = state.events.isDisaster ? 1 : 0;
    const disasterUpdate = disasterInc > 0
      ? { "system.disastersThisAdventure": actor.system.disastersThisAdventure + disasterInc }
      : {};

    await actor.update({
      ...amenityUpdate,
      ...disasterUpdate,
      "system.visits": visits
    });
  }

  // Discard unspent checks (SG p. 95): scene-party PCs' `system.checks` → 0.
  // The GM may override via the Break-tab toggle (`discardChecks: false`).
  if ( discardChecks ) {
    for ( const pc of getPartyActors() ) {
      if ( pc.system.checks > 0 ) await pc.update({ "system.checks": 0 });
    }
  } else if ( state.events?.preCampGrindTurn ) {
    // GM kept the checks → also keep the grind tracker on the turn it was
    // on when camp began. Without this, a safe-camp roll would have already
    // bumped grindTurn to 1 (rollEvents above), effectively giving the
    // party a free grind reset to go with their preserved checks. The
    // keep-checks toggle is meant to undo BOTH halves of the camp wipe.
    // (Disaster path is a no-op: rollEvents already restored
    // preCampGrindTurn there.)
    await game.settings.set("tb2e", "grindTurn", state.events.preCampGrindTurn);
  }

  // Return to adventure phase.
  await game.settings.set("tb2e", "grindPhase", "adventure");

  // Clear the session state.
  return writeState(defaultCampState());
}

/* -------------------------------------------- */
/*  Phase advance / mutators                     */
/* -------------------------------------------- */

export async function setPhase(phase) {
  if ( !game.user.isGM ) return null;
  const state = getCampState();
  const oldPhase = state.phase;
  state.phase = phase;

  // Entering the Events phase "starts camp" (SG p. 93 "Roll for Camp
  // Events"). Flip the grind tracker to camp mode and stash the current
  // grind turn so a disaster reroll can restore it (grind continues on
  // disaster; resets to 1 on safe — see rollEvents).
  if ( phase === "events" && oldPhase !== "events" ) {
    state.events.preCampGrindTurn = game.settings.get("tb2e", "grindTurn") ?? 1;
    await game.settings.set("tb2e", "grindPhase", "camp");
  }

  return writeState(state);
}

export async function setDanger(danger) {
  if ( !game.user.isGM ) return null;
  const state = getCampState();
  state.danger = danger;
  return writeState(state);
}

export async function toggleSurvey(key) {
  if ( !game.user.isGM ) return null;
  const state = getCampState();
  if ( key === "performed" ) {
    state.survey.performed = !state.survey.performed;
  } else if ( ["shelter", "concealment", "water"].includes(key) ) {
    state.survey[key] = !state.survey[key];
  }
  return writeState(state);
}

export async function setFire(fire) {
  if ( !game.user.isGM ) return null;
  if ( !["lit", "dark"].includes(fire) ) return null;
  const state = getCampState();
  state.fire = fire;
  return writeState(state);
}

export async function toggleWatcher(actorId) {
  if ( !game.user.isGM ) return null;
  const state = getCampState();
  const idx = state.watchers.indexOf(actorId);
  if ( idx === -1 ) state.watchers.push(actorId);
  else state.watchers.splice(idx, 1);
  return writeState(state);
}

export async function setGmSituational(delta) {
  if ( !game.user.isGM ) return null;
  const state = getCampState();
  state.events.gmSituational = Math.max(-10, Math.min(10, Number(delta) || 0));
  return writeState(state);
}

/* -------------------------------------------- */
/*  Events roll                                  */
/* -------------------------------------------- */

/**
 * Execute the 3d6 events roll for the current camp. Builds a Roll with the
 * computed modifier, calls `table.draw({ roll })` (which posts the
 * loot-draw-style chat card per Phase B3), and writes the drawn result into
 * session state.
 *
 * Returns the drawn ChatMessage results + chain so callers can render or
 * inspect the outcome.
 */
export async function rollEvents() {
  if ( !game.user.isGM ) return null;
  const state = getCampState();
  const actor = getCampActor(state);
  if ( !actor ) return null;

  // Locate the camp-events table for this camp type.
  const pack = game.packs.get("tb2e.camp-events");
  if ( !pack ) return null;
  const tables = await pack.getDocuments();
  const table = tables.find(t =>
    !t.getFlag("tb2e", "campEvents")?.isSubtable &&
    t.getFlag("tb2e", "campEvents")?.campType === actor.system.type
  );
  if ( !table ) return null;

  const breakdown = computeEventsModifier(state, actor, getPartyForModifier());
  const mod = breakdown.net;

  const roll = new Roll("3d6 + @mod", { mod });
  await roll.evaluate();

  // Pre-compute the top-level result from the already-evaluated roll.
  // This is more reliable than Foundry's internal reroll loop inside
  // `table.draw()` — the loop re-evaluates the roll and in some edge
  // cases (very negative totals near the lowest table range) returns
  // empty results even when `getResultsForRoll(total)` finds a match.
  // By passing `results` into draw we skip the loop, and we resolve
  // subtable recursion ourselves so the chat card reflects the full
  // "Curiosity → Owlbear" path.
  const topLevelResults = table.getResultsForRoll(roll.total);
  const topResult = topLevelResults[0];

  // Build the chain trace ourselves so the chat card shows the full
  // "Top → Subtable" path (TB2ELootTable normally does this inside its
  // .roll() override, but we're bypassing that path; see comment above).
  const chain = [{
    tableId:   table.id,
    tableName: table.name,
    tableImg:  table.img,
    tableUuid: table.uuid,
    pageRef:   table.description ?? "",
    formula:   table.formula,
    rollTotal: roll.total,
    drewLabel: topResult?.name || topResult?.text || ""
  }];

  // Manual subtable recursion for `type: "document"` results that point at
  // another RollTable.
  let terminalResults = [topResult].filter(Boolean);
  if ( topResult?.type === CONST.TABLE_RESULT_TYPES.DOCUMENT && topResult.documentUuid ) {
    const parsed = foundry.utils.parseUuid(topResult.documentUuid);
    if ( parsed?.type === "RollTable" ) {
      const subTable = await fromUuid(topResult.documentUuid);
      if ( subTable ) {
        const subDraw = await subTable.draw({ displayChat: false });
        if ( subDraw.results?.length ) terminalResults = subDraw.results;
        // Append the subtable as the next chain link so the card shows
        // "Camp Events → Subtable" with both rolls.
        chain.push({
          tableId:   subTable.id,
          tableName: subTable.name,
          tableImg:  subTable.img,
          tableUuid: subTable.uuid,
          pageRef:   subTable.description ?? "",
          formula:   subTable.formula,
          rollTotal: subDraw?.roll?.total ?? null,
          drewLabel: subDraw?.results?.map(r => r.name || r.text || "").filter(Boolean).join(", ") ?? ""
        });
      }
    }
  }

  // Draw on the main table with `results` + `chain` pre-built so the
  // reroll loop is skipped and the chat card still has the full lineage.
  const draw = await table.draw({ roll, results: terminalResults, chain });

  const terminal = terminalResults[0];
  const flags = topResult?.flags?.tb2e?.campEvents ?? {};

  const isDisaster    = !!flags.isDisaster;
  const isUnavertable = !!flags.isUnavertable;
  const hasWatchers   = (state.watchers?.length ?? 0) > 0;

  // Persist both the terminal uuid (for display name) and the top-level
  // uuid (for avert config lookup / flag re-reads on re-render).
  state.events.topResultUuid = topResult?.uuid ?? null;

  state.events.rolled        = true;
  state.events.modifier      = mod;
  state.events.total         = roll.total;
  state.events.dice          = roll.dice[0]?.results?.map(r => r.result) ?? [];
  state.events.resultUuid    = terminal?.uuid ?? null;
  state.events.isDisaster    = isDisaster;
  state.events.isUnavertable = isUnavertable;
  state.events.averted       = null;

  // Outcome resolution (SG p. 94):
  //   - Safe event → continuing.
  //   - Disaster, unavertable → ended (camp forced to break).
  //   - Disaster with no watchers set → ended (no one can avert).
  //   - Disaster with watchers → pending (awaiting avert attempt).
  if ( !isDisaster ) {
    state.events.outcome = "continuing";
  } else if ( isUnavertable || !hasWatchers ) {
    state.events.outcome = "ended";
  } else {
    state.events.outcome = "pending";
  }

  // Grind turn (SG pp. 93–94, 96):
  //   - Safe roll: reset grindTurn to 1 (camp refreshes the grind).
  //   - Disaster: restore the pre-camp grindTurn so the grind continues
  //     where it left off, even across rerolls.
  if ( isDisaster ) {
    await game.settings.set("tb2e", "grindTurn", state.events.preCampGrindTurn ?? 1);
  } else {
    await game.settings.set("tb2e", "grindTurn", 1);
  }

  await writeState(state);
  return draw;
}

/* -------------------------------------------- */
/*  Avert handling                               */
/* -------------------------------------------- */

/**
 * Record an avert outcome. `success === true` marks the disaster averted and
 * camp continues; `false` marks it failed and camp ends. GM-only.
 */
export async function markAvertAttempt({ success, actorId }) {
  if ( !game.user.isGM ) return null;
  const state = getCampState();
  state.events.averted = !!success;
  state.events.outcome = success ? "averted" : "ended";
  state.log.push({
    actorId,
    kind: "avert",
    detail: success ? "Averted" : "Failed",
    ts: Date.now()
  });
  return writeState(state);
}

/* -------------------------------------------- */
/*  Log / check bookkeeping                      */
/* -------------------------------------------- */

export async function recordTest({ actorId, kind, detail, toActorId } = {}) {
  if ( !game.user.isGM ) return null;
  const state = getCampState();
  state.log.push({
    actorId,
    kind,
    detail: detail || "",
    toActorId: toActorId || null,
    ts: Date.now()
  });
  if ( kind === "memorize" && !state.memorizedBy.includes(actorId) ) {
    state.memorizedBy.push(actorId);
  }
  if ( kind === "purify" && !state.purifiedBy.includes(actorId) ) {
    state.purifiedBy.push(actorId);
  }
  return writeState(state);
}

/* -------------------------------------------- */
/*  Modifier computation (pure)                  */
/* -------------------------------------------- */

/**
 * Compute the events-roll modifier breakdown per SG p. 93.
 *
 * @param {object}      state       — `tb2e.campState` (session)
 * @param {Actor|null}  campActor   — the active camp actor
 * @param {Actor[]}     party       — player-character actors considered for
 *                                    ranger/outcast bonuses
 * @returns {{ breakdown: object[], net: number }}
 */
export function computeEventsModifier(state, campActor, party = []) {
  const breakdown = [];
  const push = (key, label, value) => breakdown.push({ key, label, value });

  const amenities = campActor?.system?.amenities ?? {};
  const campType = campActor?.system?.type ?? "wilderness";
  const isDwarven = !!campActor?.system?.isDwarvenMade;

  // Survivalist amenities — already-found or found this visit.
  const hasShelter     = !!amenities.shelter     || !!state?.survey?.shelter;
  const hasConcealment = !!amenities.concealment || !!state?.survey?.concealment;
  push("shelter",     "Shelter",           hasShelter ? 1 : 0);
  push("concealment", "Concealment",       hasConcealment ? 1 : 0);

  // Class bonuses.
  const hasRanger  = party.some(a => a?.system?.class === "ranger");
  const hasOutcast = party.some(a => a?.system?.class === "outcast");
  push("ranger",  "Ranger in wilderness", (hasRanger && campType === "wilderness") ? 1 : 0);
  push("outcast", "Outcast in dungeon",
    (hasOutcast && (campType === "dungeons" || isDwarven)) ? 1 : 0);

  // Watch set — flat +1 regardless of count (SG p. 92).
  const hasWatch = (state?.watchers?.length ?? 0) > 0;
  push("watch", "Watch set", hasWatch ? 1 : 0);

  // Danger penalty + dark-camp relief (SG p. 93).
  const dangerValues = { typical: 0, unsafe: -2, dangerous: -3 };
  let dangerPenalty = dangerValues[state?.danger] ?? 0;
  if ( state?.fire === "dark" && dangerPenalty < 0 ) dangerPenalty += 1;
  const dangerLabel = { typical: "Typical", unsafe: "Unsafe", dangerous: "Dangerous" }[state?.danger] ?? "";
  push("danger", `Danger: ${dangerLabel}`, dangerPenalty);

  // Prior disasters this adventure in this area (SG p. 93).
  const priorDisasters = campActor?.system?.disastersThisAdventure ?? 0;
  push("prior-disasters", "Prior disasters here", -priorDisasters);

  // GM situational (SG p. 93).
  push("gm-situational", "GM situational", state?.events?.gmSituational ?? 0);

  const net = breakdown.reduce((sum, b) => sum + b.value, 0);
  return { breakdown, net };
}

/**
 * The party for a camp visit — character actors whose tokens are on the
 * current scene AND whose conflict team is "party" (the default).
 *
 * Fallback: when no PC tokens are present on the scene at all (e.g.
 * between-scene setup, test fixtures, or the GM hasn't placed tokens yet),
 * we return every character actor. This avoids surprising "empty party"
 * states. Once any PC token is on the scene the strict filter applies.
 */
export function getPartyActors() {
  const scene = canvas?.scene ?? game.scenes?.active ?? null;
  if ( !scene ) return game.actors.filter(a => a.type === "character");
  const sceneActorIds = new Set(scene.tokens.map(t => t.actorId).filter(Boolean));
  const sceneParty = game.actors.filter(a =>
    a.type === "character" &&
    sceneActorIds.has(a.id) &&
    (a.system?.conflict?.team ?? "party") === "party"
  );
  if ( sceneParty.length > 0 ) return sceneParty;
  return game.actors.filter(a => a.type === "character");
}

/** First camp actor with a token on the current scene, or null. */
export function getSceneCampActor() {
  const scene = canvas?.scene ?? game.scenes?.active ?? null;
  if ( !scene ) return null;
  for ( const t of scene.tokens ) {
    const actor = t.actor;
    if ( actor?.type === "camp" ) return actor;
  }
  return null;
}

/** Default party-for-modifier — scene-aware (legacy alias). */
function getPartyForModifier() {
  return getPartyActors();
}
