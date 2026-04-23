import { test, expect } from '../test.mjs';
import { scriptAndLockActions } from '../helpers/conflict-scripting.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §16 Conflict: Resolve — card reveal DOM presence
 * (TEST_PLAN L458, DH pp.120-127).
 *
 * What this spec asserts
 * ----------------------
 *   Per the §16 briefing: "assert the playing-card DOM elements appear
 *   on reveal." The spec is scoped narrowly to DOM presence at the
 *   reveal transition — NOT animation timing, visual regression, or
 *   resolve mechanics (covered by L454-L457, §17, §18).
 *
 *   Two DOM surfaces carry the revealed action cards:
 *
 *   1. The resolve-tab panel (templates/conflict/panel-resolve.hbs
 *      L67-114): before reveal, the current action row renders only a
 *      `button[data-action="revealAction"]` (L56-58). After reveal
 *      (`this.isRevealed` true), the `{{#unless}}...{{else}}` branch
 *      at L65 flips on and renders `.resolve-matchup` containing one
 *      `.resolve-side` per combatant group, each with a
 *      `.resolve-action-card.action-card-{{action}}` "card" built from
 *      an action-colored icon + `.action-card-label` (L82-85).
 *      Between the two sides lives a `.resolve-vs` separator (L112).
 *
 *   2. The reveal chat card (templates/chat/conflict-action-reveal.hbs
 *      L1-19): posted by `#onRevealAction` (conflict-panel.mjs
 *      L1825-1837). Renders `.conflict-reveal-card` with
 *      `.card-matchup` containing per-side
 *      `.card-matchup-action.action-{{action}}` chips, separated by
 *      `.card-matchup-vs`, plus `.card-interaction.interaction-{{key}}`
 *      (L16-18).
 *
 *   The script-phase "playing cards" with the 3D flip animation
 *   (`.script-card-flip`, `.script-card-face`, `.script-card-back`,
 *   `.script-card-front`) are rendered in `panel-script.hbs` — NOT in
 *   the resolve phase. The resolve-tab cards are flat, not flipped;
 *   the "reveal" is a template-branch swap driven by the
 *   `revealVolley` write, not a CSS flip. The briefing calling them
 *   "playing-card" is a loose label for the post-reveal action cards.
 *
 * Why this spec does NOT test.fixme
 * ----------------------------------
 *   The reveal DOM is fully wired — `#onRevealAction`
 *   (conflict-panel.mjs L1796-1838) flips `round.volleys[i].revealed`
 *   to true via `combat.revealVolley`, re-renders the panel through
 *   the updateCombat hook, AND posts the chat card. Both DOM surfaces
 *   are asserted deterministically. No known production gap applies
 *   to reveal rendering itself (the L453/L500 HP gap is about resolve
 *   mechanics, not reveal rendering).
 *
 * Scope — narrow by design:
 *   - Only the DOM presence of reveal surfaces is asserted. The roll
 *     pipeline, resolve-action mechanics, and HP mutation are covered
 *     elsewhere (L454, L456, L500).
 *   - Only volley 0 is revealed; downstream volleys are not driven.
 *   - Visual regression / snapshot testing is explicitly out of scope
 *     per TEST_PLAN.md guardrails.
 *   - Animation timing (CSS transitions, `.script-card-flip`
 *     perspective at panel.less L1180-1199) is not asserted — that's
 *     the script phase, not resolve.
 *
 * Test fixture — deterministic, minimal
 * -------------------------------------
 *   Kill conflict, 4 characters split 2/2. Both captains script
 *   ATTACK on volley 0 → `attack:attack` = "independent" (config.mjs
 *   L408). Why characters vs monsters: reveal DOM depends only on the
 *   action keys + combatant names, not on dice rolls or actor types,
 *   so characters keep the fixture the same shape as L454/L456 while
 *   avoiding any interaction with the monster-Nature branch.
 *
 *   No PRNG stub is needed — the spec never triggers a roll. The
 *   only writes are staged via the combat API (setActions,
 *   lockActions, beginResolve) and the reveal button click.
 *
 * All Playwright sessions authenticate as GM (auth.setup.mjs
 * L14-35). The reveal button is GM-only (panel-resolve.hbs L55-58).
 */

