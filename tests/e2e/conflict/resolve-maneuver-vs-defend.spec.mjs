import { test, expect } from '../test.mjs';
import { scriptAndLockActions } from '../helpers/conflict-scripting.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { VersusPendingCard, VersusResolutionCard } from '../pages/VersusCard.mjs';
import { ManeuverSpendDialog } from '../pages/ManeuverSpendDialog.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §16 Conflict: Resolve — Maneuver vs Defend (TEST_PLAN L457, SG p.69 +
 * DH pp.120-127).
 *
 * Rules under test:
 *   - Matrix (config.mjs L421): `"maneuver:defend": "versus"`. Symmetric
 *     `defend:maneuver` also versus (L415). Both sides roll; higher-
 *     successes wins by margin = |iSuccesses - oSuccesses|.
 *   - For a Kill conflict (config.mjs L205-211) both maneuver and defend
 *     roll ability `health`.
 *   - SG p.69: when the winner of a versus action scripted Maneuver and
 *     won by margin ≥ 1, they may spend the Margin of Success on one of
 *     the positioning combos (impede, position, disarm, rearm, or the
 *     pair combos). The combos are capped at MoS 4 (maneuver-spend-
 *     dialog.mjs L72-74).
 *
 * -------------------------------------------------------------------
 * What this spec verifies (narrow — TEST_PLAN L457 only)
 * -------------------------------------------------------------------
 * The L457 checkbox is "versus resolution; MoS opens
 * `maneuver-spend-dialog.mjs`". Scope:
 *   1. `combat.getVolleyInteraction(0)` returns "versus" via matrix
 *      `maneuver:defend` (config.mjs L421).
 *   2. Reveal card carries `.card-interaction.interaction-versus`
 *      (conflict-panel.mjs L1822 → getInteraction).
 *   3. Both roll cards land in the versus pipeline (initiator +
 *      opponent `flags.tb2e.versus.type`), reach
 *      `_executeVersusResolution` (versus.mjs L137-267).
 *   4. Resolution card is posted with `winnerId` = maneuverer's actor
 *      id and margin > 0.
 *   5. Because the winner's `testContext.conflictAction === "maneuver"`
 *      (conflict-panel.mjs L1990), `_executeVersusResolution` sets
 *      `showManeuverSpend = true` (versus.mjs L171-173) and the card
 *      template renders a `data-action="spend-maneuver"` button
 *      (versus-resolution.hbs L39-45).
 *   6. Clicking the spend button dispatches into
 *      `_handleManeuverSpend` (post-roll.mjs L63-107) which imports
 *      `ManeuverSpendDialog` and renders it with the winner's
 *      metadata (post-roll.mjs L85-94, L106).
 *   7. The maneuver-spend dialog mounts (`#maneuver-spend-dialog`,
 *      `.maneuver-spend` content root).
 *
 * The spend itself (choosing impede/position/disarm/rearm, the mailbox
 * write at maneuver-spend-dialog.mjs L265-271, and the GM-side
 * application of those effects) is §17's 7 specs — this spec closes
 * the dialog without submitting.
 *
 * -------------------------------------------------------------------
 * Why this spec is NOT `test.fixme`
 * -------------------------------------------------------------------
 * Every production hook L457 touches is wired:
 *   - Versus pipeline: same as the feint-vs-feint spec (L456).
 *   - Maneuver-spend button emission: versus.mjs L171-182 populates
 *     `maneuverSpendData` on the resolution card's flags + renders the
 *     button from versus-resolution.hbs L39-45.
 *   - Button handler: post-roll.mjs L21-27 (`activatePostRollListeners`)
 *     wires it to `_handleManeuverSpend` which synchronously renders the
 *     dialog (L106).
 *
 * HP damage is NOT asserted — same §18 L500 gap as L453/L456.
 *
 * -------------------------------------------------------------------
 * Test fixture (deterministic)
 * -------------------------------------------------------------------
 *   Kill conflict (config.mjs L202-211 — maneuver = ability:health,
 *   defend = ability:health), 4 characters split 2/2 across the groups.
 *
 *   Party captain (`captainA`): health=4. Scripts MANEUVER on volley 0.
 *     → pool = 4D − 1D unarmed = 3D. PRNG all-6s → 3 successes.
 *   GM captain (`captainB`): health=2. Scripts DEFEND on volley 0.
 *     → pool = 2D − 1D unarmed = 1D. PRNG all-3s → 0 successes.
 *
 *   Margin = |3 − 0| = 3. Party captain (maneuverer) wins. Margin 3 is
 *   the sweet spot — SPEND_COMBINATIONS[3] (maneuver-spend-dialog.mjs
 *   L19-24) offers impede / position / impedePosition / disarm, which
 *   is enough variety that §17's specs can branch on combo choice
 *   without re-staging.
 *
 *   PRNG stubs:
 *     - u=0.001 → Math.ceil((1-u)*6) = 6 — all successes.
 *     - u=0.5  → Math.ceil((1-u)*6) = 3 — all wyrms (0 successes).
 *
 * All Playwright sessions authenticate as GM. Reveal/roll/spend
 * handlers all gate on isGM or actor.isOwner — the GM-only path is
 * exercised here.
 */

