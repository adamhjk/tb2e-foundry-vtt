import { test, expect } from '../test.mjs';
import { scriptAndLockActions } from '../helpers/conflict-scripting.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §16 Conflict: Resolve — Attack vs Attack (TEST_PLAN L454, DH pp.120-127).
 *
 * Rules under test:
 *   - DH pp.120-127: action vs action resolution. Actions are revealed
 *     one volley at a time, the interaction type is derived from both
 *     sides' action keys, and both sides may test per their action
 *     config.
 *   - `attack:attack` is an **independent** interaction per the matrix
 *     at config.mjs L408 (symmetric both ways — there is only one
 *     entry, and `getVolleyInteraction` at combat.mjs L789-803 looks it
 *     up directly).
 *   - `conflictObstacles.attack = 0` (config.mjs L431) — both sides
 *     roll their Attack pool vs Ob 0; any successes ≥ 0 pass (i.e.
 *     every roll with 0+ successes is a nominal "hit"). "Both may
 *     hit" is the checkbox (TEST_PLAN L454): independent rolls don't
 *     contest each other, so both sides can pass.
 *   - For Kill conflicts (config.mjs L202-211): attack rolls skill
 *     `fighter`. Monsters always roll Nature (conflict-roll.mjs
 *     L49-53).
 *
 * -------------------------------------------------------------------
 * Why this spec is NOT `test.fixme` (contrast with L453)
 * -------------------------------------------------------------------
 * L453's Attack vs Defend spec is fixmed because the "HP reduced by
 * margin on loser" half of its checkbox is production-unwired
 * (resolveActionEffect at conflict-roll.mjs L155-178 is dead code;
 * nothing in `_executeVersusResolution` / `#onResolveAction` mutates
 * HP from roll margins). The L454 checkbox here is narrower — "both
 * may hit" is a roll-pipeline assertion about the **interaction
 * matrix**, not about HP mutation:
 *
 *   - The independent branch of `#onRollAction` (conflict-panel.mjs
 *     L1915-1916) sets `obstacle = conflictObstacles[actionKey] || 0`
 *     and does NOT stamp `isVersus` — the roll lands in
 *     `_handleIndependentRoll` (tb2e-roll.mjs L1487-1540) which posts
 *     a standard roll-result chat card with `testContext.isConflict:
 *     true, isVersus: false`. No versus-resolution card is produced.
 *   - Both sides' rolls are thus independent events — both may pass
 *     against their Ob 0 at the same time, which is exactly what
 *     "both may hit" asserts at the roll-pipeline level.
 *   - HP damage from either margin is the SAME gap flagged at L453
 *     (resolveActionEffect unwired) and covered by TEST_PLAN L500
 *     (`hp-damage-reduces.spec.mjs`, §18) — it is OUT OF SCOPE for
 *     this spec (see "Scope" below).
 *
 * -------------------------------------------------------------------
 * Test fixture (deterministic)
 * -------------------------------------------------------------------
 *   Kill conflict (config.mjs L202-211 — attack = skill:fighter),
 *   2 characters + 2 monsters. Both captains script ATTACK on
 *   volley 0.
 *
 *   Party captain (`captainA`): fighter=3, health=4. Scripts ATTACK
 *   on volley 0 → rolls skill:fighter vs Ob 0.
 *   GM captain (`monA`): a Bugbear. Monsters roll Nature for every
 *   action (conflict-roll.mjs L49-53); Bugbear Nature=4 per
 *   packs/_source/monsters/Bugbear_…yml.
 *
 *   Both sides get distributed HP — party captain HP=4, GM captain
 *   HP=4. The spec does NOT assert HP mutation (§18 L500 scope).
 *
 *   PRNG stub:
 *     - u=0.001 → Math.ceil((1-u)*6) = 6 — all successes. Used for
 *       BOTH rolls so both sides pass their Ob 0 independently and
 *       "both hit".
 *
 *   Sequence for volley 0 (attack vs attack, independent):
 *     1. `combat.getVolleyInteraction(0)` returns "independent".
 *     2. `combat.beginResolve` flips phase to "resolve",
 *        currentAction = 0.
 *     3. Reveal volley 0 — posts the conflict-action-reveal card
 *        with `.card-interaction.interaction-independent`.
 *     4. Stub PRNG → all-6s. Party captain rolls Attack:
 *        fighter=3 − 1 (unarmed) = 2D → 2 successes vs Ob 0 → pass.
 *     5. Party captain's roll message has `flags.tb2e.testContext
 *        = { isConflict: true, conflictAction: "attack", groupId:
 *        partyGroupId, opponentGroupId: gmGroupId, ... }` and
 *        `isVersus: false` (no versus flag, independent branch).
 *     6. GM captain rolls Attack (monster → Nature=4 − 1 unarmed =
 *        3D → 3 successes vs Ob 0 → pass).
 *     7. Both roll cards are standard `.tb2e-chat-card` roll-result
 *        cards (no `.versus-pending` / `.versus-resolution`).
 *     8. Mark resolved — `round.volleys[0].result = { resolved: true,
 *        sides, interaction: "independent", ... }`.
 *     9. `combat.nextAction` auto-advances to currentAction = 1.
 *
 * Scope (narrow — TEST_PLAN L454 only):
 *   - Only verifies Attack vs Attack independent resolution at the
 *     roll-pipeline level. Feint (L455-456), Maneuver (L457), card
 *     animation (L458), monster Nature detail (L459) are out of
 *     scope.
 *   - HP damage from margins is §18 L500 scope — the production gap
 *     is identical to L453 (resolveActionEffect unwired).
 *   - Only volley 0 is exercised; downstream volleys are not asserted.
 *
 * All Playwright sessions authenticate as GM (auth.setup.mjs
 * L14-35). Reveal/roll/resolve handlers gate on isGM or owner — the
 * GM-only path is exercised here.
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

test.describe('§16 Conflict: Resolve — Attack vs Attack', () => {
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
    // Chat log accumulates reveal + roll-result + round-summary cards
    // across repeats; clear them so count-based assertions in
    // subsequent runs aren't contaminated.
    await page.evaluate(async () => {
      const mids = game.messages.contents.map((m) => m.id);
      if ( mids.length ) await ChatMessage.deleteDocuments(mids);
    });
  });

  test(
    'Attack vs Attack (independent): both roll vs Ob 0, both may hit (DH pp.120-127)',
    async ({ page }, testInfo) => {
      const tag = `e2e-resolve-ava-${testInfo.parallelIndex}-${Date.now()}`;
      const stamp = Date.now();
      const charAName = `E2E AvA Captain ${stamp}`;
      const charBName = `E2E AvA Char B ${stamp}`;
      const monAName = `E2E AvA Bugbear ${stamp}`;
      const monBName = `E2E AvA Goblin ${stamp}`;

      await page.goto('/game');
      const ui = new GameUI(page);
      await ui.waitForReady();
      await ui.dismissTours();

      // Reveal/roll/resolve handlers assume GM in this harness
      // (conflict-panel.mjs L1796/L1847/L2003).
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

        // `__unarmed__` applies a flat -1D via conflict-panel.mjs
        // L1944-1948; PRNG all-6s keeps the spec deterministic.
        await page.evaluate(async ({ cId, ids }) => {
          const c = game.combats.get(cId);
          for ( const id of ids ) {
            await c.setWeapon(id, 'Fists', '__unarmed__');
          }
        }, { cId: combatId, ids: [cmb.captain, cmb.charB, cmb.monA, cmb.monB] });

        await expect(panel.beginScriptingButton).toBeEnabled();
        await panel.clickBeginScripting();

        /* ---------- Scripting: both captains attack on volley 0 ---------- */

        // Party side: captain attacks on volley 0 — the matchup this
        // spec exists to exercise. Volleys 1 and 2 are filler so
        // `#applyLockActions` (combat.mjs L534 requires all three
        // slots filled) opens.
        // GM side: monA attacks on volley 0. Matrix lookup (config.mjs
        // L408 `attack:attack`) returns "independent" — the
        // interaction under test.
        const partyActions = [
          { action: 'attack',   combatantId: cmb.captain },
          { action: 'defend',   combatantId: cmb.charB },
          { action: 'feint',    combatantId: cmb.captain }
        ];
        const gmActions = [
          { action: 'attack',   combatantId: cmb.monA },
          { action: 'defend',   combatantId: cmb.monB },
          { action: 'feint',    combatantId: cmb.monA }
        ];
        /* ---------- Script + lock + resolve ---------- */

        await scriptAndLockActions(page, {
          combatId, partyGroupId, gmGroupId, partyActions, gmActions
        });

        // Precondition: volley 0 interaction is "independent" via
        // combat.mjs L789-803 matrix lookup for `attack:attack`
        // (config.mjs L408).
        expect(await page.evaluate(({ cId }) => {
          const c = game.combats.get(cId);
          return c.getVolleyInteraction(0);
        }, { cId: combatId })).toBe('independent');

        await expect.poll(() => panel.activeTabId()).toBe('resolve');
        expect(await page.evaluate(({ cId }) => {
          const c = game.combats.get(cId);
          return { phase: c.system.phase, currentAction: c.system.currentAction };
        }, { cId: combatId })).toEqual({ phase: 'resolve', currentAction: 0 });

        /* ---------- Reveal volley 0 ---------- */

        // Reveal button dispatches to `#onRevealAction`
        // (conflict-panel.mjs L1796-1838) which flips
        // `round.volleys[0].revealed = true` AND posts a reveal card
        // from conflict-action-reveal.hbs.
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
        // `.card-interaction.interaction-independent` for the
        // independent interaction).
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
        expect(revealCardInteraction.classes).toContain('interaction-independent');
        expect(revealCardInteraction.hasText).toBe(true);

        /* ---------- Roll party Attack (independent) ---------- */

        // Stub PRNG → all-6s. fighter=3 plus unarmed -1D gives pool=2
        // → 2 successes on all-6s. Against Ob 0 → pass.
        await page.evaluate(() => {
          globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
          CONFIG.Dice.randomUniform = () => 0.001;
        });

        const chatCountBeforePartyRoll = await page.evaluate(
          () => game.messages.contents.length
        );

        // Roll button for the party side of volley 0 (panel-resolve.hbs
        // L103-108 — rendered iff `canRoll` and `sideInteraction !==
        // "none"`). `#onRollAction` (conflict-panel.mjs L1915-1916)
        // sets obstacle = 0 for attack (config.mjs L431) and does NOT
        // stamp `isVersus` — independent branch.
        const partyRollBtn = panel
          .resolveAction(0)
          .locator(`button[data-action="rollAction"][data-group-id="${partyGroupId}"]`);
        await expect(partyRollBtn).toBeVisible();
        await partyRollBtn.click();

        const partyDialog = new RollDialog(page);
        await partyDialog.waitForOpen();
        // Dialog mode stays "independent" (the testContext for a
        // non-versus interaction does not set isVersus, so tb2e-roll.mjs
        // L928-937 leaves the default `mode=independent` in place).
        expect(await partyDialog.modeInput.inputValue()).toBe('independent');
        // Obstacle pre-filled to 0 from testContext.obstacle
        // (tb2e-roll.mjs L512-515).
        expect(await partyDialog.getObstacle()).toBe(0);
        await partyDialog.submit();

        // Poll for the new roll-result message — it carries
        // `flags.tb2e.testContext.isConflict = true, conflictAction =
        // "attack"` per conflict-panel.mjs L1978-1990 / tb2e-roll.mjs
        // L1461-1479. Find the first message after our baseline that
        // belongs to the captain's actor and has the conflict flag.
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
        }, { actorId: captainId, base: chatCountBeforePartyRoll });
        expect(partyMessageId).toBeTruthy();

        // Sanity: the conflict testContext is stamped — and critically
        // `isVersus` is absent/false (independent branch). No versus
        // flag means no versus-resolution card will be posted.
        const partyCtx = await page.evaluate((mid) => {
          const msg = game.messages.get(mid);
          const tc = msg?.flags?.tb2e?.testContext;
          const vs = msg?.flags?.tb2e?.versus;
          return tc ? {
            isConflict: !!tc.isConflict,
            conflictAction: tc.conflictAction ?? null,
            groupId: tc.groupId ?? null,
            opponentGroupId: tc.opponentGroupId ?? null,
            hasVersusFlag: !!vs,
            obstacle: msg.flags?.tb2e?.roll?.obstacle ?? null,
            pass: msg.flags?.tb2e?.roll?.pass ?? null,
            successes: msg.flags?.tb2e?.roll?.successes ?? null
          } : null;
        }, partyMessageId);
        expect(partyCtx).toMatchObject({
          isConflict: true,
          conflictAction: 'attack',
          groupId: partyGroupId,
          opponentGroupId: gmGroupId,
          hasVersusFlag: false,
          obstacle: 0,
          pass: true
        });
        // Both may hit — the party side has successes ≥ Ob 0.
        expect(partyCtx.successes).toBeGreaterThanOrEqual(0);

        /* ---------- Roll GM Attack (independent) ---------- */

        // PRNG stays at all-6s — both sides use the same stub so
        // "both may hit" is not an artifact of biased rolls on one
        // side. Monster Nature=4 − 1 unarmed = 3D → 3 successes on
        // all-6s, vs Ob 0 → pass.
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
        expect(await gmDialog.modeInput.inputValue()).toBe('independent');
        expect(await gmDialog.getObstacle()).toBe(0);
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
        }, { actorId: monAId, base: chatCountBeforeGmRoll });
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
            hasVersusFlag: !!vs,
            obstacle: msg.flags?.tb2e?.roll?.obstacle ?? null,
            pass: msg.flags?.tb2e?.roll?.pass ?? null,
            successes: msg.flags?.tb2e?.roll?.successes ?? null
          } : null;
        }, gmMessageId);
        expect(gmCtx).toMatchObject({
          isConflict: true,
          conflictAction: 'attack',
          // GM side: groupId flipped relative to party side.
          groupId: gmGroupId,
          opponentGroupId: partyGroupId,
          hasVersusFlag: false,
          obstacle: 0,
          pass: true
        });
        expect(gmCtx.successes).toBeGreaterThanOrEqual(0);

        /* ---------- Both hit: independent pipeline, no versus card ---------- */

        // Structural assertion — neither roll produced a versus
        // pending/resolution card. `_handleVersusRoll` was not invoked
        // because `isVersus` was never set on either testContext;
        // `_handleIndependentRoll` (tb2e-roll.mjs L1487-1540) posted
        // standard roll-result cards instead.
        const versusCount = await page.evaluate(() => {
          return game.messages.contents.filter((m) => {
            return !!m.flags?.tb2e?.versus;
          }).length;
        });
        expect(versusCount).toBe(0);

        // Both sides passed Ob 0 independently — "both may hit" in
        // the interaction-matrix sense. The tie-breaker is that the
        // matrix returned "independent" at both the volley level
        // (combat.mjs L789-803) and each per-side branch
        // (conflict-panel.mjs L1915-1916) — if either had been
        // "versus", one message would carry `isVersus: true` and
        // `_handleVersusRoll` would have fired.
        expect(partyCtx.pass).toBe(true);
        expect(gmCtx.pass).toBe(true);

        // Render-level sanity: both roll cards exist as regular TB2E
        // roll-result cards with pass banners (template
        // roll-result.hbs — independent rolls render
        // `.card-banner.banner-pass` when successes ≥ obstacle).
        // Switch to the chat tab so the sidebar chat log is mounted
        // (the tracker's open() left us on the combat tab).
        await page.evaluate(() => {
          ui.sidebar?.changeTab?.('chat', 'primary');
        });

        // Scope the read to the two messages we created — the chat
        // log may contain pre-existing messages from session setup
        // and Foundry's notification popup can duplicate rendered
        // copies of recent cards, so absolute `.toHaveCount(N)` on
        // the global selector is unreliable. Reading
        // `msg.content` per-id is deterministic.
        const cardShapes = await page.evaluate((ids) => {
          return ids.map((id) => {
            const msg = game.messages.get(id);
            const dom = new DOMParser().parseFromString(
              msg?.content ?? '', 'text/html'
            );
            return {
              hasBreakdown: !!dom.querySelector('.roll-card-breakdown'),
              hasPassBanner: !!dom.querySelector('.card-banner.banner-pass'),
              hasVersusResolution: !!dom.querySelector('.versus-resolution-card'),
              hasVersusPending: !!dom.querySelector('.versus-pending-card')
            };
          });
        }, [partyMessageId, gmMessageId]);
        expect(cardShapes).toEqual([
          { hasBreakdown: true, hasPassBanner: true, hasVersusResolution: false, hasVersusPending: false },
          { hasBreakdown: true, hasPassBanner: true, hasVersusResolution: false, hasVersusPending: false }
        ]);

        /* ---------- Mark volley resolved ---------- */

        // Switch back to combat tab for the resolve button.
        await page.evaluate(() => {
          ui.sidebar?.changeTab?.('combat', 'primary');
        });

        await panel
          .resolveAction(0)
          .locator('button[data-action="resolveAction"]')
          .click();

        // `#onResolveAction` writes `round.volleys[0].result` via
        // `combat.resolveVolley` (combat.mjs L772-782). Interaction
        // is "independent" (from `getInteraction` at
        // conflict-panel.mjs L2028 — looks up `attack:attack` on the
        // matrix at config.mjs L408).
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
          .toEqual({ resolved: true, interaction: 'independent', sideCount: 2 });

        // Auto-advance to the next action (conflict-panel.mjs
        // L2092-2095).
        await expect
          .poll(() => page.evaluate(({ cId }) => {
            const c = game.combats.get(cId);
            return c.system.currentAction ?? null;
          }, { cId: combatId }))
          .toBe(1);

        // Cleanup PRNG before afterEach runs — the stub restoration
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
