import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §20 Conflict: Resolution & Compromise — end-of-conflict "major victory"
 * classification when the loser is at 0 HP and the winner is at > 50% of
 * their starting disposition (TEST_PLAN L538).
 *
 * ---------------------------------------------------------------------------
 * Rules as written — Scholar's Guide pp.74-76 ("Compromise") and DH p.254
 * ---------------------------------------------------------------------------
 * SG p.74 ("Compromise") establishes three grades keyed off the WINNER's
 * remaining disposition vs. their starting disposition:
 *
 *   - **Minor Compromise** (p.75):  "If the winner ends the conflict with
 *     more than half of their starting disposition, they owe the loser a
 *     minor compromise."
 *   - **Half Compromise** (p.75):  "If the winner ends the conflict with
 *     roughly half of their starting disposition, they owe the loser a
 *     mid-level compromise in this conflict."
 *   - **Major Compromise** (p.75):  "If the winner's disposition is reduced
 *     to just a few points at the end of the conflict, they owe the loser a
 *     major compromise."
 *
 * DH p.254 reiterates: "The winner offers a minor, half or major compromise
 * relative to damage taken."
 *
 * The **"no compromise"** case (what TEST_PLAN L538 labels "major victory")
 * is NOT one of the three written grades — the rules explicitly say
 * compromise is owed to the loser whenever the loser "took points off their
 * opponent's final disposition total" (SG p.74). The single path to
 * zero-compromise under the rules-as-written is the winner taking **no
 * damage at all**: starting === remaining → loser took zero points off the
 * winner → no compromise owed.
 *
 * This spec exercises exactly that path: winner keeps 100% of starting
 * disposition (no damage taken) → no compromise. The resolution tab's
 * `noCompromise` context flag (conflict-panel.mjs L1365 —
 * `context.noCompromise = comp.remaining === comp.starting`) matches this
 * interpretation.
 *
 * ---------------------------------------------------------------------------
 * Production path — call graph
 * ---------------------------------------------------------------------------
 *
 * 1. Phase transition (resolve → resolution):
 *    - Resolve tab shows a "Resolve Conflict" button
 *      (panel-resolve.hbs L162-166) gated by `canResolveConflict`, which is
 *      just `endState.ended` from `checkConflictEnd` (conflict-panel.mjs
 *      L1327-1328).
 *    - `combat.checkConflictEnd()` (combat.mjs L910-929) sums each group's
 *      `combatant.actor.system.conflict.hp.value`; when one group totals
 *      `<= 0` and the other doesn't, returns `{ ended: true, winnerGroupId,
 *      loserGroupId }` (L928).
 *    - Click → `ConflictPanel.#onResolveConflict` (conflict-panel.mjs
 *      L2256-2303):
 *        a) computes `endState` + `compromise = { level, label }` from
 *           `combat.calculateCompromise(winnerGroupId)` (L2268-2275)
 *        b) builds `teams[]` with `{ name, remaining, starting }` per group
 *           (L2278-2287)
 *        c) renders `templates/chat/conflict-compromise.hbs` (L2289-2295)
 *        d) posts via `ChatMessage.create(...)` (L2296-2299)
 *        e) calls `combat.beginResolution()` (L2301 → combat.mjs L935-938,
 *           flips `system.phase = "resolution"`)
 *        f) sets `this.#activeTab = "resolution"` (L2302)
 *
 * 2. Resolution tab rendering (`#prepareResolutionContext`,
 *    conflict-panel.mjs L1340-1402):
 *    - `comp = calculateCompromise(winnerGroupId)` (L1356):
 *        - percent = remaining / starting (combat.mjs L897)
 *        - `percent > 0.5` → level "minor"
 *        - `percent > 0.25` → level "half"
 *        - else         → level "major"
 *    - `context.compromise = { level, label, remaining, starting, percent
 *      (as integer %) }` (L1358-1364)
 *    - `context.noCompromise = comp.remaining === comp.starting` (L1365) —
 *      the sole predicate in production for "winner took zero damage"
 *    - Template `panel-resolution.hbs` L16-25 renders the compromise block;
 *      when `noCompromise` is true (L18 `{{#if noCompromise}}`), renders
 *      `TB2E.Conflict.Compromise.None` ("No Compromise"); otherwise renders
 *      `compromise.label` with remaining/starting readout.
 *    - `context.resolutionTeams` (L1378-1394) — each with
 *      `{ name, remaining, starting, percent, isWinner, isLoser }`. The
 *      template renders `.resolution-team.winner` / `.resolution-team.loser`
 *      modifiers per panel-resolution.hbs L37.
 *
 * 3. `calculateCompromise` (combat.mjs L885-904):
 *    - Iterates the winner group's combatants, sums
 *      `actor.system.conflict.hp.{value,max}` (L890-893). Per CLAUDE.md
 *      §Unlinked Actors, `c.actor` resolves to the per-token synthetic for
 *      unlinked monsters — not the world template. This matters only when
 *      the winner is the monster team with unlinked tokens; we stage the
 *      winner as the party (linked characters) so the distinction doesn't
 *      drive the outcome here.
 *    - `percent === 1.0` → level "minor" (>0.5 branch). This is the
 *      "no-damage" case — the level key is still "minor" at the
 *      `calculateCompromise` layer; the "no compromise" rendering is
 *      entirely downstream in `#prepareResolutionContext` at L1365.
 *
 * ---------------------------------------------------------------------------
 * Staging
 * ---------------------------------------------------------------------------
 * Kill conflict — same skeleton as mos-*.spec.mjs (L480-L484),
 * hp-ko-swap-mid-volley.spec.mjs (L503), and team-synergy.spec.mjs (L520).
 * Drive the full panel wizard: setup → disposition → weapons → scripting →
 * lock → beginResolve. Stop BEFORE any rolls (no roll pipeline needed —
 * this spec's scope is the end-of-conflict transition, not per-volley
 * damage application).
 *
 *   - Party (winner, 100% HP):
 *       - captain character (HP 4/4)
 *       - alt character    (HP 4/4)
 *       - group total: remaining = starting = 8 → percent = 1.0 → level
 *         "minor" AND noCompromise = true (per L1365)
 *   - GM (loser, 0 HP):
 *       - Bugbear boss  (HP 0/3) — captain of the GM team
 *       - Goblin mook   (HP 0/3)
 *       - group total: remaining = 0 → loserGroupId matches GM group
 *
 * HP seeding:
 *   - Party captain + alt: HP set via `distributeDisposition` (combat.mjs
 *     L219-242) to 4 each, matching the distributed disposition roll of 8.
 *     That gives `hp.max = 4` (the cap for any future clamp) and
 *     `hp.value = 4` (remaining = 100%).
 *   - Monsters: `distributeDisposition` seeds hp.{value,max} = 3 each for
 *     a rolled disposition of 6. Then we drive the loser HP straight to 0
 *     via a direct `actor.update({"system.conflict.hp.value": 0})` per the
 *     established pattern at script-independent-ko-sub.spec.mjs L395-397
 *     (the panel reads `actor.system.conflict.hp.value` via `combatant.
 *     actor`; for non-tokenised combatants in a test scene with no active
 *     scene, `combatant.actor` IS the world actor, so the direct write
 *     lands on the same document the panel reads).
 *
 * Why direct `actor.update` and not the `pendingConflictHP` mailbox:
 *   - The mailbox is the PLAYER-side path per CLAUDE.md §Mailbox Pattern
 *     and is specifically covered by TEST_PLAN L501 / L503 / L504 / L505.
 *     This spec's scope is the end-of-conflict RESOLUTION transition, not
 *     the HP-write mechanism. Using the direct write keeps the arrange
 *     step minimal and matches the idiom already established by
 *     script-independent-ko-sub.spec.mjs (L431) for "drive HP to 0 to
 *     test a downstream predicate". We're GM (auth.setup.mjs L14-35) so
 *     direct writes are authorised.
 *
 * ---------------------------------------------------------------------------
 * Production gap — why this spec is `test.fixme`
 * ---------------------------------------------------------------------------
 *
 * The **chat card** template (`templates/chat/conflict-compromise.hbs`)
 * does NOT render a "no compromise" / "major victory" branch. It
 * unconditionally renders the compromise block as
 *
 *   `<div class="card-compromise compromise-{{compromise.level}}">
 *     {{compromise.label}}
 *   </div>`
 *
 * when `compromise` is truthy (L11-15). The payload passed from
 * `#onResolveConflict` at conflict-panel.mjs L2272-2275 is always
 * `{ level: comp.level, label: localized(level) }` — there is NO
 * `noCompromise` flag passed to the chat card. For the winner-at-100% case,
 * `calculateCompromise` returns `level: "minor"` (percent = 1.0 > 0.5), so
 * the chat card posts with classes `.compromise-minor` and label
 * "Minor Compromise" — directly contradicting the RAW interpretation that
 * no compromise is owed.
 *
 * The **resolution tab** renders correctly (panel-resolution.hbs L18-23
 * gates on `noCompromise` → emits "No Compromise") because
 * `#prepareResolutionContext` populates `context.noCompromise` at L1365.
 * That branch IS exercisable green; if a future spec wants to assert the
 * resolution-tab behavior in isolation, it could do so without a fixme.
 *
 * This spec asserts the FULL desired behavior — both the resolution tab
 * AND the chat card — so it has to go fixme on the chat-card assertions.
 * Splitting into a green "resolution-tab-only" spec plus a fixmed
 * "chat-card-only" spec would fragment the coverage; L538's scope is the
 * full "major victory outcome and chat card" pipeline, so a single fixmed
 * spec is the honest shape.
 *
 * Fix shape (for the production patch that unblocks this spec):
 *   - `#onResolveConflict` (conflict-panel.mjs L2256-2303) should compute
 *     `noCompromise` the same way `#prepareResolutionContext` does
 *     (L1365) and pass it into the chat card renderContext.
 *   - `templates/chat/conflict-compromise.hbs` needs a `{{#if
 *     noCompromise}}` branch in the compromise block emitting the
 *     `TB2E.Conflict.Compromise.None` label (same localization key the
 *     resolution tab uses at panel-resolution.hbs L19) with a stable DOM
 *     marker — e.g. `<div class="card-compromise compromise-none">`. When
 *     that lands, flip this spec to `test(...)` and tighten the two
 *     chat-card class/label assertions below.
 *
 * Path by which we expect "major victory" to surface after the fix (per
 * briefing): the chat card should carry a `.compromise-none` class (or
 * equivalent distinctive marker) and the localized "No Compromise" /
 * "Major Victory" label. The resolution-tab `.resolution-compromise.
 * level-minor` + `.resolution-compromise-label` with the "No Compromise"
 * text (emitted via the `noCompromise` gate at panel-resolution.hbs
 * L18-19) IS already correct and the spec asserts it green inside the
 * same test body — the fixme block is scoped to the chat-card assertions
 * that are gated on the not-yet-shipped template branch.
 *
 * ---------------------------------------------------------------------------
 * Explicit non-scope
 * ---------------------------------------------------------------------------
 *   - Minor compromise (winner 1-50% HP) — TEST_PLAN L539.
 *   - Major compromise (winner low HP) — TEST_PLAN L540.
 *   - End conflict cleanup / tracker teardown — TEST_PLAN L541.
 *   - End-of-round summary card — TEST_PLAN L542 (different template:
 *     `conflict-round-summary.hbs`, different trigger: `nextRound`).
 *   - Tie case (both sides at 0 on the same action, SG p.76) — not listed
 *     in §20's checkboxes; could warrant its own future entry.
 *   - Kill conflict "Killing Is My Business" compromise escalation
 *     (SG pp.77-78) — the panel renders an extra `killCompromisePageRef`
 *     in the resolution tab when `conflictType === "kill"` (conflict-
 *     panel.mjs L1398-1400), but the compromise LEVEL logic is
 *     unaffected; not under test here.
 *
 * All Playwright sessions authenticate as GM (tests/e2e/auth.setup.mjs
 * L14-35). The resolve-conflict button is GM-gated
 * (panel-resolve.hbs L160 `{{#if isGM}}`) and so is the chat-card
 * post path.
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