async function createCharacter(page, { name, tag }) {
  return page.evaluate(
    async ({ n, t }) => {
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
            fighter: { rating: 3, pass: 0, fail: 0 }
          },
          conditions: { fresh: false }
        }
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

test.describe('§16 Conflict: Resolve — card reveal DOM', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => {
      try { game.tb2e?.conflictPanel?.close(); } catch {}
    });
    await page.evaluate(async () => {
      const ids = Array.from(game.combats ?? []).map((c) => c.id);
      if ( ids.length ) await Combat.deleteDocuments(ids);
    });
    // The reveal posts a chat message; clear per-test so count-based
    // baseline reads in subsequent runs stay clean (mirrors L454).
    await page.evaluate(async () => {
      const mids = game.messages.contents.map((m) => m.id);
      if ( mids.length ) await ChatMessage.deleteDocuments(mids);
    });
  });

  test(
    'Revealing a volley renders .resolve-action-card + chat reveal card (panel-resolve.hbs L82-85, conflict-action-reveal.hbs L8-18)',
    async ({ page }, testInfo) => {
      const tag = `e2e-reveal-dom-${testInfo.parallelIndex}-${Date.now()}`;
      const stamp = Date.now();
      const partyCaptainName = `E2E Reveal P-Cap ${stamp}`;
      const partyBName       = `E2E Reveal P-B ${stamp}`;
      const gmCaptainName    = `E2E Reveal G-Cap ${stamp}`;
      const gmBName          = `E2E Reveal G-B ${stamp}`;

      await page.goto('/game');
      const ui = new GameUI(page);
      await ui.waitForReady();
      await ui.dismissTours();

      // Reveal handler is GM-only (panel-resolve.hbs L55 gate).
      expect(await page.evaluate(() => game.user.isGM)).toBe(true);

      try {
        /* ---------- Arrange actors (4 characters, 2/2 split) ---------- */

        const partyCapId = await createCharacter(page, {
          name: partyCaptainName, tag
        });
        const partyBId = await createCharacter(page, {
          name: partyBName, tag
        });
        const gmCapId = await createCharacter(page, {
          name: gmCaptainName, tag
        });
        const gmBId = await createCharacter(page, {
          name: gmBName, tag
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

        /* ---------- Setup ---------- */

        const panel = new ConflictPanel(page);
        await panel.open();
        expect(await panel.activeTabId()).toBe('setup');

        const cmb = {};
        cmb.partyCap = await panel.addCombatant({
          combatId, actorId: partyCapId, groupId: partyGroupId
        });
        cmb.partyB = await panel.addCombatant({
          combatId, actorId: partyBId, groupId: partyGroupId
        });
        cmb.gmCap = await panel.addCombatant({
          combatId, actorId: gmCapId, groupId: gmGroupId
        });
        cmb.gmB = await panel.addCombatant({
          combatId, actorId: gmBId, groupId: gmGroupId
        });
        await expect(panel.setupCombatants).toHaveCount(4);

        await panel.clickCaptainButton(cmb.partyCap);
        await panel.clickCaptainButton(cmb.gmCap);
        await panel.selectConflictType('kill');

        await expect(panel.beginDispositionButton).toBeEnabled();
        await panel.clickBeginDisposition();

        /* ---------- Disposition: flat-set, then distribute ---------- */

        // Direct-API writes to bypass the disposition-roll UI (not
        // under test here; covered at L427/L428/L430/L431). Prior art:
        // resolve-attack-vs-attack.spec.mjs L289-313.
        await page.evaluate(async ({ cId, pId, gId }) => {
          const c = game.combats.get(cId);
          await c.storeDispositionRoll(pId, {
            rolled: 7, diceResults: [], cardHtml: '<em>E2E</em>'
          });
          await c.storeDispositionRoll(gId, {
            rolled: 7, diceResults: [], cardHtml: '<em>E2E</em>'
          });
        }, { cId: combatId, pId: partyGroupId, gId: gmGroupId });

        await page.evaluate(
          async ({ cId, pId, gId, pCap, pB, gCap, gB }) => {
            const c = game.combats.get(cId);
            const party = {}; party[pCap] = 4; party[pB] = 3;
            const gm    = {}; gm[gCap]   = 4; gm[gB]   = 3;
            await c.distributeDisposition(pId, party);
            await c.distributeDisposition(gId, gm);
          },
          {
            cId: combatId,
            pId: partyGroupId, gId: gmGroupId,
            pCap: cmb.partyCap, pB: cmb.partyB,
            gCap: cmb.gmCap,    gB: cmb.gmB
          }
        );

        await expect(panel.beginWeaponsButton).toBeEnabled();
        await panel.clickBeginWeapons();

        /* ---------- Weapons: unarmed for everyone ---------- */

        await page.evaluate(async ({ cId, ids }) => {
          const c = game.combats.get(cId);
          for ( const id of ids ) {
            await c.setWeapon(id, 'Fists', '__unarmed__');
          }
        }, {
          cId: combatId,
          ids: [cmb.partyCap, cmb.partyB, cmb.gmCap, cmb.gmB]
        });

        await expect(panel.beginScriptingButton).toBeEnabled();
        await panel.clickBeginScripting();

        /* ---------- Scripting: both captains attack on volley 0 ---------- */

        const partyActions = [
          { action: 'attack',   combatantId: cmb.partyCap },
          { action: 'defend',   combatantId: cmb.partyB },
          { action: 'feint',    combatantId: cmb.partyCap }
        ];
        const gmActions = [
          { action: 'attack',   combatantId: cmb.gmCap },
          { action: 'defend',   combatantId: cmb.gmB },
          { action: 'feint',    combatantId: cmb.gmCap }
        ];
        /* ---------- Script + lock + resolve ---------- */

        await scriptAndLockActions(page, {
          combatId, partyGroupId, gmGroupId, partyActions, gmActions
        });

        await expect.poll(() => panel.activeTabId()).toBe('resolve');
        expect(await page.evaluate(({ cId }) => {
          const c = game.combats.get(cId);
          return { phase: c.system.phase, currentAction: c.system.currentAction };
        }, { cId: combatId })).toEqual({ phase: 'resolve', currentAction: 0 });

        /* ---------- PRE-REVEAL DOM: reveal button, no action cards ---------- */

        const currentAction = panel.resolveAction(0);

        // Current-action row carries the `.current` marker from
        // panel-resolve.hbs L21 — indexes resolveActions[0] as the
        // currently focused volley.
        await expect(currentAction).toHaveClass(/\bcurrent\b/);

        // Before reveal: template L35 (`{{#unless this.isRevealed}}`)
        // renders the Reveal button and suppresses the `.resolve-matchup`
        // branch. The post-reveal action cards must not yet exist.
        await expect(
          currentAction.locator('button[data-action="revealAction"]')
        ).toBeVisible();
        await expect(currentAction.locator('.resolve-matchup')).toHaveCount(0);
        await expect(currentAction.locator('.resolve-action-card')).toHaveCount(0);

        /* ---------- Click Reveal ---------- */

        // Snapshot chat count so we can assert the reveal chat card
        // was posted (conflict-panel.mjs L1834-1837).
        const chatCountBeforeReveal = await page.evaluate(
          () => game.messages.contents.length
        );

        await currentAction
          .locator('button[data-action="revealAction"]')
          .click();

        // Server-side: `#onRevealAction` (conflict-panel.mjs L1796-1800)
        // calls `combat.revealVolley(0)` which flips
        // `round.volleys[0].revealed = true`.
        await expect
          .poll(() => page.evaluate(({ cId }) => {
            const c = game.combats.get(cId);
            const round = c.system.rounds?.[c.system.currentRound];
            return round?.volleys?.[0]?.revealed ?? null;
          }, { cId: combatId }))
          .toBe(true);

        /* ---------- POST-REVEAL DOM: the action cards ---------- */

        // The panel re-renders via updateCombat (conflict-panel.mjs
        // L120-129) so `this.isRevealed` flips true on the resolve
        // context (L1186-1208). The `{{#unless}}...{{else}}` branch at
        // panel-resolve.hbs L65 swaps the Reveal button out and the
        // `.resolve-matchup` block in (L67-114).
        const matchup = currentAction.locator('.resolve-matchup');
        await expect(matchup).toBeVisible();

        // Two `.resolve-side` blocks — one per CombatantGroup
        // (panel-resolve.hbs L69 `{{#each this.sides}}`).
        const sides = matchup.locator('.resolve-side');
        await expect(sides).toHaveCount(2);

        // The action-card pair — panel-resolve.hbs L82-85:
        //   <div class="resolve-action-card action-card-{{this.action}}">
        //     <i class="{{this.actionIcon}}"></i>
        //     <span class="action-card-label">...</span>
        //   </div>
        //
        // Both sides scripted ATTACK on volley 0 → both cards carry
        // `.action-card-attack`. This is the core "playing-card DOM
        // elements appear on reveal" assertion.
        const attackCards = matchup.locator(
          '.resolve-action-card.action-card-attack'
        );
        await expect(attackCards).toHaveCount(2);

        // Each card has an icon <i> (template L83) and a
        // `.action-card-label` span (L84). Assert on the first
        // card — shape is identical for both by construction.
        await expect(attackCards.first().locator('i')).toHaveCount(1);
        const firstLabel = attackCards.first().locator('.action-card-label');
        await expect(firstLabel).toBeVisible();
        // Label text is localized via CONFIG.TB2E.conflictActions.attack.label
        // (conflict-panel.mjs L1816 builds it the same way for the chat
        // card). We don't hard-code the string; just ensure the span has
        // non-empty text, which is all the render contract guarantees.
        expect(
          ((await firstLabel.textContent()) ?? '').trim().length
        ).toBeGreaterThan(0);

        // The "vs" separator between the two sides — panel-resolve.hbs
        // L112 emits `<span class="resolve-vs">vs</span>` inside the
        // `{{#unless @last}}` branch, so exactly one appears between
        // the two `.resolve-side` blocks.
        await expect(matchup.locator('.resolve-vs')).toHaveCount(1);

        // The Reveal button must be gone post-reveal — template L35
        // `{{#unless this.isRevealed}}` gate.
        await expect(
          currentAction.locator('button[data-action="revealAction"]')
        ).toHaveCount(0);

        /* ---------- Reveal CHAT CARD DOM ---------- */

        // `#onRevealAction` L1834-1837 posts a ChatMessage whose
        // content is rendered from conflict-action-reveal.hbs. Assert
        // the card's action chips + interaction tag are present. The
        // most recent message should be the reveal card (we cleared
        // chat in afterEach and nothing else posts between the snapshot
        // and the click on this path).
        await expect
          .poll(() => page.evaluate(() => game.messages.contents.length), {
            timeout: 10_000
          })
          .toBeGreaterThan(chatCountBeforeReveal);

        const revealShape = await page.evaluate(() => {
          const msg = game.messages.contents.at(-1);
          const dom = new DOMParser().parseFromString(
            msg?.content ?? '', 'text/html'
          );
          const card = dom.querySelector('.conflict-reveal-card');
          const matchupEl = dom.querySelector('.card-matchup');
          const actionChips = dom.querySelectorAll(
            '.card-matchup-action.action-attack'
          );
          const vs = dom.querySelectorAll('.card-matchup-vs');
          const interactionEl = dom.querySelector('.card-interaction');
          return {
            hasRevealCard: !!card,
            hasMatchup: !!matchupEl,
            attackChipCount: actionChips.length,
            vsSeparatorCount: vs.length,
            interactionClasses: interactionEl?.className ?? null,
            interactionText: (interactionEl?.textContent ?? '').trim()
          };
        });
        expect(revealShape.hasRevealCard).toBe(true);
        expect(revealShape.hasMatchup).toBe(true);
        // Two action chips, one per side. action key is "attack" on
        // both (conflict-panel.mjs L1812-1817 writes `action:
        // entry.action` per side; template L11 renders
        // `.card-matchup-action.action-{{this.action}}`).
        expect(revealShape.attackChipCount).toBe(2);
        // Exactly one "vs" separator between the two sides
        // (template L13 `{{#unless @last}}`).
        expect(revealShape.vsSeparatorCount).toBe(1);
        // Interaction for attack:attack is "independent" per the
        // matrix at config.mjs L408; template L16 renders
        // `.card-interaction.interaction-{{interaction}}`.
        expect(revealShape.interactionClasses).toContain('card-interaction');
        expect(revealShape.interactionClasses).toContain('interaction-independent');
        expect(revealShape.interactionText.length).toBeGreaterThan(0);
      } finally {
        await cleanupTaggedActors(page, tag);
      }
    }
  );
});
