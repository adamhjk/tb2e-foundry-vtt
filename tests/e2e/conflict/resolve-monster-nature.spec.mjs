import { test, expect } from '../test.mjs';
import { scriptAndLockActions } from '../helpers/conflict-scripting.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §16 Conflict: Resolve — Monster uses Nature for all action rolls
 * (TEST_PLAN L459).
 *
 * Rules under test:
 *   - SG p.172 / DH monster rules: monsters roll Nature for every
 *     test. In conflict specifically, monsters bypass the per-conflict-
 *     type action config (config.mjs L193-358 — characters use
 *     `{ type, keys }` such as skill:fighter for attack in a Kill
 *     conflict) and unconditionally roll their top-level `system.nature`
 *     scalar (module/data/actor/monster.mjs L8 — a flat integer, NOT
 *     the `{rating, pass, fail, max}` block characters use).
 *
 * Implementation map:
 *   - `buildResolutionContext` at conflict-roll.mjs L49-53 — the
 *     monster-Nature branch used by pre-render contexts:
 *       if ( actor.type === "monster" ) {
 *         testKey = "nature"; testType = "ability";
 *         baseDice = actor.system.nature;
 *       }
 *   - `#onRollAction` at conflict-panel.mjs L1863-1869 — the same
 *     branch on the roll-dispatch path. It sets
 *     `testType = "ability"` and `testKey = "nature"` before passing
 *     to `rollTest` (L1974-1994), regardless of the action's configured
 *     keys. Applies uniformly across A/D/F/M — there is no per-action
 *     gate, just the `actor.type === "monster"` check.
 *   - `_resolveRollData` at tb2e-roll.mjs L45-48 — for
 *     `actor.type === "monster"` + `key === "nature"` the pool reads
 *     `actor.system.nature` directly (the flat scalar), NOT
 *     `actor.system.abilities.nature.rating` which would be 0.
 *   - `_buildRollFlags` at tb2e-roll.mjs L1427-1480 persists
 *     `flags.tb2e.roll.{type,key,baseDice}` plus
 *     `flags.tb2e.directNatureTest` (L1453 — true iff
 *     `type === "ability" && key === "nature"`) — these are the message-
 *     level breadcrumbs this spec keys on.
 *
 * -------------------------------------------------------------------
 * Why this spec is NOT `test.fixme`
 * -------------------------------------------------------------------
 * The monster-Nature branch is production-wired at two independent
 * sites (conflict-panel.mjs L1863-1869 for the dispatch, conflict-roll.
 * mjs L49-53 for the pre-render context) AND the pool resolver
 * (tb2e-roll.mjs L45-48) has the matching short-circuit. The sibling
 * §21 monster-nature-roll spec (tests/e2e/sheet/monster-nature-roll.
 * spec.mjs) already exercises the pool-resolver branch in isolation
 * via the monster sheet; this spec asserts the conflict dispatch
 * branch at L1863-1869 routes a monster's action roll through Nature
 * AS A DISTINCT PATH from the sheet one (the roll dialog is opened
 * from the conflict resolve tab, with `testContext.isConflict: true`
 * and a `conflictAction` key set).
 *
 * -------------------------------------------------------------------
 * Test fixture (deterministic)
 * -------------------------------------------------------------------
 *   Kill conflict (config.mjs L202-211 — attack = skill:fighter,
 *   maneuver = ability:health). A **Goblin** is the GM captain
 *   (packs/_source/monsters/Goblin_…yml — Nature=3). A **Kobold**
 *   fills the GM side so the team has >= 2 combatants.
 *
 *   For the party side we use a single character captain (fighter=5,
 *   health=4) plus a filler character. The captain is scripted to
 *   Attack so their half of the volley exercises the character skill
 *   path as a regression sanity check (skill:fighter at config.mjs
 *   L206), but THIS spec's primary assertions are against the
 *   **Goblin's** roll flags. The party roll is only verified to carry
 *   `type: "skill", key: "fighter"` — i.e. to demonstrate that the
 *   monster's Nature routing is NOT a bug that would also clobber
 *   character-side action rolls.
 *
 *   Why a Goblin (Nature=3) vs Kobold (Nature=2) is not sufficient
 *   on its own: both characters and monsters on the GM side go
 *   through the same L1863-1869 branch — swapping captains between
 *   the two monsters doesn't add a new path. We pin on the Goblin
 *   captain whose Nature=3 gives a non-ambiguous baseDice (vs a
 *   Kobold's Nature=2, which collides with "base 2D" that could
 *   come from a fighter=2 skill on a wrongly-configured actor).
 *
 *   Unarmed gives -1D (conflict-panel.mjs L1944-1948), so the Goblin's
 *   pool = Nature (3) − 1 = 2D. PRNG stub u=0.001 → every d6 shows 6 →
 *   every die is a success. All rolls pass vs Ob 0 for attack
 *   (config.mjs L431).
 *
 *   Sequence for volley 0 (attack vs attack, independent):
 *     1. Matrix lookup `attack:attack` at config.mjs L408 returns
 *        "independent" — both sides test, no versus.
 *     2. Party captain (character, fighter=5) rolls attack. Flags
 *        confirm `type:"skill",key:"fighter",baseDice:5` — the
 *        character path ignores Nature (regression sanity).
 *     3. GM captain (monster, Nature=3) rolls attack. Flags confirm
 *        `type:"ability",key:"nature",baseDice:3` — Nature pool,
 *        NOT fighter=0 or will.
 *     4. `flags.tb2e.directNatureTest === true` on the monster's
 *        card (tb2e-roll.mjs L1453) — proves the `_resolveRollData`
 *        short-circuit fired.
 *     5. Dialog pool-size input pre-fills with 3 (Nature) for the
 *        monster — not 0 (the nonexistent skills.fighter rating for
 *        monsters) and not any abilities.nature.rating (monsters
 *        don't have that field at all — monster.mjs L6-11 only has
 *        the top-level `nature` scalar).
 *
 * Scope (narrow — TEST_PLAN L459 only):
 *   - Verifies a single action (Attack) routes through Nature on the
 *     monster side. Per the briefing: "The branch applies to A/D/F/M
 *     uniformly — assert just one action as a regression guard,
 *     citing the conflict-roll.mjs branch as evidence it applies
 *     uniformly." The L1863-1869 branch has no `actionKey` gate, so
 *     a positive check on Attack is sufficient evidence for the
 *     whole matrix. Prior specs (L454 Attack-vs-Attack, L456 Feint-
 *     vs-Feint, L457 Maneuver-vs-Defend) already incidentally
 *     exercise monster Nature on their GM side for different actions.
 *   - HP damage from margins is §18 L500 scope — deliberately NOT
 *     asserted.
 *   - Character rolls are covered by L454/L455/L456/L457 — this spec
 *     does a minimum sanity check on the party-side roll only to
 *     prove the monster branch doesn't leak into the character path.
 *
 * All Playwright sessions authenticate as GM (auth.setup.mjs L14-35).
 * Roll handlers gate on isGM or owner — the GM-only path is exercised.
 */

