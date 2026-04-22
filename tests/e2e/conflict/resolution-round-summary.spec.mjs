import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §20 Conflict: Resolution & Compromise — end-of-round posts the
 * `conflict-round-summary.hbs` chat card with per-volley actions and
 * per-group disposition outcomes (TEST_PLAN L542).
 *
 * ---------------------------------------------------------------------------
 * Rules as written — DH pp.125-127, SG pp.68-69
 * ---------------------------------------------------------------------------
 * DH p.127 describes the round/volley structure of a conflict: each round
 * consists of three action volleys (scripted during scripting, revealed +
 * resolved during resolve). A round ENDS after all three volleys are
 * resolved — at which point the GM may choose to call for a new round
 * (continuing the conflict) or resolve it entirely (if `checkConflictEnd`
 * signals an end state). The "round summary" chat card is a display-layer
 * convention — DH/SG don't mandate a specific summary artifact — but the
 * system implements one to give players a durable record of which actions
 * played out and how the disposition pools shifted over the round.
 *
 * This spec's scope is narrow and card-centric:
 *   - Posts exactly one `.conflict-summary-card` chat message when the
 *     GM marks the third volley as resolved.
 *   - The card lists all three volleys' actions per combatant per side,
 *     in order.
 *   - The card's disposition-changes block reports each group's current
 *     and max disposition totals at the end of the round.
 *
 * ---------------------------------------------------------------------------
 * Production path — call graph
 * ---------------------------------------------------------------------------
 *
 * Trigger: `panel-resolve.hbs` L120-124 renders an `isGM`-gated
 * `<button class="panel-action-btn secondary" data-action="resolveAction"
 * data-action-index="{{index}}">` inside each `.resolve-action.current`
 * body (the `{{#if this.isCurrent}}` gate at L31). Clicking dispatches to
 * `ConflictPanel.#onResolveAction` (conflict-panel.mjs L2003-2096).
 *
 * `#onResolveAction(event, target)`:
 *   1. Reads `actionIndex = parseInt(target.dataset.actionIndex)` (L2006).
 *   2. Builds `resultSides[]` from the currently scripted action entries
 *      (`round.actions[group.id][actionIndex]`) for each group (L2012-2024).
 *   3. Computes `interaction` via `getInteraction` against the action
 *      pair (L2027-2030) — looks up `config.mjs` L407-427 matrix.
 *   4. Calls `combat.resolveVolley(actionIndex, result)` (combat.mjs
 *      L772-782), which writes `round.volleys[actionIndex].result` on
 *      the stored rounds object.
 *   5. Calls `consumeResolvedManeuverEffects(actionIndex)` to drain any
 *      pending Impede/Position bags targeted at this volley (SG p.69).
 *   6. **The round-summary post gate** — `if ( actionIndex === 2 )`
 *      (conflict-panel.mjs L2046) fires ONLY when marking the third
 *      volley resolved. The handler then:
 *        a) Iterates `i = 0..2` building an `actions[]` array of per-
 *           volley `{ actionNum: i+1, sides: [...] }` entries
 *           (L2047-2064). For past volleys (V0/V1) it reads
 *           `round.volleys[i].result.sides` — falling back to
 *           reconstructing sides from `round.actions[g.id][i]` when
 *           the stored result didn't carry `sides` (L2053-2062; the
 *           fast-forward branch we exercise below). For V2 it uses the
 *           just-built `resultSides` directly.
 *        b) Builds `dispositionChanges[]` (L2067-2077) by iterating each
 *           group's member combatants and summing
 *           `combatant.actor.system.conflict.hp.{value,max}` — yielding
 *           `{ groupName, current, max }` per group. Per CLAUDE.md
 *           §Unlinked Actors this correctly reads from `c.actor`
 *           (synthetic for unlinked tokens).
 *        c) Renders `templates/chat/conflict-round-summary.hbs` with
 *           `{ round, actions, dispositionChanges }` context
 *           (L2079-2085) and posts via `ChatMessage.create`
 *           (L2086-2089).
 *   7. If `actionIndex < 2` auto-advances via `combat.nextAction()`
 *      (L2093-2095) — NOT called when actionIndex === 2, which is why
 *      the round-summary post is the terminal step of the round.
 *
 * Template (`templates/chat/conflict-round-summary.hbs`):
 *   - L2  `<div class="tb2e-chat-card conflict-summary-card">`
 *   - L5  header `{{localize "TB2E.Conflict.Round"}} {{round}} —
 *         {{localize "TB2E.Conflict.Summary"}}`
 *   - L7-16 one `.card-summary-action` per volley, each containing
 *         one `.card-summary-side.action-{{action}}` per group with
 *         "`{{combatantName}}: {{actionLabel}}`" text
 *   - L17-25 `{{#if dispositionChanges}}` block with one
 *         `.card-summary-change` per group reporting
 *         "`{{groupName}}: {{current}}/{{max}}`"
 *
 * ---------------------------------------------------------------------------
 * Staging — full wizard through lock, then fast-forward volleys
 * ---------------------------------------------------------------------------
 * Cloned from L540 (`resolution-major-compromise.spec.mjs`) and adapted
 * from L484 (`mos-carries-across-rounds.spec.mjs`) for the fast-forward
 * idiom:
 *
 *   - Kill conflict. Party: captain character (health=4, fighter=3) +
 *     alt character. GM: Bugbear boss + Goblin mook (both via the
 *     `tb2e.monsters` compendium).
 *   - Full wizard: setup → disposition (flat 8/6) → weapons (__unarmed__
 *     for everyone) → scripting (three volleys scripted per side so
 *     `lockActions` passes, combat.mjs L534) → lock → `beginResolve()`.
 *   - Disposition distributed via `c.distributeDisposition(...)` — party
 *     4/4 (both characters start with hp.value=4), monsters 3/3. The
 *     spec does NOT drive anyone to 0 HP — we want the conflict to
 *     continue (not end), so `canResolveConflict` (conflict-panel.mjs
 *     L1327-1328) stays false. The "New Round" button (panel-resolve.hbs
 *     L168-171) should render instead — we don't click it, but its
 *     presence confirms the round ended cleanly.
 *   - Fast-forward: write `round.volleys[0].result = { resolved: true,
 *     sides: [...], interaction: "independent" }` and similarly for V1.
 *     Bump `system.currentAction = 2` so V2 is the only `isCurrent`
 *     action (conflict-panel.mjs L1186). The V2 "Mark Resolved" button
 *     only renders inside the V2 `.resolve-action.current` body
 *     (panel-resolve.hbs L31/L117-126), gated by `isGM`.
 *   - Reveal V2 (so the body renders past the `{{#unless isRevealed}}`
 *     branch at L35 into the revealed-actions branch at L65-126 that
 *     contains the Mark Resolved button).
 *   - Click V2 Mark Resolved → `#onResolveAction(actionIndex: 2)` runs
 *     the round-summary post path.
 *
 * Why fast-forward: playing V0/V1 through the full reveal+roll+mark
 * pipeline costs 4+ roll-dialog submissions and isn't the scope —
 * L484 established the fast-forward idiom for exactly this reason
 * (L348-366: direct `round.volleys[0..1]` writes + `currentAction = 2`
 * bump). We reuse it here for the two filler volleys, then exercise the
 * real Mark Resolved button for V2 so the round-summary post path runs
 * end-to-end against the production handler.
 *
 * Why NOT trigger via `combat.advanceRound()` directly: the briefing
 * hypothesised three candidate triggers:
 *   (a) `advanceRound` itself posts the card;
 *   (b) a separate `nextRound` handler (which would be the panel's
 *       "New Round" button, `#onNextRound` at conflict-panel.mjs
 *       L2239-2248);
 *   (c) the passive post-resolve-last-volley path in `#onResolveAction`.
 *
 * Investigation confirmed **(c)**: the only call site for the
 * `conflict-round-summary.hbs` template is inside the
 * `if (actionIndex === 2)` branch of `#onResolveAction`
 * (conflict-panel.mjs L2046-2089). `advanceRound` (combat.mjs L810-878)
 * has no `ChatMessage.create` call. `#onNextRound` (conflict-panel.mjs
 * L2239-2248) just delegates to `advanceRound`. The card is posted at
 * the moment the round ENDS (third volley resolved), not when a new
 * round BEGINS.
 *
 * ---------------------------------------------------------------------------
 * Green vs fixme
 * ---------------------------------------------------------------------------
 * This spec goes GREEN. The production path is fully wired and the
 * template is complete. No gap observed in the card's actions or
 * dispositionChanges rendering.
 *
 * ---------------------------------------------------------------------------
 * Explicit non-scope
 * ---------------------------------------------------------------------------
 *   - No-compromise / minor / major / end-conflict cards — TEST_PLAN
 *     L538-L541 (this §20 iteration is exclusively the round-summary
 *     card).
 *   - Cross-round maneuver carryover — TEST_PLAN L484.
 *   - Actual volley roll pipeline (reveal card, roll dialogs, versus
 *     resolution) — covered by L454-L459, L480-L484.
 *   - Rendering of the "New Round" button OR clicking it — the panel's
 *     `#onNextRound` (conflict-panel.mjs L2239-2248) is the trigger for
 *     `advanceRound`, but `advanceRound` itself does NOT post a card
 *     (verified). The round-summary card has already been posted by the
 *     time "New Round" is even visible.
 *
 * All Playwright sessions authenticate as GM (tests/e2e/auth.setup.mjs
 * L14-35). The Mark Resolved button + chat post path are both GM-gated
 * (panel-resolve.hbs L119; `ChatMessage.create` posts from the acting
 * user).
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

