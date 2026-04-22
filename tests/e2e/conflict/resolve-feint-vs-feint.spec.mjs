import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { VersusPendingCard, VersusResolutionCard } from '../pages/VersusCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §16 Conflict: Resolve — Feint vs Feint (TEST_PLAN L456, DH pp.120-127).
 *
 * Rules under test:
 *   - DH pp.120-127: action vs action resolution. Actions are revealed
 *     one volley at a time, the interaction is derived from both sides'
 *     action keys per the matrix at config.mjs L407-424, and for a
 *     versus interaction the higher-successes side wins with
 *     margin = |iSuccesses - oSuccesses| (versus.mjs L170).
 *   - Matrix (config.mjs L418): `"feint:feint": "versus"`. Both sides
 *     roll; winner by margin. For Kill conflicts the Feint action is
 *     `{ type: "skill", keys: ["fighter"] }` (config.mjs L208).
 *
 * -------------------------------------------------------------------
 * Why this spec is NOT `test.fixme` (contrast with L453)
 * -------------------------------------------------------------------
 * L453's Attack vs Defend spec is fixmed because the HP-damage half of
 * its checkbox requires production wiring that does not exist —
 * `resolveActionEffect` (conflict-roll.mjs L155-178) is imported only
 * as dead code at conflict-panel.mjs L3 and no call site writes HP
 * from volley margins. That same gap applies to feint-vs-feint damage
 * and is §18 L500 scope (`hp-damage-reduces.spec.mjs`).
 *
 * The L456 checkbox is scoped to versus-interaction / resolution-
 * pipeline behaviors that ARE wired:
 *
 *   - `combat.getVolleyInteraction(0)` (combat.mjs L789-803) returns
 *     `"versus"` via matrix lookup of `"feint:feint"` (config.mjs L418).
 *   - `ConflictPanel.#onRevealAction` (conflict-panel.mjs L1796-1838)
 *     flips `round.volleys[0].revealed = true` and posts a reveal card
 *     from conflict-action-reveal.hbs with
 *     `.card-interaction.interaction-versus`.
 *   - `ConflictPanel.#onRollAction` (conflict-panel.mjs L1909-1921)
 *     resolves sideInteraction via `getInteraction(actionKey,
 *     opponentAction)` and for `"versus"` stamps `isVersus: true` on
 *     testContext (L1992). That lands both rolls in `_handleVersusRoll`
 *     (tb2e-roll.mjs L1580-1650) which posts pending cards and
 *     registers them in `PendingVersusRegistry` (versus.mjs L18-20).
 *   - Finalize on both cards routes through `_handleFinalize`
 *     (post-roll.mjs L506-522) into `_executeVersusResolution`
 *     (versus.mjs L137-267): a resolution card is posted with
 *     `flags.tb2e.versus.winnerId` pointing at the higher-successes
 *     side's actor id (L160), and `margin = Math.abs(iSuccesses -
 *     oSuccesses)` (L170).
 *   - `#onResolveAction` (conflict-panel.mjs L2003-2096) writes
 *     `round.volleys[0].result = { resolved, sides, interaction:
 *     "versus", ... }` via `combat.resolveVolley` (combat.mjs
 *     L772-782) and auto-advances `currentAction`.
 *
 * HP assertions are deliberately omitted — the mirror of L453's scope
 * note applies here (same production gap).
 *
 * -------------------------------------------------------------------
 * Test fixture (deterministic)
 * -------------------------------------------------------------------
 *   Kill conflict (config.mjs L202-211; feint = skill:fighter),
 *   4 characters split 2/2 across the groups. Two characters (not
 *   monsters) on both sides so we can control Fighter ratings directly
 *   — monsters always roll Nature (conflict-roll.mjs L49-53) which is
 *   not the matchup L456 wants to exercise.
 *
 *   Party captain (`captainA`): fighter=4. Scripts FEINT on volley 0.
 *     → pool = 4D − 1D unarmed = 3D, all-6s PRNG → 3 successes.
 *   GM captain (`captainB`): fighter=2. Scripts FEINT on volley 0.
 *     → pool = 2D − 1D unarmed = 1D, all-3s PRNG → 0 successes.
 *
 *   Margin = |3 − 0| = 3. Party captain wins.
 *
 *   PRNG stubs:
 *     - u=0.001 → Math.ceil((1-u)*6) = 6 — all successes.
 *     - u=0.5  → Math.ceil((1-u)*6) = 3 — all wyrms (0 successes).
 *
 *   Sequence for volley 0 (feint vs feint, versus):
 *     1. `combat.getVolleyInteraction(0)` returns "versus".
 *     2. `combat.beginResolve` flips phase to "resolve",
 *        currentAction = 0.
 *     3. Reveal volley 0 — posts the conflict-action-reveal card with
 *        `interaction-versus` class.
 *     4. Stub PRNG → all-6s. Party captain rolls Feint → 3 successes.
 *        Dialog mode pre-set to "versus" by `#onRollAction` stamping
 *        `isVersus` (conflict-panel.mjs L1992; tb2e-roll.mjs L928-937).
 *     5. Finalize → pending card goes into PendingVersusRegistry.
 *     6. Stub PRNG → all-3s. GM captain rolls Feint → 0 successes.
 *        Select the attacker's message as the versus challenge in the
 *        dialog dropdown (VersusDialogExtras-equivalent inline select).
 *     7. Finalize → `_executeVersusResolution` posts the resolution
 *        card naming the party captain as winner, margin = 3.
 *     8. Mark resolved — `#onResolveAction` writes
 *        `round.volleys[0].result = { resolved: true, interaction:
 *        "versus", sides: 2 }`. Auto-advance to currentAction = 1.
 *
 * Scope (narrow — TEST_PLAN L456 only):
 *   - Only verifies Feint vs Feint versus resolution at the roll-
 *     pipeline level. Attack vs Attack (L454, independent), Feint vs
 *     Attack (L455, none/independent), Maneuver (L457), card animation
 *     (L458), monster Nature detail (L459) are out of scope.
 *   - HP damage from margins is §18 L500 scope — the production gap is
 *     the same as L453 (`resolveActionEffect` unwired).
 *   - Only volley 0 is exercised; downstream volleys are not asserted.
 *
 * All Playwright sessions authenticate as GM (auth.setup.mjs L14-35).
 * Reveal/roll/resolve handlers gate on isGM or owner — the GM-only
 * path is the one exercised here.
 */

