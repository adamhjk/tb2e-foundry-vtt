import { test, expect } from '../test.mjs';
import { scriptAndLockActions } from '../helpers/conflict-scripting.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §19 Conflict: Team, Helping, Artha — an UNSCRIPTED teammate can help a
 * scripted action (TEST_PLAN L521).
 *
 * ---------------------------------------------------------------------------
 * Rules as written — Scholar's Guide p.71 ("Helping Your Team")
 * ---------------------------------------------------------------------------
 * "Characters, apprentices, companions and minions may help if they have
 *  the ability or skill listed for the current action. The game master
 *  can also approve another relevant skill to be used to help.
 *    - Help grants +1D to the player who is rolling for this action.
 *    - One can help even if one hasn't been assigned an action.
 *    - One cannot help if one is knocked out of the conflict."
 *
 * ("../reference/rules/helping-conflict/scholars-guide-helping-conflict.md"
 *  L34-41; the "even if one hasn't been assigned an action" bullet — L39 —
 *  is exactly this checkbox's scope.)
 *
 * SG p.71 also notes: "If a team has more than three characters, three of
 * them act this round. The others can help." — the staging models this
 * rule directly: the party has two characters, captainA is scripted on
 * ALL three of V0/V1/V2 (a valid "team of one" scripting per SG p.71 bullet
 * 1 of Team Actions), and altHelper takes NO action slot in this round,
 * yet is still a legal helper by SG p.71 L39.
 *
 * ---------------------------------------------------------------------------
 * Scope distinction vs L520 (team-synergy) and L504 (help-blocked-when-ko)
 * ---------------------------------------------------------------------------
 * L520 (team-synergy): alt IS scripted on V1/V2 and helps V0 via the
 *   synergy path. Coupled help+synergy (tb2e-roll.mjs L695-705).
 * L504 (hp-help-blocked-when-ko): alt IS scripted on a filler slot and is
 *   KO'd, proving the `conflictHP.value <= 0` gate at help.mjs L57 fires
 *   through the conflict-specific `candidates` entry path.
 * THIS spec (L521): alt is NOT scripted on ANY volley this round, and
 *   helps V0 without synergy. Proves the `memberCombatants` filter at
 *   conflict-panel.mjs L1970-1972 (group + roller-exclusion only) has NO
 *   scripting filter — unscripted teammates qualify.
 *
 * If a future refactor added a `c.system.actions[volleyIndex]?.combatantId
 * === c.id` filter to `memberCombatants` (e.g. to enforce "only scripted
 * teammates can help"), L520 and L504 would still pass (their alts ARE
 * scripted on some filler slot), but THIS spec would fail — catching the
 * regression on the "unscripted helper" surface specifically.
 *
 * ---------------------------------------------------------------------------
 * Production path — call graph
 * ---------------------------------------------------------------------------
 * Conflict action roll (attack on V0) →
 *   `#onRollAction` (conflict-panel.mjs L1847+) — builds `memberCombatants`
 *   at L1970-1972:
 *     ```
 *     const groupMembers = combat.combatants.filter(c => c._source.group === groupId);
 *     const memberCombatants = groupMembers
 *       .filter(c => c.id !== combatantId && c.actor);
 *     ```
 *   That filter is purely group + roller-exclusion. No scripting check. So
 *   alt (who never appears in `round.actions[partyGroupId]`) is still in
 *   `memberCombatants` after the filter.
 * → `rollTest({... testContext: { isConflict, candidates: memberCombatants } })`
 * → `getEligibleHelpers` (help.mjs L76-150): `candidates` provided →
 *   scene-token walk bypassed (L84-85). For alt (fighter=2), the
 *   `_findSkillHelpPath` "same-skill" branch at L281-289 fires — `skills
 *   .fighter.rating > 0` → helper record `{ id: altId, helpVia: 'fighter',
 *   helpViaType: 'skill', ... }`.
 * → `_showRollDialog` renders `.roll-dialog-helpers` with `.helper-row
 *   [data-helper-id=altId]` + `.helper-toggle[data-helper-id=altId]`
 *   (roll-dialog.hbs L215-216).
 * → Click `.helper-toggle` (POM `toggleHelper`, NOT `toggleHelperSynergy`
 *   — L521 is help without synergy per its scope). Handler at
 *   tb2e-roll.mjs L669-686: adds `.active` to the toggle, bumps
 *   `helperBonus` by 1, re-renders summary → pool bumps +1.
 * → On submit (L1114-1124): `selectedHelpers` includes alt with `synergy:
 *   false` (derived from row NOT having `.synergy-active` class).
 * → `_handleIndependentRoll` (tb2e-roll.mjs L1487-1540) posts roll-result
 *   card with `flags.tb2e.helpers[0] = { id: altId, helpVia: 'fighter',
 *   helpViaType: 'skill', synergy: false, name }` (via mapHelpersForFlags
 *   at roll-utils.mjs L164-168).
 * → `_buildSynergyHelpers` filters `h.synergy` — alt is excluded → the
 *   `.roll-card-helpers` section is NOT rendered (tb2e-roll.mjs L1549-1551).
 *
 * ---------------------------------------------------------------------------
 * Staging
 * ---------------------------------------------------------------------------
 * Kill conflict (config.mjs L202-211 — attack → skill:fighter):
 *   - Party: captainA (fighter=3, health=4, the ROLLER on V0/V1/V2) +
 *     altHelper (fighter=2, health=3, the UNSCRIPTED helper).
 *   - GM: Bugbear captain + Goblin mook (monsters, different group — not
 *     in the party helper candidate pool per group filter at conflict-
 *     panel.mjs L1970).
 *   - All unarmed via `__unarmed__` (conflict-panel.mjs L1944-1948 bakes
 *     a -1D "Fists" modifier).
 *   - **Party scripting: captainA on ALL three volleys** — alt has NO
 *     scripted action this round. This matches the "one can help even if
 *     one hasn't been assigned an action" SG p.71 rule directly.
 *     `#applyLockActions` at combat.mjs L534 requires `actions.length === 3
 *     && every(a => a.action && a.combatantId)` — no uniqueness constraint
 *     on combatantId, so captain-x3 is a valid lock.
 *   - GM scripting: monA attacks V0 (attack:attack INDEPENDENT per
 *     config.mjs L408 — no versus chain), filler for V1/V2.
 *   - Flat disposition (captainA HP=4, alt HP=3, monA HP=4, monB HP=4)
 *     so nobody starts KO'd — the help.mjs L57 KO gate is green.
 *
 * PRNG stub: `CONFIG.Dice.randomUniform = () => 0.001` → all-6s. With
 * pool = fighter(3) - 1 unarmed + 1 help = 3 dice, captainA's attack
 * passes Ob 0 with 3 successes. A submission we can read cleanly.
 *
 * ---------------------------------------------------------------------------
 * Concrete assertions
 * ---------------------------------------------------------------------------
 * (1) Pre-roll fixture control — direct `getEligibleHelpers` call mirroring
 *     `#onRollAction`'s `memberCombatants` build returns
 *     `[{ id: altActorId, helpVia: 'fighter', helpViaType: 'skill' }]`.
 *     Same shape as L504's control but with alt UNSCRIPTED — proves the
 *     `memberCombatants` filter doesn't gate on scripting state.
 * (2) Alt's V0 action slot assertion — `round.actions[partyGroupId][0]
 *     .combatantId === captainActorId` (party's scripted captainA x3);
 *     alt's actor id does NOT appear in ANY of `round.actions[partyGroupId]`
 *     — proves alt is genuinely "unassigned this round" per SG p.71 L39.
 * (3) Roll dialog opens with `.helper-toggle[data-helper-id=altId]` present
 *     AND in the un-toggled state (no `.active` class). This is the
 *     structural shape the dialog renders for an unscripted teammate.
 * (4) Dialog baseline pool: `getSummaryPool() === 2` (fighter=3 - 1 unarmed).
 * (5) `toggleHelper(altId)` → `.helper-toggle` gains `.active`; summary pool
 *     bumps 2 → 3 via `helperBonus` increment (tb2e-roll.mjs L683).
 * (6) Submit → roll-result card posted. Assert:
 *     - `flags.tb2e.testContext = { isConflict: true, conflictAction:
 *       'attack', groupId: partyGroupId }`.
 *     - `flags.tb2e.roll = { pass: true, successes: 3, finalSuccesses: 3,
 *       obstacle: 0, poolSize: 3 }` (baseline 2 + 1 help).
 *     - `flags.tb2e.helpers[0] === { id: altId, helpVia: 'fighter',
 *       helpViaType: 'skill', synergy: false, name: <alt name> }` — the
 *       CORE L521 contract: helper metadata carries the unscripted helper.
 *     - `.roll-card-helpers` section has count 0 — `synergyHelpers` is
 *       empty (alt's `synergy === false`), so the synergy block is
 *       suppressed. This pins the help-without-synergy case cleanly and
 *       distinguishes L521's surface from L520's synergy surface.
 * (7) Alt's script state unchanged post-roll — alt still has NO action
 *     slot in `round.actions[partyGroupId]`. Helping does NOT consume an
 *     action slot per SG p.71 L39. Also asserts alt's skills.fighter.pass
 *     unchanged (helpers don't earn pass/fail pips from helping; only
 *     synergy (SG p.87) unlocks advancement — and we didn't use synergy).
 *
 * ---------------------------------------------------------------------------
 * Explicit non-scope
 * ---------------------------------------------------------------------------
 *   - Synergy path (L520 — coupled help+synergy + advancement logging via
 *     `_processSynergy`).
 *   - KO'd-helper gate (L160 for scene-token path, L504 for conflict-
 *     specific `candidates` path).
 *   - Versus mode (attack vs defend) — config.mjs L409's versus chain
 *     routes through `_handleVersusRoll` + finalization, a different
 *     surface. attack:attack isolates the synergy-free help path on an
 *     independent roll.
 *   - Fate/Persona spends (L522/L523).
 *
 * All Playwright sessions authenticate as GM (tests/e2e/auth.setup.mjs).
 * `rollTest` and `#onRollAction` handlers run synchronously in-session.
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
 * Create a character with enough scaffolding to act as a conflict roller
 * OR helper. Explicit `conditions.{afraid,dead} = false` so the earlier
 * branches of `isBlockedFromHelping` (help.mjs L54-55) don't fire — the
 * only possible filter reason for alt in this spec would be KO (help.mjs
 * L57), and alt is seeded with hp.max=3 > 0 and hp.value=3 via
 * distributeDisposition so that branch is green too.
 */
async function createCharacter(page, { name, tag, fighter }) {
  return page.evaluate(
    async ({ n, t, f }) => {
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
          conditions: { fresh: false, afraid: false, dead: false, angry: false }
        }
      });
      return actor.id;
    },
    { n: name, t: tag, f: fighter }
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

