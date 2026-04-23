import { test, expect } from '../test.mjs';
import { scriptAndLockActions } from '../helpers/conflict-scripting.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §20 Conflict: Resolution & Compromise — end-conflict state teardown
 * (TEST_PLAN L541).
 *
 * ---------------------------------------------------------------------------
 * Scope
 * ---------------------------------------------------------------------------
 * Covers the "End Conflict" button on the resolution tab — the finalize /
 * wipe-state step that closes the panel, deletes the Combat document, and
 * clears `system.conflict.hp` on every participating actor. This is the step
 * AFTER the L538/L539/L540 resolve-conflict transition.
 *
 * Staging clones L540 exactly: a Kill conflict with party captain+alt as
 * winner at HP 1/8 (major-compromise bracket) vs Bugbear+Goblin loser at HP
 * 0/6. Drive the full wizard (setup → disposition → weapons → scripting →
 * lock → beginResolve), then `clickResolveConflict` to flip the phase to
 * "resolution" and land on the resolution tab. THEN — this spec's new
 * surface — click the "End Conflict" button, accept the confirm dialog, and
 * assert the full state teardown.
 *
 * ---------------------------------------------------------------------------
 * Rules as written — DH pp.125-127, SG pp.74-76
 * ---------------------------------------------------------------------------
 * The end-of-conflict teardown is implementation-adjacent rather than
 * rules-adjacent: DH / SG describe the compromise grading (L538-L540's scope)
 * but do not prescribe document lifecycle. The primary RAW concern here is
 * that conflict HP is a per-conflict disposition pool (SG pp.68-69: "Each
 * side rolls its disposition at the start of the conflict") and MUST NOT
 * persist back into the adventure phase — hence the wipe. A surviving
 * stale `system.conflict.hp` after the conflict ends would corrupt the next
 * conflict's starting disposition ceiling (combat.mjs L219-242
 * `distributeDisposition` writes both `value` AND `max`, but a leaked
 * `hp.value > 0` between conflicts could influence `checkConflictEnd` on a
 * freshly-created combat before distribution lands).
 *
 * ---------------------------------------------------------------------------
 * Production path — `ConflictPanel.#onEndConflict` (conflict-panel.mjs L2328-2386)
 * ---------------------------------------------------------------------------
 *
 *   1. Template: panel-resolution.hbs L69-77 emits the button only when
 *      `isGM` — our harness is GM (tests/e2e/auth.setup.mjs L14-35).
 *
 *   2. `#onEndConflict`:
 *        a. Opens `foundry.applications.api.DialogV2.confirm` (L2332-2336)
 *           with the "End Conflict" title + localized confirm message.
 *        b. On cancel → returns without mutating state.
 *        c. On confirm, branches on `combat.system.phase` (L2340):
 *           - `!== "resolution"`  → renders + posts
 *             `templates/chat/conflict-compromise.hbs` as a chat card
 *             (L2341-2382). This is the "end conflict from tracker / outside
 *             the resolution tab" path.
 *           - `=== "resolution"`  → **skips** the chat card (compromise card
 *             already posted on resolution ENTRY via `#onResolveConflict`,
 *             conflict-panel.mjs L2296-2299). This spec's path.
 *        d. Calls `this.close()` (L2384) — the panel's ApplicationV2
 *           close pipeline. `DEFAULT_OPTIONS.id = "conflict-panel"` at
 *           conflict-panel.mjs L41, so the outer `<div id="conflict-panel">`
 *           is removed from the DOM.
 *        e. Calls `combat.endConflict()` (L2385 → combat.mjs L967-969),
 *           which is simply `return this.delete()`.
 *
 *   3. `combat.delete()` fires `_preDelete` (combat.mjs L941-961):
 *        - Guards on `isConflict && game.user.isGM`.
 *        - Iterates `this.combatants`, resolving each to `combatant.actor`
 *          (CLAUDE.md §Unlinked Actors — for non-tokenised combatants this is
 *          the world actor; for tokenised it's the token's synthetic actor).
 *        - Deduplicates via a `Set` so multi-combatant-per-actor is fine.
 *        - Writes `system.conflict.hp.{value,max}` = 0 on each actor.
 *        - Additionally clears `system.conflict.weapon`/`weaponId` IFF those
 *          fields exist on the schema (character.mjs L167-168 — yes;
 *          monster.mjs L46-52 — no; the conditional avoids schema-invalid
 *          writes for monster actors).
 *
 *   4. After `Combat.delete` resolves:
 *        - `game.combats.get(combatId)` returns null/undefined.
 *        - The conflict tracker re-renders (conflict-tracker.mjs hooks
 *          `deleteCombat`). `hasCombat = false` (conflict-tracker.mjs L85)
 *          so tracker-footer.hbs L15 falls through to L4 — the "End
 *          Conflict" button is replaced by the "Create Conflict" button.
 *        - The panel singleton has already closed via `this.close()`, so
 *          `game.tb2e.conflictPanel.rendered === false` and no
 *          `#conflict-panel` element exists in the DOM.
 *
 * ---------------------------------------------------------------------------
 * Staging — cloned from L540 (resolution-major-compromise.spec.mjs)
 * ---------------------------------------------------------------------------
 * Identical arrange step: full wizard → flat disposition 8/6 →
 * `distributeDisposition` (4/4, 3/3) → `__unarmed__` weapons → lock →
 * `beginResolve`. Then drop captain HP to 1, alt/monA/monB to 0 via direct
 * `actor.update({"system.conflict.hp.value": N})` on the world actor
 * documents (the `script-independent-ko-sub.spec.mjs` L395-397 idiom,
 * carried forward by L538/L539/L540). Click L538-landed
 * `resolveConflictButton` POM helper → resolution tab rendered. Only THEN
 * does the spec diverge: click the new `endConflictButton`, accept the
 * confirm dialog, and assert state teardown.
 *
 * ---------------------------------------------------------------------------
 * Assertions (all green per #onEndConflict investigation)
 * ---------------------------------------------------------------------------
 *   1. Combat document deleted — `game.combats.get(combatId)` is null.
 *   2. All four actors have `system.conflict.hp = { value: 0, max: 0 }` —
 *      the schema default (character.mjs L162-165, monster.mjs L47-50).
 *      Character actors additionally have `system.conflict.weapon` and
 *      `system.conflict.weaponId` cleared to "" (empty string, the schema
 *      default for `StringField({ blank: true })`). Monster actors' schemas
 *      lack those fields entirely, so _preDelete skips them (combat.mjs
 *      L955-958) — we don't assert them on monsters.
 *   3. ConflictPanel is closed — no `ConflictPanel` instance remains in
 *      `foundry.applications.instances` (the Map-or-object fallback pattern
 *      used in tests/e2e/pages/ManeuverSpendDialog.mjs L102-116), and the
 *      `#conflict-panel` DOM element is gone.
 *   4. Tracker footer shows the "Create Conflict" button (not
 *      "End Conflict" / "Open Playbook") — the `hasCombat` flip at
 *      conflict-tracker.mjs L85 drives the re-render through
 *      tracker-footer.hbs L4/L15.
 *
 * Also asserts (pre-teardown) that all four actors had HP > 0 or hp.max > 0
 * at the resolution entry — so the post-teardown "= 0" assertion is not
 * vacuously true.
 *
 * ---------------------------------------------------------------------------
 * Why NOT the tracker's "End Conflict" button
 * ---------------------------------------------------------------------------
 * The tracker has its own `#onEndConflict` (conflict-tracker.mjs L303-314)
 * that uses the same confirm + `combat.endConflict()` path — but does NOT
 * call `panel.close()`. TEST_PLAN L541's checkbox specifically reads
 * "panel closed", which is only the panel path's guarantee. A tracker-side
 * "End Conflict" spec is conceivable but isn't the L541 slot.
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

test.describe('§20 Conflict: Resolution — end-conflict state teardown (panel closed, tracker cleared, actor HP reset) (DH pp.125-127, TEST_PLAN L541)', () => {
  test.afterEach(async ({ page }) => {
    // Best-effort teardown — the happy-path test already closes the panel
    // + deletes the Combat, but cleanup still needs to work if an assertion
    // failed mid-flight.
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

  test('clicking "End Conflict" on resolution tab → Combat deleted, all actor conflict.hp cleared, panel closed, tracker reverts to "Create Conflict"', async ({ page }, testInfo) => {
    const tag = `e2e-end-conflict-${testInfo.parallelIndex}-${Date.now()}`;
    const stamp = Date.now();
    const captainName = `E2E EndC Captain ${stamp}`;
    const altName = `E2E EndC Alt ${stamp}`;
    const monAName = `E2E EndC Bugbear ${stamp}`;
    const monBName = `E2E EndC Goblin ${stamp}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // End-conflict button + _preDelete HP reset are both GM-gated
    // (panel-resolution.hbs L70 `{{#if isGM}}`, combat.mjs L943
    // `!game.user.isGM` early-return). Our harness is GM
    // (tests/e2e/auth.setup.mjs L14-35).
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

      /* ---------- Weapons: stamp __unarmed__ ---------- */

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
      /* ---------- Script + lock + resolve ---------- */

      await scriptAndLockActions(page, {
        combatId, partyGroupId, gmGroupId, partyActions, gmActions
      });

      await expect.poll(() => panel.activeTabId()).toBe('resolve');

      /* ---------- Seed major-compromise HP values ---------- */

      // Direct writes (L538-L540 idiom). Target seeds: captain=1, alt=0,
      // monA=0, monB=0. Party total 1 (NOT atZero, winner) vs GM total 0
      // (atZero, loser) per combat.mjs L922-928.
      await page.evaluate(async ({ capId, aId, mAId, mBId }) => {
        await game.actors.get(capId).update({ 'system.conflict.hp.value': 1 });
        await game.actors.get(aId).update({ 'system.conflict.hp.value': 0 });
        await game.actors.get(mAId).update({ 'system.conflict.hp.value': 0 });
        await game.actors.get(mBId).update({ 'system.conflict.hp.value': 0 });
      }, { capId: captainId, aId: altId, mAId: monAId, mBId: monBId });

      /* ---------- Resolve → resolution tab ---------- */

      await expect(panel.resolveConflictButton).toBeVisible();
      await panel.clickResolveConflict();
      expect(await page.evaluate(({ cId }) => {
        const c = game.combats.get(cId);
        return c.system.phase;
      }, { cId: combatId })).toBe('resolution');

      /* ---------- Precondition: HP state is non-default BEFORE end ---------- */

      // The post-teardown "= 0" assertion would be vacuously true if the
      // actors were already at the schema default. After `distributeDisposition`
      // + the HP shaves: captain hp.max=4 (non-default), alt hp.max=4,
      // monA hp.max=3, monB hp.max=3 — and captain hp.value=1 (non-default).
      // Characters also have weapon=__unarmed__ stamped via combat.setWeapon
      // (combat.mjs L272-274), which mirrors to `system.conflict.weaponId`
      // on character actors.
      const preEndHp = await page.evaluate(({ capId, aId, mAId, mBId }) => ({
        cap: game.actors.get(capId)?.system.conflict?.hp,
        alt: game.actors.get(aId)?.system.conflict?.hp,
        monA: game.actors.get(mAId)?.system.conflict?.hp,
        monB: game.actors.get(mBId)?.system.conflict?.hp
      }), { capId: captainId, aId: altId, mAId: monAId, mBId: monBId });
      expect(preEndHp).toEqual({
        cap:  { value: 1, max: 4 },
        alt:  { value: 0, max: 4 },
        monA: { value: 0, max: 3 },
        monB: { value: 0, max: 3 }
      });

      /* ---------- Precondition: resolution tab shows End Conflict button ---------- */

      // End Conflict button on panel-resolution.hbs L72 — GM-only (L70).
      await expect(panel.resolutionContent).toBeVisible();
      await expect(panel.endConflictButton).toBeVisible();

      // Panel singleton is currently rendered with its public id
      // (conflict-panel.mjs L41 `DEFAULT_OPTIONS.id = "conflict-panel"`).
      expect(await page.evaluate(() => {
        const fa = foundry.applications.instances;
        const all = fa?.values ? Array.from(fa.values()) : Object.values(fa ?? {});
        return all.some(
          (app) => app?.id === 'conflict-panel' && app?.rendered === true
        );
      })).toBe(true);

      /* ---------- Act: click End Conflict + confirm ---------- */

      await panel.clickEndConflictAndConfirm();

      /* ---------- Assert: Combat document deleted ---------- */

      // combat.endConflict (combat.mjs L967-969) is just `this.delete()`.
      // After the delete resolves, `game.combats.get(combatId)` is nullish.
      await expect
        .poll(
          () => page.evaluate(
            (cId) => game.combats.get(cId) ?? null,
            combatId
          ),
          { timeout: 10_000 }
        )
        .toBeNull();

      // `game.combat` (the active combat) is also null/undefined when no
      // combat is active. For the sidebar tracker's "no-combat" footer branch
      // (tracker-footer.hbs L4) to render, `hasCombat === false` at
      // conflict-tracker.mjs L85 (`combat !== null` → false).
      expect(await page.evaluate(() => game.combat ?? null)).toBeNull();

      /* ---------- Assert: all actors' system.conflict.hp reset to 0/0 ---------- */

      // combat._preDelete (combat.mjs L941-961) iterates `this.combatants`,
      // resolves `combatant.actor`, and writes hp.{value,max}=0. For our
      // non-tokenised combatants, `combatant.actor` IS the world actor
      // (CLAUDE.md §Unlinked Actors), so the reset lands on the same
      // document we read via `game.actors.get(id)` here.
      //
      // The reset target is the schema default (character.mjs L162-165,
      // monster.mjs L47-50): `{ value: 0, max: 0 }`. Use expect.poll because
      // _preDelete's per-actor updates are async and the ordering relative
      // to the Combat.delete resolution isn't strictly serialized in the
      // caller's await.
      await expect
        .poll(() => page.evaluate(({ capId, aId, mAId, mBId }) => ({
          cap:  game.actors.get(capId)?.system.conflict?.hp,
          alt:  game.actors.get(aId)?.system.conflict?.hp,
          monA: game.actors.get(mAId)?.system.conflict?.hp,
          monB: game.actors.get(mBId)?.system.conflict?.hp
        }), { capId: captainId, aId: altId, mAId: monAId, mBId: monBId }))
        .toEqual({
          cap:  { value: 0, max: 0 },
          alt:  { value: 0, max: 0 },
          monA: { value: 0, max: 0 },
          monB: { value: 0, max: 0 }
        });

      // Characters also have their `system.conflict.weapon`/`weaponId` fields
      // cleared (combat.mjs L955-958: the schema check finds `weapon` on
      // character.mjs L167 and stamps "" — `StringField({ blank: true })`
      // default). Monsters' schemas (monster.mjs L46-52) lack those fields,
      // so _preDelete skips them — no assertion against monster weapon.
      const charactersWeaponState = await page.evaluate(({ capId, aId }) => ({
        cap: {
          weapon: game.actors.get(capId)?.system.conflict?.weapon ?? null,
          weaponId: game.actors.get(capId)?.system.conflict?.weaponId ?? null
        },
        alt: {
          weapon: game.actors.get(aId)?.system.conflict?.weapon ?? null,
          weaponId: game.actors.get(aId)?.system.conflict?.weaponId ?? null
        }
      }), { capId: captainId, aId: altId });
      expect(charactersWeaponState).toEqual({
        cap: { weapon: '', weaponId: '' },
        alt: { weapon: '', weaponId: '' }
      });

      /* ---------- Assert: ConflictPanel closed ---------- */

      // `ConflictPanel.#onEndConflict` L2384 calls `this.close()` BEFORE
      // the combat.delete. Use expect.poll because the close pipeline is
      // async (ApplicationV2's _onClose runs through the render queue).
      await expect
        .poll(() => page.evaluate(() => {
          const fa = foundry.applications.instances;
          const all = fa?.values ? Array.from(fa.values()) : Object.values(fa ?? {});
          return all.some(
            (app) =>
              (app?.id === 'conflict-panel' || app?.constructor?.name === 'ConflictPanel')
              && app?.rendered === true
          );
        }))
        .toBe(false);

      // DOM-level mirror: the panel's outer element is gone.
      await expect(panel.root).toHaveCount(0);

      /* ---------- Assert: tracker footer reverts to "Create Conflict" ---------- */

      // tracker-footer.hbs L4 `{{#unless hasCombat}}` branch renders the
      // `button[data-action="createConflict"]`, while the L15 `{{#if
      // hasCombat}}` branch (End Conflict button + Open Playbook) collapses.
      // The tracker re-renders on `deleteCombat` hooks.
      await expect(tracker.endConflictButton).toHaveCount(0);
      await expect(tracker.openPanelButton).toHaveCount(0);
      await expect(tracker.createConflictButton).toBeVisible();
    } finally {
      await cleanupTaggedActors(page, tag);
    }
  });
});