test.describe('§20 Conflict: Resolution — end-of-round posts conflict-round-summary chat card (DH p.127, TEST_PLAN L542)', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => {
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

  test('resolving volley 3 posts conflict-round-summary.hbs with 3-volley action rows + per-group disposition readouts', async ({ page }, testInfo) => {
    const tag = `e2e-round-summary-${testInfo.parallelIndex}-${Date.now()}`;
    const stamp = Date.now();
    const captainName = `E2E RS Captain ${stamp}`;
    const altName = `E2E RS Alt ${stamp}`;
    const monAName = `E2E RS Bugbear ${stamp}`;
    const monBName = `E2E RS Goblin ${stamp}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Mark Resolved button + round-summary chat post are GM-gated
    // (panel-resolve.hbs L119 `{{#if @root.isGM}}`; ChatMessage.create
    // posts from the acting user). Our harness is GM (auth.setup.mjs).
    expect(await page.evaluate(() => game.user.isGM)).toBe(true);

    try {
      /* ---------- Arrange actors ---------- */

      const captainId = await createCaptainCharacter(page, {
        name: captainName, tag, fighter: 3, health: 4
      });
      const altId = await createCharacter(page, { name: altName, tag });
      const monAId = await importMonster(page, {
        sourceName: 'Bugbear', uniqueName: monAName, tag
      });
      const monBId = await importMonster(page, {
        sourceName: 'Goblin', uniqueName: monBName, tag
      });

      /* ---------- Create conflict, resolve group ids ---------- */

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

      /* ---------- Setup tab: 4 combatants, captains, kill conflict ---------- */

      const panel = new ConflictPanel(page);
      await panel.open();
      expect(await panel.activeTabId()).toBe('setup');

      const cmb = {};
      cmb.captain = await panel.addCombatant({
        combatId, actorId: captainId, groupId: partyGroupId
      });
      cmb.alt = await panel.addCombatant({
        combatId, actorId: altId, groupId: partyGroupId
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

      /* ---------- Disposition: flat-set, full pools both sides ---------- */

      // Party disposition 8 → distributed 4/4. GM disposition 6 →
      // distributed 3/3. Nobody is driven to 0 — the conflict should
      // NOT end, so `canResolveConflict` stays false and the "New
      // Round" button renders at round end instead (panel-resolve.hbs
      // L168-171). The round-summary post path is orthogonal to the
      // end-of-conflict path — L542 tests the end-of-ROUND card, not
      // the end-of-conflict compromise card (L538-L541).
      await page.evaluate(async ({ cId, pId, gId }) => {
        const c = game.combats.get(cId);
        await c.storeDispositionRoll(pId, {
          rolled: 8, diceResults: [], cardHtml: '<em>E2E</em>'
        });
        await c.storeDispositionRoll(gId, {
          rolled: 6, diceResults: [], cardHtml: '<em>E2E</em>'
        });
      }, { cId: combatId, pId: partyGroupId, gId: gmGroupId });

      await page.evaluate(async ({ cId, pId, gId, capId, aId, mAId, mBId }) => {
        const c = game.combats.get(cId);
        const party = {}; party[capId] = 4; party[aId] = 4;
        const gm = {};    gm[mAId]   = 3; gm[mBId]   = 3;
        await c.distributeDisposition(pId, party);
        await c.distributeDisposition(gId, gm);
      }, {
        cId: combatId,
        pId: partyGroupId,
        gId: gmGroupId,
        capId: cmb.captain,
        aId: cmb.alt,
        mAId: cmb.monA,
        mBId: cmb.monB
      });

      await expect(panel.beginWeaponsButton).toBeEnabled();
      await panel.clickBeginWeapons();

      /* ---------- Weapons: __unarmed__ for everyone ---------- */

      await page.evaluate(async ({ cId, ids }) => {
        const c = game.combats.get(cId);
        for ( const id of ids ) {
          await c.setWeapon(id, 'Fists', '__unarmed__');
        }
      }, {
        cId: combatId,
        ids: [cmb.captain, cmb.alt, cmb.monA, cmb.monB]
      });

      await expect(panel.beginScriptingButton).toBeEnabled();
      await panel.clickBeginScripting();

      /* ---------- Scripting: distinct actions per volley to prove ordering ---------- */

      // We pick THREE DIFFERENT action keys per side so the rendered
      // `.card-summary-side.action-{key}` class on each row is unique
      // per volley — this lets us assert ordering (V1→V2→V3) cleanly.
      // Party: attack / defend / feint. GM: feint / maneuver / attack.
      // None of these are resolved via rolls (we fast-forward), so the
      // action config interactions (versus vs independent) don't matter
      // here; they just need to be valid keys (conflict-panel.mjs
      // L2020 `CONFIG.TB2E.conflictActions[e.action]?.label`).
      const partyActions = [
        { action: 'attack', combatantId: cmb.captain },
        { action: 'defend', combatantId: cmb.alt },
        { action: 'feint',  combatantId: cmb.captain }
      ];
      const gmActions = [
        { action: 'feint',    combatantId: cmb.monA },
        { action: 'maneuver', combatantId: cmb.monA },
        { action: 'attack',   combatantId: cmb.monA }
      ];
      await page.evaluate(async ({ cId, pId, gId, pa, ga }) => {
        const c = game.combats.get(cId);
        await c.setActions(pId, pa);
        await c.setActions(gId, ga);
      }, {
        cId: combatId,
        pId: partyGroupId,
        gId: gmGroupId,
        pa: partyActions,
        ga: gmActions
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
          party: ['attack', 'defend', 'feint'],
          gm: ['feint', 'maneuver', 'attack']
        });

      await page.evaluate(async ({ cId, pId, gId }) => {
        const c = game.combats.get(cId);
        await c.lockActions(pId);
        await c.lockActions(gId);
      }, { cId: combatId, pId: partyGroupId, gId: gmGroupId });

      /* ---------- Transition to resolve phase ---------- */

      await page.evaluate(async ({ cId }) => {
        const c = game.combats.get(cId);
        await c.beginResolve();
      }, { cId: combatId });

      await expect.poll(() => panel.activeTabId()).toBe('resolve');
      expect(await page.evaluate(({ cId }) => {
        const c = game.combats.get(cId);
        return { phase: c.system.phase, currentAction: c.system.currentAction };
      }, { cId: combatId })).toEqual({ phase: 'resolve', currentAction: 0 });

      /* ---------- Fast-forward V0 and V1 ---------- */

      // Mirror of L484 (`mos-carries-across-rounds.spec.mjs` L347-366):
      // write stub `volleys[0..1].result = { ... }` directly, then bump
      // `system.currentAction` to 2. This skips rolling V0/V1 and the
      // panel correctly renders V2 as `.isCurrent` so its Mark Resolved
      // button renders (panel-resolve.hbs L31 `{{#if this.isCurrent}}`
      // gates the whole body, and L117-126 the button itself).
      //
      // We store `sides` arrays on the filler results here — this means
      // `#onResolveAction`'s round-summary builder (conflict-panel.mjs
      // L2050-2062) takes the primary branch (reads `volley.result.
      // sides`) for V0/V1 rather than the fallback. We seed side payloads
      // that match the scripted actions exactly so the rendered card
      // rows reflect the scripted matchups. (The fallback branch would
      // produce equivalent output — it reconstructs sides from
      // `round.actions` — but asserting against known seeded values is
      // more precise.)
      await page.evaluate(async ({ cId, aCap, aAlt, mA, mAName, capName, altName }) => {
        const c = game.combats.get(cId);
        const rounds = foundry.utils.deepClone(c.system.rounds);
        const r = rounds[c.system.currentRound];
        r.volleys[0].revealed = true;
        r.volleys[0].result = {
          resolved: true,
          sides: [
            { action: 'attack', actionLabel: 'Attack', combatantName: capName },
            { action: 'feint',  actionLabel: 'Feint',  combatantName: mAName }
          ],
          interaction: 'independent'
        };
        r.volleys[1].revealed = true;
        r.volleys[1].result = {
          resolved: true,
          sides: [
            { action: 'defend',   actionLabel: 'Defend',   combatantName: altName },
            { action: 'maneuver', actionLabel: 'Maneuver', combatantName: mAName }
          ],
          interaction: 'versus'
        };
        await c.update({
          'system.rounds': rounds,
          'system.currentAction': 2
        });
      }, {
        cId: combatId,
        aCap: cmb.captain,
        aAlt: cmb.alt,
        mA: cmb.monA,
        mAName: monAName,
        capName: captainName,
        altName: altName
      });

      await expect
        .poll(() => page.evaluate(({ cId }) => {
          const c = game.combats.get(cId);
          return c.system.currentAction ?? null;
        }, { cId: combatId }))
        .toBe(2);

      /* ---------- Reveal V2 ---------- */

      // The Mark Resolved button renders inside
      // `.resolve-action.current` only when `this.isRevealed` is true
      // (panel-resolve.hbs L65-126, the else branch of
      // `{{#unless this.isRevealed}}`). Clicking Reveal on the current
      // volley dispatches to `#onRevealAction` (conflict-panel.mjs
      // L1796-1838), which flips `round.volleys[currentAction].revealed`
      // and posts a reveal chat card.
      await panel
        .resolveAction(2)
        .locator('button[data-action="revealAction"]')
        .click();

      await expect
        .poll(() => page.evaluate(({ cId }) => {
          const c = game.combats.get(cId);
          const round = c.system.rounds?.[c.system.currentRound];
          return round?.volleys?.[2]?.revealed ?? null;
        }, { cId: combatId }))
        .toBe(true);

      /* ---------- Capture baseline chat count ---------- */

      // Pre-trigger baseline so we can identify the round-summary card
      // by slice(baseline) after the Mark Resolved click. The reveal
      // click above posts a reveal card — that's BEFORE baseline, so
      // it's excluded from the post-click delta.
      const chatCountBefore = await page.evaluate(
        () => game.messages.contents.length
      );

      /* ---------- Act: click Mark Resolved on V2 ---------- */

      // Triggers `#onResolveAction` with `actionIndex === 2` — the
      // round-summary post path at conflict-panel.mjs L2046-2089.
      await panel
        .resolveAction(2)
        .locator('button[data-action="resolveAction"]')
        .click();

      /* ---------- Assert: V2 result stored, no auto-advance ---------- */

      // `resolveVolley(2, result)` wrote `round.volleys[2].result`
      // (combat.mjs L772-782). And because `actionIndex === 2`, the
      // auto-advance at L2093-2095 is skipped — `currentAction` stays at
      // 2 (the panel then renders the "New Round" button because
      // `allResolved` is true, panel-resolve.hbs L167-171).
      await expect
        .poll(() => page.evaluate(({ cId }) => {
          const c = game.combats.get(cId);
          const round = c.system.rounds?.[c.system.currentRound];
          const vr = round?.volleys?.[2]?.result;
          if ( !vr ) return null;
          return {
            resolved: !!vr.resolved,
            interaction: vr.interaction ?? null,
            sideCount: vr.sides?.length ?? 0
          };
        }, { cId: combatId }))
        // V2 action pair is party:feint vs gm:attack — `getInteraction`
        // (conflict-panel.mjs L2028 → config.mjs L416) returns "none"
        // for `feint:attack`. The specific interaction value is
        // incidental to this spec; what matters is that resolveVolley
        // stored a result with the two scripted sides.
        .toEqual({ resolved: true, interaction: 'none', sideCount: 2 });

      // Precondition for the "end of round" framing: conflict is NOT
      // over (no side at 0 HP), so `#onResolveConflict` / compromise
      // card path did NOT fire. Only the round-summary card should be
      // new in the chat log.
      expect(await page.evaluate(({ cId }) => {
        const c = game.combats.get(cId);
        return c.checkConflictEnd();
      }, { cId: combatId })).toMatchObject({ ended: false });

      /* ---------- Assert: one new chat card — the round summary ---------- */

      await expect
        .poll(
          () => page.evaluate(
            (base) => game.messages.contents.length - base,
            chatCountBefore
          ),
          { timeout: 10_000 }
        )
        .toBe(1);

      const cardMessageId = await page.evaluate((base) => {
        const added = game.messages.contents.slice(base);
        return added[0]?.id ?? null;
      }, chatCountBefore);
      expect(cardMessageId).toBeTruthy();

      // Scope all DOM reads to the specific message li with
      // `.first()` — defensive against Foundry's notification popup
      // occasionally double-rendering a recent card.
      const cardRoot = page
        .locator(`li.chat-message[data-message-id="${cardMessageId}"] .conflict-summary-card`)
        .first();
      await expect(cardRoot).toBeVisible();

      /* ---------- Assert: card header reports round 1 + summary label ---------- */

      // Header format (conflict-round-summary.hbs L4-6):
      //   "<icon> {{localize 'TB2E.Conflict.Round'}} {{round}} —
      //    {{localize 'TB2E.Conflict.Summary'}}"
      // lang/en.json L492 "Round", L624 "Summary". `round` is
      // `combat.system.currentRound || 0` at conflict-panel.mjs L2010,
      // passed as `round` to the template at L2081. The first round is
      // round 1 (combat.mjs L287-307). Use `textContent` (not
      // `innerText`) so CSS `text-transform: uppercase` styling on the
      // card header doesn't mangle the assertion — the underlying
      // template text is mixed-case.
      const headerText = await cardRoot
        .locator('.card-title')
        .evaluate((el) => el.textContent);
      expect(headerText.trim()).toBe('Round 1 — Summary');

      /* ---------- Assert: three `.card-summary-action` rows with correct ordering ---------- */

      const actionRows = cardRoot.locator('.card-summary-action');
      await expect(actionRows).toHaveCount(3);

      // Per-row action numbers: `{{this.actionNum}}` at template L9
      // (1-indexed — `actionNum: i + 1` at conflict-panel.mjs L2063).
      // Use `textContent` to avoid CSS `text-transform` interference —
      // numeric labels aren't affected here, but it's a stable pattern
      // for this card.
      const actionNums = await actionRows
        .locator('.card-summary-num')
        .evaluateAll((els) => els.map((el) => el.textContent.trim()));
      expect(actionNums).toEqual(['1', '2', '3']);

      // Each row's sides carry an `.action-{{action}}` class emitted at
      // template L11. Assert the per-row action keys match the scripted
      // pairings — this is the strongest "actions shown per combatant
      // per volley" assertion in the checkbox (TEST_PLAN L542).
      //
      // V0 (row 0): party attack / GM feint
      // V1 (row 1): party defend / GM maneuver
      // V2 (row 2): party feint / GM attack  (the LIVE mark-resolved
      //                                       volley — uses
      //                                       `resultSides` built at
      //                                       conflict-panel.mjs
      //                                       L2013-2024)
      for ( const [rowIdx, expected] of [
        [0, ['action-attack', 'action-feint']],
        [1, ['action-defend', 'action-maneuver']],
        [2, ['action-feint',  'action-attack']]
      ] ) {
        const sides = actionRows.nth(rowIdx).locator('.card-summary-side');
        await expect(sides).toHaveCount(2);
        const classes = await sides.evaluateAll((els) =>
          els.map((el) => el.className)
        );
        for ( const [sideIdx, cls] of expected.entries() ) {
          expect(classes[sideIdx]).toContain(cls);
        }
      }

      // Side content: `{{combatantName}}: {{actionLabel}}` at template
      // L12. For V2 the combatantName is read from
      // `combat.combatants.get(entry.combatantId).name` at
      // conflict-panel.mjs L2021. For V0/V1 we seeded the names
      // directly on the stub result above. Party captain is on V0 and
      // V2; alt is on V1; Bugbear (monA) is on all three GM volleys.
      // Use `textContent` (not `innerText`) so CSS `text-transform`
      // on the card doesn't alter the assertion — the underlying
      // template text at L12 is mixed-case from the actor names and the
      // localized action labels (lang/en.json L487-490 "Attack" /
      // "Defend" / "Feint" / "Maneuver"). `textContent` also collapses
      // any trailing whitespace we may have to normalize.
      const readRowSides = async (idx) =>
        (await actionRows.nth(idx)
          .locator('.card-summary-side')
          .evaluateAll((els) => els.map((el) =>
            el.textContent.replace(/\s+/g, ' ').trim()
          )));

      const v0Sides = await readRowSides(0);
      expect(v0Sides[0]).toBe(`${captainName}: Attack`);
      expect(v0Sides[1]).toBe(`${monAName}: Feint`);

      const v1Sides = await readRowSides(1);
      expect(v1Sides[0]).toBe(`${altName}: Defend`);
      expect(v1Sides[1]).toBe(`${monAName}: Maneuver`);

      const v2Sides = await readRowSides(2);
      expect(v2Sides[0]).toBe(`${captainName}: Feint`);
      expect(v2Sides[1]).toBe(`${monAName}: Attack`);

      /* ---------- Assert: disposition-changes block ---------- */

      // Template L17-25 `{{#if dispositionChanges}}` → one
      // `.card-summary-change` per group with text
      // "`{{groupName}}: {{current}}/{{max}}`" (L21). The builder at
      // conflict-panel.mjs L2067-2077 sums `c.actor.system.conflict.
      // hp.{value,max}` across each group's combatants — this spec
      // didn't damage anyone, so party reports 8/8 (4+4) and GM 6/6
      // (3+3). Per CLAUDE.md §Unlinked Actors the read uses `c.actor`
      // which resolves to the synthetic token actor for unlinked
      // monsters (Bugbear/Goblin) and the world actor for linked
      // characters — both paths correctly surface the full seeded HP.
      const changes = cardRoot.locator('.card-summary-change');
      await expect(changes).toHaveCount(2);
      // Use `textContent` to avoid CSS `text-transform` on card
      // headers/labels. Default group names are "Party Team" / "GM Team"
      // (combat.mjs L27-32 seeds from TB2E.Conflict.PCTeam /
      // TB2E.Conflict.NPCTeam which localize to "Party Team" / "GM Team"
      // per lang/en.json L456-457). Sort so we don't depend on group
      // ordering — `Array.from(combat.groups)` is insertion order, and
      // while the panel creates the party group first, the template
      // just iterates in that order.
      const changeTexts = await changes.evaluateAll((els) =>
        els.map((el) => el.textContent.replace(/\s+/g, ' ').trim())
      );
      expect(changeTexts.sort()).toEqual(['GM Team: 6/6', 'Party Team: 8/8']);

      /* ---------- Assert: resolve tab now shows "New Round" button ---------- */

      // Post-V2-resolution, `allResolved` is true and
      // `canResolveConflict` is false (nobody at 0 HP) — so the
      // navigation region renders the `data-action="nextRound"` button
      // (panel-resolve.hbs L167-171). This confirms the panel has
      // reached the end-of-round state that the round-summary card
      // records. The `advanceRound` / `#onNextRound` path is NOT
      // exercised here — it's covered by TEST_PLAN L484.
      await expect(
        panel.resolveContent.locator(
          'button.setup-next-btn[data-action="nextRound"]'
        )
      ).toBeVisible();
      await expect(panel.resolveConflictButton).toHaveCount(0);
    } finally {
      await cleanupTaggedActors(page, tag);
    }
  });
});