async function createCaptainCharacter(page, { name, tag, fighter, health = 4 }) {
  return page.evaluate(
    async ({ n, t, f, h }) => {
      const actor = await Actor.implementation.create({
        name: n,
        type: 'character',
        flags: { tb2e: { e2eTag: t } },
        system: {
          abilities: {
            health: { rating: h, pass: 0, fail: 0 },
            will:   { rating: 4, pass: 0, fail: 0 },
            nature: { rating: 3, max: 3, pass: 0, fail: 0 }
          },
          skills: {
            fighter: { rating: f, pass: 0, fail: 0 }
          },
          conditions: { fresh: false }
        }
      });
      return actor.id;
    },
    { n: name, t: tag, f: fighter, h: health }
  );
}

async function createCharacter(page, { name, tag }) {
  return page.evaluate(
    async ({ n, t }) => {
      const actor = await Actor.implementation.create({
        name: n,
        type: 'character',
        flags: { tb2e: { e2eTag: t } },
        system: { conditions: { fresh: false } }
      });
      return actor.id;
    },
    { n: name, t: tag }
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

test.describe('§16 Conflict: Resolve — Feint vs Feint', () => {
  test.afterEach(async ({ page }) => {
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
    // Chat log accumulates reveal + versus cards across repeats; clear
    // so count-based / tail-scan assertions in subsequent runs aren't
    // contaminated (mirrors resolve-feint-vs-attack.spec.mjs L227-230).
    await page.evaluate(async () => {
      const mids = game.messages.contents.map((m) => m.id);
      if ( mids.length ) await ChatMessage.deleteDocuments(mids);
    });
  });

  test(
    'Feint vs Feint (versus): higher successes wins by margin (DH pp.120-127)',
    async ({ page }, testInfo) => {
      const tag = `e2e-resolve-fvf-${testInfo.parallelIndex}-${Date.now()}`;
      const stamp = Date.now();
      const charAName = `E2E FvF Captain A ${stamp}`;
      const charBName = `E2E FvF Captain B ${stamp}`;
      const charCName = `E2E FvF Char C ${stamp}`;
      const charDName = `E2E FvF Char D ${stamp}`;

      await page.goto('/game');
      const ui = new GameUI(page);
      await ui.waitForReady();
      await ui.dismissTours();

      // Reveal/roll/resolve handlers assume GM in this harness
      // (conflict-panel.mjs L1796/L1847/L2003).
      expect(await page.evaluate(() => game.user.isGM)).toBe(true);

      try {
        /* ---------- Arrange actors ---------- */

        // Two captains — one per group — both characters (NOT monsters,
        // since monsters roll Nature regardless of action per conflict-
        // roll.mjs L49-53, and the matchup under test is two character-
        // side feints rolling Fighter).
        const captainAId = await createCaptainCharacter(page, {
          name: charAName, tag, fighter: 4
        });
        const captainBId = await createCaptainCharacter(page, {
          name: charBName, tag, fighter: 2
        });
        const charCId = await createCharacter(page, { name: charCName, tag });
        const charDId = await createCharacter(page, { name: charDName, tag });

        /* ---------- Create conflict ---------- */

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
        cmb.captainA = await panel.addCombatant({
          combatId, actorId: captainAId, groupId: partyGroupId
        });
        cmb.charC = await panel.addCombatant({
          combatId, actorId: charCId, groupId: partyGroupId
        });
        cmb.captainB = await panel.addCombatant({
          combatId, actorId: captainBId, groupId: gmGroupId
        });
        cmb.charD = await panel.addCombatant({
          combatId, actorId: charDId, groupId: gmGroupId
        });
        await expect(panel.setupCombatants).toHaveCount(4);

        await panel.clickCaptainButton(cmb.captainA);
        await panel.clickCaptainButton(cmb.captainB);
        await panel.selectConflictType('kill');

        await expect(panel.beginDispositionButton).toBeEnabled();
        await panel.clickBeginDisposition();

        /* ---------- Disposition: flat-set both sides ---------- */

        // Prior art L427/L428/L430/L431 — action-assign + lock + weapons
        // UIs are covered elsewhere. Stage disposition via direct writes
        // (same pattern as resolve-attack-vs-defend.spec.mjs L311-319).
        await page.evaluate(async ({ cId, pId, gId }) => {
          const c = game.combats.get(cId);
          await c.storeDispositionRoll(pId, {
            rolled: 7, diceResults: [], cardHtml: '<em>E2E</em>'
          });
          await c.storeDispositionRoll(gId, {
            rolled: 7, diceResults: [], cardHtml: '<em>E2E</em>'
          });
        }, { cId: combatId, pId: partyGroupId, gId: gmGroupId });

        await page.evaluate(async ({ cId, pId, gId, aId, bId, cId2, dId }) => {
          const c = game.combats.get(cId);
          const party = {}; party[aId] = 4; party[cId2] = 3;
          const gm = {};    gm[bId]   = 4; gm[dId]   = 3;
          await c.distributeDisposition(pId, party);
          await c.distributeDisposition(gId, gm);
        }, {
          cId: combatId,
          pId: partyGroupId,
          gId: gmGroupId,
          aId: cmb.captainA,
          bId: cmb.captainB,
          cId2: cmb.charC,
          dId: cmb.charD
        });

        await expect(panel.beginWeaponsButton).toBeEnabled();
        await panel.clickBeginWeapons();

        /* ---------- Weapons: unarmed for everyone ---------- */

        // `__unarmed__` applies a flat -1D via conflict-panel.mjs
        // L1944-1948. PRNG stubs make dice deterministic, so the -1D
        // just shifts the final success counts to the numbers cited in
        // the header ("3 successes" / "0 successes").
        await page.evaluate(async ({ cId, ids }) => {
          const c = game.combats.get(cId);
          for ( const id of ids ) {
            await c.setWeapon(id, 'Fists', '__unarmed__');
          }
        }, { cId: combatId, ids: [cmb.captainA, cmb.charC, cmb.captainB, cmb.charD] });

        await expect(panel.beginScriptingButton).toBeEnabled();
        await panel.clickBeginScripting();

        /* ---------- Scripting: feint vs feint on volley 0 ---------- */

        // Both captains script FEINT on volley 0 — the matchup this
        // spec exists to exercise. Volleys 1 and 2 are filler (any
        // valid actions) so `#applyLockActions` (combat.mjs L534
        // requires all three slots filled) opens.
        const partyActions = [
          { action: 'feint',    combatantId: cmb.captainA },
          { action: 'defend',   combatantId: cmb.charC },
          { action: 'attack',   combatantId: cmb.captainA }
        ];
        const gmActions = [
          { action: 'feint',    combatantId: cmb.captainB },
          { action: 'attack',   combatantId: cmb.charD },
          { action: 'defend',   combatantId: cmb.captainB }
        ];
        await page.evaluate(async ({ cId, pId, gId, pa, ga }) => {
          const c = game.combats.get(cId);
          await c.setActions(pId, pa);
          await c.setActions(gId, ga);
        }, {
          cId: combatId, pId: partyGroupId, gId: gmGroupId,
          pa: partyActions, ga: gmActions
        });

        await expect
          .poll(() => page.evaluate(({ cId, pId, gId }) => {
            const c = game.combats.get(cId);
            const round = c.system.rounds?.[c.system.currentRound];
            return {
              party: (round?.actions?.[pId] ?? []).map((e) => e?.action ?? null),
              gm: (round?.actions?.[gId] ?? []).map((e) => e?.action ?? null)
            };
          }, { cId: combatId, pId: partyGroupId, gId: gmGroupId }))
          .toEqual({
            party: ['feint', 'defend', 'attack'],
            gm: ['feint', 'attack', 'defend']
          });

        await page.evaluate(async ({ cId, pId, gId }) => {
          const c = game.combats.get(cId);
          await c.lockActions(pId);
          await c.lockActions(gId);
        }, { cId: combatId, pId: partyGroupId, gId: gmGroupId });

        await expect
          .poll(() => page.evaluate(({ cId, pId, gId }) => {
            const c = game.combats.get(cId);
            const round = c.system.rounds?.[c.system.currentRound];
            return {
              p: round?.locked?.[pId] ?? null,
              g: round?.locked?.[gId] ?? null
            };
          }, { cId: combatId, pId: partyGroupId, gId: gmGroupId }))
          .toEqual({ p: true, g: true });

        /* ---------- Transition to resolve phase ---------- */

        // Precondition: interaction for volley 0 resolves to "versus"
        // via `combat.getVolleyInteraction(0)` (combat.mjs L789-803) —
        // the matrix lookup for `feint:feint` at config.mjs L418.
        expect(await page.evaluate(({ cId }) => {
          const c = game.combats.get(cId);
          return c.getVolleyInteraction(0);
        }, { cId: combatId })).toBe('versus');

        await page.evaluate(async ({ cId }) => {
          const c = game.combats.get(cId);
          await c.beginResolve();
        }, { cId: combatId });

        await expect.poll(() => panel.activeTabId()).toBe('resolve');
        expect(await page.evaluate(({ cId }) => {
          const c = game.combats.get(cId);
          return { phase: c.system.phase, currentAction: c.system.currentAction };
        }, { cId: combatId })).toEqual({ phase: 'resolve', currentAction: 0 });

        /* ---------- Reveal volley 0 ---------- */

        // Reveal button dispatches to `#onRevealAction` (conflict-panel.mjs
        // L1796-1838) which flips `round.volleys[0].revealed = true` AND
        // posts a reveal card rendered from conflict-action-reveal.hbs.
        // The card carries `.card-interaction.interaction-versus`
        // derived from `getInteraction(sides[0].action, sides[1].action)`
        // (conflict-panel.mjs L1822 → matrix "feint:feint" = "versus").
        const chatCountBeforeReveal = await page.evaluate(
          () => game.messages.contents.length
        );
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

        await expect
          .poll(() => page.evaluate(() => game.messages.contents.length), {
            timeout: 10_000
          })
          .toBeGreaterThan(chatCountBeforeReveal);

        const revealCardInteraction = await page.evaluate(() => {
          const msg = game.messages.contents.at(-1);
          const dom = new DOMParser().parseFromString(
            msg?.content ?? '', 'text/html'
          );
          const el = dom.querySelector('.card-interaction');
          return {
            classes: el ? el.className : null,
            hasText: !!el?.textContent?.trim()
          };
        });
        expect(revealCardInteraction.classes).toContain('interaction-versus');
        expect(revealCardInteraction.hasText).toBe(true);

        /* ---------- Roll party Feint (initiator) ---------- */

        // Stub PRNG → all-6s for the initiator. fighter=4 − 1 unarmed
        // = 3D → 3 successes on all-6s.
        await page.evaluate(() => {
          globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
          CONFIG.Dice.randomUniform = () => 0.001;
        });

        // The roll button for the party side of volley 0 targets the
        // partyGroupId. `#onRollAction` (conflict-panel.mjs L1917-1919)
        // stamps `isVersus: true` on testContext when sideInteraction
        // === "versus" per `getInteraction("feint", "feint")`.
        const partyRollBtn = panel
          .resolveAction(0)
          .locator(`button[data-action="rollAction"][data-group-id="${partyGroupId}"]`);
        await expect(partyRollBtn).toBeVisible();
        await expect(partyRollBtn).toBeEnabled();
        await partyRollBtn.click();

        const partyDialog = new RollDialog(page);
        await partyDialog.waitForOpen();
        // Dialog mode pre-set to "versus" by testContext.isVersus
        // (tb2e-roll.mjs L928-937).
        expect(await partyDialog.modeInput.inputValue()).toBe('versus');
        await partyDialog.submit();

        const partyMessageId = await page.evaluate(async (actorId) => {
          const started = Date.now();
          while ( Date.now() - started < 10_000 ) {
            const msg = game.messages.contents.find((m) => {
              const vs = m.flags?.tb2e?.versus;
              return vs?.type === 'initiator' && vs.initiatorActorId === actorId;
            });
            if ( msg ) return msg.id;
            await new Promise((r) => setTimeout(r, 100));
          }
          return null;
        }, captainAId);
        expect(partyMessageId).toBeTruthy();

        // Sanity: the conflict testContext is stamped onto the roll
        // message (conflict-panel.mjs L1983-1993). Note: `_buildRollFlags`
        // (tb2e-roll.mjs L1461-1479) whitelists a subset of testContext
        // fields when persisting to message flags — `isVersus` is NOT
        // in that whitelist. The versus routing is instead evidenced
        // by `flags.tb2e.versus.type === "initiator"` (asserted via
        // partyMessageId lookup above) and the dialog mode preset
        // asserted earlier.
        const partyCtx = await page.evaluate((mid) => {
          const msg = game.messages.get(mid);
          const tc = msg?.flags?.tb2e?.testContext;
          const vs = msg?.flags?.tb2e?.versus;
          return tc ? {
            isConflict: !!tc.isConflict,
            conflictAction: tc.conflictAction ?? null,
            groupId: tc.groupId ?? null,
            opponentGroupId: tc.opponentGroupId ?? null,
            versusType: vs?.type ?? null
          } : null;
        }, partyMessageId);
        expect(partyCtx).toEqual({
          isConflict: true,
          conflictAction: 'feint',
          groupId: partyGroupId,
          opponentGroupId: gmGroupId,
          versusType: 'initiator'
        });

        // Switch to chat tab to interact with the pending card. The
        // tracker's open() left the sidebar on combat.
        await page.evaluate(() =>
          ui.sidebar?.changeTab?.('chat', 'primary')
        );

        const partyCard = new VersusPendingCard(page, partyMessageId);
        await partyCard.expectPresent();
        await partyCard.expectPending();
        await partyCard.clickFinalize();
        await expect(partyCard.resolvedBanner).toBeVisible();

        /* ---------- Roll GM Feint (opponent) ---------- */

        // Swap PRNG → all-3s (all wyrms). fighter=2 − 1 unarmed = 1D →
        // 0 successes on all-3s.
        await page.evaluate(() => {
          CONFIG.Dice.randomUniform = () => 0.5;
        });

        // Switch back to combat tab so the roll button is mounted.
        await page.evaluate(() =>
          ui.sidebar?.changeTab?.('combat', 'primary')
        );
        const gmRollBtn = panel
          .resolveAction(0)
          .locator(`button[data-action="rollAction"][data-group-id="${gmGroupId}"]`);
        await expect(gmRollBtn).toBeVisible();
        await expect(gmRollBtn).toBeEnabled();
        await gmRollBtn.click();

        const gmDialog = new RollDialog(page);
        await gmDialog.waitForOpen();
        expect(await gmDialog.modeInput.inputValue()).toBe('versus');

        // Versus responder: pick initiator's message as the challenge
        // via the challenge dropdown (populated on `createChatMessage`
        // per tb2e-roll.mjs L1032-1045).
        const challengeSelect = gmDialog.root.locator(
          'select[name="challengeMessageId"]'
        );
        await expect(challengeSelect).toHaveCount(1);
        await expect(
          challengeSelect.locator(`option[value="${partyMessageId}"]`)
        ).toHaveCount(1);
        await challengeSelect.selectOption(partyMessageId);
        await gmDialog.submit();

        const gmMessageId = await page.evaluate(async ({ mId }) => {
          const started = Date.now();
          while ( Date.now() - started < 10_000 ) {
            const msg = game.messages.contents.find((m) => {
              const vs = m.flags?.tb2e?.versus;
              return vs?.type === 'opponent' && vs.initiatorMessageId === mId;
            });
            if ( msg ) return msg.id;
            await new Promise((r) => setTimeout(r, 100));
          }
          return null;
        }, { mId: partyMessageId });
        expect(gmMessageId).toBeTruthy();

        // Both roll cards land in the versus pipeline — evidenced by
        // `flags.tb2e.versus.type === "opponent"` (lookup key above)
        // plus the shared testContext conflict metadata.
        const gmCtx = await page.evaluate((mid) => {
          const msg = game.messages.get(mid);
          const tc = msg?.flags?.tb2e?.testContext;
          const vs = msg?.flags?.tb2e?.versus;
          return tc ? {
            isConflict: !!tc.isConflict,
            conflictAction: tc.conflictAction ?? null,
            groupId: tc.groupId ?? null,
            opponentGroupId: tc.opponentGroupId ?? null,
            versusType: vs?.type ?? null
          } : null;
        }, gmMessageId);
        expect(gmCtx).toEqual({
          isConflict: true,
          conflictAction: 'feint',
          groupId: gmGroupId,
          opponentGroupId: partyGroupId,
          versusType: 'opponent'
        });

        await page.evaluate(() =>
          ui.sidebar?.changeTab?.('chat', 'primary')
        );
        const gmCard = new VersusPendingCard(page, gmMessageId);
        await gmCard.expectPresent();
        await gmCard.expectPending();
        await gmCard.clickFinalize();

        /* ---------- Versus resolution: initiator wins by margin ---------- */

        const resolutionMessageId = await page.evaluate(async ({ aId, dId }) => {
          const started = Date.now();
          while ( Date.now() - started < 10_000 ) {
            const msg = game.messages.contents.find((m) => {
              const vs = m.flags?.tb2e?.versus;
              return vs?.type === 'resolution'
                && vs.initiatorMessageId === aId
                && vs.opponentMessageId === dId;
            });
            if ( msg ) return msg.id;
            await new Promise((r) => setTimeout(r, 100));
          }
          return null;
        }, { aId: partyMessageId, dId: gmMessageId });
        expect(resolutionMessageId).toBeTruthy();

        const resolution = new VersusResolutionCard(page, resolutionMessageId);
        await resolution.expectPresent();

        // Initiator (party captain, fighter=4) wins.
        expect(await resolution.initiatorIsWinner()).toBe(true);
        expect(await resolution.getWinnerName()).toBe(charAName);

        // Successes: initiator=3 (fighter=4 − 1 unarmed, all-6s),
        // opponent=0 (fighter=2 − 1 unarmed, all-3s → 0 successes).
        // Margin = |3 − 0| = 3.
        const iSuccesses = await resolution.getInitiatorSuccesses();
        const oSuccesses = await resolution.getOpponentSuccesses();
        expect(iSuccesses).toBeGreaterThan(oSuccesses);
        const margin = iSuccesses - oSuccesses;
        expect(margin).toBeGreaterThan(0);

        // Flag-level: winnerId points at initiator's actor id.
        const resFlags = await page.evaluate((mid) => {
          const msg = game.messages.get(mid);
          const vs = msg?.flags?.tb2e?.versus;
          return vs ? { type: vs.type, winnerId: vs.winnerId } : null;
        }, resolutionMessageId);
        expect(resFlags).toEqual({ type: 'resolution', winnerId: captainAId });

        // HP assertion deliberately omitted — same production gap as
        // TEST_PLAN L453 (resolveActionEffect unwired, §18 L500 scope).

        /* ---------- Mark volley resolved ---------- */

        // Switch back to combat tab for the panel button.
        await page.evaluate(() =>
          ui.sidebar?.changeTab?.('combat', 'primary')
        );
        await panel
          .resolveAction(0)
          .locator('button[data-action="resolveAction"]')
          .click();

        // `#onResolveAction` writes `round.volleys[0].result` via
        // `combat.resolveVolley` (combat.mjs L772-782). Interaction is
        // re-derived at conflict-panel.mjs L2028 via
        // `getInteraction(resultSides[0].action, resultSides[1].action)`
        // — both sides scripted feint, so interaction === "versus".
        await expect
          .poll(() => page.evaluate(({ cId }) => {
            const c = game.combats.get(cId);
            const round = c.system.rounds?.[c.system.currentRound];
            const vr = round?.volleys?.[0]?.result;
            if ( !vr ) return null;
            return {
              resolved: !!vr.resolved,
              interaction: vr.interaction ?? null,
              sideCount: vr.sides?.length ?? 0
            };
          }, { cId: combatId }))
          .toEqual({ resolved: true, interaction: 'versus', sideCount: 2 });

        // Auto-advance to the next action (conflict-panel.mjs L2092-2095).
        await expect
          .poll(() => page.evaluate(({ cId }) => {
            const c = game.combats.get(cId);
            return c.system.currentAction ?? null;
          }, { cId: combatId }))
          .toBe(1);

        // Cleanup PRNG before afterEach runs — the stub restoration in
        // afterEach is defensive.
        await page.evaluate(() => {
          if ( globalThis.__tb2eE2EPrevRandomUniform ) {
            CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
            delete globalThis.__tb2eE2EPrevRandomUniform;
          }
        });
      } finally {
        await cleanupTaggedActors(page, tag);
      }
    }
  );
});
