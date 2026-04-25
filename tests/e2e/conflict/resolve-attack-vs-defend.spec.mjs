import { test, expect } from '../test.mjs';
import { scriptAndLockActions } from '../helpers/conflict-scripting.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { VersusPendingCard, VersusResolutionCard } from '../pages/VersusCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §16 Conflict: Resolve — Attack vs Defend (TEST_PLAN L453, DH pp.120-127).
 *
 * Rules under test:
 *   - DH pp.120-127: action vs action resolution. Actions are revealed
 *     one volley at a time, the interaction type is derived from both
 *     sides' action keys, both sides roll per their action config, and
 *     the higher-successes side wins the volley with margin = delta.
 *   - `attack:defend` is a **versus** interaction per the matrix at
 *     config.mjs L407-424 (symmetric: `defend:attack` is also versus).
 *     For Kill conflicts (config.mjs L205-211), attack rolls skill
 *     `fighter` and defend rolls ability `health`.
 *   - Checkbox (TEST_PLAN L453): "versus resolution, higher successes
 *     wins; HP reduced by margin on loser".
 *
 * -------------------------------------------------------------------
 * Production gap — why this spec is `test.fixme`
 * -------------------------------------------------------------------
 * The resolve mechanism (reveal → both sides roll versus → mark
 * resolved) is fully wired:
 *   - `combat.beginResolve` (combat.mjs L357-373) flips phase to
 *     "resolve" and resets `currentAction = 0`.
 *   - `ConflictPanel.#onRevealAction` (conflict-panel.mjs L1796-1838)
 *     flips `round.volleys[i].revealed = true` and posts a reveal
 *     chat card rendered from templates/chat/conflict-action-reveal.hbs.
 *   - `ConflictPanel.#onRollAction` (conflict-panel.mjs L1847-1995)
 *     resolves the per-side interaction via `getInteraction` (conflict-
 *     roll.mjs L14-16), and when it equals "versus" it stamps
 *     `testContext.isVersus = true` (L1992) on the roll before calling
 *     `rollTest`. That lands the roll in `_handleVersusRoll` (tb2e-
 *     roll.mjs L1580-1650) which posts a pending card and registers it
 *     in `PendingVersusRegistry` (versus.mjs L18-20).
 *   - Finalize on both cards (via `_handleFinalize` post-roll.mjs
 *     L506-522) routes into `_executeVersusResolution` (versus.mjs
 *     L137-267) which posts a versus-resolution card naming the winner
 *     and recording margin = |iSuccesses - oSuccesses| (L170).
 *   - `#onResolveAction` (conflict-panel.mjs L2003-2096) writes
 *     `round.volleys[i].result = { resolved, sides, interaction,
 *     interactionLabel, timestamp }` via `combat.resolveVolley`
 *     (combat.mjs L772-782).
 *
 * **But the "HP reduced by margin on loser" half of the checkbox is
 * not implemented.** Nothing in `_executeVersusResolution`, in
 * `#onResolveAction`, or elsewhere in the resolve pipeline mutates the
 * loser's `system.conflict.hp.value`. `resolveActionEffect` (conflict-
 * roll.mjs L155-178) returns the correct `{ type: "damage", amount:
 * margin }` descriptor for attacks but is imported only as dead code
 * at conflict-panel.mjs L3 — no call site consumes it.
 *
 * The only HP write paths in production are:
 *   - The GM roster input at conflict-panel.mjs L341-360 — a manual
 *     GM edit, not auto-applied from roll margins.
 *   - The `pendingConflictHP` mailbox (tb2e.mjs L193-204) — captain-
 *     writes-for-teammate, also manual.
 *   - `calculateDisposition` / `distributeDisposition` (combat.mjs
 *     L219-242) — sets the starting pool, not damage-on-miss.
 *
 * Checkbox TEST_PLAN L500 (§18 Conflict: HP & KO, `hp-damage-reduces.
 * spec.mjs`) is where the HP-auto-write will be encoded once wired.
 *
 * -------------------------------------------------------------------
 * Fix shape
 * -------------------------------------------------------------------
 * A natural hook point is the end of `_executeVersusResolution` in
 * versus.mjs — when both sides carry conflict testContext (combatId,
 * combatantId, conflictAction, opponentGroupId) and the winner's action
 * is attack/feint (damage) or defend (restore), walk every combatant
 * on the loser-group (or winner-group for defend-restore) and apply
 * the margin-derived mutation from `resolveActionEffect`. Alternately
 * do it in `#onResolveAction` (combat-panel.mjs L2003+) by reading the
 * paired resolution-card flag and walking the combatants. Either way,
 * use the `pendingConflictHP` mailbox for non-GM writers (CLAUDE.md
 * §Mailbox Pattern).
 *
 * When that lands:
 *   - Drop the `test.fixme` here.
 *   - Flip TEST_PLAN.md L453 to `- [x]` (with citations).
 *   - Add §18 L500 coverage for the detailed HP/KO behaviors.
 *
 * -------------------------------------------------------------------
 * Test fixture (deterministic)
 * -------------------------------------------------------------------
 *   Kill conflict (config.mjs L202-211 — attack=skill:fighter,
 *   defend=ability:health), 2 characters + 2 monsters.
 *
 *   Party captain (`captainA`): fighter=3, health=4. Scripts ATTACK
 *   on volley 0.
 *   GM captain (`monA`): a Bugbear (packs/_source/monsters/
 *   Bugbear_…yml). Monsters roll Nature for every action (conflict-
 *   roll.mjs L49-53), so the script slot type doesn't matter — GM
 *   rolls Nature with PRNG-stubbed dice regardless.
 *
 *   Both sides get distributed HP via `distributeDisposition` — party
 *   captain ends at HP=4, GM captain at HP=4.
 *
 *   PRNG stubs:
 *     - u=0.001 → Math.ceil((1-u)*6) = 6 — all successes.
 *     - u=0.5  → Math.ceil((1-u)*6) = 3 — all wyrms (0 successes).
 *
 *   Sequence for volley 0 (attack vs defend, versus):
 *     1. Stub PRNG → all-6s. Party captain rolls Attack (fighter=3 →
 *        3 successes).
 *     2. Finalize → card goes into `PendingVersusRegistry`.
 *     3. Stub PRNG → all-3s. GM captain rolls Defend (monster Nature
 *        — Bugbear Nature=4 per monster YAML → 0 successes).
 *     4. Finalize → `_executeVersusResolution` posts the resolution
 *        card naming party captain as winner, margin = 3.
 *     5. EXPECTED (fixme): GM-captain's `combatant.actor.system.
 *        conflict.hp.value` drops from 4 to 1 (4 - 3 margin).
 *     6. Party captain's HP untouched at 4 (no cascade — defend
 *        interaction doesn't damage the attacker on loss; SG p.69
 *        / DH p.123).
 *     7. Mark resolved (`#onResolveAction` writes `volley.result`).
 *
 * Scope (narrow — TEST_PLAN L453 only):
 *   - Only verifies Attack vs Defend versus resolution. Attack vs
 *     Attack (independent, L454), Feint vs Attack (none, L455), and
 *     Maneuver (L457) are out of scope.
 *   - Only volley 0 is exercised; the `#onResolveAction` auto-advance
 *     path (conflict-panel.mjs L2093-2095 → `combat.nextAction`) is
 *     asserted once but the downstream volleys aren't exercised here.
 *   - KO detection (HP hitting 0) is §18 L502 scope.
 *
 * All Playwright sessions authenticate as GM (auth.setup.mjs L14-35).
 * The resolve/reveal/roll-action handlers all gate on isGM or owner
 * — the GM-only path is the one exercised here.
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

