import { test, expect } from '../test.mjs';
import { scriptAndLockActions } from '../helpers/conflict-scripting.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §19 Conflict: Team, Helping, Artha — spend Fate DURING a conflict roll;
 * verify the reroll flow and action-context preservation (TEST_PLAN L522).
 *
 * ---------------------------------------------------------------------------
 * Rules as written — Scholar's Guide p.85 ("Fate → Luck")
 * ---------------------------------------------------------------------------
 * "A player may spend one fate point for luck after they've rolled. Pick up
 *  one new die for each 6 rolled. Roll these dice and count new successes.
 *  If more 6s come up, pick up new dice for each 6 and keep going!"
 * (../reference/rules/fate-persona/scholars-guide-fate-persona.md L131-133)
 *
 * Also: DH p.47 ("Fate") and SG p.87 describe the same Luck spend as a
 * post-roll "reroll 6s" effect. Each 6 (a "sun" — `d.isSun` in the
 * production code) spawns a fresh d6 into the pool; any 6 in the new batch
 * chains into another reroll batch until no suns remain.
 *
 * ---------------------------------------------------------------------------
 * Scope distinction vs §3 L? (tests/e2e/roll/fate-reroll.spec.mjs)
 * ---------------------------------------------------------------------------
 * §3 covers the GENERIC fate-reroll surface — a standalone ability/skill
 * roll from the character sheet. The post-roll chat-card button is the
 * same `data-action="fate-luck"` handler (post-roll.mjs L48 →
 * `_handleFateLuck` L116-175), and the reroll mechanics are identical
 * (spend 1 fate, append luck dice, recalc successes, flip `luckUsed`).
 *
 * L522 (this spec) is the CONFLICT-SPECIFIC Fate: Luck surface. The roll is
 * initiated via `#onRollAction` at conflict-panel.mjs L1847+, which seeds
 * `testContext` with conflict metadata at L1974-1994:
 *   { isConflict, candidates: memberCombatants, conflictAction, combatId,
 *     combatantId, groupId, opponentGroupId, roundNum, volleyIndex }
 * That metadata survives through `_buildRollFlags` (tb2e-roll.mjs L1461-
 * 1479) onto the chat message's `flags.tb2e.testContext`. The distinguishing
 * assertion for L522: after `_handleFateLuck` runs its partial update
 * (post-roll.mjs L158-171 only touches `flags.tb2e.roll.{diceResults,
 * successes,finalSuccesses,pass}` and `flags.tb2e.luckUsed` — NOT
 * testContext), the conflict metadata remains intact on the message, so
 * downstream conflict consumers (maneuver spend buttons, versus finalize,
 * action-context cards) still see the same action context they saw pre-spend.
 *
 * If a future refactor collapsed `_handleFateLuck` to write a full-message
 * replacement (e.g. passing `flags.tb2e` as a whole object instead of dot-
 * path keys), testContext would be wiped — §3 wouldn't catch it (there's
 * no testContext on a standalone roll), but this spec would.
 *
 * ---------------------------------------------------------------------------
 * Production path — call graph
 * ---------------------------------------------------------------------------
 * Click V0 `rollAction` button in the conflict panel →
 *   `#onRollAction` (conflict-panel.mjs L1847+) builds the
 *   `memberCombatants` candidate list (L1970-1972) and calls `rollTest`
 *   with `testContext` carrying full conflict metadata (L1978-1993).
 * → `rollTest` → `_showRollDialog` (tb2e-roll.mjs L376-1203) renders
 *   roll-dialog.hbs. For a character with `fate.current > 0`,
 *   `showPersona = isCharacter && !isResourcesOrCircles` (tb2e-roll.mjs
 *   L395-397) unlocks the persona section — fate availability is also
 *   plumbed into helpers' `hasFate` flag (tb2e-roll.mjs L145) for the
 *   in-dialog synergy button, but the ROLLER's own fate spend for
 *   Luck/Deeper is a POST-roll chat-card interaction, not an in-dialog
 *   toggle (see roll-result.hbs L110-117 `{{#if hasFate}}` + `{{#if
 *   hasSuns}}` gate).
 * → Submit the dialog → attack:attack is INDEPENDENT per config.mjs L408
 *   (both sides roll vs Ob 0 with no versus finalization). Lands in
 *   `_handleIndependentRoll` (tb2e-roll.mjs L1487-1540) which posts a
 *   roll-result chat card with `flags.tb2e.roll.{poolSize,successes,
 *   finalSuccesses,obstacle,pass}` and `flags.tb2e.testContext` (the
 *   shape declared at tb2e-roll.mjs L1461-1479, preserving combatId +
 *   combatantId + groupId + opponentGroupId + roundNum + volleyIndex +
 *   conflictAction).
 * → Chat-card template renders `{{#if hasFate}}{{#if hasSuns}}{{#unless
 *   luckUsed}}<button data-action="fate-luck">...{{/unless}}{{/if}}{{/if}}`
 *   (roll-result.hbs around L110-117). With the roller having fate >= 1
 *   AND at least one die being a sun, the button appears.
 * → `activatePostRollListeners` (post-roll.mjs L15-57) wires
 *   `data-action="fate-luck"` → `_handleFateLuck(message)` (L116-175):
 *     1. Count initial suns (L135) → sunsToExplode
 *     2. While sunsToExplode > 0 (L141-146): roll fresh batch via
 *        `evaluateRoll`, append to luckDice, add to totalNewSuccesses,
 *        recount suns from THIS batch (not cumulative — L145 is the
 *        cascade-termination predicate).
 *     3. Spend fate (L149-152): current -= 1, spent += 1.
 *     4. Build new diceResults with luck dice tagged `isLuck: true`
 *        (L155).
 *     5. Update message flags via dot-path keys (L158-162) — partial
 *        update, so testContext/helpers/conflictAction/etc. are
 *        untouched.
 *     6. Recalc finalSuccesses + pass via `recalculateSuccesses`
 *        (L164-169) — for `isVersus=false, obstacle=0`, pass recomputes
 *        to `(successes + conditionalBonus) >= 0 === true` regardless of
 *        reroll outcome.
 *     7. Re-render chat card (L174).
 *
 * ---------------------------------------------------------------------------
 * Staging
 * ---------------------------------------------------------------------------
 * Kill conflict (config.mjs L202-211 — attack rolls skill:fighter):
 *   - Party: captainA (fighter=3, health=4, FATE=2 — the ROLLER; fate>=1
 *     is required for the Luck button to appear per `hasFate` gate at
 *     roll-utils.mjs L131).
 *   - GM: Bugbear captain + Goblin mook (monsters — different group).
 *   - All unarmed via `__unarmed__` (conflict-panel.mjs L1944-1948 bakes
 *     a -1D "Fists" modifier).
 *   - Party V0=attack/captainA; GM V0=attack/monA → attack:attack is
 *     INDEPENDENT (config.mjs L408). No versus chain; clean independent-
 *     roll surface so `_handleFateLuck` is the ONLY post-roll interaction
 *     we exercise (versus would require `_handleVersusFinalize` which is
 *     orthogonal to the fate-reroll surface).
 *   - Flat disposition (captainA=4, monA=4, monB=4) so nobody starts KO'd
 *     (help.mjs L57 gate — not relevant here since we don't engage help,
 *     but keeps the staging clean).
 *
 * PRNG stub sequence (mid-test swap, same pattern as fate-reroll.spec.mjs
 * L158-160):
 *   1. Initial roll: `CONFIG.Dice.randomUniform = () => 0.001` → Foundry's
 *      d6 face formula `Math.ceil((1 - u) * 6)` yields face 6 on every
 *      die. Pool = fighter(3) − 1 unarmed = 2D → 2 suns = 2 successes vs
 *      Ob 0. Pass with hasSuns true → Fate: Luck button rendered.
 *   2. Post-click reroll: swap to `() => 0.999` → face 1 on every die.
 *      2 suns trigger `evaluateRoll(2)` with this stub → both dice face
 *      1 (failure, NOT a sun) → cascade loop at post-roll.mjs L141-146
 *      exits after one pass. Luck dice carry `isLuck:true`, 0 new
 *      successes, no cascade.
 *   (Why not stay at 0.001 for the reroll? All-6s stub would recurse
 *    forever — `evaluateRoll` clamps the pool to max(n, 1), so each
 *    cascade pass always has at least 1 die. 0.999 is the clean "reroll
 *    ran, cascade terminated" surface — same rationale as fate-reroll
 *    §3 L152-157, except we use 0.999 instead of 0.3 here to test the
 *    "reroll ran but added zero successes" boundary case.)
 *
 * Why 0-success reroll + Ob=0 (attack is INDEPENDENT vs Ob 0)? It pins
 * the cleanest possible assertion: the reroll FIRED (dice pool grew by 2,
 * luckUsed=true, fate.current decremented), and successes stayed put at
 * 2. If a regression silently skipped the reroll, diceResults.length
 * would stay at 2 AND luckUsed would stay false — both flags flip
 * together. Additionally, `pass` stays true (2 >= 0) across the rerecalc
 * — the assertion isolates "reroll mechanics" from "pass/fail flip" (§3
 * owns the flip from fail→pass).
 *
 * ---------------------------------------------------------------------------
 * Concrete assertions
 * ---------------------------------------------------------------------------
 * Pre-roll:
 *   (A) captain actor baseline: `fate.current === 2`, `fate.spent === 0`.
 *   (B) message count recorded for the "find the roll-result card" filter.
 *
 * Post-submit (initial roll lands):
 *   (C) Card located by `flags.tb2e.testContext.isConflict === true &&
 *       conflictAction === 'attack' && actorId === captainId`. The
 *       distinguishing L522 test-context assertion is a full-shape deep
 *       equality:
 *         testContext = {
 *           isConflict: true,
 *           conflictAction: 'attack',
 *           combatId, combatantId, groupId, opponentGroupId,
 *           roundNum: 0, volleyIndex: 0, ...
 *         }
 *   (D) Roll flags: `{ poolSize: 2, successes: 2, finalSuccesses: 2,
 *       obstacle: 0, pass: true }`.
 *   (E) `flags.tb2e.luckUsed === false` (pre-spend).
 *   (F) Card DOM shows 2 dice (`diceResults` locator count === 2).
 *   (G) Fate: Luck button VISIBLE — proves `hasFate && hasSuns` rendered
 *       the button on the CONFLICT roll card (same template gate as §3,
 *       but reached via the conflict-panel entry path).
 *
 * PRNG swap → click Fate: Luck → _handleFateLuck runs:
 *   (H) Actor: `fate.current === 1, fate.spent === 1` (post-roll.mjs
 *       L149-152).
 *   (I) Card DOM shows 4 dice (2 original + 2 luck). `successes` stays
 *       at 2 (luck dice all face-1 → 0 new successes).
 *   (J) Message flag `luckUsed === true` (post-roll.mjs L161).
 *   (K) Roll flags shape: `{ successes: 2, finalSuccesses: 2, pass: true }`
 *       — pass stays true (2 >= 0 still holds post-recalc).
 *   (L) The 2 appended dice carry `isLuck: true` (post-roll.mjs L155).
 *   (M) **CONFLICT-SPECIFIC — the L522 distinguishing assertion**: the
 *       message's `flags.tb2e.testContext` is UNCHANGED — same
 *       conflictAction, combatId, combatantId, groupId, opponentGroupId,
 *       roundNum, volleyIndex as pre-spend. The reroll preserved the
 *       conflict action context (post-roll.mjs L158-171 partial update
 *       only touches roll.{...} and luckUsed keys).
 *   (N) Card re-rendered with the Fate: Luck button GONE (template
 *       `{{#unless luckUsed}}` guard — post-roll.mjs line 129 also
 *       guards re-click warnings).
 *
 * ---------------------------------------------------------------------------
 * Explicit non-scope
 * ---------------------------------------------------------------------------
 *   - Standalone ability/skill test Fate: Luck — owned by §3
 *     tests/e2e/roll/fate-reroll.spec.mjs.
 *   - Persona spend in conflict — L523 (different artha, different
 *     card surface).
 *   - Deeper Understanding (Fate + wise) — would need a wise-selected
 *     dialog; orthogonal to conflict.
 *   - Versus-mode attack vs defend — uses `_handleVersusRoll` +
 *     `_handleVersusFinalize`; attack:attack independent isolates the
 *     fate-reroll surface from versus finalization.
 *   - Synergy / helpers — L520/L521 owns those surfaces.
 *
 * All Playwright sessions authenticate as GM (tests/e2e/auth.setup.mjs).
 * The `_handleFateLuck` handler runs in-session (owner gate passes as
 * GM), so the reroll's effects are observable synchronously via poll.
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

