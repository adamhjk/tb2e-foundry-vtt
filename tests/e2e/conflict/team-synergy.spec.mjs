import { test, expect } from '../test.mjs';
import { scriptAndLockActions } from '../helpers/conflict-scripting.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §19 Conflict: Team, Helping, Artha — teammate synergy on a conflict
 * action roll (TEST_PLAN L520).
 *
 * ---------------------------------------------------------------------------
 * Rules as written — Scholar's Guide p.87 ("Synergy", under Fate)
 * ---------------------------------------------------------------------------
 * "When helping another player on a test, the helper may spend one fate
 *  point before the dice are cast to learn from the experience. Players
 *  may use the synergy effect while helping on a skill, ability or
 *  Beginner's Luck test. If the player rolling the dice passes the test,
 *  the helper marks a passed test for advancement for the skill or
 *  ability with which they helped, not necessarily the one being tested.
 *  If they fail, they mark a failed test. All help must obey the standard
 *  helping rules." (../reference/rules/fate-persona/scholars-guide-fate-
 *  persona.md L141-148)
 *
 * Notes on the TEST_PLAN L520 description ("adds +1D to the rolling
 * teammate's action"):
 *   - The +1D comes from the **helping** contribution that always
 *     accompanies synergy — per SG p.87, "All help must obey the standard
 *     helping rules", so a teammate spending fate for synergy must ALSO
 *     be contributing their help die. The production UI wires these
 *     together: clicking `.helper-synergy-btn` in the roll dialog auto-
 *     activates the sibling `.helper-toggle` (module/dice/tb2e-roll.mjs
 *     L695-705) and adds `.synergy-active` to the row (L707), so the
 *     synergy path guarantees both +1D help AND advancement logging.
 *   - The "teammate synergy" assertion therefore covers BOTH halves:
 *     the rolling teammate's pool gains +1D (from the coupled help), AND
 *     the helper earns an advancement test (logged via _processSynergy
 *     in post-roll.mjs L410-457).
 *
 * ---------------------------------------------------------------------------
 * Production path — call graph
 * ---------------------------------------------------------------------------
 * Conflict action roll (attack/defend/feint/maneuver) →
 *   `#onRollAction` (conflict-panel.mjs L1847+) — builds `memberCombatants`
 *   (L1970-1972: same-group Combatants minus the roller) and calls
 *   `rollTest` with `testContext = { isConflict, candidates:
 *   memberCombatants, ... }`.
 * → `getEligibleHelpers` (help.mjs L76-150): with `candidates` provided,
 *   the scene-token walk at L91-101 is shortcut — pool = candidates
 *   (L84-85). For each candidate, `_findBestHelpPath` (L227-238) resolves
 *   a help path — for a Kill attack (skill:fighter) against a teammate
 *   with fighter > 0, the "same-skill" branch at help.mjs L281-289 fires.
 *   Helper entry carries `hasFate: character && fate.current > 0`
 *   (L145), which unlocks the `.helper-synergy-btn` in the dialog
 *   (templates/dice/roll-dialog.hbs L224-228).
 * → `_showRollDialog` (tb2e-roll.mjs L376-1203) renders roll-dialog.hbs.
 *   Click `.helper-synergy-btn` → tb2e-roll.mjs L690-708 handler: auto-
 *   engages the helper toggle (+1D) at L696-705 and toggles
 *   `.synergy-active` on the row at L707.
 * → On dialog submit (L1114-1124): `selectedHelpers` includes the alt
 *   with `synergy: true` (L1122, derived from the row's
 *   `.synergy-active` class).
 * → For an attack-vs-attack **independent** interaction (config.mjs L408 —
 *   both sides roll vs Ob 0), `_handleIndependentRoll` (tb2e-roll.mjs
 *   L1487-1540) posts the roll-result chat card with:
 *     - `synergyHelpers: _buildSynergyHelpers(config.selectedHelpers)`
 *       (L1515) — filtered to `h.synergy === true && !helperSynergy[h.id]
 *       && game.actors.has(h.id)` (L1551).
 *     - `flags.tb2e.helpers: mapHelpersForFlags(config.selectedHelpers)`
 *       (L1535 → roll-utils.mjs L164-168) — minimal record with
 *       `{ id, name, helpVia, helpViaType, synergy }`.
 * → `buildChatTemplateData` (roll-utils.mjs L84-157) renders
 *   `{{#if synergyHelpers.length}}` block in roll-result.hbs L141-151,
 *   emitting `button.card-btn[data-action="synergy"]
 *   [data-helper-id="<altId>"]` per unresolved synergy helper.
 * → Clicking the chat-card synergy button dispatches
 *   `activatePostRollListeners` (post-roll.mjs L33-56) →
 *   `_handleSynergy(message, helperId)` (post-roll.mjs L376-402):
 *     - GM branch (L396-398): `_processSynergy(actor, message)` runs
 *       directly — deducts 1 fate from the HELPER, calls
 *       `_logAdvancement` (tb2e-roll.mjs L192-204) to bump
 *       `system.skills.<helpVia>.pass` or `.fail` by 1, marks
 *       `flags.tb2e.helperSynergy.<actorId> = true` on the message,
 *       re-renders the card (button disappears).
 *     - Non-GM branch (L399-400): `actor.setFlag("tb2e",
 *       "pendingSynergy", { messageId })` → the mailbox pattern
 *       (CLAUDE.md §Mailbox Pattern, `flags.tb2e.pendingSynergy`). GM
 *       hook at tb2e.mjs L185-188 detects the flag and calls
 *       `processSynergyMailbox` (post-roll.mjs L466-471) which runs
 *       `_processSynergy` and unsets the flag.
 *
 * Both branches converge on `_processSynergy` — this spec exercises
 * BOTH as two sibling scenarios to prove the mailbox and the direct-GM
 * paths produce the same end state.
 *
 * ---------------------------------------------------------------------------
 * Staging
 * ---------------------------------------------------------------------------
 * Kill conflict (config.mjs L202-211 — attack rolls skill:fighter):
 *   - Party: captainA (fighter=3, health=4, fate=0 — the ROLLER; fate=0 so
 *     the captain doesn't show their own synergy toggle, which isn't
 *     relevant here) + altHelper (fighter=2, fate=3 — the synergy
 *     donor; fate=3 so both scenarios can spend fate without re-seeding).
 *   - GM: Bugbear captain + Goblin mook (monsters — different group, so
 *     not in the helper candidate pool per conflict-panel.mjs L1970 group
 *     filter).
 *   - All unarmed via `__unarmed__` (conflict-panel.mjs L1944-1948
 *     bakes a -1D "Fists" modifier).
 *   - Scripting: party V0=attack/captainA, alt on V1 so alt is NOT
 *     scripted on V0 — WAIT, actually per SG p.87 synergy just requires
 *     helping; standard helping rules allow any unscripted teammate to
 *     help (DH p.63). The test plan's "§19 Team, Helping, Artha" section
 *     groups synergy separately from "helping from an unscripted teammate"
 *     (L521); synergy here is about the fate spend while helping, not
 *     about which teammate can help. We stage alt as scripted on V1
 *     (defend) so they're NOT the V0 actor and CAN help V0 (standard
 *     helping works either way — scripted-on-other-volley teammates
 *     qualify per `memberCombatants` filter at conflict-panel.mjs L1970-
 *     1972 which only excludes the current roller).
 *   - GM V0=attack/monA, V1=attack/monB — **attack:attack interaction**
 *     (config.mjs L408) is INDEPENDENT, so both sides roll independently
 *     vs Ob 0 and no versus-resolution card is produced (contrast with
 *     attack:defend versus chain which would require `_handleVersusRoll`
 *     finalization). Independent attack lands in `_handleIndependentRoll`
 *     — the standard synergy surface.
 *
 * Disposition distributed flat (captainA HP=4, alt HP=3, monA HP=4,
 * monB HP=4) so nobody starts KO'd (help.mjs L57 gate needs
 * `conflictHP.value > 0 || max === 0`; we want alt to qualify as helper).
 *
 * PRNG stub: `CONFIG.Dice.randomUniform = () => 0.001` — `Math.ceil((1 -
 * 0.001) * 6) = 6`, so every die rolls a 6. With pool = fighter(3) − 1
 * unarmed + 1 help = 3 dice, the captain's attack passes Ob 0 with 3
 * successes. Since SG p.87 says "If the player rolling the dice passes
 * the test, the helper marks a passed test" — the pass path is what we
 * exercise for `_logAdvancement` (tb2e-roll.mjs L192-204, pass → bumps
 * `skills.fighter.pass`).
 *
 * ---------------------------------------------------------------------------
 * Concrete assertions
 * ---------------------------------------------------------------------------
 * Two scenarios (separate `test(...)` invocations inside one describe):
 *
 * (A) GM direct-synergy path:
 *   1. Dialog baseline: `getSummaryPool()` === 2 (fighter=3 − 1 unarmed).
 *   2. After `toggleHelperSynergy(altId)`: summary pool === 3 (baseline
 *      +1 help). `.helper-row[data-helper-id=altId]` has
 *      `.synergy-active`. `.helper-toggle[data-helper-id=altId]` has
 *      `.active`.
 *   3. Submit → roll-result card emitted. On the card:
 *      - `.roll-card-breakdown .breakdown-total` pool integer === 3.
 *      - `flags.tb2e.helpers[0] = { id: altId, helpVia: "fighter",
 *        helpViaType: "skill", synergy: true, name: <alt name> }`.
 *      - `flags.tb2e.testContext.isConflict === true`, `conflictAction
 *        === "attack"`, `groupId === partyGroupId`.
 *      - `flags.tb2e.roll.pass === true`, `.successes === 3`.
 *      - `.roll-card-helpers` block visible, containing
 *        `button[data-action="synergy"][data-helper-id=altId]`.
 *      - `flags.tb2e.helperSynergy` is absent (pre-click).
 *      - Alt actor baseline: `fate.current === 3`, `fate.spent === 0`,
 *        `skills.fighter.pass === 0`.
 *   4. Click synergy button on card → `_handleSynergy` (GM branch) runs
 *      `_processSynergy`. Assert after re-render:
 *      - `fate.current === 2` (deducted 1).
 *      - `fate.spent === 1`.
 *      - `skills.fighter.pass === 1` (logged via _logAdvancement at
 *        tb2e-roll.mjs L192-204; advancement threshold for rating 2 is
 *        pass=2 per advancement table — we're well below the cap).
 *      - `flags.tb2e.helperSynergy.<altId> === true`.
 *      - Card re-rendered with synergy button count 0 (helper filtered
 *        out of `synergyHelpers` per tb2e-roll.mjs L1551).
 *      - `flags.tb2e.pendingSynergy` on alt actor is absent (GM direct
 *        path never writes the mailbox — that's Scenario B).
 *
 * (B) Mailbox-path synergy:
 *   1. Re-stage a fresh conflict (independent test) — dialog + submit
 *      produces the same roll-result card.
 *   2. Instead of clicking the chat-card synergy button, write the
 *      mailbox flag directly via `actor.update({"flags.tb2e.pendingSynergy":
 *      { messageId }})` on alt — the same idiom L501/L503/L504 use for
 *      `pendingConflictHP`. This simulates a non-GM player clicking the
 *      synergy button (module/dice/post-roll.mjs L399-401).
 *   3. Poll for the GM hook (tb2e.mjs L185-188 → `processSynergyMailbox`
 *      post-roll.mjs L466-471) to:
 *      - Drain the mailbox (alt's `pendingSynergy` flag cleared).
 *      - Deduct fate (alt.fate.current drops by 1).
 *      - Log advancement (alt.skills.fighter.pass === 1).
 *      - Mark message processed (`flags.tb2e.helperSynergy.<altId> ===
 *        true`).
 *
 * Both scenarios converge on `_processSynergy` — B proves the mailbox
 * pattern is wired correctly (flag detection + drain + clear), A proves
 * the direct-GM path yields the same end state.
 *
 * ---------------------------------------------------------------------------
 * Explicit non-scope
 * ---------------------------------------------------------------------------
 *   - L521 unscripted-teammate helping mechanics (this spec's alt IS
 *     scripted on V1, but the helping itself is standard — both
 *     scripted and unscripted teammates can help per DH p.63, and
 *     `memberCombatants` at conflict-panel.mjs L1970-1972 doesn't filter
 *     by scripting). Alt's help here is the standard same-skill path,
 *     NOT a distinct "unscripted helping" surface. L521 owns the
 *     unscripted-from-different-volley coverage.
 *   - L522 Fate: Luck (reroll 6s post-roll) — a different fate spend.
 *   - L523 Persona in conflict — a different artha spend.
 *   - Versus-mode conflict rolls (attack vs defend) — synergy flows
 *     through `_handleVersusRoll` at tb2e-roll.mjs L1566+ which also
 *     builds `synergyHelpers` (L1589), but the versus resolution card
 *     is a separate surface. We use attack-vs-attack INDEPENDENT here
 *     so the spec isolates synergy's code path from versus finalization.
 *
 * All Playwright sessions authenticate as GM (tests/e2e/auth.setup.mjs).
 * The GM-gated hook at tb2e.mjs L186 fires synchronously in-session for
 * the mailbox scenario.
 */

const MONSTER_PACK_ID = 'tb2e.monsters';

async function importMonster(page, { sourceName, uniqueName, tag }) {
  return page.evaluate(
    async ({ pId, src, name, t }) => {
      const pack = game.packs.get(pId);
      if ( !pack ) throw new Error(`Pack not found: ${pId}`);
      const docs = await pack.getDocuments();
      const source = docs.find((d) => d.name === src);
      if ( !source ) throw new Error(`Source "${src}" not in pack ${pId}`);
      const data = source.toObject();
      data.name = name;
      data.flags = {
        ...(data.flags ?? {}),
        tb2e: { ...(data.flags?.tb2e ?? {}), e2eTag: t }
      };
      const created = await Actor.implementation.create(data);
      return created.id;
    },
    { pId: MONSTER_PACK_ID, src: sourceName, name: uniqueName, t: tag }
  );
}

/**
 * Create a character with enough scaffolding to act as a conflict roller:
 * positive fighter rating for the attack pool, health>0 for hp.max seeding
 * via distributeDisposition, fate and persona SchemaFields explicit so the
 * values don't fall back to defaults that might drift.
 */
async function createCharacter(page, { name, tag, fighter, fate }) {
  return page.evaluate(
    async ({ n, t, f, fp }) => {
      const actor = await Actor.implementation.create({
        name: n,
        type: 'character',
        flags: { tb2e: { e2eTag: t } },
        system: {
          abilities: {
            health: { rating: 4, pass: 0, fail: 0 },
            will:   { rating: 4, pass: 0, fail: 0 },
            nature: { rating: 3, max: 3, pass: 0, fail: 0 }
          },
          skills: {
            fighter: { rating: f, pass: 0, fail: 0 }
          },
          fate: { current: fp, spent: 0 },
          persona: { current: 0, spent: 0 },
          conditions: { fresh: false, afraid: false, dead: false, angry: false }
        }
      });
      return actor.id;
    },
    { n: name, t: tag, f: fighter, fp: fate }
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

/**
 * Drive the panel through setup → disposition → weapons → scripting →
 * resolve for a Kill conflict with the given actors. Returns the combatId,
 * group ids, and per-combatant ids so the caller can exercise the V0
 * attack-vs-attack roll.
 *
 * Staging is identical across scenarios A/B — extracting to a helper keeps
 * each scenario focused on the synergy path under test.
 */
async function stageKillConflict(page, {
  panel, tracker, captainId, altId, monAId, monBId
}) {
  await tracker.open();
  await tracker.clickCreateConflict();
  await expect
    .poll(
      () => page.evaluate(() => {
        const c = game.combats.find((x) => x.isConflict);
        return c ? c.groups.size : 0;
      }),
      { timeout: 10_000 }
    )
    .toBe(2);
  const { combatId, partyGroupId, gmGroupId } = await page.evaluate(() => {
    const c = game.combats.find((x) => x.isConflict);
    const g = Array.from(c.groups);
    return { combatId: c.id, partyGroupId: g[0].id, gmGroupId: g[1].id };
  });

  await panel.open();
  expect(await panel.activeTabId()).toBe('setup');

  const cmb = {};
  cmb.captain = await panel.addCombatant({
    combatId, actorId: captainId, groupId: partyGroupId
  });
  cmb.alt = await panel.addCombatant({
    combatId, actorId: altId, groupId: partyGroupId
  });
  cmb.monA = await panel.addCombatant({
    combatId, actorId: monAId, groupId: gmGroupId
  });
  cmb.monB = await panel.addCombatant({
    combatId, actorId: monBId, groupId: gmGroupId
  });
  await expect(panel.setupCombatants).toHaveCount(4);

  await panel.clickCaptainButton(cmb.captain);
  await panel.clickCaptainButton(cmb.monA);
  await panel.selectConflictType('kill');

  await expect(panel.beginDispositionButton).toBeEnabled();
  await panel.clickBeginDisposition();

  // Flat disposition — nobody starts KO'd so alt qualifies as a helper.
  await page.evaluate(async ({ cId, pId, gId }) => {
    const c = game.combats.get(cId);
    await c.storeDispositionRoll(pId, {
      rolled: 7, diceResults: [], cardHtml: '<em>E2E</em>'
    });
    await c.storeDispositionRoll(gId, {
      rolled: 8, diceResults: [], cardHtml: '<em>E2E</em>'
    });
  }, { cId: combatId, pId: partyGroupId, gId: gmGroupId });

  await page.evaluate(async ({ cId, pId, gId, capId, aId, mAId, mBId }) => {
    const c = game.combats.get(cId);
    const party = {}; party[capId] = 4; party[aId] = 3;
    const gm = {};    gm[mAId] = 4; gm[mBId] = 4;
    await c.distributeDisposition(pId, party);
    await c.distributeDisposition(gId, gm);
  }, {
    cId: combatId,
    pId: partyGroupId,
    gId: gmGroupId,
    capId: cmb.captain,
    aId: cmb.alt,
    mAId: cmb.monA,
    mBId: cmb.monB
  });

  await expect(panel.beginWeaponsButton).toBeEnabled();
  await panel.clickBeginWeapons();

  await page.evaluate(async ({ cId, ids }) => {
    const c = game.combats.get(cId);
    for ( const id of ids ) await c.setWeapon(id, 'Fists', '__unarmed__');
  }, {
    cId: combatId,
    ids: [cmb.captain, cmb.alt, cmb.monA, cmb.monB]
  });

  await expect(panel.beginScriptingButton).toBeEnabled();
  await panel.clickBeginScripting();

  // Party V0=attack/captainA — the ROLLER on V0 so `memberCombatants`
  // (conflict-panel.mjs L1970-1972) excludes captainA and includes alt.
  // Alt scripted on V1/V2 as filler so lockActions gate opens — their
  // scripted role on other volleys does NOT prevent them from helping V0
  // (memberCombatants is filtered by group + roller-exclusion only).
  const partyActions = [
    { action: 'attack', combatantId: cmb.captain },
    { action: 'defend', combatantId: cmb.alt },
    { action: 'feint',  combatantId: cmb.captain }
  ];
  // GM V0=attack too — `attack:attack` is **independent** (config.mjs
  // L408) so both sides roll vs Ob 0 with no versus-resolution card.
  const gmActions = [
    { action: 'attack', combatantId: cmb.monA },
    { action: 'defend', combatantId: cmb.monB },
    { action: 'defend', combatantId: cmb.monA }
  ];
  /* ---------- Script + lock + resolve ---------- */

  await scriptAndLockActions(page, {
    combatId, partyGroupId, gmGroupId, partyActions, gmActions
  });

  await expect.poll(() => panel.activeTabId()).toBe('resolve');

  // Reveal V0 so the roll-action button becomes visible.
  await panel
    .resolveAction(0)
    .locator('button[data-action="revealAction"]')
    .click();

  await expect
    .poll(() => page.evaluate(({ cId }) => {
      const c = game.combats.get(cId);
      const round = c.system.rounds?.[c.system.currentRound];
      return round?.volleys?.[0]?.revealed ?? null;
    }, { cId: combatId }))
    .toBe(true);

  return { combatId, partyGroupId, gmGroupId, cmb };
}

test.describe("§19 Conflict: Team — teammate synergy on a conflict action roll (SG p.87, TEST_PLAN L520)", () => {
  test.afterEach(async ({ page }) => {
    // Restore PRNG + close panel between runs.
    await page.evaluate(() => {
      if ( globalThis.__tb2eE2EPrevRandomUniform ) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
      try { game.tb2e?.conflictPanel?.close(); } catch {}
    });
    await page.evaluate(async () => {
      const ids = Array.from(game.combats ?? []).map((c) => c.id);
      if ( ids.length ) await Combat.deleteDocuments(ids);
    });
    // Clear chat so synergy-button count assertions in sibling iterations
    // don't pick up prior-run cards (stale `data-helper-id` values would
    // still be there, pointing at deleted actors).
    await page.evaluate(async () => {
      const mids = game.messages.contents.map((m) => m.id);
      if ( mids.length ) await ChatMessage.deleteDocuments(mids);
    });
  });

  test(
    'GM-direct synergy: helper earns advancement and spends 1 fate when the chat-card synergy button is clicked',
    async ({ page }, testInfo) => {
      const tag = `e2e-team-syn-gm-${testInfo.parallelIndex}-${Date.now()}`;
      const stamp = Date.now();
      const captainName = `E2E SynCap ${stamp}`;
      const altName = `E2E SynAlt ${stamp}`;
      const monAName = `E2E SynBugbear ${stamp}`;
      const monBName = `E2E SynGoblin ${stamp}`;

      await page.goto('/game');
      const ui = new GameUI(page);
      await ui.waitForReady();
      await ui.dismissTours();
      expect(await page.evaluate(() => game.user.isGM)).toBe(true);

      try {
        /* ---------- Arrange actors ---------- */

        const captainId = await createCharacter(page, {
          name: captainName, tag, fighter: 3, fate: 0
        });
        const altId = await createCharacter(page, {
          name: altName, tag, fighter: 2, fate: 3
        });
        const monAId = await importMonster(page, {
          sourceName: 'Bugbear', uniqueName: monAName, tag
        });
        const monBId = await importMonster(page, {
          sourceName: 'Goblin', uniqueName: monBName, tag
        });

        /* ---------- Stage Kill conflict through scripting → reveal V0 ---------- */

        const tracker = new ConflictTracker(page);
        const panel = new ConflictPanel(page);
        const { combatId, partyGroupId } = await stageKillConflict(page, {
          panel, tracker, captainId, altId, monAId, monBId
        });

        /* ---------- Control: baseline pool + candidate shape ---------- */

        // Alt qualifies as a candidate via the same-skill path (help.mjs
        // L281-289) BEFORE any synergy action — this pins the pool so
        // the synergy assertion isolates the +1D attribution.
        const preHelperPool = await page.evaluate(
          async ({ cId, pId, capId }) => {
            const { getEligibleHelpers } = await import(
              '/systems/tb2e/module/dice/help.mjs'
            );
            const combat = game.combats.get(cId);
            const rollerActor = game.actors.get(capId);
            const candidates = combat.combatants
              .filter((c) => c._source.group === pId)
              .filter((c) => c.actor && c.actor.id !== rollerActor.id);
            const helpers = getEligibleHelpers({
              actor: rollerActor,
              type: 'skill',
              key: 'fighter',
              testContext: { isConflict: true, candidates },
              candidates
            });
            return helpers.map((h) => ({
              id: h.id, helpVia: h.helpVia, helpViaType: h.helpViaType,
              hasFate: h.hasFate
            }));
          },
          { cId: combatId, pId: partyGroupId, capId: captainId }
        );
        expect(preHelperPool).toEqual([
          { id: altId, helpVia: 'fighter', helpViaType: 'skill', hasFate: true }
        ]);

        /* ---------- PRNG stub: all-6s ---------- */

        // With pool = fighter(3) − 1 unarmed + 1 help = 3 dice, all-6s →
        // 3 successes vs Ob 0 → pass. Per SG p.87, pass path bumps the
        // helper's `skills.<helpVia>.pass` on synergy spend.
        await page.evaluate(() => {
          globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
          CONFIG.Dice.randomUniform = () => 0.001;
        });

        /* ---------- Act 1: open dialog, engage synergy, submit ---------- */

        const chatCountBeforeRoll = await page.evaluate(
          () => game.messages.contents.length
        );

        const attackRollBtn = panel
          .resolveAction(0)
          .locator(`button[data-action="rollAction"][data-group-id="${partyGroupId}"]`);
        await expect(attackRollBtn).toBeVisible();
        await attackRollBtn.click();

        const dialog = new RollDialog(page);
        await dialog.waitForOpen();

        // Baseline: fighter=3 − 1 unarmed = 2D. The `-1 unarmed` modifier
        // is pushed at conflict-panel.mjs L1944-1948.
        expect(await dialog.getSummaryPool()).toBe(2);
        expect(await dialog.modeInput.inputValue()).toBe('independent');
        expect(await dialog.getObstacle()).toBe(0);

        // Click the star-icon synergy button on alt's row. The production
        // handler (tb2e-roll.mjs L690-708) auto-engages the help toggle
        // and adds `.synergy-active`. After the click:
        //   - alt's `.helper-toggle` is `.active` → helperBonus bumps by
        //     1 (tb2e-roll.mjs L703) → updateSummary re-reads pool.
        //   - row carries `.synergy-active` class (L707) → on submit,
        //     `selectedHelpers[i].synergy = true` at L1122.
        await dialog.toggleHelperSynergy(altId);
        expect(await dialog.getSummaryPool()).toBe(3);

        await dialog.submit();

        /* ---------- Locate the roll-result chat message ---------- */

        const messageId = await page.evaluate(async ({ actorId, base }) => {
          const started = Date.now();
          while ( Date.now() - started < 10_000 ) {
            const tail = game.messages.contents.slice(base);
            const msg = tail.find((m) => {
              const tc = m.flags?.tb2e?.testContext;
              return tc?.isConflict
                && tc.conflictAction === 'attack'
                && m.flags?.tb2e?.actorId === actorId;
            });
            if ( msg ) return msg.id;
            await new Promise((r) => setTimeout(r, 100));
          }
          return null;
        }, { actorId: captainId, base: chatCountBeforeRoll });
        expect(messageId).toBeTruthy();

        /* ---------- Assertions on the freshly-posted roll card ---------- */

        const rollFlags = await page.evaluate((mid) => {
          const msg = game.messages.get(mid);
          return {
            helpers: msg.flags.tb2e.helpers,
            helperSynergy: msg.flags.tb2e.helperSynergy ?? null,
            testContext: {
              isConflict: !!msg.flags.tb2e.testContext?.isConflict,
              conflictAction: msg.flags.tb2e.testContext?.conflictAction ?? null,
              groupId: msg.flags.tb2e.testContext?.groupId ?? null
            },
            roll: {
              pass: msg.flags.tb2e.roll?.pass ?? null,
              successes: msg.flags.tb2e.roll?.successes ?? null,
              finalSuccesses: msg.flags.tb2e.roll?.finalSuccesses ?? null,
              obstacle: msg.flags.tb2e.roll?.obstacle ?? null,
              poolSize: msg.flags.tb2e.roll?.poolSize ?? null
            }
          };
        }, messageId);

        expect(rollFlags.testContext).toEqual({
          isConflict: true,
          conflictAction: 'attack',
          groupId: partyGroupId
        });
        // Pool = 3 (fighter 3 − 1 unarmed + 1 help) and all-6s stub → 3
        // successes vs Ob 0 → pass.
        expect(rollFlags.roll).toEqual({
          pass: true,
          successes: 3,
          finalSuccesses: 3,
          obstacle: 0,
          poolSize: 3
        });
        // Helper record carries synergy: true — the chat card will
        // render the synergy button for alt.
        expect(rollFlags.helpers).toEqual([
          expect.objectContaining({
            id: altId,
            helpVia: 'fighter',
            helpViaType: 'skill',
            synergy: true
          })
        ]);
        // Not yet processed — helperSynergy map is empty/absent.
        expect(rollFlags.helperSynergy).toBeFalsy();

        /* ---------- Alt baseline state (pre-synergy-spend) ---------- */

        const altBefore = await page.evaluate((id) => {
          const a = game.actors.get(id);
          return {
            fateCurrent: a.system.fate.current,
            fateSpent: a.system.fate.spent,
            fighterPass: a.system.skills.fighter.pass,
            fighterFail: a.system.skills.fighter.fail,
            pendingSynergy: a.getFlag('tb2e', 'pendingSynergy') ?? null
          };
        }, altId);
        expect(altBefore).toEqual({
          fateCurrent: 3,
          fateSpent: 0,
          fighterPass: 0,
          fighterFail: 0,
          pendingSynergy: null
        });

        /* ---------- Act 2: click synergy button on the chat card ---------- */

        // Scope to THIS message, not the "last roll card" — prior reveal
        // chat messages also live in the log. Filter the default
        // RollChatCard locator to the specific message id.
        const card = new RollChatCard(page);
        // Override root to the specific chat message by id.
        card.root = page
          .locator(`li.chat-message[data-message-id="${messageId}"] .tb2e-chat-card`)
          .filter({ has: page.locator('.roll-card-breakdown') })
          .first();
        card.synergySection = card.root.locator('.roll-card-helpers');

        await expect(card.root).toBeVisible();
        await expect(card.synergySection).toHaveCount(1);
        const synergyBtn = card.root.locator(
          `.roll-card-helpers button[data-action="synergy"][data-helper-id="${altId}"]`
        );
        await expect(synergyBtn).toHaveCount(1);

        // Dispatch native click — same pattern as clickFinalize /
        // clickFateLuck. The handler (post-roll.mjs L40 via
        // activatePostRollListeners) checks `game.user.isGM` (L397) and
        // runs `_processSynergy` directly since we auth as GM.
        await synergyBtn.evaluate((el) => el.click());

        /* ---------- Act 3: poll end state ---------- */

        // Alt: -1 fate.current, +1 fate.spent, +1 skills.fighter.pass.
        await expect
          .poll(
            () => page.evaluate((id) => {
              const a = game.actors.get(id);
              return {
                fateCurrent: a.system.fate.current,
                fateSpent: a.system.fate.spent,
                fighterPass: a.system.skills.fighter.pass
              };
            }, altId),
            { timeout: 10_000 }
          )
          .toEqual({ fateCurrent: 2, fateSpent: 1, fighterPass: 1 });

        // Message: `flags.tb2e.helperSynergy.<altId> === true` (post-
        // roll.mjs L444-446).
        await expect
          .poll(
            () => page.evaluate((mid) => {
              const msg = game.messages.get(mid);
              return msg?.flags?.tb2e?.helperSynergy ?? null;
            }, messageId),
            { timeout: 10_000 }
          )
          .toMatchObject({ [altId]: true });

        // Card re-rendered — synergy button gone (filtered out via
        // `_buildSynergyHelpers` at tb2e-roll.mjs L1551: `!helperSynergy
        // [h.id]`).
        await expect(synergyBtn).toHaveCount(0, { timeout: 10_000 });

        // GM-direct path never touches the mailbox flag on alt.
        expect(await page.evaluate((id) =>
          game.actors.get(id).getFlag('tb2e', 'pendingSynergy') ?? null, altId)
        ).toBeNull();
      } finally {
        await cleanupTaggedActors(page, tag);
      }
    }
  );

  test(
    'Mailbox synergy: pendingSynergy flag on helper actor drains to _processSynergy via GM hook',
    async ({ page }, testInfo) => {
      const tag = `e2e-team-syn-mb-${testInfo.parallelIndex}-${Date.now()}`;
      const stamp = Date.now();
      const captainName = `E2E SynCapMB ${stamp}`;
      const altName = `E2E SynAltMB ${stamp}`;
      const monAName = `E2E SynBugbearMB ${stamp}`;
      const monBName = `E2E SynGoblinMB ${stamp}`;

      await page.goto('/game');
      const ui = new GameUI(page);
      await ui.waitForReady();
      await ui.dismissTours();
      expect(await page.evaluate(() => game.user.isGM)).toBe(true);

      try {
        const captainId = await createCharacter(page, {
          name: captainName, tag, fighter: 3, fate: 0
        });
        const altId = await createCharacter(page, {
          name: altName, tag, fighter: 2, fate: 3
        });
        const monAId = await importMonster(page, {
          sourceName: 'Bugbear', uniqueName: monAName, tag
        });
        const monBId = await importMonster(page, {
          sourceName: 'Goblin', uniqueName: monBName, tag
        });

        const tracker = new ConflictTracker(page);
        const panel = new ConflictPanel(page);
        const { combatId, partyGroupId } = await stageKillConflict(page, {
          panel, tracker, captainId, altId, monAId, monBId
        });

        await page.evaluate(() => {
          globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
          CONFIG.Dice.randomUniform = () => 0.001;
        });

        /* ---------- Roll with synergy-marked help ---------- */

        const chatCountBeforeRoll = await page.evaluate(
          () => game.messages.contents.length
        );

        const attackRollBtn = panel
          .resolveAction(0)
          .locator(`button[data-action="rollAction"][data-group-id="${partyGroupId}"]`);
        await attackRollBtn.click();

        const dialog = new RollDialog(page);
        await dialog.waitForOpen();
        await dialog.toggleHelperSynergy(altId);
        expect(await dialog.getSummaryPool()).toBe(3);
        await dialog.submit();

        const messageId = await page.evaluate(async ({ actorId, base }) => {
          const started = Date.now();
          while ( Date.now() - started < 10_000 ) {
            const tail = game.messages.contents.slice(base);
            const msg = tail.find((m) => {
              const tc = m.flags?.tb2e?.testContext;
              return tc?.isConflict
                && tc.conflictAction === 'attack'
                && m.flags?.tb2e?.actorId === actorId;
            });
            if ( msg ) return msg.id;
            await new Promise((r) => setTimeout(r, 100));
          }
          return null;
        }, { actorId: captainId, base: chatCountBeforeRoll });
        expect(messageId).toBeTruthy();

        // Baseline for alt before mailbox drain.
        const altBefore = await page.evaluate((id) => {
          const a = game.actors.get(id);
          return {
            fateCurrent: a.system.fate.current,
            fighterPass: a.system.skills.fighter.pass,
            pendingSynergy: a.getFlag('tb2e', 'pendingSynergy') ?? null
          };
        }, altId);
        expect(altBefore).toEqual({
          fateCurrent: 3, fighterPass: 0, pendingSynergy: null
        });

        /* ---------- Act: write the mailbox flag directly ---------- */

        // Simulates the non-GM branch of `_handleSynergy` (post-roll.mjs
        // L399-401): `actor.setFlag("tb2e", "pendingSynergy", { messageId
        // })`. We use the bundled `actor.update({"flags.tb2e.pending
        // Synergy": {...}})` idiom (matches L501/L503/L504 for
        // `pendingConflictHP`) so the hook at tb2e.mjs L187-188 sees the
        // key in the `changes` diff. setFlag would also work, but the
        // `changes` diff shape is what the hook checks.
        await page.evaluate(async ({ id, mid }) => {
          const actor = game.actors.get(id);
          await actor.update({
            'flags.tb2e.pendingSynergy': { messageId: mid }
          });
        }, { id: altId, mid: messageId });

        /* ---------- Act 2: poll hook drain ---------- */

        // GM hook: tb2e.mjs L185-188 fires `processSynergyMailbox` which
        // runs `_processSynergy` (fate spend + advancement) and then
        // `unsetFlag("tb2e", "pendingSynergy")` at post-roll.mjs L470.
        await expect
          .poll(
            () => page.evaluate((id) =>
              game.actors.get(id).getFlag('tb2e', 'pendingSynergy') ?? null,
              altId
            ),
            { timeout: 10_000, message: 'pendingSynergy mailbox should be drained by GM hook' }
          )
          .toBeNull();

        // Alt end state — same as GM-direct path.
        await expect
          .poll(
            () => page.evaluate((id) => {
              const a = game.actors.get(id);
              return {
                fateCurrent: a.system.fate.current,
                fateSpent: a.system.fate.spent,
                fighterPass: a.system.skills.fighter.pass
              };
            }, altId),
            { timeout: 10_000 }
          )
          .toEqual({ fateCurrent: 2, fateSpent: 1, fighterPass: 1 });

        // Message marked processed.
        await expect
          .poll(
            () => page.evaluate((mid) => {
              const msg = game.messages.get(mid);
              return msg?.flags?.tb2e?.helperSynergy ?? null;
            }, messageId),
            { timeout: 10_000 }
          )
          .toMatchObject({ [altId]: true });
      } finally {
        await cleanupTaggedActors(page, tag);
      }
    }
  );
});
