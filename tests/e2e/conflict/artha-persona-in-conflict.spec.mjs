import { test, expect } from '../test.mjs';
import { scriptAndLockActions } from '../helpers/conflict-scripting.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §19 Conflict: Team, Helping, Artha — spend Persona DURING a conflict roll;
 * verify the pre-roll +1D advantage bonus lands in the pool and that
 * persona.current/spent update correctly (TEST_PLAN L523).
 *
 * ---------------------------------------------------------------------------
 * Rules as written — Scholar's Guide p.88 ("Spending Persona → Advantage")
 * ---------------------------------------------------------------------------
 * "A player may spend up to three persona points on a single roll before
 *  throwing the dice. Each persona point adds +1D to the roll."
 * (../reference/rules/fate-persona/scholars-guide-fate-persona.md L163-165)
 *
 * This is a PRE-ROLL spend — the dialog's stepper commits before dice are
 * cast — distinct from the two POST-roll artha buttons on the chat card:
 *   - "Fate: Luck" (SG p.87, post-roll reroll-6s) — covered by L522 +
 *     §3 fate-reroll.
 *   - "Ah, Of Course!" (DH p.77, Persona post-roll wise-aid reroll-all-
 *     wyrms) — covered by §3 wise-aid-persona.
 *   - "Deeper Understanding" (SG p.87, Fate post-roll single-wyrm reroll)
 *     — covered by §3 persona-deeper-understanding (misnamed spec file;
 *     the production handler is `_handleDeeperUnderstanding`, a FATE
 *     spend, per post-roll.mjs L181-249).
 *
 * ---------------------------------------------------------------------------
 * Scope distinction — the conflict-specific surface for +1D Persona
 * ---------------------------------------------------------------------------
 * §3 has no equivalent spec: the generic pre-roll Persona Advantage stepper
 * is not tested elsewhere on the standalone-roll surface. L523 (this spec)
 * exercises it on the CONFLICT roll dialog path — the production code at
 * tb2e-roll.mjs L395-397 gates the `showPersona` template flag on
 * `isCharacter && !isResourcesOrCircles`, and attack rolls on a character
 * captain in a Kill conflict satisfy both predicates (the attack skill
 * is `fighter` per config.mjs L202-211, not resources/circles).
 *
 * The conflict surface distinguishes itself via:
 *   (a) the `testContext` seeded at conflict-panel.mjs L1974-1994 (full
 *       `{isConflict, candidates, conflictAction, combatId, combatantId,
 *       groupId, opponentGroupId, roundNum, volleyIndex}` shape) survives
 *       through `_buildRollFlags` at tb2e-roll.mjs L1461-1479 onto the
 *       chat message's `flags.tb2e.testContext`. Nothing on the pre-roll
 *       persona path mutates that, but the CONTEXT-PRESERVATION assertion
 *       is the same regression surface L522 owns: if a future refactor
 *       dropped `testContext` on the persona-spend path (e.g. via a full-
 *       object `flags.tb2e` replacement in `_applyPreRollActorChanges`
 *       or `_buildRollFlags`), this spec catches it on the conflict
 *       surface specifically.
 *   (b) attack:attack is INDEPENDENT per config.mjs L408 — both sides
 *       roll vs Ob 0 with no versus finalization — so the spec lands in
 *       `_handleIndependentRoll` (tb2e-roll.mjs L1487-1540), isolating
 *       the pre-roll persona surface from versus-mode chat flow (which
 *       would pipe through `_handleVersusRoll` + `_handleVersusFinalize`
 *       and is out of scope here).
 *
 * ---------------------------------------------------------------------------
 * Production path — call graph
 * ---------------------------------------------------------------------------
 * Click V0 `rollAction` button in the conflict panel →
 *   `#onRollAction` (conflict-panel.mjs L1847+) builds `memberCombatants`
 *   (L1970-1972), calls `rollTest` with `testContext` carrying full
 *   conflict metadata (L1978-1993).
 * → `rollTest` → `_showRollDialog` (tb2e-roll.mjs L376-1203). Dialog data
 *   prep sets `showPersona = isCharacter && !isResourcesOrCircles` at
 *   L395-397. `personaAvailable` is bound to `actor.system.persona.current`
 *   at L396 — the cap the stepper clamps against at L823/L835.
 *   Template renders the persona section (roll-dialog.hbs L163-199) when
 *   `showPersona` is true: the `+` stepper (`.persona-advantage .stepper-
 *   btn[data-delta='1']`) is wired at tb2e-roll.mjs L820-829 to clamp
 *   `personaState.advantage` into [0, min(3, personaAvailable − channel
 *   cost)], update the readout (`.stepper-value[data-field='persona
 *   Advantage']`), re-render the modifier list (including +1D source=
 *   'persona' for each advantage point — L606-613), and refresh the
 *   summary pool.
 * → Submit the dialog → `_applyPreRollActorChanges` (tb2e-roll.mjs L1369-
 *   1408) at L1327 computes `personaCost = advantage + (channelNature ?
 *   1 : 0)` (L1374). If > 0, writes `system.persona.current =
 *   max(0, current − cost)` (L1376) and `system.persona.spent = spent +
 *   cost` (L1377) via `actor.update(updates)` (L1398) — partial update
 *   keyed by dot-paths, so other actor state is untouched.
 * → `_buildRollFlags` (tb2e-roll.mjs L1414-1480) builds the message flags
 *   WITHOUT any dedicated persona-spend marker on the message (the spend
 *   is on the actor, not the card). The only persona-related message
 *   flag is `channelNature` (L1452) for Channel-Your-Nature — NOT
 *   applicable here. `flags.tb2e.roll.modifiers` preserves each +1D
 *   persona modifier verbatim (L1431 — `allModifiers.map(m => ({...m}))`),
 *   which is the on-card evidence of the advantage spend.
 * → `_handleIndependentRoll` (tb2e-roll.mjs L1487-1540) posts the roll-
 *   result card.
 *
 * ---------------------------------------------------------------------------
 * Staging
 * ---------------------------------------------------------------------------
 * Kill conflict (config.mjs L202-211 — attack rolls skill:fighter):
 *   - Party: captainA (fighter=3, health=4, FATE=0, PERSONA=2 — the ROLLER).
 *     Fate=0 so the -1 decrement test for persona is unambiguous (we're on
 *     the persona path, NOT fate); the Fate: Luck button won't even render
 *     because `hasFate` requires `fate.current > 0` (roll-utils.mjs L131).
 *     Persona=2 (rather than 1) so a hypothetical regression that decremented
 *     TWICE would surface as `persona.current === 0` rather than clamping
 *     silently at zero.
 *   - GM: Bugbear captain + Goblin mook (monsters — different group).
 *   - All unarmed via `__unarmed__` (conflict-panel.mjs L1944-1948 bakes
 *     a -1D "Fists" modifier).
 *   - Party V0=attack/captainA; GM V0=attack/monA → attack:attack is
 *     INDEPENDENT (config.mjs L408). No versus chain; clean independent-
 *     roll surface.
 *   - Flat disposition (captainA=4, monA=4, monB=4) so nobody starts KO'd
 *     (help.mjs L57 gate — not relevant here since we don't engage help,
 *     but keeps the staging clean).
 *
 * PRNG stub: `CONFIG.Dice.randomUniform = () => 0.001` → Foundry's d6 face
 * formula `Math.ceil((1 − u) * 6)` yields face 6 on every die → all-suns,
 * every die is a success. Pool = fighter(3) − 1 unarmed + 1 persona = 3D
 * → 3 successes vs Ob 0, pass. The all-6s stub pins: the +1D persona die
 * CONTRIBUTED to the pool (3 dice in diceResults, not 2), and every die
 * is a success regardless of which die index was the persona add. There's
 * no mid-test PRNG swap needed — persona is a PRE-ROLL spend, one-shot, no
 * chat-card button to re-trigger a cascade (contrast with L522 fate-
 * reroll where the chat-card button triggers `evaluateRoll` mid-test).
 *
 * ---------------------------------------------------------------------------
 * Concrete assertions
 * ---------------------------------------------------------------------------
 * Pre-roll:
 *   (A) captain actor baseline: `persona.current === 2`, `persona.spent === 0`.
 *       Also asserts `fate.current === 0` to lock the distinction: we are
 *       NOT on the fate path.
 *
 * Dialog (post-open, pre-spend):
 *   (B) `dialog.personaSection` count === 1 — conflict roll dialog renders
 *       the persona section. This is the CONFLICT SURFACE assertion — if a
 *       future refactor passed a non-character actor or a resources/circles
 *       test through the conflict path and broke `showPersona`, the
 *       section would be absent and this spec would fail.
 *   (C) `dialog.getSummaryPool()` === 2 (fighter 3 − 1 unarmed = 2D
 *       baseline, no persona yet).
 *
 * Click persona +1 advantage stepper:
 *   (D) `dialog.personaAdvantageValue` reads "1" — stepper clamped to 1,
 *       not 0 (personaAvailable=2 so 1 is valid), not 2 (one click).
 *   (E) `dialog.getSummaryPool()` === 3 — the +1D persona modifier added
 *       to the live-summary pool. Proves the dialog's `renderModifierList`
 *       + `updateSummary` re-render ran (tb2e-roll.mjs L826-827).
 *
 * Submit, then locate the roll-result card via the conflict-testContext
 * filter:
 *   (F) `flags.tb2e.testContext` full-shape `toMatchObject`:
 *         { isConflict: true, conflictAction: 'attack', combatId,
 *           combatantId: cmb.captain, groupId: partyGroupId,
 *           opponentGroupId: gmGroupId, roundNum: 1, volleyIndex: 0 }
 *   (G) `flags.tb2e.roll` exact shape:
 *         { poolSize: 3, successes: 3, finalSuccesses: 3, obstacle: 0,
 *           pass: true }
 *   (H) `flags.tb2e.roll.diceResults.length === 3` — the +1D persona
 *       contribution landed in the rolled pool, not just the summary.
 *   (I) `flags.tb2e.roll.modifiers` contains exactly ONE entry with
 *       `source === 'persona', type === 'dice', value === 1` — the
 *       advantage modifier survived onto the chat message (on-card
 *       evidence of the spend, per tb2e-roll.mjs L1431).
 *   (J) Card DOM: `card.diceResults` count === 3 — renders 3 die chips.
 *   (K) `flags.tb2e.channelNature === false` — we did NOT toggle channel
 *       nature; the flag surface for that mechanic is off.
 *
 * Persona spend on the actor:
 *   (L) `persona.current === 1, persona.spent === 1` — the partial
 *       update at tb2e-roll.mjs L1376-1377 fired.
 *   (M) `fate.current === 0, fate.spent === 0` — the persona spend did
 *       NOT accidentally decrement fate (orthogonal-fields check).
 *
 * Post-submit controls:
 *   (N) Fate: Luck button count === 0 — `hasFate` is false (fate=0),
 *       so the button is not rendered. Locks down the "persona path,
 *       not fate path" distinction on the card surface as well.
 *
 * ---------------------------------------------------------------------------
 * Explicit non-scope
 * ---------------------------------------------------------------------------
 *   - Channel Your Nature (SG p.88 — 1 Persona adds Nature rating dice)
 *     — orthogonal mechanic; owned by nature-tax-decrement and future
 *     channel-nature specs.
 *   - Of Course (post-roll persona reroll-all-wyrms, DH p.77) — owned by
 *     §3 wise-aid-persona.
 *   - Deeper Understanding (post-roll FATE single-wyrm reroll, SG p.87)
 *     — owned by §3 persona-deeper-understanding (misnamed spec file).
 *   - Fate: Luck in conflict — L522 artha-fate-in-conflict.
 *   - Persona advantage clamp at personaAvailable boundary (e.g. stepper
 *     pinned at 2 when actor has persona=2) — could be added as a
 *     sibling scenario later; L523 targets the happy-path +1D surface.
 *   - Versus-mode attack vs defend — uses `_handleVersusRoll`; attack:
 *     attack independent isolates the persona surface.
 *   - Synergy / helpers — L520/L521 owns those surfaces.
 *
 * All Playwright sessions authenticate as GM (tests/e2e/auth.setup.mjs).
 * The pre-roll persona deduction runs in-session via `_applyPreRollActor
 * Changes` (owner gate passes as GM on a character captain), so the
 * persona.current/spent effects are observable synchronously via poll.
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