async function createCaptainCharacter(page, { name, tag, health }) {
  return page.evaluate(
    async ({ n, t, h }) => {
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
            // Fighter is unused for maneuver/defend in Kill (both use
            // health ability) but present for parity with sibling specs.
            fighter: { rating: 3, pass: 0, fail: 0 }
          },
          conditions: { fresh: false }
        }
      });
      return actor.id;
    },
    { n: name, t: tag, h: health }
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

test.describe('§16 Conflict: Resolve — Maneuver vs Defend', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(async () => {
      if ( globalThis.__tb2eE2EPrevRandomUniform ) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
      // Defensively close the maneuver-spend dialog if an assertion bailed
      // while it was still mounted (the test itself closes it in the happy
      // path). Matches the prior-art ApplicationV2 teardown pattern used
      // in other specs (tie-break.spec.mjs L187).
      const fa = foundry.applications.instances;
      const all = fa?.values ? Array.from(fa.values()) : Object.values(fa ?? {});
      for ( const app of all ) {
        const ctor = app?.constructor?.name ?? '';
        if ( app?.id === 'maneuver-spend-dialog'
          || ctor === 'ManeuverSpendDialog' ) {
          try { await app.close(); } catch {}
        }
      }
      try { game.tb2e?.conflictPanel?.close(); } catch {}
    });
    await page.evaluate(async () => {
      const ids = Array.from(game.combats ?? []).map((c) => c.id);
      if ( ids.length ) await Combat.deleteDocuments(ids);
    });
    // Clear chat log — the reveal + both versus cards + resolution +
    // spend-dialog path accumulate several messages per run; with
    // --repeat-each this can contaminate tail-scan / count assertions
    // (mirrors the cleanup in resolve-feint-vs-feint.spec.mjs L180-183).
    await page.evaluate(async () => {
      const mids = game.messages.contents.map((m) => m.id);
      if ( mids.length ) await ChatMessage.deleteDocuments(mids);
    });
  });

  test(
    'Maneuver vs Defend (versus): maneuverer wins, spend dialog opens (SG p.69)',
    async ({ page }, testInfo) => {
      const tag = `e2e-resolve-mvd-${testInfo.parallelIndex}-${Date.now()}`;
      const stamp = Date.now();
      const charAName = `E2E MvD Captain A ${stamp}`;
      const charBName = `E2E MvD Captain B ${stamp}`;
      const charCName = `E2E MvD Char C ${stamp}`;
      const charDName = `E2E MvD Char D ${stamp}`;

      await page.goto('/game');
      const ui = new GameUI(page);
      await ui.waitForReady();
      await ui.dismissTours();

      // Reveal/roll/resolve + spend-dialog handlers gate on isGM or owner
      // (conflict-panel.mjs L1796/L1847/L2003 and post-roll.mjs L101-104).
      expect(await page.evaluate(() => game.user.isGM)).toBe(true);

      try {
        /* ---------- Arrange actors ---------- */

        // Two captains — one per group. Both characters (NOT monsters)
        // so the action-config-driven ability roll (health for Kill
        // maneuver/defend) is exercised; monsters always roll Nature
        // (conflict-roll.mjs L49-53), which is not this matchup.
        const captainAId = await createCaptainCharacter(page, {
          name: charAName, tag, health: 4
        });
        const captainBId = await createCaptainCharacter(page, {
          name: charBName, tag, health: 2
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

        // Staged via direct writes (same pattern as resolve-feint-vs-
        // feint.spec.mjs L274-298). The action-assign + disposition-
        // rolling UIs are covered by §12/§13 checkboxes.
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
        // L1944-1948. PRNG stubs make dice deterministic regardless;
        // the -1D just shifts the final success counts to the numbers
        // cited in the header ("3 successes" / "0 successes").
        await page.evaluate(async ({ cId, ids }) => {
          const c = game.combats.get(cId);
          for ( const id of ids ) {
            await c.setWeapon(id, 'Fists', '__unarmed__');
          }
        }, { cId: combatId, ids: [cmb.captainA, cmb.charC, cmb.captainB, cmb.charD] });

        await expect(panel.beginScriptingButton).toBeEnabled();
        await panel.clickBeginScripting();

        /* ---------- Scripting: maneuver vs defend on volley 0 ---------- */

        // Party captain MANEUVERS, GM captain DEFENDS. Matrix entry
        // `maneuver:defend` = "versus" (config.mjs L421) — the matchup
        // this spec exists to exercise. Volleys 1 and 2 are filler —
        // `#applyLockActions` (combat.mjs L534) requires all three
        // slots filled to open the lock.
        const partyActions = [
          { action: 'maneuver', combatantId: cmb.captainA },
          { action: 'defend',   combatantId: cmb.charC },
          { action: 'attack',   combatantId: cmb.captainA }
        ];
        const gmActions = [
          { action: 'defend',   combatantId: cmb.captainB },
          { action: 'attack',   combatantId: cmb.charD },
          { action: 'defend',   combatantId: cmb.captainB }
        ];
        /* ---------- Script + lock + resolve ---------- */

        await scriptAndLockActions(page, {
          combatId, partyGroupId, gmGroupId, partyActions, gmActions
        });

        // Precondition: interaction for volley 0 resolves to "versus"
        // via `combat.getVolleyInteraction(0)` (combat.mjs L789-803) →
        // matrix lookup for `maneuver:defend` at config.mjs L421.
        expect(await page.evaluate(({ cId }) => {
          const c = game.combats.get(cId);
          return c.getVolleyInteraction(0);
        }, { cId: combatId })).toBe('versus');

        await expect.poll(() => panel.activeTabId()).toBe('resolve');
        expect(await page.evaluate(({ cId }) => {
          const c = game.combats.get(cId);
          return { phase: c.system.phase, currentAction: c.system.currentAction };
        }, { cId: combatId })).toEqual({ phase: 'resolve', currentAction: 0 });

        /* ---------- Reveal volley 0 ---------- */

        // Reveal button dispatches to `#onRevealAction` (conflict-panel.mjs
        // L1796-1838) which flips `round.volleys[0].revealed = true` AND
        // posts a reveal card from conflict-action-reveal.hbs. The card
        // carries `.card-interaction.interaction-versus` derived from
        // `getInteraction("maneuver", "defend")` (config.mjs L421 → versus).
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

        /* ---------- Roll party Maneuver (initiator) ---------- */

        // Stub PRNG → all-6s. health=4 − 1 unarmed = 3D → 3 successes.
        await page.evaluate(() => {
          globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
          CONFIG.Dice.randomUniform = () => 0.001;
        });

        // `#onRollAction` (conflict-panel.mjs L1917-1919) stamps
        // `isVersus: true` on testContext when sideInteraction ===
        // "versus" per matrix "maneuver:defend" (config.mjs L421).
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

        // Conflict testContext stamped onto the roll message
        // (conflict-panel.mjs L1983-1993). `conflictAction` on the
        // winner's message is the key that `_executeVersusResolution`
        // reads to decide whether to surface the spend prompt
        // (versus.mjs L167-173).
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
          conflictAction: 'maneuver',
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

        /* ---------- Roll GM Defend (opponent) ---------- */

        // Swap PRNG → all-3s. health=2 − 1 unarmed = 1D → 0 successes.
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

        // Versus responder picks initiator's message as the challenge
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
          conflictAction: 'defend',
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

        /* ---------- Versus resolution: maneuverer wins by margin ---------- */

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

        // Maneuverer (initiator, party captain) wins.
        expect(await resolution.initiatorIsWinner()).toBe(true);
        expect(await resolution.getWinnerName()).toBe(charAName);

        // Successes: initiator=3, opponent=0. Margin = 3.
        const iSuccesses = await resolution.getInitiatorSuccesses();
        const oSuccesses = await resolution.getOpponentSuccesses();
        expect(iSuccesses).toBeGreaterThan(oSuccesses);
        const margin = iSuccesses - oSuccesses;
        expect(margin).toBeGreaterThan(0);

        // Flag-level: winnerId points at maneuverer's actor id AND the
        // `maneuverSpend` payload is populated — this is what drives
        // the button rendering on the card.
        const resFlags = await page.evaluate((mid) => {
          const msg = game.messages.get(mid);
          const vs = msg?.flags?.tb2e?.versus;
          const mv = msg?.flags?.tb2e?.maneuverSpend;
          return {
            versusType: vs?.type ?? null,
            winnerId: vs?.winnerId ?? null,
            maneuverSpend: mv ? {
              margin: mv.margin ?? null,
              combatantId: mv.combatantId ?? null,
              groupId: mv.groupId ?? null,
              opponentGroupId: mv.opponentGroupId ?? null,
              volleyIndex: mv.volleyIndex ?? null
            } : null
          };
        }, resolutionMessageId);
        expect(resFlags.versusType).toBe('resolution');
        expect(resFlags.winnerId).toBe(captainAId);
        expect(resFlags.maneuverSpend).toEqual({
          margin,
          combatantId: cmb.captainA,
          groupId: partyGroupId,
          opponentGroupId: gmGroupId,
          volleyIndex: 0
        });

        /* ---------- Spend prompt: button renders, dialog opens ---------- */

        // The versus-resolution.hbs template (L39-45) renders the
        // spend-maneuver button inside `.maneuver-spend-prompt-card`
        // iff `showManeuverSpend`. Assert the button is present on the
        // DOM by scoping to the resolution card in the chat log.
        const spendBtn = resolution.root.locator(
          'button[data-action="spend-maneuver"]'
        );
        await expect(spendBtn).toBeVisible();

        // Click triggers `activatePostRollListeners`' handler
        // (post-roll.mjs L21-27) → `_handleManeuverSpend` (L63-107) →
        // `new ManeuverSpendDialog(args).render(true)` (L106). Native-
        // click pattern (same rationale as VersusPendingCard.clickFinalize):
        // the chat-log scroll container confuses Playwright's viewport
        // math but the production handler is a plain
        // `addEventListener("click", ...)`.
        await spendBtn.evaluate((btn) => btn.click());

        // Dialog mounts with `id: "maneuver-spend-dialog"` (maneuver-
        // spend-dialog.mjs L78). This is the L457 assertion.
        const spendDialog = new ManeuverSpendDialog(page);
        await spendDialog.waitForOpen();

        // The dialog should show the margin as "MoS 3" and offer the
        // MoS-3 combo list (impede / position / impedePosition / disarm
        // per SPEND_COMBINATIONS[3] at maneuver-spend-dialog.mjs L19-24).
        const mosText = (await spendDialog.mosLabel.innerText()).trim();
        expect(mosText).toContain(String(margin));
        // Combo count sanity — MoS 3 → 4 combos (L19-24).
        await expect(spendDialog.combos).toHaveCount(4);
        // Specific combo keys present.
        await expect(spendDialog.comboRadio('impede')).toHaveCount(1);
        await expect(spendDialog.comboRadio('position')).toHaveCount(1);
        await expect(spendDialog.comboRadio('impedePosition')).toHaveCount(1);
        await expect(spendDialog.comboRadio('disarm')).toHaveCount(1);

        /* ---------- Close dialog (spend itself is §17 scope) ---------- */

        // No mailbox write should have occurred yet — we close without
        // submitting. §17's 7 specs drive the submit path per combo.
        await spendDialog.close();

        const pendingSpend = await page.evaluate(({ cId, cmbId }) => {
          const c = game.combats.get(cId);
          const cmb = c?.combatants.get(cmbId);
          return cmb?.system?.pendingManeuverSpend ?? null;
        }, { cId: combatId, cmbId: cmb.captainA });
        // `pendingManeuverSpend` is typed as an object on the data
        // model; its default is an empty object. Only asserting we
        // don't carry a populated selection.
        expect(pendingSpend?.selection ?? null).toBeFalsy();

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
        // — maneuver + defend → "versus".
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
