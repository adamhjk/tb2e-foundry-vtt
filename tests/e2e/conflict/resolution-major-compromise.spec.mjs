import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §20 Conflict: Resolution & Compromise — "Major Compromise" classification
 * when the loser is at 0 HP and the winner retains ≤ 25% of their starting
 * disposition (TEST_PLAN L540).
 *
 * ---------------------------------------------------------------------------
 * Rules as written — Scholar's Guide pp.74-76 ("Compromise") and DH pp.125-127
 * ---------------------------------------------------------------------------
 * SG p.76 "Major Compromise" (scholars-guide-conflicts.md L517-519):
 *
 *   "If the winner's disposition is reduced to just a few points at the end
 *   of the conflict, they owe the loser a major compromise."
 *
 * The SG lays out three winning-with-damage brackets (L501-523):
 *   - Minor: winner > half of starting disposition.
 *   - Half: winner at roughly half.
 *   - Major: winner reduced to just a few points.
 *
 * DH pp.125-127 reiterates the same grading: the winner owes a compromise
 * relative to damage taken, from minor to major.
 *
 * This spec is the "major" bracket — winner took heavy damage but still
 * stands (at least one combatant > 0 HP) while the loser is at 0. The RAW
 * spirit is "a painful compromise" (SG p.76 L523: "A major compromise
 * should feel painful to the winner.").
 *
 * Contrast with:
 *   - TEST_PLAN L538 "no compromise" edge (winner at 100% HP, fixmed — chat
 *     card template lacks a `noCompromise` branch).
 *   - TEST_PLAN L539 "minor compromise" (winner at > 50% HP, green).
 *   - Half compromise (winner in 25%-50% bracket) — not under test here.
 *
 * ---------------------------------------------------------------------------
 * Production path — call graph (identical to L539; only HP seeds differ)
 * ---------------------------------------------------------------------------
 *
 * 1. Phase transition (resolve → resolution):
 *    - Resolve tab "Resolve Conflict" button (panel-resolve.hbs L163) gated
 *      by `canResolveConflict === endState.ended` (conflict-panel.mjs
 *      L1327-1328).
 *    - `combat.checkConflictEnd()` (combat.mjs L910-929) sums each group's
 *      `combatant.actor.system.conflict.hp.value`; party=1 > 0 (winner),
 *      gm=0 (loser).
 *    - Click → `ConflictPanel.#onResolveConflict` (conflict-panel.mjs
 *      L2256-2303) computes `compromise`, renders `conflict-compromise.hbs`,
 *      posts chat card, calls `beginResolution()` (combat.mjs L935-938,
 *      flips `system.phase = "resolution"`), sets `#activeTab = "resolution"`.
 *
 * 2. Resolution tab rendering (`#prepareResolutionContext`,
 *    conflict-panel.mjs L1340-1402):
 *    - `comp = calculateCompromise(winnerGroupId)` (L1356):
 *        - percent = remaining / starting (combat.mjs L897)
 *        - `percent > 0.5`  → level "minor"   (L539's bracket)
 *        - `percent > 0.25` → level "half"    (not under test)
 *        - else            → level "major"   ← THIS SPEC
 *    - With remaining=1, starting=8 → percent=0.125 → `percent > 0.25` is
 *      FALSE → level "major" (combat.mjs L901 else branch).
 *    - `levelKey = "Major"`, `label = localize("TB2E.Conflict.Compromise.
 *      Major")` → "Major Compromise" (lang/en.json L558).
 *    - `context.compromise = { level: "major", label: "Major Compromise",
 *       remaining: 1, starting: 8, percent: Math.round(0.125 * 100) = 13 }`
 *      (conflict-panel.mjs L1357-1364).
 *    - `context.noCompromise = comp.remaining === comp.starting` (L1365).
 *      For this spec: 1 !== 8 → `noCompromise === false`, so
 *      panel-resolution.hbs L18 `{{#if noCompromise}}` gate fails and the
 *      L20-23 else branch fires, emitting "Major Compromise" + "1/8 (13%)".
 *
 * 3. `calculateCompromise` (combat.mjs L885-904):
 *    - Iterates the winner group's combatants, sums
 *      `actor.system.conflict.hp.{value,max}` via `c.actor`. For linked
 *      character actors, `c.actor` IS the world actor (CLAUDE.md §Unlinked
 *      Actors); direct `actor.update(...)` writes land on the same doc.
 *    - remaining = captain(1) + alt(0) = 1
 *    - starting  = captain(4) + alt(4) = 8
 *    - percent   = 0.125 → level "major"
 *
 * ---------------------------------------------------------------------------
 * Staging — mirrors L539 exactly, differing only in the HP seed values
 * ---------------------------------------------------------------------------
 * Kill conflict — same skeleton as mos-*.spec.mjs (L480-L484),
 * hp-ko-swap-mid-volley.spec.mjs (L503), team-synergy.spec.mjs (L520),
 * resolution-victory.spec.mjs (L538), and resolution-minor-compromise.spec.mjs
 * (L539). Drive the full panel wizard: setup → disposition → weapons →
 * scripting → lock → beginResolve. Stop BEFORE any rolls — this spec's scope
 * is the end-of-conflict resolution transition, not per-volley damage
 * application.
 *
 *   - Party (winner, major-compromise HP):
 *       - captain character (HP 1/4)  ← shave to "just a few points"
 *       - alt character    (HP 0/4)  ← shaved all the way, but group total>0
 *     - group total: remaining=1, starting=8 → percent=0.125 → level
 *       "major" (combat.mjs L901 else branch, 0.125 ≤ 0.25).
 *     - group total > 0, so party is NOT in `atZero` (combat.mjs L922) —
 *       party wins; gm (total 0) is the sole `atZero` entry → loser.
 *   - GM (loser, 0 HP):
 *       - Bugbear boss (HP 0/3) — captain of the GM team
 *       - Goblin mook  (HP 0/3)
 *     - group total: remaining=0 → loserGroupId matches GM group.
 *
 * HP seeding path (same as L539):
 *   - Both sides go through `distributeDisposition` (combat.mjs L219-242)
 *     at full value — party 4/4 each, monsters 3/3 each. That seeds
 *     `hp.max` (the immutable ceiling) AND the initial `hp.value` for
 *     panel-gating predicates (`canBeginScripting` requires hp.value > 0
 *     per conflict-panel.mjs L978-979).
 *   - Then we drive HP to the target seed values via direct
 *     `actor.update({"system.conflict.hp.value": N})` on the world actors
 *     — the `script-independent-ko-sub.spec.mjs` L395-397 idiom, carried
 *     forward by L538/L539. Four writes: captain → 1, alt → 0,
 *     monA → 0, monB → 0. Crucially we drop to 0 AFTER the wizard gates
 *     (canBeginScripting only reads hp.value at transition time, not
 *     reactively).
 *   - For non-tokenised combatants `combatant.actor` IS the world actor
 *     (CLAUDE.md §Unlinked Actors); the direct writes land on the same
 *     document the panel reads at `c.actor.system.conflict.hp.{value,max}`
 *     inside `checkConflictEnd` / `calculateCompromise` (combat.mjs
 *     L890-893, L916-917).
 *
 * Why direct `actor.update` (not the `pendingConflictHP` mailbox):
 *   - The mailbox is the PLAYER-side path (CLAUDE.md §Mailbox Pattern),
 *     covered by TEST_PLAN L501 / L503 / L504 / L505. This spec's scope is
 *     the end-of-conflict RESOLUTION transition, not the HP-write
 *     mechanism. Direct writes keep arrange minimal and match L538/L539.
 *
 * ---------------------------------------------------------------------------
 * Green vs fixme
 * ---------------------------------------------------------------------------
 *
 * This spec goes GREEN. The production gap documented at L538
 * (chat-card `conflict-compromise.hbs` missing a `{{#if noCompromise}}`
 * branch) only manifests for the zero-damage "no compromise" case — for a
 * real major compromise (winner took heavy damage, remaining=1 !== starting
 * =8), the chat-card payload `compromise = { level: "major", label:
 * "Major Compromise" }` is correct RAW per SG p.76, and
 * `conflict-compromise.hbs` L11-15 renders `<div class="card-compromise
 * compromise-major">Major Compromise</div>` as expected (the template's
 * generic `compromise-{{compromise.level}}` class handles all three
 * damage brackets uniformly).
 *
 * The resolution tab path is likewise correct: `noCompromise` false →
 * panel-resolution.hbs L20-23 else branch emits "Major Compromise" + "1/8
 * (13%)". Localization key `TB2E.Conflict.Compromise.Major` exists at
 * lang/en.json L558 → "Major Compromise".
 *
 * ---------------------------------------------------------------------------
 * Explicit non-scope
 * ---------------------------------------------------------------------------
 *   - Zero-damage "no compromise" edge — TEST_PLAN L538 (fixmed, chat-card
 *     gap).
 *   - Minor compromise (winner > 50% HP) — TEST_PLAN L539.
 *   - Half compromise (winner 25%-50% HP) — no dedicated slot; the
 *     classifier branch is exercised only if a future test lands there.
 *   - End conflict cleanup / tracker teardown — TEST_PLAN L541.
 *   - End-of-round summary card — TEST_PLAN L542.
 *   - Killing Is My Business compromise escalation (SG pp.77-78) — the
 *     panel renders an extra `killCompromisePageRef` when
 *     `conflictType === "kill"` (conflict-panel.mjs L1398-1400), but the
 *     compromise LEVEL logic is unaffected; not under test here.
 *
 * All Playwright sessions authenticate as GM (tests/e2e/auth.setup.mjs
 * L14-35). The resolve-conflict button + chat post are GM-gated
 * (panel-resolve.hbs L160 `{{#if isGM}}`).
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

test.describe('§20 Conflict: Resolution — major compromise (winner at 1/8 HP, loser at 0) outcome and chat card (SG p.76, TEST_PLAN L540)', () => {
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

  test('winner at 12.5% HP, loser at 0 HP → resolution tab "Major Compromise" + chat card compromise-major class and label', async ({ page }, testInfo) => {
    const tag = `e2e-resolution-major-${testInfo.parallelIndex}-${Date.now()}`;
    const stamp = Date.now();
    const captainName = `E2E Maj Captain ${stamp}`;
    const altName = `E2E Maj Alt ${stamp}`;
    const monAName = `E2E Maj Bugbear ${stamp}`;
    const monBName = `E2E Maj Goblin ${stamp}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Resolve-conflict button + chat post are both GM-gated (panel-
    // resolve.hbs L160 `{{#if isGM}}`; ChatMessage.create posts from the
    // acting user). Our harness is GM (tests/e2e/auth.setup.mjs L14-35).
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

      // Party disposition 8, distributed flat as 4/4 → each character gets
      // hp.max = 4, hp.value = 4 via combat.distributeDisposition
      // (combat.mjs L219-242). We then shave captain to 1 and alt to 0
      // below, landing the party at remaining=1, starting=8 (the "major
      // compromise" bracket per SG p.76 — "just a few points").
      //
      // Monster disposition 6, distributed flat as 3/3. We drive each to 0
      // below to trigger `checkConflictEnd` → returns gm as loser.
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

      // Sanity: all combatants at full HP before HP shaves. We'll drop HP
      // AFTER the wizard gates; for now every combatant must have
      // hp.value > 0 so `canBeginScripting` (conflict-panel.mjs L978-979,
      // needs a weapon per non-KO combatant) doesn't short-circuit.
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
      // keys purely off `checkConflictEnd().ended` which sums HP. We still
      // lock both sides so the panel progresses to the resolve phase
      // (combat.beginResolve at combat.mjs L357-371 gates on both sides
      // being locked).
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

      /* ---------- Act: seed major-compromise HP values ---------- */

      // Direct writes on the world actors — L538/L539 idiom (and
      // script-independent-ko-sub.spec.mjs L395-397). For non-tokenised
      // combatants `combatant.actor` resolves to the world actor (CLAUDE.md
      // §Unlinked Actors), so a direct write lands on the same document
      // the panel reads.
      //
      // Target seeds:
      //   - captain → 1 (party captain at "just a few points" per SG p.76)
      //   - alt     → 0 (party alt KO; group total remains 1, so party is
      //                  NOT atZero per combat.mjs L922 and still wins)
      //   - monA    → 0
      //   - monB    → 0 (gm total 0/6 → loser)
      // Party total remaining/starting = 1/8 → percent 0.125 → level
      // "major" (combat.mjs L901 else branch, 0.125 ≤ 0.25).
      await page.evaluate(async ({ capId, aId, mAId, mBId }) => {
        await game.actors.get(capId).update({ 'system.conflict.hp.value': 1 });
        await game.actors.get(aId).update({ 'system.conflict.hp.value': 0 });
        await game.actors.get(mAId).update({ 'system.conflict.hp.value': 0 });
        await game.actors.get(mBId).update({ 'system.conflict.hp.value': 0 });
      }, { capId: captainId, aId: altId, mAId: monAId, mBId: monBId });

      // Verify `checkConflictEnd` now returns the expected winner/loser.
      // Party total = 1 (NOT atZero), gm total = 0 (atZero) — per combat.mjs
      // L922-928, gm is the sole `atZero` entry so party wins.
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

      // And `calculateCompromise` for the winner returns percent = 0.125
      // → level "major" (combat.mjs L901, else branch of the
      // `>0.5` / `>0.25` ladder). With remaining=1 !== starting=8, the
      // resolution tab's `noCompromise` predicate (conflict-panel.mjs L1365)
      // is FALSE — so the compromise label/detail render (panel-resolution
      // .hbs L20-23 else branch) rather than the "No Compromise" L19 branch.
      const comp = await page.evaluate(({ cId, pId }) => {
        const c = game.combats.get(cId);
        return c.calculateCompromise(pId);
      }, { cId: combatId, pId: partyGroupId });
      expect(comp).toEqual({
        level: 'major',
        remaining: 1,
        starting: 8,
        percent: 1 / 8
      });

      /* ---------- Act: click "Resolve Conflict" ---------- */

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

      /* ---------- Assert: resolution tab renders major compromise ---------- */

      // Winner banner: partyGroup name + winner styling
      // (panel-resolution.hbs L5-13). The `.winner` modifier applies when
      // `!isTie`.
      await expect(panel.resolutionBanner).toBeVisible();
      await expect(panel.resolutionBanner).toHaveClass(/\bwinner\b/);
      await expect(panel.resolutionBanner).not.toHaveClass(/\btie\b/);

      // Compromise block present with `level-major` modifier — the
      // `{{#if compromise}}` gate at panel-resolution.hbs L16 passes
      // because conflict-panel.mjs L1358-1364 populates `context.
      // compromise` for the winning side. `calculateCompromise` returned
      // `level: "major"` at percent 0.125.
      await expect(panel.resolutionCompromise).toBeVisible();
      await expect(panel.resolutionCompromise).toHaveClass(/\blevel-major\b/);
      await expect(panel.resolutionCompromise).not.toHaveClass(/\blevel-minor\b/);
      await expect(panel.resolutionCompromise).not.toHaveClass(/\blevel-half\b/);

      // Label: the `{{#if noCompromise}}` branch at panel-resolution.hbs
      // L18 does NOT fire because `context.noCompromise === false`
      // (L1365 ← `comp.remaining (1) === comp.starting (8)` is false). So
      // the L20-23 else branch renders the localized `compromise.label`
      // (TB2E.Conflict.Compromise.Major → "Major Compromise", lang/en.json
      // L558).
      await expect(panel.resolutionCompromiseLabel).toHaveText('Major Compromise');

      // The `.resolution-compromise-detail` span (panel-resolution.hbs
      // L22) renders "remaining/starting (percent%)" with `percent`
      // already rounded to an integer (conflict-panel.mjs L1363
      // `Math.round(comp.percent * 100)`). For 1/8 → 12.5 → rounds to 13.
      await expect(
        panel.resolutionCompromise.locator('.resolution-compromise-detail')
      ).toHaveText('1/8 (13%)');

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

      // Scope locators to the specific message li to avoid
      // cross-contamination with prior-run cards. `.first()` narrows if
      // the chat log ever doubles (L538's chat double-render guard).
      const cardRoot = page
        .locator(`li.chat-message[data-message-id="${cardMessageId}"] .conflict-compromise-card`)
        .first();
      await expect(cardRoot).toBeVisible();

      // Winner name rendered in the card header (conflict-compromise.hbs
      // L8-10). Group names default to "Party"/"NPCs"; the stable
      // assertion is that SOMETHING was put in the winner slot.
      const cardWinnerText = await cardRoot
        .locator('.card-winner strong')
        .innerText();
      expect(cardWinnerText.trim()).not.toBe('');
      expect(cardWinnerText.trim()).not.toBe('???');

      // Per-team HP readouts (conflict-compromise.hbs L18-23). Two
      // entries: party 1/8 (winner) and GM 0/6 (loser). Template renders
      // `{{this.remaining}}/{{this.starting}}` (L21).
      const teamRows = cardRoot.locator('.card-final-team');
      await expect(teamRows).toHaveCount(2);
      const teamTexts = await teamRows
        .locator('.card-final-team-hp')
        .allInnerTexts();
      expect(teamTexts.sort()).toEqual(['0/6', '1/8']);

      // Compromise block on the card (conflict-compromise.hbs L11-15).
      // For the major-compromise case, `#onResolveConflict` at conflict-
      // panel.mjs L2272-2275 passes `compromise = { level: "major", label:
      // "Major Compromise" }` — the template's generic `compromise-
      // {{compromise.level}}` class renders `<div class="card-compromise
      // compromise-major">Major Compromise</div>`.
      //
      // Unlike the L538 "no compromise" case (where the card template
      // lacks a `{{#if noCompromise}}` branch and so misrenders), this
      // path is the CORRECT RAW behavior per SG p.76 L519: "If the
      // winner's disposition is reduced to just a few points at the end
      // of the conflict, they owe the loser a major compromise." No fixme
      // needed.
      const cardCompromise = cardRoot.locator('.card-compromise');
      await expect(cardCompromise).toBeVisible();
      await expect(cardCompromise).toHaveClass(/\bcompromise-major\b/);
      await expect(cardCompromise).not.toHaveClass(/\bcompromise-minor\b/);
      await expect(cardCompromise).not.toHaveClass(/\bcompromise-half\b/);
      await expect(cardCompromise).toHaveText('Major Compromise');
    } finally {
      await cleanupTaggedActors(page, tag);
    }
  });
});