test.describe('§20 Conflict: Resolution — major victory (no compromise) outcome and chat card (SG pp.74-76, TEST_PLAN L538)', () => {
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

  test.fixme(
    'winner at 100% HP, loser at 0 HP → resolution tab "No Compromise", chat card DOES NOT (gap: missing noCompromise branch in conflict-compromise.hbs)',
    {
      annotation: {
        type: 'issue',
        description: 'The chat card template `templates/chat/conflict-compromise.hbs` renders `<div class="card-compromise compromise-{{compromise.level}}">{{compromise.label}}</div>` unconditionally when `compromise` is truthy, with NO branch for the winner-took-no-damage case. For a winner at 100% HP, `calculateCompromise` returns level "minor" (percent 1.0 > 0.5), so the card posts "Minor Compromise" contradicting SG pp.74-76 (no compromise is owed when the loser did not reduce the winner\'s disposition). Verified empirically: rendered card markup is `<div class="card-compromise compromise-minor">Minor Compromise</div>`. The RESOLUTION TAB already handles this correctly via `#prepareResolutionContext` L1365 `context.noCompromise = comp.remaining === comp.starting` and panel-resolution.hbs L18-19 which emits `TB2E.Conflict.Compromise.None` ("No Compromise") — that half of the spec passes green. Fix: pass `noCompromise` from `#onResolveConflict` (conflict-panel.mjs L2256-2303) into the chat-card render context, and add a `{{#if noCompromise}}` branch to conflict-compromise.hbs emitting the "No Compromise" localized label with a distinctive class (e.g. `compromise-none`). Once landed, flip `test.fixme` → `test` here — all upstream staging + resolution-tab assertions already pass; the only live failure today is the two chat-card class/label assertions at the end of the test body.'
      }
    },
    async ({ page }, testInfo) => {
      const tag = `e2e-resolution-victory-${testInfo.parallelIndex}-${Date.now()}`;
      const stamp = Date.now();
      const captainName = `E2E MV Captain ${stamp}`;
      const altName = `E2E MV Alt ${stamp}`;
      const monAName = `E2E MV Bugbear ${stamp}`;
      const monBName = `E2E MV Goblin ${stamp}`;

      await page.goto('/game');
      const ui = new GameUI(page);
      await ui.waitForReady();
      await ui.dismissTours();

      // Resolve-conflict button + chat post are both GM-gated (panel-
      // resolve.hbs L160 `{{#if isGM}}`; conflict-panel.mjs #onResolve
      // runs the render on the local session; ChatMessage.create posts
      // from the acting user). Our harness is GM.
      expect(await page.evaluate(() => game.user.isGM)).toBe(true);

      try {
        /* ---------- Arrange actors ---------- */

        const captainId = await createCharacter(page, { name: captainName, tag });
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

        /* ---------- Setup tab ---------- */

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

        /* ---------- Disposition: flat-set both sides ---------- */

        // Party disposition 8, distributed flat as 4/4 → each character
        // gets hp.max = 4, hp.value = 4 via combat.distributeDisposition
        // (combat.mjs L219-242). Party stays at 100% HP through the whole
        // spec — this is the "winner took no damage" shape that lights
        // the `noCompromise` predicate (conflict-panel.mjs L1365).
        //
        // Monster disposition 6, distributed flat as 3/3. We drive each
        // to 0 below; the initial seeding is to establish non-zero
        // `hp.max` so the render path that gates on `starting > 0`
        // (conflict-panel.mjs L1390) computes a valid percent.
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

        // Sanity: party is at 100%, monsters at full. We'll 0 the monsters
        // after the wizard gates; for now every combatant must have
        // hp.value > 0 so the `canBeginScripting` gate (conflict-panel.mjs
        // L978-979) which requires a weapon per non-KO combatant doesn't
        // short-circuit later.
        expect(await page.evaluate(({ capId, aId, mAId, mBId }) => ({
          cap: game.actors.get(capId)?.system.conflict?.hp ?? null,
          alt: game.actors.get(aId)?.system.conflict?.hp ?? null,
          monA: game.actors.get(mAId)?.system.conflict?.hp ?? null,
          monB: game.actors.get(mBId)?.system.conflict?.hp ?? null
        }), {
          capId: captainId, aId: altId, mAId: monAId, mBId: monBId
        })).toEqual({
          cap: { value: 4, max: 4 },
          alt: { value: 4, max: 4 },
          monA: { value: 3, max: 3 },
          monB: { value: 3, max: 3 }
        });

        await expect(panel.beginWeaponsButton).toBeEnabled();
        await panel.clickBeginWeapons();

        /* ---------- Weapons: stamp __unarmed__ directly ---------- */

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

        /* ---------- Scripting: pre-seed + lock both sides ---------- */

        // Actions don't drive the end-state here — `canResolveConflict`
        // keys purely off `checkConflictEnd().ended` which sums HP. We
        // still lock both sides so the panel progresses to the resolve
        // phase (combat.beginResolve at combat.mjs L357-371 gates on both
        // sides being locked).
        const partyActions = [
          { action: 'attack',   combatantId: cmb.captain },
          { action: 'defend',   combatantId: cmb.alt },
          { action: 'feint',    combatantId: cmb.captain }
        ];
        const gmActions = [
          { action: 'attack',   combatantId: cmb.monA },
          { action: 'defend',   combatantId: cmb.monB },
          { action: 'maneuver', combatantId: cmb.monA }
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
            gm: ['attack', 'defend', 'maneuver']
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

        await page.evaluate(async ({ cId }) => {
          const c = game.combats.get(cId);
          await c.beginResolve();
        }, { cId: combatId });

        await expect.poll(() => panel.activeTabId()).toBe('resolve');
        expect(await page.evaluate(({ cId }) => {
          const c = game.combats.get(cId);
          return { phase: c.system.phase, currentAction: c.system.currentAction };
        }, { cId: combatId })).toEqual({ phase: 'resolve', currentAction: 0 });

        /* ---------- Precondition: no "Resolve Conflict" button yet ---------- */

        // `canResolveConflict` is false until one side hits 0 HP
        // (conflict-panel.mjs L1327-1328 / combat.mjs L922-928).
        await expect(panel.resolveConflictButton).toHaveCount(0);

        /* ---------- Act: drive GM side to 0 HP ---------- */

        // Direct writes on the world actors — same pattern as
        // script-independent-ko-sub.spec.mjs L395-397. For non-tokenised
        // combatants, `combatant.actor` resolves to the world actor
        // (CLAUDE.md §Unlinked Actors — the synthetic path requires a
        // scene token, which this spec doesn't stage; the synthetic
        // parity edge is TEST_PLAN L505's scope). So a direct world-actor
        // write is exactly what the panel reads at
        // `combat.combatants.filter(...).map(c => c.actor.system.conflict
        // .hp.value)` inside `checkConflictEnd` / `calculateCompromise`
        // (combat.mjs L890-893, L916-917).
        await page.evaluate(async ({ mAId, mBId }) => {
          await game.actors.get(mAId).update({ 'system.conflict.hp.value': 0 });
          await game.actors.get(mBId).update({ 'system.conflict.hp.value': 0 });
        }, { mAId: monAId, mBId: monBId });

        // Verify `checkConflictEnd` now returns the expected winner/loser.
        const endState = await page.evaluate(({ cId }) => {
          const c = game.combats.get(cId);
          return c.checkConflictEnd();
        }, { cId: combatId });
        expect(endState).toEqual({
          ended: true,
          winnerGroupId: partyGroupId,
          loserGroupId: gmGroupId,
          tie: false
        });

        // And `calculateCompromise` for the winner returns percent = 1.0
        // → level "minor" at the raw layer. The "no compromise" decision
        // is downstream at `#prepareResolutionContext` L1365.
        const comp = await page.evaluate(({ cId, pId }) => {
          const c = game.combats.get(cId);
          return c.calculateCompromise(pId);
        }, { cId: combatId, pId: partyGroupId });
        expect(comp).toEqual({
          level: 'minor',
          remaining: 8,
          starting: 8,
          percent: 1
        });

        /* ---------- Act: click "Resolve Conflict" ---------- */

        // The button is now rendered because `canResolveConflict` is
        // true (conflict-panel.mjs L1328 ← endState.ended === true). The
        // POM helper clicks and waits for the resolution tab to become
        // active.
        const chatCountBefore = await page.evaluate(
          () => game.messages.contents.length
        );
        await expect(panel.resolveConflictButton).toBeVisible();
        await panel.clickResolveConflict();

        // Phase flipped to "resolution".
        expect(await page.evaluate(({ cId }) => {
          const c = game.combats.get(cId);
          return c.system.phase;
        }, { cId: combatId })).toBe('resolution');

        /* ---------- Assert: resolution tab renders no-compromise ---------- */

        // Winner banner: partyGroup name + winner styling
        // (panel-resolution.hbs L5-13). The `.winner` modifier is applied
        // when `!isTie`; since we have a winner, the banner carries it.
        await expect(panel.resolutionBanner).toBeVisible();
        await expect(panel.resolutionBanner).toHaveClass(/\bwinner\b/);
        await expect(panel.resolutionBanner).not.toHaveClass(/\btie\b/);

        // Compromise block present — the `{{#if compromise}}` gate at
        // panel-resolution.hbs L16 passes because the panel populates
        // `context.compromise` for the winning side regardless of
        // noCompromise (conflict-panel.mjs L1358-1364). The `.level-minor`
        // modifier comes from `calculateCompromise` returning "minor" at
        // percent 1.0 — the level key is the raw comparison, independent
        // of noCompromise.
        await expect(panel.resolutionCompromise).toBeVisible();
        await expect(panel.resolutionCompromise).toHaveClass(/\blevel-minor\b/);

        // Label: the `{{#if noCompromise}}` branch at panel-resolution.hbs
        // L18 fires because `context.noCompromise === true` (L1365 ←
        // `comp.remaining === comp.starting`, 8 === 8). So the rendered
        // label is `TB2E.Conflict.Compromise.None` — "No Compromise".
        await expect(panel.resolutionCompromiseLabel).toHaveText('No Compromise');

        /* ---------- Assert: chat card posted ---------- */

        // Exactly one new chat message — the compromise card posted at
        // conflict-panel.mjs L2296-2299 via ChatMessage.create.
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

        // The card should render from `conflict-compromise.hbs` — scope
        // the DOM locators to the specific message li to avoid
        // cross-contamination with prior-run cards (chat double-render
        // guard: `.first()` narrows if the chat log is ever doubled).
        const cardRoot = page
          .locator(`li.chat-message[data-message-id="${cardMessageId}"] .conflict-compromise-card`)
          .first();
        await expect(cardRoot).toBeVisible();

        // Winner name rendered in the card header (conflict-compromise.hbs
        // L8-10). Group names default to "Party"/"NPCs" — the stable
        // assertion is that SOMETHING was put in the winner slot (not
        // blank, not "???").
        const cardWinnerText = await cardRoot
          .locator('.card-winner strong')
          .innerText();
        expect(cardWinnerText.trim()).not.toBe('');
        expect(cardWinnerText.trim()).not.toBe('???');

        // Per-team HP readouts (conflict-compromise.hbs L18-23). Two
        // entries, party 8/8 (winner) and GM 0/6 (loser). The template
        // uses `{{this.remaining}}/{{this.starting}}` (L21), so the
        // rendered text is exactly "8/8" and "0/6".
        const teamRows = cardRoot.locator('.card-final-team');
        await expect(teamRows).toHaveCount(2);
        const teamTexts = await teamRows
          .locator('.card-final-team-hp')
          .allInnerTexts();
        expect(teamTexts.sort()).toEqual(['0/6', '8/8']);

        /* ---------- FIXME: chat card missing noCompromise branch ---------- */

        // DESIRED assertion — this is what the production fix should land.
        // When `noCompromise` is true (winner at 100% HP), the card
        // should render a distinctive marker for "major victory" — e.g.
        // the `compromise-none` class equivalent to the resolution-tab's
        // level-none path (panel-resolution.hbs L18-19 emits `TB2E.
        // Conflict.Compromise.None` via the `noCompromise` gate).
        //
        // Current production behavior: the card posts with class
        // `.compromise-minor` (because `calculateCompromise` returns
        // level "minor" at percent 1.0) and label "Minor Compromise" —
        // the SG pp.74-76 "no compromise" case is not distinguishable
        // from a real minor compromise, which is the gap the annotation
        // documents.
        //
        // The test.fixme at the top of the test skips execution of this
        // block in production; once the chat-card `{{#if noCompromise}}`
        // branch lands, removing `test.fixme` makes these assertions
        // active and the spec goes green end-to-end.
        const cardCompromise = cardRoot.locator('.card-compromise');
        await expect(cardCompromise).toBeVisible();
        // Desired: a distinctive class for the no-compromise state.
        await expect(cardCompromise).toHaveClass(/\bcompromise-none\b/);
        // Desired: the "No Compromise" localized label (matches the
        // resolution-tab label via `TB2E.Conflict.Compromise.None`).
        await expect(cardCompromise).toHaveText('No Compromise');
      } finally {
        await cleanupTaggedActors(page, tag);
      }
    }
  );
});
