import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §3 Rolls — help adds +1D to the roller's pool (DH p.63, SG pp.36-38).
 *
 * Rules under test:
 *   - "Help: If you can help another party member, you grant them +1D."
 *     — DH p.63, SG pp.36-38. Each eligible helper contributes exactly one
 *     die to the roller's pool.
 *   - Helpers qualify when they have the same ability / skill (or a
 *     suggested help skill, or BL ability, or Nature) at rating > 0 and
 *     are not blocked by dead / afraid / conflict-KO'd conditions
 *     (see `isBlockedFromHelping` + `_findBestHelpPath` in module/dice/
 *     help.mjs).
 *
 * Help is a PRE-ROLL dialog mechanism in this codebase — not a post-roll
 * chat-card button:
 *   - `getEligibleHelpers` in module/dice/help.mjs scans scene tokens on
 *     the roller's conflict team for qualifying actors.
 *   - `_showRollDialog` in module/dice/tb2e-roll.mjs passes the result to
 *     templates/dice/roll-dialog.hbs as `pcHelpers` / `npcHelpers`; each
 *     rendered row has a `.helper-toggle` button wired (around tb2e-roll.mjs
 *     line 669) to bump `helperBonus`, re-render the modifier list, and
 *     refresh the summary.
 *   - On submit (tb2e-roll.mjs line 1113-1124), active toggles are
 *     collected as `selectedHelpers` and passed to `gatherHelpModifiers`
 *     (line 108) which emits one `{type:"dice", value:1, source:"help"}`
 *     modifier per helper. These land in the chat message flags via
 *     `mapHelpersForFlags` (roll-utils.mjs line 164) as
 *     `flags.tb2e.roll.helpers` and in `flags.tb2e.roll.modifiers` as the
 *     pre-roll +1D contribution.
 *
 * TEST_PLAN.md line 159 previously described this flow as "Character B
 * clicks Help on chat card" — the chat-card `acceptHelp` action does not
 * exist in the production code path. The only help-adjacent chat-card
 * action is `synergy` (helper spends fate for advancement, module/dice/
 * post-roll.mjs `_handleSynergy`). The TEST_PLAN description has been
 * updated to reflect the actual pre-roll flow.
 *
 * Multi-user constraint:
 *   - E2E auth runs as the GM only (see tests/e2e/auth.setup.mjs). Two
 *     world actors created by the GM are both GM-owned by default; the
 *     helper-eligibility check doesn't care who "clicked" the toggle —
 *     `getEligibleHelpers` only inspects the helper actor's rating and
 *     blocking conditions. So a single GM session can drive both sides.
 *
 * Scene / token requirement:
 *   - The helper candidate pool (help.mjs line 91-113) filters
 *     `canvas.scene.tokens` — both primary and fallback paths require
 *     tokens on the active scene. The seed world has no scene by default,
 *     so this spec provisions a minimal scene and drops one token per
 *     actor onto it before opening the roll dialog.
 *
 * Dice determinism:
 *   - u=0.001 → Math.ceil((1-u)*6) = 6 on every d6 (all-6s / all suns).
 *     A 5D pool (4 rating + 1 help) vs Ob 3 is a deterministic PASS with 5
 *     successes. Same pattern as ability-test-basic / roll-dialog-modifiers.
 */