async function createCharacter(page, { name, tag, fighter, fate, persona }) {
  return page.evaluate(
    async ({ n, t, f, fp, pp }) => {
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
          persona: { current: pp, spent: 0 },
          conditions: { fresh: false, afraid: false, dead: false, angry: false }
        }
      });
      return actor.id;
    },
    { n: name, t: tag, f: fighter, fp: fate, pp: persona }
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
  "§19 Conflict: Artha — spend Persona +1D during conflict roll (SG p.88, TEST_PLAN L523)",
  () => {
    test.afterEach(async ({ page }) => {
      // Restore PRNG + close panel + clear combats/chat between runs so no
      // stale cards bleed across sibling iterations.
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
      'spending Persona +1D in the conflict roll dialog adds a die to the pool, decrements persona.current/spent, and preserves testContext on the chat card',
      async ({ page }, testInfo) => {
        const tag = `e2e-artha-persona-conflict-${testInfo.parallelIndex}-${Date.now()}`;
        const stamp = Date.now();
        const captainName = `E2E PersonaCap ${stamp}`;
        const monAName = `E2E PersonaBugbear ${stamp}`;
        const monBName = `E2E PersonaGoblin ${stamp}`;

        await page.goto('/game');
        const ui = new GameUI(page);
        await ui.waitForReady();
        await ui.dismissTours();
        expect(await page.evaluate(() => game.user.isGM)).toBe(true);

        try {
          /* ---------- Arrange actors ---------- */

          // persona=2 (not 1) so a hypothetical double-decrement regression
          // would surface as current=0 rather than clamping silently at 0
          // via the Math.max guard at tb2e-roll.mjs L1376. fate=0 locks
          // down "persona path, not fate path" — the Fate: Luck button
          // won't render (hasFate gate at roll-utils.mjs L131).
          const captainId = await createCharacter(page, {
            name: captainName, tag, fighter: 3, fate: 0, persona: 2
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
          cmb.monA = await panel.addCombatant({
            combatId, actorId: monAId, groupId: gmGroupId
          });
          cmb.monB = await panel.addCombatant({
            combatId, actorId: monBId, groupId: gmGroupId
          });
          await expect(panel.setupCombatants).toHaveCount(3);

          await panel.clickCaptainButton(cmb.captain);
          await panel.clickCaptainButton(cmb.monA);
          await panel.selectConflictType('kill');

          await expect(panel.beginDispositionButton).toBeEnabled();
          await panel.clickBeginDisposition();

          /* ---------- Disposition: flat-set both sides ---------- */

          await page.evaluate(async ({ cId, pId, gId }) => {
            const c = game.combats.get(cId);
            await c.storeDispositionRoll(pId, {
              rolled: 4, diceResults: [], cardHtml: '<em>E2E</em>'
            });
            await c.storeDispositionRoll(gId, {
              rolled: 8, diceResults: [], cardHtml: '<em>E2E</em>'
            });
          }, { cId: combatId, pId: partyGroupId, gId: gmGroupId });

          await page.evaluate(async ({ cId, pId, gId, capId, mAId, mBId }) => {
            const c = game.combats.get(cId);
            const party = {}; party[capId] = 4;
            const gm = {};    gm[mAId] = 4; gm[mBId] = 4;
            await c.distributeDisposition(pId, party);
            await c.distributeDisposition(gId, gm);
          }, {
            cId: combatId,
            pId: partyGroupId,
            gId: gmGroupId,
            capId: cmb.captain,
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
            ids: [cmb.captain, cmb.monA, cmb.monB]
          });

          await expect(panel.beginScriptingButton).toBeEnabled();
          await panel.clickBeginScripting();

          /* ---------- Scripting ---------- */

          // Party V0=attack/captainA; GM V0=attack/monA → attack:attack is
          // INDEPENDENT per config.mjs L408 (no versus chain). Only V0
          // matters for the assertion but `lockActions` (combat.mjs L534:
          // length === 3 && every a.action && a.combatantId) requires
          // the full triple; captainA x3 is accepted (no uniqueness gate).
          const partyActions = [
            { action: 'attack', combatantId: cmb.captain },
            { action: 'defend', combatantId: cmb.captain },
            { action: 'feint',  combatantId: cmb.captain }
          ];
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

          /* ---------- Reveal V0 ---------- */

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

          /* ---------- (A) Pre-roll baseline: persona + fate ---------- */

          const captainBefore = await page.evaluate((id) => {
            const a = game.actors.get(id);
            return {
              personaCurrent: a.system.persona.current,
              personaSpent: a.system.persona.spent,
              fateCurrent: a.system.fate.current,
              fateSpent: a.system.fate.spent
            };
          }, captainId);
          expect(captainBefore).toEqual({
            personaCurrent: 2,
            personaSpent: 0,
            fateCurrent: 0,
            fateSpent: 0
          });

          /* ---------- PRNG stub: all-6s ---------- */

          // u=0.001 → face 6 on every die (Math.ceil((1 - 0.001)*6) = 6).
          // No mid-test swap needed — persona is a PRE-ROLL one-shot spend.
          await page.evaluate(() => {
            globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
            CONFIG.Dice.randomUniform = () => 0.001;
          });

          /* ---------- Act: open dialog, spend 1 Persona, submit ---------- */

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

          // (B) CONFLICT SURFACE — persona section rendered.
          await expect(dialog.personaSection).toHaveCount(1);

          // (C) Baseline: fighter(3) − 1 unarmed = 2D. Ob 0 (independent attack).
          expect(await dialog.getSummaryPool()).toBe(2);
          expect(await dialog.modeInput.inputValue()).toBe('independent');
          expect(await dialog.getObstacle()).toBe(0);

          // Spend 1 Persona for Advantage (SG p.88 — +1D per persona point).
          await dialog.incrementPersonaAdvantage(1);

          // (D) Stepper value reads 1 — asserted inside the POM helper.
          // (E) Summary pool bumps 2 → 3 via the persona modifier add.
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

          /* ---------- Assertions F/G/H/I/K: message flags ---------- */

          const msgSnapshot = await page.evaluate((mid) => {
            const msg = game.messages.get(mid);
            const tb = msg.flags.tb2e;
            return {
              testContext: JSON.parse(JSON.stringify(tb.testContext ?? null)),
              roll: {
                poolSize: tb.roll?.poolSize ?? null,
                successes: tb.roll?.successes ?? null,
                finalSuccesses: tb.roll?.finalSuccesses ?? null,
                obstacle: tb.roll?.obstacle ?? null,
                pass: tb.roll?.pass ?? null
              },
              diceLen: (tb.roll?.diceResults ?? []).length,
              personaMods: (tb.roll?.modifiers ?? []).filter(
                (m) => m.source === 'persona' && m.type === 'dice'
              ),
              channelNature: !!tb.channelNature,
              luckUsed: !!tb.luckUsed
            };
          }, messageId);

          // (F) testContext carries the full conflict metadata — same
          // regression surface as L522: if a future refactor dropped
          // testContext on the persona-spend path, this catches it.
          expect(msgSnapshot.testContext).toMatchObject({
            isConflict: true,
            conflictAction: 'attack',
            combatId,
            combatantId: cmb.captain,
            groupId: partyGroupId,
            opponentGroupId: gmGroupId,
            roundNum: 1,
            volleyIndex: 0
          });
          // (G) Roll flags: 3D all-6s → 3 suns = 3 successes, pass Ob 0.
          // poolSize reflects the persona +1D (baseline 2D + 1D persona = 3D).
          expect(msgSnapshot.roll).toEqual({
            poolSize: 3,
            successes: 3,
            finalSuccesses: 3,
            obstacle: 0,
            pass: true
          });
          // (H) 3 rolled dice — persona contribution landed in the pool.
          expect(msgSnapshot.diceLen).toBe(3);
          // (I) Exactly one persona +1D modifier survived onto the card
          // (tb2e-roll.mjs L1431 preserves modifiers verbatim).
          expect(msgSnapshot.personaMods).toHaveLength(1);
          expect(msgSnapshot.personaMods[0]).toMatchObject({
            source: 'persona',
            type: 'dice',
            value: 1
          });
          // (K) We did NOT toggle channel nature.
          expect(msgSnapshot.channelNature).toBe(false);
          expect(msgSnapshot.luckUsed).toBe(false);

          /* ---------- Assertion J: card DOM ---------- */

          // Scope to THIS message — sibling pattern from L522 to dodge
          // chat double-render.
          const card = new RollChatCard(page);
          card.root = page
            .locator(`li.chat-message[data-message-id="${messageId}"] .tb2e-chat-card`)
            .filter({ has: page.locator('.roll-card-breakdown') })
            .first();
          card.diceResults = card.root.locator('.roll-card-dice .die-result');
          card.fateLuckButton = card.root.locator(
            '.card-actions button[data-action="fate-luck"]'
          );

          await expect(card.root).toBeVisible();
          // (J) 3 dice rendered.
          await expect(card.diceResults).toHaveCount(3);

          /* ---------- Assertion N: no Fate: Luck button on the card ---------- */

          // fate=0 → hasFate false → template gate suppresses the button
          // (roll-result.hbs L110-117). Locks down "persona, not fate".
          await expect(card.fateLuckButton).toHaveCount(0);

          /* ---------- Assertion L/M: actor persona + fate deltas ---------- */

          // persona.current decremented 2→1, spent 0→1 (tb2e-roll.mjs
          // L1376-1377). Poll — _applyPreRollActorChanges runs inside the
          // rollTest pipeline and the actor.update is async.
          await expect
            .poll(
              () => page.evaluate((id) => {
                const a = game.actors.get(id);
                return {
                  personaCurrent: a.system.persona.current,
                  personaSpent: a.system.persona.spent,
                  fateCurrent: a.system.fate.current,
                  fateSpent: a.system.fate.spent
                };
              }, captainId),
              { timeout: 10_000 }
            )
            .toEqual({
              personaCurrent: 1,  // (L)
              personaSpent: 1,    // (L)
              fateCurrent: 0,     // (M) orthogonal — untouched
              fateSpent: 0        // (M)
            });
        } finally {
          await cleanupTaggedActors(page, tag);
        }
      }
    );
  }
);