async function createCaptainCharacter(page, { name, tag, fighter, health }) {
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

test.describe('§16 Conflict: Resolve — Attack vs Defend', () => {
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
  });

  test(
    'Attack vs Defend (versus): attacker wins by margin, HP unchanged (manual GM application; DH pp.120-127)',
    async ({ page }, testInfo) => {
      const tag = `e2e-resolve-avd-${testInfo.parallelIndex}-${Date.now()}`;
      const stamp = Date.now();
      const charAName = `E2E AvD Captain ${stamp}`;
      const charBName = `E2E AvD Char B ${stamp}`;
      const monAName = `E2E AvD Bugbear ${stamp}`;
      const monBName = `E2E AvD Goblin ${stamp}`;

      await page.goto('/game');
      const ui = new GameUI(page);
      await ui.waitForReady();
      await ui.dismissTours();

      // Reveal/roll/resolve handlers all assume GM in this harness
      // (conflict-panel.mjs L1796/L1847/L2003 — gated by isGM or
      // actor.isOwner; harness is GM-only per auth.setup.mjs L14-35).
      expect(await page.evaluate(() => game.user.isGM)).toBe(true);

      try {
        /* ---------- Arrange actors ---------- */

        const captainId = await createCaptainCharacter(page, {
          name: charAName, tag, fighter: 3, health: 4
        });
        const charBId = await createCharacter(page, { name: charBName, tag });
        const monAId = await importMonster(page, {
          sourceName: 'Bugbear', uniqueName: monAName, tag
        });
        const monBId = await importMonster(page, {
          sourceName: 'Goblin', uniqueName: monBName, tag
        });

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
        cmb.captain = await panel.addCombatant({
          combatId, actorId: captainId, groupId: partyGroupId
        });
        cmb.charB = await panel.addCombatant({
          combatId, actorId: charBId, groupId: partyGroupId
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

        // Prior art L427/L428/L430/L431 — action-assign + lock + weapons
        // UIs are covered elsewhere. Stage disposition via direct writes.
        await page.evaluate(async ({ cId, pId, gId }) => {
          const c = game.combats.get(cId);
          await c.storeDispositionRoll(pId, {
            rolled: 7, diceResults: [], cardHtml: '<em>E2E</em>'
          });
          await c.storeDispositionRoll(gId, {
            rolled: 8, diceResults: [], cardHtml: '<em>E2E</em>'
          });
        }, { cId: combatId, pId: partyGroupId, gId: gmGroupId });

        await page.evaluate(async ({ cId, pId, gId, capId, bId, mAId, mBId }) => {
          const c = game.combats.get(cId);
          const party = {}; party[capId] = 4; party[bId] = 3;
          const gm = {};    gm[mAId]   = 4; gm[mBId]   = 4;
          await c.distributeDisposition(pId, party);
          await c.distributeDisposition(gId, gm);
        }, {
          cId: combatId,
          pId: partyGroupId,
          gId: gmGroupId,
          capId: cmb.captain,
          bId: cmb.charB,
          mAId: cmb.monA,
          mBId: cmb.monB
        });

        await expect(panel.beginWeaponsButton).toBeEnabled();
        await panel.clickBeginWeapons();

        /* ---------- Weapons: unarmed for everyone ---------- */

        // `__unarmed__` applies a flat -1D via the weapons modifier at
        // conflict-panel.mjs L1944-1948; the PRNG stub makes this
        // deterministic anyway (all-6s means 2D still → 2 successes).
        await page.evaluate(async ({ cId, ids }) => {
          const c = game.combats.get(cId);
          for ( const id of ids ) {
            await c.setWeapon(id, 'Fists', '__unarmed__');
          }
        }, { cId: combatId, ids: [cmb.captain, cmb.charB, cmb.monA, cmb.monB] });

        await expect(panel.beginScriptingButton).toBeEnabled();
        await panel.clickBeginScripting();

        /* ---------- Scripting: attack vs defend on volley 0 ---------- */

        // Party side: captain attacks on volley 0 — the matchup this
        // spec exists to exercise. Volleys 1 and 2 are filler so the
        // locked-state gate (combat.mjs L534, applyLockActions only
        // fires if all three slots are filled) opens.
        // GM side: monA defends on volley 0. The matrix (config.mjs
        // L409 `attack:defend`) returns "versus" — the interaction
        // under test.
        const partyActions = [
          { action: 'attack',   combatantId: cmb.captain },
          { action: 'defend',   combatantId: cmb.charB },
          { action: 'feint',    combatantId: cmb.captain }
        ];
        const gmActions = [
          { action: 'defend',   combatantId: cmb.monA },
          { action: 'attack',   combatantId: cmb.monB },
          { action: 'defend',   combatantId: cmb.monA }
        ];
        /* ---------- Script + lock + resolve ---------- */

        await scriptAndLockActions(page, {
          combatId, partyGroupId, gmGroupId, partyActions, gmActions
        });

        // Precondition: interaction for volley 0 resolves to "versus"
        // via `combat.getVolleyInteraction(0)` (combat.mjs L789-803) —
        // the matrix lookup for `attack:defend` at config.mjs L409.
        expect(await page.evaluate(({ cId }) => {
          const c = game.combats.get(cId);
          return c.getVolleyInteraction(0);
        }, { cId: combatId })).toBe('versus');

        await expect.poll(() => panel.activeTabId()).toBe('resolve');
        expect(await page.evaluate(({ cId }) => {
          const c = game.combats.get(cId);
          return { phase: c.system.phase, currentAction: c.system.currentAction };
        }, { cId: combatId })).toEqual({ phase: 'resolve', currentAction: 0 });

        // Pre-resolve HP snapshot — the damage assertion reads these
        // as the "before" values.
        const hpBefore = await page.evaluate(({ capA, mA }) => {
          return {
            captainA: game.actors.get(capA)?.system.conflict?.hp?.value ?? null,
            monA: game.actors.get(mA)?.system.conflict?.hp?.value ?? null
          };
        }, { capA: captainId, mA: monAId });
        expect(hpBefore).toEqual({ captainA: 4, monA: 4 });

        /* ---------- Reveal volley 0 ---------- */

        // Reveal button (panel-resolve.hbs L56) dispatches to
        // `#onRevealAction` (conflict-panel.mjs L1796-1838) which
        // flips `round.volleys[0].revealed = true` AND posts a chat
        // card from conflict-action-reveal.hbs. Asserting the card
        // exists (with `interaction: "versus"` on its matchup block)
        // is the first user-visible signal the pipeline is alive.
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

        // The reveal card carries the interaction label on its body
        // (conflict-action-reveal.hbs L16-18 renders
        // `.card-interaction.interaction-versus` with the localized
        // label). We find it by scanning the tail of the chat log.
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

        /* ---------- Roll party Attack (initiator) ---------- */

        // Stub PRNG → all-6s for the attacker. fighter=3 plus unarmed
        // -1D (conflict-panel.mjs L1944-1948) gives pool=2 → 2
        // successes on an all-6s roll.
        await page.evaluate(() => {
          globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
          CONFIG.Dice.randomUniform = () => 0.001;
        });

        const chatCountBeforeAttack = await page.evaluate(
          () => game.messages.contents.length
        );

        // The roll button is emitted for the attacker's side of volley 0
        // (panel-resolve.hbs L103-108, rendered iff `canRoll` and the
        // side's `sideInteraction !== "none"`). `#onRollAction`
        // (conflict-panel.mjs L1917-1919) sets `isVersus: true` on
        // testContext when the interaction is versus, which pre-selects
        // versus mode in the roll dialog (tb2e-roll.mjs L928-937).
        const attackRollBtn = panel
          .resolveAction(0)
          .locator(`button[data-action="rollAction"][data-group-id="${partyGroupId}"]`);
        await expect(attackRollBtn).toBeVisible();
        await attackRollBtn.click();

        const attackDialog = new RollDialog(page);
        await attackDialog.waitForOpen();
        // Dialog mode was pre-set to versus by `#onRollAction`.
        expect(await attackDialog.modeInput.inputValue()).toBe('versus');
        await attackDialog.submit();

        const attackMessageId = await page.evaluate(async (actorId) => {
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
        }, captainId);
        expect(attackMessageId).toBeTruthy();

        // Sanity: the conflict testContext is stamped onto the roll
        // message (conflict-panel.mjs L1983-1993) — this is the
        // metadata the fix-shape would use to drive the auto-HP write.
        const attackCtx = await page.evaluate((mid) => {
          const msg = game.messages.get(mid);
          const tc = msg?.flags?.tb2e?.testContext;
          return tc ? {
            isConflict: !!tc.isConflict,
            isVersus: !!tc.isVersus,
            conflictAction: tc.conflictAction ?? null,
            groupId: tc.groupId ?? null,
            opponentGroupId: tc.opponentGroupId ?? null
          } : null;
        }, attackMessageId);
        expect(attackCtx).toEqual({
          isConflict: true,
          isVersus: true,
          conflictAction: 'attack',
          groupId: partyGroupId,
          opponentGroupId: gmGroupId
        });

        // Need the chat tab to see the card — the tracker's open()
        // switched the sidebar to combat.
        await page.evaluate(() =>
          ui.sidebar?.changeTab?.('chat', 'primary')
        );

        const attackCard = new VersusPendingCard(page, attackMessageId);
        await attackCard.expectPresent();
        await attackCard.expectPending();
        await attackCard.clickFinalize();
        await expect(attackCard.resolvedBanner).toBeVisible();

        /* ---------- Roll GM Defend (opponent) ---------- */

        // Swap PRNG → all-3s (all wyrms). Monster Nature test — Bugbear
        // has `system.nature = 4` (packs/_source/monsters/Bugbear…) →
        // pool=4, unarmed -1D → 3D, all-3s → 0 successes.
        await page.evaluate(() => {
          CONFIG.Dice.randomUniform = () => 0.5;
        });

        // The roll button for the GM side of volley 0 targets the
        // gmGroupId — `#onRollAction` reads data-group-id from the
        // button itself (conflict-panel.mjs L1858) and builds the
        // correct versus testContext (opponentGroupId flips relative
        // to the attacker's).
        const defendRollBtn = panel
          .resolveAction(0)
          .locator(`button[data-action="rollAction"][data-group-id="${gmGroupId}"]`);
        // Switching back to the combat tab so the roll-button selector
        // resolves against the mounted panel DOM.
        await page.evaluate(() =>
          ui.sidebar?.changeTab?.('combat', 'primary')
        );
        await expect(defendRollBtn).toBeVisible();
        await defendRollBtn.click();

        const defendDialog = new RollDialog(page);
        await defendDialog.waitForOpen();
        expect(await defendDialog.modeInput.inputValue()).toBe('versus');

        // The versus-responder path uses the challenge dropdown to
        // pick the initiator's message as the challenge
        // (VersusDialogExtras.selectChallenge). The dropdown is
        // populated on both initial render and the `createChatMessage`
        // hook (tb2e-roll.mjs L1032-1045) — so the attacker's message
        // is in-list by this point.
        const challengeSelect = defendDialog.root.locator(
          'select[name="challengeMessageId"]'
        );
        await expect(challengeSelect).toHaveCount(1);
        await expect(
          challengeSelect.locator(`option[value="${attackMessageId}"]`)
        ).toHaveCount(1);
        await challengeSelect.selectOption(attackMessageId);
        await defendDialog.submit();

        const defendMessageId = await page.evaluate(async ({ mId }) => {
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
        }, { mId: attackMessageId });
        expect(defendMessageId).toBeTruthy();

        await page.evaluate(() =>
          ui.sidebar?.changeTab?.('chat', 'primary')
        );
        const defendCard = new VersusPendingCard(page, defendMessageId);
        await defendCard.expectPresent();
        await defendCard.expectPending();
        await defendCard.clickFinalize();

        /* ---------- Versus resolution: attacker wins by margin ---------- */

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
        }, { aId: attackMessageId, dId: defendMessageId });
        expect(resolutionMessageId).toBeTruthy();

        const resolution = new VersusResolutionCard(page, resolutionMessageId);
        await resolution.expectPresent();

        // Attacker (initiator) wins.
        expect(await resolution.initiatorIsWinner()).toBe(true);
        expect(await resolution.getWinnerName()).toBe(charAName);

        // Successes: attacker=2 (3 fighter − 1 unarmed, all-6s),
        // defender=0 (4 nature − 1 unarmed, all-3s → 0 successes).
        // Margin = |2 − 0| = 2.
        const iSuccesses = await resolution.getInitiatorSuccesses();
        const oSuccesses = await resolution.getOpponentSuccesses();
        expect(iSuccesses).toBeGreaterThan(oSuccesses);
        const margin = iSuccesses - oSuccesses;
        expect(margin).toBeGreaterThan(0);

        // Flag-level: winnerId points at attacker's actor id.
        const resFlags = await page.evaluate((mid) => {
          const msg = game.messages.get(mid);
          const vs = msg?.flags?.tb2e?.versus;
          return vs ? { type: vs.type, winnerId: vs.winnerId } : null;
        }, resolutionMessageId);
        expect(resFlags).toEqual({ type: 'resolution', winnerId: captainId });

        // --- HP ANTI-SPEC: manual application by design ------------------
        // The resolution pipeline does NOT auto-apply HP damage. The GM
        // applies the margin manually via the panel HP controls
        // (conflict-panel.mjs L341-360). Both combatants' HP must stay
        // at their starting disposition (4 each) after the resolution
        // card posts.
        const hpAfter = await page.evaluate(({ capA, mA }) => {
          return {
            captainA: game.actors.get(capA)?.system.conflict?.hp?.value ?? null,
            monA: game.actors.get(mA)?.system.conflict?.hp?.value ?? null
          };
        }, { capA: captainId, mA: monAId });
        expect(hpAfter.captainA).toBe(4);
        expect(hpAfter.monA).toBe(4);
        // `margin` is still computed and surfaced via the resolution
        // card; it just isn't auto-written to HP.
        expect(margin).toBeGreaterThan(0);

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
        // `combat.resolveVolley` (combat.mjs L772-782) — the structural
        // record that the volley is done. Interaction + sides are
        // preserved (conflict-panel.mjs L2032-2038).
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

        // Clean up PRNG before afterEach runs — the stub restoration
        // in afterEach is defensive.
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