test.describe('§3 Rolls — help adds +1D', () => {
  test.afterEach(async ({ page }) => {
    // Restore the PRNG stub + clean up scene/actors. Shared Page object
    // persists across specs; leaked stubs or stale scenes would break
    // downstream tests that assume a clean world.
    await page.evaluate(async () => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
      // Delete any scenes created by this spec. Scenes are keyed by name
      // prefix "E2E Help Scene" so downstream specs can't accidentally
      // share them.
      for (const s of [...game.scenes.filter(s => s.name?.startsWith('E2E Help Scene'))]) {
        try { await s.delete(); } catch {}
      }
    });
  });

  test('PC helper toggle adds +1D to the roller\'s pool (DH p.63)', async ({ page }) => {
    const suffix = Date.now();
    const rollerName = `E2E Roller ${suffix}`;
    const helperName = `E2E Helper ${suffix}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Create the roller (A) and helper (B). Both are characters on the
    // default "party" conflict team (see module/data/actor/character.mjs
    // line 166). Fresh disabled on both so the baseline pool is exactly
    // the rating — any other auto-mod (fresh +1D) would muddy the "+1
    // from help" assertion.
    //
    // Helper has Will rating 2 (> 0) so `_findAbilityHelpPath` in
    // help.mjs returns the same-ability match. No blocking conditions.
    const { rollerId, helperId } = await page.evaluate(async ({ rn, hn }) => {
      const roller = await Actor.create({
        name: rn,
        type: 'character',
        system: {
          abilities: {
            will:   { rating: 4, pass: 0, fail: 0 },
            health: { rating: 3, pass: 0, fail: 0 },
            nature: { rating: 3, max: 3, pass: 0, fail: 0 }
          },
          conditions: { fresh: false }
        }
      });
      const helper = await Actor.create({
        name: hn,
        type: 'character',
        system: {
          abilities: {
            will:   { rating: 2, pass: 0, fail: 0 },
            health: { rating: 3, pass: 0, fail: 0 },
            nature: { rating: 3, max: 3, pass: 0, fail: 0 }
          },
          // RAW (SG p.48): Afraid blocks offering help. Explicitly leave
          // this false so the help path is not short-circuited by
          // `isBlockedFromHelping`.
          conditions: { fresh: false, afraid: false, dead: false }
        }
      });
      return { rollerId: roller.id, helperId: helper.id };
    }, { rn: rollerName, hn: helperName });
    expect(rollerId).toBeTruthy();
    expect(helperId).toBeTruthy();

    // Provision a scene + drop one token per actor. `getEligibleHelpers`
    // only considers actors that have a token on the active scene (see
    // help.mjs line 91-113) — otherwise `availableHelpers` is empty and
    // the helpers block never renders.
    const sceneId = await page.evaluate(async ({ rId, hId, suf }) => {
      const scene = await Scene.create({
        name: `E2E Help Scene ${suf}`,
        active: true,
        width: 1000,
        height: 1000,
        padding: 0,
        grid: { type: 1, size: 100 }
      });
      // Tokens must carry `actorId` so the help.mjs scene-pool filter
      // resolves `t.actor`. `actorLink: false` keeps the token as a
      // synthetic actor, which is the default for world characters but
      // explicit here for documentation.
      await scene.createEmbeddedDocuments('Token', [
        {
          name: game.actors.get(rId).name,
          actorId: rId,
          actorLink: true,
          x: 100, y: 100,
          width: 1, height: 1
        },
        {
          name: game.actors.get(hId).name,
          actorId: hId,
          actorLink: true,
          x: 300, y: 100,
          width: 1, height: 1
        }
      ]);
      // Pull the active scene into canvas. `help.mjs` reads `canvas?.scene`
      // — scene.activate() ensures the canvas is viewing our scene.
      await scene.view();
      return scene.id;
    }, { rId: rollerId, hId: helperId, suf: suffix });
    expect(sceneId).toBeTruthy();

    // Stub PRNG → all-6s so 5D vs Ob 3 = 5 successes (PASS).
    await page.evaluate(() => {
      globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => 0.001;
    });

    // Open the roller's sheet, switch to Abilities, click Will.
    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, rollerId);

    const sheet = new CharacterSheet(page, rollerName);
    await sheet.expectOpen();
    await sheet.openAbilitiesTab();

    const initialChatCount = await page.evaluate(() => game.messages.contents.length);

    await sheet.rollAbilityRow('will').click();

    const dialog = new RollDialog(page);
    await dialog.waitForOpen();

    // Baseline — rating-only pool before any helper toggle.
    expect(await dialog.getPoolSize()).toBe(4);
    expect(await dialog.getSummaryPool()).toBe(4);

    // Sanity: the helper block MUST render with our helper in the list.
    // The section starts collapsed (`.collapsible.collapsed`), so we
    // assert existence rather than visibility — `toggleHelper` expands
    // the section before clicking.
    await expect(dialog.helperToggle(helperId)).toHaveCount(1);

    // Engage help. The toggle's click handler bumps `helperBonus`,
    // re-renders the modifier list, and updates the summary text.
    await dialog.toggleHelper(helperId);

    // Pool summary now reflects the +1D helper contribution (DH p.63).
    expect(await dialog.getSummaryPool()).toBe(5);
    // `poolSize` (base dice input) is NOT mutated — the +1D comes from
    // `totalDiceBonus` in the submit callback (tb2e-roll.mjs ~line 1110).
    expect(await dialog.getPoolSize()).toBe(4);
    // A help-sourced modifier row is present in the modifier list.
    await expect(dialog.modifierRows.filter({ hasText: helperName })).toHaveCount(1);

    await dialog.fillObstacle(3);
    await dialog.submit();

    await expect
      .poll(() => page.evaluate(() => game.messages.contents.length), { timeout: 10_000 })
      .toBeGreaterThan(initialChatCount);

    const card = new RollChatCard(page);
    await card.expectPresent();

    // Card shape — 5D pool (4 rating + 1 help), 5 sixes, PASS vs Ob 3.
    expect(await card.getPool()).toBe(5);
    await expect(card.diceResults).toHaveCount(5);
    expect(await card.getSuccesses()).toBe(5);
    expect(await card.getObstacle()).toBe(3);
    expect(await card.isPass()).toBe(true);

    // Flag-level assertions — cover both surfaces that record the help:
    //   - `flags.tb2e.helpers` (top-level, set via `mapHelpersForFlags` in
    //     roll-utils.mjs line 164; applied alongside `...rollFlags` at
    //     tb2e-roll.mjs line 1535) — the minimal per-helper record stored
    //     on the message for synergy lookups.
    //   - `flags.tb2e.roll.modifiers` — pre-roll dice modifier array; one
    //     entry with source="help" per helper (gatherHelpModifiers in
    //     tb2e-roll.mjs line 108). The chat card's breakdown block renders
    //     these in `roll-result.hbs` at line 40.
    const rollFlags = await page.evaluate(() => {
      const msg = game.messages.contents.at(-1);
      const tb = msg?.flags?.tb2e;
      const f = tb?.roll;
      if ( !f ) return null;
      return {
        type: f.type,
        key: f.key,
        baseDice: f.baseDice,
        poolSize: f.poolSize,
        successes: f.successes,
        obstacle: f.obstacle,
        pass: f.pass,
        helpers: (tb.helpers || []).map(h => ({
          id: h.id, name: h.name, helpVia: h.helpVia, helpViaType: h.helpViaType
        })),
        helpMods: (f.modifiers || [])
          .filter(m => m.source === 'help')
          .map(m => ({ type: m.type, value: m.value, source: m.source }))
      };
    });
    expect(rollFlags).toEqual({
      type: 'ability',
      key: 'will',
      baseDice: 4,
      poolSize: 5,
      successes: 5,
      obstacle: 3,
      pass: true,
      helpers: [{
        id: helperId,
        name: helperName,
        helpVia: 'will',
        helpViaType: 'ability'
      }],
      helpMods: [{ type: 'dice', value: 1, source: 'help' }]
    });

    // Cleanup actors (scene is cleaned up in afterEach).
    await page.evaluate(({ rId, hId }) => {
      game.actors.get(rId)?.delete();
      game.actors.get(hId)?.delete();
    }, { rId: rollerId, hId: helperId });
  });
});