test.describe(
  "§19 Conflict: Artha — spend Fate during conflict roll; verify reroll (SG p.85, TEST_PLAN L522)",
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
      'spending Fate: Luck on a conflict roll card rerolls 6s, spends 1 fate, and preserves testContext',
      async ({ page }, testInfo) => {
        const tag = `e2e-artha-fate-conflict-${testInfo.parallelIndex}-${Date.now()}`;
        const stamp = Date.now();
        const captainName = `E2E FateCap ${stamp}`;
        const monAName = `E2E FateBugbear ${stamp}`;
        const monBName = `E2E FateGoblin ${stamp}`;

        await page.goto('/game');
        const ui = new GameUI(page);
        await ui.waitForReady();
        await ui.dismissTours();
        expect(await page.evaluate(() => game.user.isGM)).toBe(true);

        try {
          /* ---------- Arrange actors ---------- */

          // Fate=2 so the -1 decrement post-spend assertion is unambiguous
          // (current: 2 → 1, spent: 0 → 1). Same rationale as §3
          // fate-reroll.spec.mjs L79-80.
          const captainId = await createCharacter(page, {
            name: captainName, tag, fighter: 3, fate: 2
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
          // INDEPENDENT per config.mjs L408 (no versus chain). We only care
          // about V0 but need the full triple scripted so `lockActions`
          // validates (combat.mjs L534: length === 3 && every a.action &&
          // a.combatantId). captainA x3 is accepted — no uniqueness gate.
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

          /* ---------- Pre-roll baseline: captain fate state ---------- */

          const captainBefore = await page.evaluate((id) => {
            const a = game.actors.get(id);
            return {
              fateCurrent: a.system.fate.current,
              fateSpent: a.system.fate.spent
            };
          }, captainId);
          expect(captainBefore).toEqual({ fateCurrent: 2, fateSpent: 0 });

          /* ---------- PRNG stub 1: all-6s for the initial roll ---------- */

          await page.evaluate(() => {
            globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
            CONFIG.Dice.randomUniform = () => 0.001;
          });

          /* ---------- Act 1: open dialog + submit the V0 attack ---------- */

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

          // Baseline: fighter(3) − 1 unarmed = 2D. Ob 0 (independent attack).
          expect(await dialog.getSummaryPool()).toBe(2);
          expect(await dialog.modeInput.inputValue()).toBe('independent');
          expect(await dialog.getObstacle()).toBe(0);

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

          /* ---------- Assertion C/D/E: roll-result card metadata ---------- */

          // Capture the full testContext shape pre-spend so we can diff
          // against the post-spend snapshot (assertion M). Deep clone by
          // value so later mutations can't alias.
          const preSpend = await page.evaluate((mid) => {
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
              luckUsed: !!tb.luckUsed,
              diceLen: (tb.roll?.diceResults ?? []).length,
              suns: (tb.roll?.diceResults ?? []).filter(d => d.isSun).length
            };
          }, messageId);

          // (C) testContext carries the full conflict metadata from
          // conflict-panel.mjs L1978-1993 through tb2e-roll.mjs L1461-1479.
          // roundNum is the 1-indexed currentRound (combat.mjs flips it to 1
          // on beginResolve). volleyIndex is 0-indexed. combatId +
          // combatantId + groupId + opponentGroupId come directly from
          // conflict-panel.mjs L1984-1989.
          expect(preSpend.testContext).toMatchObject({
            isConflict: true,
            conflictAction: 'attack',
            combatId,
            combatantId: cmb.captain,
            groupId: partyGroupId,
            opponentGroupId: gmGroupId,
            roundNum: 1,
            volleyIndex: 0
          });
          // (D) Roll flags: 2D all-6s → 2 suns → 2 successes, pass Ob 0.
          expect(preSpend.roll).toEqual({
            poolSize: 2,
            successes: 2,
            finalSuccesses: 2,
            obstacle: 0,
            pass: true
          });
          // (E) Not yet spent.
          expect(preSpend.luckUsed).toBe(false);
          // 2 dice, both suns.
          expect(preSpend.diceLen).toBe(2);
          expect(preSpend.suns).toBe(2);

          /* ---------- Assertion F/G: DOM shape + Fate: Luck button ---------- */

          // Scope the RollChatCard to THIS message (sibling specs establish
          // this pattern — the default `.last()` scope would match any
          // intervening chat card). See team-synergy.spec.mjs L671-677.
          const card = new RollChatCard(page);
          card.root = page
            .locator(`li.chat-message[data-message-id="${messageId}"] .tb2e-chat-card`)
            .filter({ has: page.locator('.roll-card-breakdown') })
            .first();
          // Re-scope dependent locators.
          card.diceResults = card.root.locator('.roll-card-dice .die-result');
          card.fateLuckButton = card.root.locator(
            '.card-actions button[data-action="fate-luck"]'
          );

          await expect(card.root).toBeVisible();
          // (F) 2 dice rendered.
          await expect(card.diceResults).toHaveCount(2);
          // (G) Fate: Luck button visible on the CONFLICT roll card —
          // proves `hasFate && hasSuns` both hold and the template
          // guarded-render went through (roll-result.hbs L110-117).
          await expect(card.fateLuckButton).toBeVisible();

          /* ---------- PRNG stub 2: swap to all-1s for the reroll ---------- */

          // Mid-test swap — same pattern as §3 fate-reroll L158-160. u=0.999
          // → Math.ceil((1 - 0.999) * 6) = Math.ceil(0.006) = 1, so every
          // die in the reroll batch shows face 1. No successes, no suns →
          // cascade loop at post-roll.mjs L145 terminates after one pass.
          // We keep the ORIGINAL stub reference in __tb2eE2EPrevRandomUniform
          // so afterEach can restore it.
          await page.evaluate(() => {
            CONFIG.Dice.randomUniform = () => 0.999;
          });

          /* ---------- Act 2: click Fate: Luck on the conflict roll card ---------- */

          // Dispatch native click — same pattern as RollChatCard.clickFateLuck
          // but inlined to use the message-scoped locator.
          await card.fateLuckButton.evaluate((el) => el.click());

          /* ---------- Assertion H: fate spent (poll; async actor.update) ---------- */

          await expect
            .poll(
              () => page.evaluate((id) => {
                const a = game.actors.get(id);
                return {
                  fateCurrent: a.system.fate.current,
                  fateSpent: a.system.fate.spent
                };
              }, captainId),
              { timeout: 10_000 }
            )
            .toEqual({ fateCurrent: 1, fateSpent: 1 });

          /* ---------- Assertion I/J/K/L/M: message flags post-spend ---------- */

          // Poll for `luckUsed: true` to confirm the reroll handler landed —
          // it's the last flag `_handleFateLuck` writes in its partial
          // update (post-roll.mjs L158-162).
          await expect
            .poll(
              () => page.evaluate((mid) =>
                !!game.messages.get(mid)?.flags?.tb2e?.luckUsed, messageId),
              { timeout: 10_000 }
            )
            .toBe(true);

          const postSpend = await page.evaluate((mid) => {
            const msg = game.messages.get(mid);
            const tb = msg.flags.tb2e;
            const dice = tb.roll?.diceResults ?? [];
            return {
              testContext: JSON.parse(JSON.stringify(tb.testContext ?? null)),
              roll: {
                poolSize: tb.roll?.poolSize ?? null,
                successes: tb.roll?.successes ?? null,
                finalSuccesses: tb.roll?.finalSuccesses ?? null,
                obstacle: tb.roll?.obstacle ?? null,
                pass: tb.roll?.pass ?? null
              },
              luckUsed: !!tb.luckUsed,
              diceLen: dice.length,
              // Original suns preserved (first 2 dice).
              originalSuns: dice.slice(0, 2).filter(d => d.isSun).length,
              // Luck dice are the tail; all carry isLuck:true
              // (post-roll.mjs L155).
              luckSliceIsLuck: dice.slice(2).every(d => d.isLuck === true),
              // With u=0.999, luck dice are face-1: not suns, not successes.
              luckSliceSuccesses: dice.slice(2).filter(d => d.success).length,
              luckSliceSuns: dice.slice(2).filter(d => d.isSun).length
            };
          }, messageId);

          // (I) 2 original + 2 luck dice = 4 total; successes stayed at 2
          // (luck dice all face-1 → no new successes).
          expect(postSpend.diceLen).toBe(4);
          // (K) Roll recomputed: successes = 2 (unchanged), finalSuccesses
          // = 2 (unchanged), pass still true (2 >= 0).
          expect(postSpend.roll).toEqual({
            poolSize: 2,
            successes: 2,
            finalSuccesses: 2,
            obstacle: 0,
            pass: true
          });
          // (J) luckUsed flipped (template hides the button on re-render).
          expect(postSpend.luckUsed).toBe(true);
          // (L) Luck dice carry isLuck:true; the pre-existing 2 suns are
          // preserved intact. With the all-1s reroll stub, the luck slice
          // has 0 successes and 0 suns.
          expect(postSpend.originalSuns).toBe(2);
          expect(postSpend.luckSliceIsLuck).toBe(true);
          expect(postSpend.luckSliceSuccesses).toBe(0);
          expect(postSpend.luckSliceSuns).toBe(0);
          // (M) **The L522 distinguishing assertion** — testContext is
          // preserved byte-for-byte through the post-roll handler's
          // partial update (post-roll.mjs L158-171 uses dot-path keys for
          // `flags.tb2e.roll.*` and `flags.tb2e.luckUsed` only; testContext
          // is never touched). A future refactor that wrote the whole
          // `flags.tb2e` object back would fail this assertion — §3
          // wouldn't catch it (testContext is null on a standalone roll).
          expect(postSpend.testContext).toEqual(preSpend.testContext);

          /* ---------- Assertion N: button gone on re-render ---------- */

          await expect(card.fateLuckButton).toHaveCount(0, { timeout: 10_000 });
          // 4 dice rendered after re-render (2 original + 2 luck).
          await expect(card.diceResults).toHaveCount(4, { timeout: 10_000 });
        } finally {
          await cleanupTaggedActors(page, tag);
        }
      }
    );
  }
);
