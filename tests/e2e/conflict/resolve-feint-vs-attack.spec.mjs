import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §16 Conflict: Resolve — Feint vs Attack (TEST_PLAN L455, DH pp.120-127).
 *
 * Rules under test:
 *   - DH pp.120-127: action vs action resolution. The interaction
 *     matrix (config.mjs L407-424) governs which side(s) roll. A
 *     "none" sideInteraction means that side does NOT test
 *     (`tests = interaction !== "none"` — conflict-roll.mjs L41).
 *   - Matrix (config.mjs L416): `"feint:attack": "none"`. The side
 *     that chose Feint sees `sideInteraction === "none"` when the
 *     opposing side chose Attack, so the feinter does NOT roll.
 *   - Matrix (config.mjs L410): `"attack:feint": "independent"`. The
 *     side that chose Attack (against an opposing Feint) rolls
 *     independently at Ob 0 (`conflictObstacles.attack = 0`, config.mjs
 *     L431). The per-side sideInteraction disagreement across the
 *     two groups is what drives the asymmetric "one side rolls, the
 *     other doesn't" shape in `#onRollAction`.
 *
 * -------------------------------------------------------------------
 * Checkbox wording caveat
 * -------------------------------------------------------------------
 * TEST_PLAN L455 reads "feinter rolls, defender does not; feinter
 * hits on any successes". Production behaves the OPPOSITE way — per
 * the matrix above, the feinter's side carries the "none" interaction
 * (feinter does NOT roll) and the opposing (attack) side rolls
 * independently at Ob 0. This is consistent with the briefing's DH
 * p.120-127 summary ("Feint vs Attack/Defend = none (defender/feinter
 * doesn't roll)") and with `getInteraction` + the matrix. The spec
 * asserts against the production behavior, not the checkbox prose.
 *
 * The "feinter hits on any successes" half of the checkbox maps to
 * HP damage on the attacker when the feint lands — which depends on
 * `resolveActionEffect` being consumed by the resolve pipeline. That
 * is the same production gap flagged at TEST_PLAN L453 (attack-vs-
 * defend `test.fixme`) and L500 (§18 `hp-damage-reduces.spec.mjs`):
 * `resolveActionEffect` is imported only as dead code at
 * conflict-panel.mjs L3 and no call site writes to HP from volley
 * margins. HP mutation is OUT OF SCOPE for this spec.
 *
 * -------------------------------------------------------------------
 * Why this spec is NOT `test.fixme` (contrast with L453)
 * -------------------------------------------------------------------
 * L453's Attack vs Defend spec is fixmed because the HP-damage half
 * of its checkbox requires production wiring that does not exist. The
 * L455 checkbox is scoped here to interaction-matrix / roll-pipeline
 * behaviors that ARE wired:
 *
 *   - `#onRollAction` (conflict-panel.mjs L1909-1921) consults
 *     `getInteraction(actionKey, opponentAction)` per side:
 *       - On the feint side, sideInteraction === "none" — the
 *         template (panel-resolve.hbs L103-106) renders the roll
 *         button with `.invisible` + `disabled`, so a rollAction
 *         click is not a user-available path.
 *       - On the attack side, sideInteraction === "independent" — the
 *         button is enabled, `#onRollAction` sets obstacle =
 *         conflictObstacles.attack = 0 and does NOT stamp
 *         `isVersus`, landing in `_handleIndependentRoll`
 *         (tb2e-roll.mjs L1487-1540). Standard roll-result card,
 *         no versus-resolution card.
 *   - `combat.getVolleyInteraction(volleyIndex)` (combat.mjs L789-803)
 *     looks up `"feint:attack"` on the matrix — the top-level volley
 *     interaction is "none". This is what `#onResolveAction`
 *     (conflict-panel.mjs L2028) later re-derives via
 *     `getInteraction(resultSides[0].action, resultSides[1].action)`
 *     when it writes `round.volleys[i].result.interaction`. Because
 *     groups[0] is the party group here (scripted Feint first), the
 *     stored interaction on the volley result is "none".
 *   - `#onResolveAction` (conflict-panel.mjs L2003-2038) writes
 *     `round.volleys[0].result = { resolved, sides, interaction:
 *     "none", interactionLabel, timestamp }` via
 *     `combat.resolveVolley` (combat.mjs L772-782) and auto-advances
 *     `currentAction`.
 *
 * -------------------------------------------------------------------
 * Test fixture (deterministic)
 * -------------------------------------------------------------------
 *   Kill conflict (config.mjs L202-211 — attack = skill:fighter),
 *   2 characters + 2 monsters. Party captain scripts FEINT on volley
 *   0; GM captain scripts ATTACK on volley 0.
 *
 *   Party captain (`captainA`): fighter=3, health=4. Scripts FEINT
 *   on volley 0 → sideInteraction "none" → does NOT roll.
 *   GM captain (`monA`): Bugbear (Nature=4 per packs/_source/monsters/
 *   Bugbear_…yml). Monsters roll Nature for all conflict actions
 *   (conflict-roll.mjs L49-53). Scripts ATTACK on volley 0 →
 *   sideInteraction "independent" → rolls Nature vs Ob 0.
 *
 *   Both sides get distributed HP — party captain HP=4, GM captain
 *   HP=4. The spec does NOT assert HP mutation (§18 L500 scope).
 *
 *   PRNG stub:
 *     - u=0.001 → Math.ceil((1-u)*6) = 6 — all successes. Ensures
 *       the GM attacker "hits" (successes >= Ob 0 is always true for
 *       Ob=0, but this keeps the number of successes deterministic
 *       at Nature=4 − 1 unarmed = 3D → 3 successes).
 *
 *   Sequence for volley 0 (feint vs attack, none/independent asymmetric):
 *     1. `combat.getVolleyInteraction(0)` returns "none" (groups[0]
 *        scripted feint; matrix "feint:attack" = "none").
 *     2. `combat.beginResolve` flips phase to "resolve",
 *        currentAction = 0.
 *     3. Reveal volley 0 — posts the conflict-action-reveal card.
 *        The reveal card's interaction class reflects
 *        `getInteraction(sides[0].action, sides[1].action)` (conflict-
 *        panel.mjs L1822) — `interaction-none`.
 *     4. Party (feint) side: roll button is rendered but
 *        `.invisible` + `disabled` (panel-resolve.hbs L103-106).
 *        The feinter does NOT roll.
 *     5. GM (attack) side: roll button is enabled. Stub PRNG →
 *        all-6s. GM captain rolls Attack (Nature=4 − 1 unarmed = 3D
 *        → 3 successes vs Ob 0 → pass). Standard roll-result card,
 *        no versus flag.
 *     6. Mark resolved — `round.volleys[0].result = { resolved: true,
 *        sides, interaction: "none", ... }`. Auto-advance to
 *        currentAction = 1.
 *
 * Scope (narrow — TEST_PLAN L455 only):
 *   - Only verifies Feint vs Attack "none" interaction at the
 *     roll-pipeline level. Feint vs Feint (L456, versus), Maneuver
 *     (L457), card animation (L458), monster Nature detail (L459)
 *     are out of scope.
 *   - HP damage from margins is §18 L500 scope — the production gap
 *     is the same as L453 (resolveActionEffect unwired).
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

test.describe('§16 Conflict: Resolve — Feint vs Attack', () => {
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
    // clear them so count-based assertions in subsequent runs aren't
    // contaminated.
    await page.evaluate(async () => {
      const mids = game.messages.contents.map((m) => m.id);
      if ( mids.length ) await ChatMessage.deleteDocuments(mids);
    });
  });

  test(
    'Feint vs Attack: feinter does not roll; attacker rolls vs Ob 0 (DH pp.120-127)',
    async ({ page }, testInfo) => {
      const tag = `e2e-resolve-fva-${testInfo.parallelIndex}-${Date.now()}`;
      const stamp = Date.now();
      const charAName = `E2E FvA Captain ${stamp}`;
      const charBName = `E2E FvA Char B ${stamp}`;
      const monAName = `E2E FvA Bugbear ${stamp}`;
      const monBName = `E2E FvA Goblin ${stamp}`;

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

        // Stage disposition via direct writes. Prior art L427/L428/
        // L430/L431 covers the interactive UI paths.
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

        /* ---------- Scripting: feint (party) vs attack (GM) on volley 0 ---------- */

        // Party side: captain FEINTS on volley 0 — the matchup this
        // spec exists to exercise. Volleys 1 and 2 are filler so that
        // `#applyLockActions` (combat.mjs L534 requires all three
        // slots filled) opens.
        // GM side: monA ATTACKS on volley 0. Matrix lookup (config.mjs
        // L416 `feint:attack`) returns "none" at the top level —
        // groups[0] is the party group (feint) in this fixture. Per-
        // side: the party's sideInteraction is "none" (feinter
        // doesn't roll); the GM's sideInteraction is "independent"
        // via `getInteraction("attack", "feint")` (config.mjs L410).
        const partyActions = [
          { action: 'feint',    combatantId: cmb.captain },
          { action: 'defend',   combatantId: cmb.charB },
          { action: 'attack',   combatantId: cmb.captain }
        ];
        const gmActions = [
          { action: 'attack',   combatantId: cmb.monA },
          { action: 'defend',   combatantId: cmb.monB },
          { action: 'feint',    combatantId: cmb.monA }
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
            gm: ['attack', 'defend', 'feint']
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

        // Precondition: volley 0 top-level interaction is "none" via
        // combat.mjs L789-803 matrix lookup for `feint:attack`
        // (config.mjs L416). groups[0] is the party group here.
        expect(await page.evaluate(({ cId }) => {
          const c = game.combats.get(cId);
          return c.getVolleyInteraction(0);
        }, { cId: combatId })).toBe('none');

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

        // The reveal card carries the interaction label derived from
        // `getInteraction(sides[0].action, sides[1].action)`
        // (conflict-panel.mjs L1822) → `interaction-none` for the
        // party's feint vs GM's attack matchup. The reveal-card
        // template renders `.card-interaction.interaction-{key}`
        // (conflict-action-reveal.hbs L16-18).
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
        expect(revealCardInteraction.classes).toContain('interaction-none');
        expect(revealCardInteraction.hasText).toBe(true);

        /* ---------- Feinter side: button invisible + disabled ---------- */

        // Panel-resolve.hbs L103-106 renders a roll button for every
        // side whose `canRoll` is true, but adds `.invisible` +
        // `disabled` when sideInteraction === "none". For the party
        // (feint) side, `getInteraction("feint", "attack")` = "none",
        // so the button is non-interactive.
        const partyRollBtn = panel
          .resolveAction(0)
          .locator(`button[data-action="rollAction"][data-group-id="${partyGroupId}"]`);
        await expect(partyRollBtn).toHaveCount(1);
        await expect(partyRollBtn).toHaveClass(/\binvisible\b/);
        await expect(partyRollBtn).toBeDisabled();

        // Double-check via the side-interaction select (GM-only,
        // rendered by panel-resolve.hbs L88-94 when
        // `interactionOverridable` is true at conflict-panel.mjs
        // L1258-1260 — i.e. on the current unresolved action for GM).
        // The select's current value mirrors the per-side
        // `sideInteraction` (L1244). For the party (feint) side:
        // `getInteraction("feint", "attack")` = "none" per the matrix.
        const partySideSelect = panel
          .resolveAction(0)
          .locator(`select.side-interaction-select[data-group-id="${partyGroupId}"]`);
        await expect(partySideSelect).toHaveValue('none');

        /* ---------- Attacker side: enabled, rolls vs Ob 0 ---------- */

        // For the GM (attack) side, `getInteraction("attack",
        // "feint")` = "independent" (config.mjs L410), so the roll
        // button is enabled and `#onRollAction` sets obstacle =
        // conflictObstacles.attack = 0 (config.mjs L431) without
        // stamping `isVersus` — independent branch.
        await page.evaluate(() => {
          globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
          CONFIG.Dice.randomUniform = () => 0.001;
        });

        const chatCountBeforeGmRoll = await page.evaluate(
          () => game.messages.contents.length
        );

        const gmRollBtn = panel
          .resolveAction(0)
          .locator(`button[data-action="rollAction"][data-group-id="${gmGroupId}"]`);
        await expect(gmRollBtn).toBeVisible();
        await expect(gmRollBtn).toBeEnabled();
        await expect(gmRollBtn).not.toHaveClass(/\binvisible\b/);
        await gmRollBtn.click();

        const gmDialog = new RollDialog(page);
        await gmDialog.waitForOpen();
        // Dialog mode stays "independent" (no versus flag in the
        // testContext, so tb2e-roll.mjs L928-937 leaves
        // `mode=independent` in place).
        expect(await gmDialog.modeInput.inputValue()).toBe('independent');
        // Obstacle pre-filled to 0 from testContext.obstacle
        // (tb2e-roll.mjs L512-515).
        expect(await gmDialog.getObstacle()).toBe(0);
        await gmDialog.submit();

        // Find the new roll-result message carrying the conflict
        // testContext for this action (conflict-panel.mjs L1978-1990).
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
          groupId: gmGroupId,
          opponentGroupId: partyGroupId,
          hasVersusFlag: false,
          obstacle: 0,
          pass: true
        });
        // Attacker hits independently vs Ob 0 — successes >= 0.
        expect(gmCtx.successes).toBeGreaterThanOrEqual(0);

        /* ---------- No feinter roll card, no versus card ---------- */

        // Structural assertion: no chat message carries the feinter
        // actor id as a conflict-roll author — the feinter never
        // rolled. (Reveal and attacker-roll messages are the only
        // post-reveal chat entries.)
        const feinterRollCount = await page.evaluate((actorId) => {
          return game.messages.contents.filter((m) => {
            const tc = m.flags?.tb2e?.testContext;
            return tc?.isConflict
              && tc.conflictAction === 'feint'
              && m.flags?.tb2e?.actorId === actorId;
          }).length;
        }, captainId);
        expect(feinterRollCount).toBe(0);

        // And no versus pending/resolution card exists — the
        // independent branch never sets `isVersus`, so
        // `_handleVersusRoll` (tb2e-roll.mjs L1580-1650) was not
        // invoked.
        const versusCount = await page.evaluate(() => {
          return game.messages.contents.filter((m) => {
            return !!m.flags?.tb2e?.versus;
          }).length;
        });
        expect(versusCount).toBe(0);

        // Render-level sanity: the GM roll card is a standard TB2E
        // roll-result card with a pass banner — not a versus card.
        await page.evaluate(() => {
          ui.sidebar?.changeTab?.('chat', 'primary');
        });
        const cardShape = await page.evaluate((mid) => {
          const msg = game.messages.get(mid);
          const dom = new DOMParser().parseFromString(
            msg?.content ?? '', 'text/html'
          );
          return {
            hasBreakdown: !!dom.querySelector('.roll-card-breakdown'),
            hasPassBanner: !!dom.querySelector('.card-banner.banner-pass'),
            hasVersusResolution: !!dom.querySelector('.versus-resolution-card'),
            hasVersusPending: !!dom.querySelector('.versus-pending-card')
          };
        }, gmMessageId);
        expect(cardShape).toEqual({
          hasBreakdown: true,
          hasPassBanner: true,
          hasVersusResolution: false,
          hasVersusPending: false
        });

        /* ---------- Mark volley resolved ---------- */

        await page.evaluate(() => {
          ui.sidebar?.changeTab?.('combat', 'primary');
        });

        await panel
          .resolveAction(0)
          .locator('button[data-action="resolveAction"]')
          .click();

        // `#onResolveAction` writes `round.volleys[0].result` via
        // `combat.resolveVolley` (combat.mjs L772-782). Interaction
        // is re-derived at conflict-panel.mjs L2028 via
        // `getInteraction(resultSides[0].action, resultSides[1].action)`
        // — groups[0] is party (feint), so the stored interaction is
        // "none".
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
          .toEqual({ resolved: true, interaction: 'none', sideCount: 2 });

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