test.describe(
  "§19 Conflict: Team — unscripted teammate can help a scripted action (SG p.71, TEST_PLAN L521)",
  () => {
    test.afterEach(async ({ page }) => {
      // Restore PRNG + close panel + clear combats/chat between runs so no
      // stale synergy/roll cards bleed across sibling iterations.
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
      await page.evaluate(async () => {
        const mids = game.messages.contents.map((m) => m.id);
        if ( mids.length ) await ChatMessage.deleteDocuments(mids);
      });
    });

    test(
      'unscripted alt appears in helper pool and contributes +1D when toggled; no action slot consumed',
      async ({ page }, testInfo) => {
        const tag = `e2e-team-unscripted-${testInfo.parallelIndex}-${Date.now()}`;
        const stamp = Date.now();
        const captainName = `E2E UnsCap ${stamp}`;
        const altName = `E2E UnsAlt ${stamp}`;
        const monAName = `E2E UnsBugbear ${stamp}`;
        const monBName = `E2E UnsGoblin ${stamp}`;

        await page.goto('/game');
        const ui = new GameUI(page);
        await ui.waitForReady();
        await ui.dismissTours();
        expect(await page.evaluate(() => game.user.isGM)).toBe(true);

        try {
          /* ---------- Arrange actors ---------- */

          const captainId = await createCharacter(page, {
            name: captainName, tag, fighter: 3
          });
          const altId = await createCharacter(page, {
            name: altName, tag, fighter: 2
          });
          const monAId = await importMonster(page, {
            sourceName: 'Bugbear', uniqueName: monAName, tag
          });
          const monBId = await importMonster(page, {
            sourceName: 'Goblin', uniqueName: monBName, tag
          });

          /* ---------- Create conflict + resolve group ids ---------- */

          const tracker = new ConflictTracker(page);
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

          /* ---------- Setup tab ---------- */

          const panel = new ConflictPanel(page);
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

          /* ---------- Disposition: flat-set both sides ---------- */

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
            const gm = {};    gm[mAId]   = 4; gm[mBId]   = 4;
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

          /* ---------- Weapons: unarmed for everyone ---------- */

          await page.evaluate(async ({ cId, ids }) => {
            const c = game.combats.get(cId);
            for ( const id of ids ) await c.setWeapon(id, 'Fists', '__unarmed__');
          }, {
            cId: combatId,
            ids: [cmb.captain, cmb.alt, cmb.monA, cmb.monB]
          });

          await expect(panel.beginScriptingButton).toBeEnabled();
          await panel.clickBeginScripting();

          /* ---------- Scripting: captainA on ALL three volleys ---------- */

          // alt gets NO action slot — the core L521 staging. captainA on
          // V0/V1/V2 is accepted by `#applyLockActions` (combat.mjs L534)
          // because it only validates `length===3 && every(a.action &&
          // a.combatantId)` — no uniqueness constraint. This mirrors the
          // SG p.71 Team Actions rule "If a team has more than three
          // characters, three of them act this round. The others can help."
          // — alt is the "other" who doesn't act but can still help.
          const partyActions = [
            { action: 'attack', combatantId: cmb.captain },
            { action: 'defend', combatantId: cmb.captain },
            { action: 'feint',  combatantId: cmb.captain }
          ];
          // GM V0=attack → attack:attack INDEPENDENT (config.mjs L408).
          // Both sides roll vs Ob 0, no versus resolution card.
          const gmActions = [
            { action: 'attack', combatantId: cmb.monA },
            { action: 'defend', combatantId: cmb.monB },
            { action: 'defend', combatantId: cmb.monA }
          ];
          /* ---------- Script + lock (resolve deferred for pre-resolve assertions) ---------- */

          await scriptAndLockActions(page, {
            combatId, partyGroupId, gmGroupId, partyActions, gmActions,
            beginResolve: false
          });

          /* ---------- Assertion block 1: alt is UNSCRIPTED in round.actions ---------- */

          // Prove the staging: alt's combatantId appears in NONE of the
          // three party action slots. SG p.71 bullet "One can help even if
          // one hasn't been assigned an action" — alt is precisely that
          // unassigned teammate.
          const partyActionSlots = await page.evaluate(
            ({ cId, pId }) => {
              const c = game.combats.get(cId);
              const round = c.system.rounds?.[c.system.currentRound];
              return (round?.actions?.[pId] || []).map((a) => a?.combatantId);
            },
            { cId: combatId, pId: partyGroupId }
          );
          expect(partyActionSlots).toEqual([
            cmb.captain, cmb.captain, cmb.captain
          ]);
          expect(partyActionSlots).not.toContain(cmb.alt);

          /* ---------- Assertion block 2: fixture control on memberCombatants ---------- */

          // Direct `getEligibleHelpers` call mirroring conflict-panel.mjs
          // L1970-1972's `memberCombatants` build. The filter is group +
          // roller-exclusion only — NO scripting filter. If a future
          // refactor added `c.system.actions[0]?.combatantId === c.id` (or
          // anything referencing the current volley's script slot), this
          // assertion fails at staging, which is the regression surface.
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
                id: h.id, helpVia: h.helpVia, helpViaType: h.helpViaType
              }));
            },
            { cId: combatId, pId: partyGroupId, capId: captainId }
          );
          // Exactly one helper — alt, via same-skill match (help.mjs L281-289).
          expect(preHelperPool).toEqual([
            { id: altId, helpVia: 'fighter', helpViaType: 'skill' }
          ]);

          /* ---------- Transition to resolve phase + reveal V0 ---------- */

          await page.evaluate(async ({ cId }) => {
            const c = game.combats.get(cId);
            await c.beginResolve();
          }, { cId: combatId });

          await expect.poll(() => panel.activeTabId()).toBe('resolve');

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

          /* ---------- PRNG stub: all-6s (pass Ob 0 cleanly) ---------- */

          await page.evaluate(() => {
            globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
            CONFIG.Dice.randomUniform = () => 0.001;
          });

          /* ---------- Alt baseline (before roll) ---------- */

          const altBefore = await page.evaluate((id) => {
            const a = game.actors.get(id);
            return {
              fighterPass: a.system.skills.fighter.pass,
              fighterFail: a.system.skills.fighter.fail
            };
          }, altId);
          expect(altBefore).toEqual({ fighterPass: 0, fighterFail: 0 });

          /* ---------- Act: open dialog, toggle alt as helper, submit ---------- */

          const chatCountBeforeRoll = await page.evaluate(
            () => game.messages.contents.length
          );

          const attackRollBtn = panel
            .resolveAction(0)
            .locator(
              `button[data-action="rollAction"][data-group-id="${partyGroupId}"]`
            );
          await expect(attackRollBtn).toBeVisible();
          await attackRollBtn.click();

          const dialog = new RollDialog(page);
          await dialog.waitForOpen();

          // Dialog assertion 3: the helper toggle for the unscripted alt
          // IS rendered — this is what L521's checkbox is about. If the
          // `memberCombatants` filter had a scripting gate, this toggle
          // would be absent and the spec would fail here.
          const altToggle = dialog.helperToggle(altId);
          await expect(altToggle).toHaveCount(1);
          // Not yet active — render starts with toggle off (tb2e-roll.mjs
          // L669 `.helper-toggle` with no initial `.active`).
          await expect(altToggle).not.toHaveClass(/(^|\s)active(\s|$)/);

          // Dialog assertion 4: baseline pool = 2 (fighter 3 - 1 unarmed).
          expect(await dialog.getSummaryPool()).toBe(2);
          expect(await dialog.modeInput.inputValue()).toBe('independent');
          expect(await dialog.getObstacle()).toBe(0);

          // Dialog assertion 5: engage alt as helper (NOT synergy — just
          // help). POM `toggleHelper` expands the helpers section, clicks
          // the toggle, asserts `.active` ends up set. The handler at
          // tb2e-roll.mjs L669-686 bumps helperBonus and re-renders
          // summary; pool goes 2 → 3.
          await dialog.toggleHelper(altId);
          expect(await dialog.getSummaryPool()).toBe(3);

          await dialog.submit();

          /* ---------- Locate the roll-result chat message ---------- */

          const messageId = await page.evaluate(
            async ({ actorId, base }) => {
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
            },
            { actorId: captainId, base: chatCountBeforeRoll }
          );
          expect(messageId).toBeTruthy();

          /* ---------- Assertion block 6: roll-result card metadata ---------- */

          const rollFlags = await page.evaluate(
            ({ mid, altName }) => {
              const msg = game.messages.get(mid);
              return {
                helpers: msg.flags.tb2e.helpers,
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
                },
                altName // echo back so the helper-name assertion is safe
              };
            },
            { mid: messageId, altName }
          );

          expect(rollFlags.testContext).toEqual({
            isConflict: true,
            conflictAction: 'attack',
            groupId: partyGroupId
          });
          // Pool = 3 (fighter 3 - 1 unarmed + 1 help from alt) and all-6s
          // stub → 3 successes vs Ob 0 → pass.
          expect(rollFlags.roll).toEqual({
            pass: true,
            successes: 3,
            finalSuccesses: 3,
            obstacle: 0,
            poolSize: 3
          });
          // THE CORE L521 CONTRACT: helpers flag carries the unscripted
          // alt with synergy=false. If `memberCombatants` had a scripting
          // filter, alt would never have reached this array.
          expect(rollFlags.helpers).toEqual([
            {
              id: altId,
              name: altName,
              helpVia: 'fighter',
              helpViaType: 'skill',
              synergy: false
            }
          ]);

          /* ---------- Assertion block: .roll-card-helpers absent (no synergy) ---------- */

          // Since alt's `synergy === false`, `_buildSynergyHelpers`
          // (tb2e-roll.mjs L1549-1551) filters alt out → synergyHelpers
          // is empty → the `.roll-card-helpers` section is NOT rendered
          // by roll-result.hbs. This distinguishes L521's surface from
          // L520's synergy surface cleanly — helping without synergy
          // produces NO chat-card helper block.
          const synergySectionCount = await page
            .locator(
              `li.chat-message[data-message-id="${messageId}"] .roll-card-helpers`
            )
            .count();
          expect(synergySectionCount).toBe(0);

          /* ---------- Assertion block 7: alt's script state unchanged ---------- */

          // Helping does NOT consume an action slot (SG p.71 L39). Alt
          // remains genuinely unscripted after the roll: round.actions
          // [partyGroupId] still references only captainA across all
          // three volleys.
          const partyActionSlotsPostRoll = await page.evaluate(
            ({ cId, pId }) => {
              const c = game.combats.get(cId);
              const round = c.system.rounds?.[c.system.currentRound];
              return (round?.actions?.[pId] || []).map((a) => a?.combatantId);
            },
            { cId: combatId, pId: partyGroupId }
          );
          expect(partyActionSlotsPostRoll).toEqual([
            cmb.captain, cmb.captain, cmb.captain
          ]);
          expect(partyActionSlotsPostRoll).not.toContain(cmb.alt);

          // Alt's advancement state untouched — without synergy (SG p.87)
          // helpers don't log pass/fail pips. skills.fighter.pass stays
          // at the baseline 0 we seeded.
          const altAfter = await page.evaluate((id) => {
            const a = game.actors.get(id);
            return {
              fighterPass: a.system.skills.fighter.pass,
              fighterFail: a.system.skills.fighter.fail
            };
          }, altId);
          expect(altAfter).toEqual({ fighterPass: 0, fighterFail: 0 });
        } finally {
          await cleanupTaggedActors(page, tag);
        }
      }
    );
  }
);