const MONSTER_PACK_ID = 'tb2e.monsters';

/**
 * Import a named monster from the compendium. Mirrors the helper in
 * resolve-attack-vs-attack.spec.mjs (kept inline for self-containment).
 */
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
      return { id: created.id, nature: created.system.nature };
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

test.describe('§16 Conflict: Resolve — Monster uses Nature for action rolls', () => {
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
    // Chat log accumulates reveal + roll-result cards across repeats;
    // clear them so per-test message scoping stays simple.
    await page.evaluate(async () => {
      const mids = game.messages.contents.map((m) => m.id);
      if ( mids.length ) await ChatMessage.deleteDocuments(mids);
    });
  });

  test(
    'Monster rolls Nature on Attack (not skill:fighter); character side still rolls fighter',
    async ({ page }, testInfo) => {
      const tag = `e2e-monster-nature-${testInfo.parallelIndex}-${Date.now()}`;
      const stamp = Date.now();
      const captainAName = `E2E MN Captain ${stamp}`;
      const fillerAName  = `E2E MN Filler A ${stamp}`;
      const goblinName   = `E2E MN Goblin Captain ${stamp}`;
      const koboldName   = `E2E MN Kobold ${stamp}`;

      await page.goto('/game');
      const ui = new GameUI(page);
      await ui.waitForReady();
      await ui.dismissTours();

      // Reveal/roll handlers assume GM in this harness
      // (conflict-panel.mjs L1796/L1847).
      expect(await page.evaluate(() => game.user.isGM)).toBe(true);

      try {
        /* ---------- Arrange actors ---------- */

        const CAPTAIN_FIGHTER = 5;
        const captainAId = await createCaptainCharacter(page, {
          name: captainAName, tag, fighter: CAPTAIN_FIGHTER, health: 4
        });
        const fillerAId = await createCharacter(page, {
          name: fillerAName, tag
        });
        const goblin = await importMonster(page, {
          sourceName: 'Goblin', uniqueName: goblinName, tag
        });
        const kobold = await importMonster(page, {
          sourceName: 'Kobold', uniqueName: koboldName, tag
        });
        // Sanity pins — if a future YAML change silently shifts either
        // Nature value the pool-size assertion below would become
        // ambiguous, so fail loudly here instead.
        expect(goblin.nature).toBe(3);
        expect(kobold.nature).toBe(2);

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
        cmb.fillerA = await panel.addCombatant({
          combatId, actorId: fillerAId, groupId: partyGroupId
        });
        cmb.goblin = await panel.addCombatant({
          combatId, actorId: goblin.id, groupId: gmGroupId
        });
        cmb.kobold = await panel.addCombatant({
          combatId, actorId: kobold.id, groupId: gmGroupId
        });
        await expect(panel.setupCombatants).toHaveCount(4);

        await panel.clickCaptainButton(cmb.captainA);
        await panel.clickCaptainButton(cmb.goblin);
        // Kill conflict → attack = skill:fighter for characters
        // (config.mjs L206), contrasted against the monster's Nature
        // routing that this spec asserts.
        await panel.selectConflictType('kill');

        await expect(panel.beginDispositionButton).toBeEnabled();
        await panel.clickBeginDisposition();

        /* ---------- Disposition: flat-set both sides ---------- */

        // Stage disposition directly — disposition-roll / distribute
        // UI paths are covered by §14 specs and are not the subject
        // of this spec.
        await page.evaluate(async ({ cId, pId, gId }) => {
          const c = game.combats.get(cId);
          await c.storeDispositionRoll(pId, {
            rolled: 7, diceResults: [], cardHtml: '<em>E2E</em>'
          });
          await c.storeDispositionRoll(gId, {
            rolled: 8, diceResults: [], cardHtml: '<em>E2E</em>'
          });
        }, { cId: combatId, pId: partyGroupId, gId: gmGroupId });

        await page.evaluate(async ({ cId, pId, gId, cAId, fAId, gobId, kobId }) => {
          const c = game.combats.get(cId);
          const party = {}; party[cAId] = 4; party[fAId] = 3;
          const gm = {};    gm[gobId]   = 4; gm[kobId]   = 4;
          await c.distributeDisposition(pId, party);
          await c.distributeDisposition(gId, gm);
        }, {
          cId: combatId,
          pId: partyGroupId,
          gId: gmGroupId,
          cAId: cmb.captainA,
          fAId: cmb.fillerA,
          gobId: cmb.goblin,
          kobId: cmb.kobold
        });

        await expect(panel.beginWeaponsButton).toBeEnabled();
        await panel.clickBeginWeapons();

        /* ---------- Weapons: unarmed for everyone ---------- */

        // `__unarmed__` applies a flat -1D via conflict-panel.mjs
        // L1944-1948. Keeps the pool math simple for the assertion:
        //   monster pool = Nature − 1 (unarmed), and 0 ≤ Ob 0 → pass.
        await page.evaluate(async ({ cId, ids }) => {
          const c = game.combats.get(cId);
          for ( const id of ids ) {
            await c.setWeapon(id, 'Fists', '__unarmed__');
          }
        }, {
          cId: combatId,
          ids: [cmb.captainA, cmb.fillerA, cmb.goblin, cmb.kobold]
        });

        await expect(panel.beginScriptingButton).toBeEnabled();
        await panel.clickBeginScripting();

        /* ---------- Scripting ---------- */

        // Both captains attack on volley 0. Matrix `attack:attack`
        // (config.mjs L408) is "independent" — both sides roll (tests
        // both pipelines in one volley). Volleys 1-2 are filler so
        // lockActions opens (combat.mjs L534 requires all 3 slots).
        const partyActions = [
          { action: 'attack',   combatantId: cmb.captainA },
          { action: 'defend',   combatantId: cmb.fillerA },
          { action: 'feint',    combatantId: cmb.captainA }
        ];
        const gmActions = [
          { action: 'attack',   combatantId: cmb.goblin },
          { action: 'defend',   combatantId: cmb.kobold },
          { action: 'feint',    combatantId: cmb.goblin }
        ];
        /* ---------- Script + lock + resolve ---------- */

        await scriptAndLockActions(page, {
          combatId, partyGroupId, gmGroupId, partyActions, gmActions
        });

        expect(await page.evaluate(({ cId }) => {
          const c = game.combats.get(cId);
          return c.getVolleyInteraction(0);
        }, { cId: combatId })).toBe('independent');

        await expect.poll(() => panel.activeTabId()).toBe('resolve');

        /* ---------- Reveal volley 0 ---------- */

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

        /* ---------- Stub PRNG → all-6s ---------- */

        // u = 0.001 → Math.ceil((1-u)*6) = 6 → every die a success.
        // We don't actually need the roll to pass for the assertions,
        // but a deterministic pool-sized successes count makes the
        // flag check trivially stable.
        await page.evaluate(() => {
          globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
          CONFIG.Dice.randomUniform = () => 0.001;
        });

        /* ---------- Roll party Attack (character: fighter skill) ---------- */

        const chatCountBeforePartyRoll = await page.evaluate(
          () => game.messages.contents.length
        );

        const partyRollBtn = panel
          .resolveAction(0)
          .locator(`button[data-action="rollAction"][data-group-id="${partyGroupId}"]`);
        await expect(partyRollBtn).toBeVisible();
        await partyRollBtn.click();

        const partyDialog = new RollDialog(page);
        await partyDialog.waitForOpen();
        // Character side routes through `actionCfg` at conflict-panel.mjs
        // L1864-1865 → skill:fighter for Kill (config.mjs L206). Pool
        // is fighter (5) + (-1 unarmed) = 4D.
        expect(await partyDialog.getPoolSize()).toBe(CAPTAIN_FIGHTER);
        expect(await partyDialog.getSummaryPool()).toBe(CAPTAIN_FIGHTER - 1);
        await partyDialog.submit();

        const partyMessageId = await page.evaluate(async ({ actorId, base }) => {
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
        }, { actorId: captainAId, base: chatCountBeforePartyRoll });
        expect(partyMessageId).toBeTruthy();

        /* ---------- Roll GM Attack (monster: Nature ability) ---------- */

        const chatCountBeforeGmRoll = await page.evaluate(
          () => game.messages.contents.length
        );

        const gmRollBtn = panel
          .resolveAction(0)
          .locator(`button[data-action="rollAction"][data-group-id="${gmGroupId}"]`);
        await expect(gmRollBtn).toBeVisible();
        await gmRollBtn.click();

        const gmDialog = new RollDialog(page);
        await gmDialog.waitForOpen();

        // *** Primary assertion — monster Nature pool in the dialog ***
        //
        // `#onRollAction` (conflict-panel.mjs L1866-1869) forced
        // `{ type:"ability", key:"nature" }`; `_resolveRollData`
        // (tb2e-roll.mjs L45-48) resolved the pool as
        // `actor.system.nature` (3 for Goblin). If the routing broke
        // and the monster was going through the configured keys
        // (`skill:fighter` — config.mjs L206), the pool would be 0
        // because monsters have no `system.skills` block.
        expect(await gmDialog.getPoolSize()).toBe(goblin.nature);
        // Summary text = "<Nature − 1> D …" after the -1D unarmed
        // modifier (conflict-panel.mjs L1944-1948).
        expect(await gmDialog.getSummaryPool()).toBe(goblin.nature - 1);
        await gmDialog.submit();

        const gmMessageId = await page.evaluate(async ({ actorId, base }) => {
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
        }, { actorId: goblin.id, base: chatCountBeforeGmRoll });
        expect(gmMessageId).toBeTruthy();

        /* ---------- Assert roll-level breadcrumbs ---------- */

        const flags = await page.evaluate(({ pId, gId }) => {
          const p = game.messages.get(pId);
          const g = game.messages.get(gId);
          const read = (m) => m ? {
            type: m.flags?.tb2e?.roll?.type ?? null,
            key: m.flags?.tb2e?.roll?.key ?? null,
            baseDice: m.flags?.tb2e?.roll?.baseDice ?? null,
            directNatureTest: m.flags?.tb2e?.directNatureTest ?? null
          } : null;
          return { party: read(p), gm: read(g) };
        }, { pId: partyMessageId, gId: gmMessageId });

        // *** Primary assertions — monster flags ***
        // conflict-panel.mjs L1866-1869 routed the monster through
        // ability:nature; tb2e-roll.mjs L1429 persisted those fields
        // as flags.tb2e.roll.{type,key}; L1453 stamped
        // directNatureTest = (type === "ability" && key === "nature").
        expect(flags.gm).toEqual({
          type: 'ability',
          key: 'nature',
          // Pre-modifier pool: the flat Nature scalar from monster.mjs
          // L8. NOT abilities.nature.rating (which doesn't exist on
          // monsters) and NOT skills.fighter.rating (doesn't exist
          // either — monsters have no skills block).
          baseDice: goblin.nature,
          directNatureTest: true
        });

        // *** Regression sanity — character flags ***
        // The monster branch is a SPECIFIC guard on `actor.type`
        // (L1866); it must not leak into the character path. The
        // character captain's attack on the same volley should still
        // route through actionCfg (config.mjs L206 — skill:fighter).
        expect(flags.party).toEqual({
          type: 'skill',
          key: 'fighter',
          baseDice: CAPTAIN_FIGHTER,
          directNatureTest: false
        });

        // Cleanup PRNG before afterEach's defensive restore runs.
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
