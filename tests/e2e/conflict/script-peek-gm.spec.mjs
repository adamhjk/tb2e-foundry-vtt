import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ConflictTracker } from '../pages/ConflictTracker.mjs';
import { ConflictPanel } from '../pages/ConflictPanel.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §15 Conflict: Scripting — GM Peek (TEST_PLAN L429).
 *
 * Scripting is secret: both teams lock in their three volleys before
 * the reveal (DH pp.124-126). The GM panel surfaces a "Peek at Actions"
 * toggle on the party group so the GM can confirm (per
 * `conflict-panel.mjs` L2308 docstring "Toggle GM peek for a group's
 * locked actions") that they're seeing the party's locked script.
 *
 * Rules under test:
 *   - Peek state lives in `ConflictPanel` as a private `Set<string>`
 *     instance property `#gmPeekGroups` (conflict-panel.mjs L31-32).
 *     **No combat/combatant/actor document is mutated** — peek is a
 *     per-GM local UI toggle. Player clients are therefore entirely
 *     unaffected: nothing about the combat / combatant / actor source
 *     data changes, so a player's DOM (which reads the same documents
 *     and does NOT share `#gmPeekGroups`) is identical before and
 *     after the GM's click.
 *   - The peek button is only rendered on the party group
 *     (`gmCanPeek = game.user.isGM && isPartyGroup`,
 *     conflict-panel.mjs L1164 → panel-script.hbs L100-105 / L132-137).
 *     `isPartyGroup` is derived at L1124-1127 from
 *     `actor?.hasPlayerOwner` on any member — so this test spins up a
 *     throwaway Player-role user and grants them OWNER rights on the
 *     party actors, since the seed world has no non-GM users.
 *   - `#onPeekActions` (conflict-panel.mjs L2311-2320) toggles
 *     membership in `#gmPeekGroups` and calls `this.render()`. The
 *     panel context exposes that toggle as `gmIsPeeking` (L1165),
 *     which the template uses to add/remove the `.active` class on
 *     the peek button (panel-script.hbs L101 / L133).
 *
 * Implementation note — why we do NOT assert the reveal DOM:
 *   Foundry's `Document#testUserPermission` (common/abstract/
 *   document.mjs L404-412) gives GMs `OWNER` level over every
 *   document unconditionally, so `actor.isOwner` is always `true`
 *   for the GM. That means `isMember` (conflict-panel.mjs L1118-1121,
 *   `allMembers.some(c => game.actors.get(c.actorId)?.isOwner)`) is
 *   ALSO always `true` for the GM — which collapses `canViewActions`
 *   (L1136-1137, `isMember || (isGM && peekSet.has(group.id))`) to
 *   `true` regardless of the peek set. In other words, the
 *   card-front reveal faces (panel-script.hbs L115-121) are ALWAYS
 *   visible to a GM, whether or not they've toggled peek.
 *
 *   So the peek button's DOM-visible effect on a GM session is
 *   ONLY the `.active` class on the button itself (L101 / L133) —
 *   the reveal content was never hidden in the first place. This
 *   is the behavioural surface this spec asserts; the "hide the
 *   cards by default, reveal on peek" outcome is only observable
 *   from a non-GM client, which this harness cannot drive (all
 *   Playwright sessions authenticate as the Gamemaster — see
 *   `auth.setup.mjs` L23).
 *
 * Scope (TEST_PLAN L429):
 *   - Assert the peek button is rendered on the party group and NOT
 *     on the GM group (rendering-gate contract at L1164 — the GM
 *     group has no player-owner so `isPartyGroup` is false there).
 *   - Assert click-to-peek adds `.active` class to the button
 *     (reflecting `gmIsPeeking` via L1165 → L101/L133).
 *   - Assert click-to-hide is reversible — `.active` class removed.
 *   - Assert NO world state mutated: `combat.system.rounds[n].locked`
 *     unchanged, `_source.system.pendingActions{,Locked}` on both
 *     captains unchanged, and `combat.flags` carries no peek marker.
 *     This is the "player view remains hidden" half of the briefing
 *     operationalised: a player client re-reading the same documents
 *     produces the same DOM before and after.
 *   - DOES NOT cover: change-before-lock (L430), KO substitution
 *     (L431), and cannot cover the non-GM reveal-DOM effect (see
 *     implementation note above — GM always has OWNER, so the
 *     reveal DOM is always emitted).
 *
 * Staging: same pattern as `script-lock.spec.mjs` (L428) — two
 * characters (captain + other) + two monsters (GM captain + mook),
 * flat-set disposition on both sides, weapons stamped directly via
 * `combat.setWeapon`, actions pre-seeded via `combat.setActions`, then
 * both sides locked via `combat.lockActions`. The peek button only
 * renders once the group is locked (L100 / L132 sit inside the
 * `{{#if this.isLocked}}` / `{{else}}` branches of L21).
 *
 * E2E harness constraint: the Playwright session is GM. Peek is a
 * GM-only affordance, so only the GM path exists to exercise.
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

async function createCharacter(page, { name, tag, playerOwnerId = null }) {
  return page.evaluate(
    async ({ n, t, pid }) => {
      const ownership = { default: 0 };
      if ( pid ) ownership[pid] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
      const actor = await Actor.implementation.create({
        name: n,
        type: 'character',
        ownership,
        flags: { tb2e: { e2eTag: t } },
        system: { conditions: { fresh: false } }
      });
      return actor.id;
    },
    { n: name, t: tag, pid: playerOwnerId }
  );
}

/**
 * Create a throwaway Player-role user so that the party actors can be
 * assigned ownership to a non-GM. `hasPlayerOwner` (used at
 * `conflict-panel.mjs` L1124-1127 to derive `isPartyGroup`, which in turn
 * gates `gmCanPeek` at L1164) iterates non-GM users and returns true iff
 * any has ownership level >= OWNER. The default seed world only has a
 * Gamemaster user, so without this scaffold `isPartyGroup` is always
 * `false` and the peek button is never rendered.
 */
async function createPlayerUser(page, { name, tag }) {
  return page.evaluate(
    async ({ n, t }) => {
      const user = await User.implementation.create({
        name: n,
        role: CONST.USER_ROLES.PLAYER,
        flags: { tb2e: { e2eTag: t } }
      });
      return user.id;
    },
    { n: name, t: tag }
  );
}

async function cleanupTaggedUsers(page, tag) {
  await page.evaluate(async (t) => {
    const ids = game.users
      .filter((u) => u.getFlag?.('tb2e', 'e2eTag') === t)
      .map((u) => u.id);
    if ( ids.length ) await User.implementation.deleteDocuments(ids);
  }, tag);
}

async function cleanupTaggedActors(page, tag) {
  await page.evaluate(async (t) => {
    const ids = game.actors
      .filter((a) => a.getFlag?.('tb2e', 'e2eTag') === t)
      .map((a) => a.id);
    if ( ids.length ) await Actor.implementation.deleteDocuments(ids);
  }, tag);
}

test.describe('§15 Conflict: Scripting — GM peek', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => {
      try { game.tb2e?.conflictPanel?.close(); } catch {}
    });
    await page.evaluate(async () => {
      const ids = Array.from(game.combats ?? []).map((c) => c.id);
      if ( ids.length ) await Combat.deleteDocuments(ids);
    });
  });

  test(
    'GM peek reveals party actions, toggle off rehides, no world state mutates (DH pp.124-126)',
    async ({ page }, testInfo) => {
      const tag = `e2e-script-peek-${testInfo.parallelIndex}-${Date.now()}`;
      const stamp = Date.now();
      const charAName = `E2E Captain ${stamp}`;
      const charBName = `E2E Char B ${stamp}`;
      const monsterAName = `E2E Bugbear ${stamp}`;
      const monsterBName = `E2E Goblin ${stamp}`;

      await page.goto('/game');
      const ui = new GameUI(page);
      await ui.waitForReady();
      await ui.dismissTours();

      // Sanity: peek is GM-only (panel-script.hbs L100/L132 gated on
      // `gmCanPeek` which requires `game.user.isGM` at
      // conflict-panel.mjs L1164).
      expect(await page.evaluate(() => game.user.isGM)).toBe(true);

      try {
        /* ---------- Arrange player user + actors ---------- */

        // The seed world ships with only a Gamemaster user — no players —
        // so `hasPlayerOwner` (conflict-panel.mjs L1126) always returns
        // false without this setup. That collapses `isPartyGroup` to
        // false (L1124-1127), which collapses `gmCanPeek` to false
        // (L1164), which drops the peek button entirely. Create a
        // throwaway Player-role user and grant them ownership of the
        // party actors so the "this is a player team" condition is
        // realistic.
        const playerId = await createPlayerUser(page, {
          name: `E2E Player ${stamp}`, tag
        });

        const captainId = await createCharacter(page, {
          name: charAName, tag, playerOwnerId: playerId
        });
        const charBId = await createCharacter(page, {
          name: charBName, tag, playerOwnerId: playerId
        });
        const monAId = await importMonster(page, {
          sourceName: 'Bugbear', uniqueName: monsterAName, tag
        });
        const monBId = await importMonster(page, {
          sourceName: 'Goblin', uniqueName: monsterBName, tag
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

        /* ---------- Setup tab: populate + captainize + type ---------- */

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

        /* ---------- Weapons: stamp weapons directly ---------- */

        await page.evaluate(async ({ cId, ids }) => {
          const c = game.combats.get(cId);
          for ( const id of ids ) {
            await c.setWeapon(id, 'Fists', '__unarmed__');
          }
        }, { cId: combatId, ids: [cmb.captain, cmb.charB, cmb.monA, cmb.monB] });

        await expect(panel.beginScriptingButton).toBeEnabled();
        await panel.clickBeginScripting();

        /* ---------- Scripting: pre-seed + lock both groups ---------- */

        // Peek only renders when `isLocked` (panel-script.hbs L100 sits
        // inside the `{{else}}` branch of the L21 `{{#unless
        // this.isLocked}}` gate). Both groups need to be locked so we
        // can assert the reveal DOM.
        const partyActions = [
          { action: 'attack',   combatantId: cmb.captain },
          { action: 'defend',   combatantId: cmb.charB },
          { action: 'feint',    combatantId: cmb.captain }
        ];
        const gmActions = [
          { action: 'maneuver', combatantId: cmb.monA },
          { action: 'attack',   combatantId: cmb.monB },
          { action: 'defend',   combatantId: cmb.monA }
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

        // `combat.setActions` is async but its internal `#applyActions`
        // call at combat.mjs L332 is unawaited — we must poll for the
        // `system.rounds[n].actions[groupId]` write to land before
        // firing `lockActions`, or `#applyLockActions`'s all-filled gate
        // (L534) will see stale empty slots and silently no-op.
        await expect
          .poll(() => page.evaluate(({ cId, pId, gId }) => {
            const c = game.combats.get(cId);
            const round = c.system.rounds?.[c.system.currentRound];
            const pa = round?.actions?.[pId] ?? [];
            const ga = round?.actions?.[gId] ?? [];
            return (
              pa.length === 3 && pa.every((e) => e?.action && e?.combatantId) &&
              ga.length === 3 && ga.every((e) => e?.action && e?.combatantId)
            );
          }, { cId: combatId, pId: partyGroupId, gId: gmGroupId }), {
            timeout: 10_000
          })
          .toBe(true);

        await page.evaluate(async ({ cId, pId, gId }) => {
          const c = game.combats.get(cId);
          await c.lockActions(pId);
          await c.lockActions(gId);
        }, { cId: combatId, pId: partyGroupId, gId: gmGroupId });

        // Wait for both sides to surface as locked in the panel.
        await expect(panel.scriptLockedBadge(partyGroupId)).toBeVisible();
        await expect(panel.scriptLockedBadge(gmGroupId)).toBeVisible();

        // The party group's auto-collapse on lock (conflict-panel.mjs
        // L1140-1143) adds a `.collapsed` class on `.script-slots.locked`
        // for the GM once per round. It does NOT remove the faces from
        // the DOM — it just hides them via CSS — so Playwright's
        // element-count locators still resolve.

        /* ---------- Snapshot "before peek" world state ---------- */

        const worldBefore = await page.evaluate(
          ({ cId, capId, monAid, pId, gId }) => {
            const c = game.combats.get(cId);
            const captain = c.combatants.get(capId);
            const mon = c.combatants.get(monAid);
            const round = c.system.rounds?.[c.system.currentRound];
            return {
              partyLocked: round?.locked?.[pId] ?? null,
              gmLocked: round?.locked?.[gId] ?? null,
              partyActions: foundry.utils.deepClone(round?.actions?.[pId] ?? []),
              gmActions: foundry.utils.deepClone(round?.actions?.[gId] ?? []),
              captainPendingActions: foundry.utils.deepClone(
                captain?._source.system?.pendingActions ?? []
              ),
              captainPendingLocked:
                captain?._source.system?.pendingActionsLocked ?? null,
              monPendingActions: foundry.utils.deepClone(
                mon?._source.system?.pendingActions ?? []
              ),
              monPendingLocked:
                mon?._source.system?.pendingActionsLocked ?? null,
              combatFlags: foundry.utils.deepClone(c.flags ?? {})
            };
          },
          {
            cId: combatId,
            capId: cmb.captain,
            monAid: cmb.monA,
            pId: partyGroupId,
            gId: gmGroupId
          }
        );

        /* ---------- Precondition DOM: peek button on party, not GM ---------- */

        // `gmCanPeek` is `game.user.isGM && isPartyGroup`
        // (conflict-panel.mjs L1164). The GM group has `isPartyGroup`
        // false (no `hasPlayerOwner` member on the monster team), so
        // `gmCanPeek` is false and the button is never emitted —
        // panel-script.hbs L100 / L132 are both gated on `gmCanPeek`.
        await expect(panel.peekActionsButton(partyGroupId)).toBeVisible();
        await expect(panel.peekActionsButton(gmGroupId)).toHaveCount(0);

        // Before peek: the button has no `.active` class
        // (panel-script.hbs L101/L133 — `{{#if this.gmIsPeeking}}active{{/if}}`
        // where `gmIsPeeking = this.#gmPeekGroups.has(group.id)`,
        // conflict-panel.mjs L1165).
        await expect(panel.peekActionsButton(partyGroupId)).not.toHaveClass(
          /\bactive\b/
        );

        /* ---------- Act 1: click peek → `.active` class on ---------- */

        await panel.peekActionsButton(partyGroupId).click();

        // Re-render: `#onPeekActions` (conflict-panel.mjs L2311-2320)
        // adds the group to `#gmPeekGroups` and calls `this.render()`.
        // The peek state surfaces on the button as `.active`
        // (panel-script.hbs L101/L133). See the module-level jsdoc for
        // why we don't also assert the card-front count — the GM's
        // implicit `OWNER` permission short-circuits `canViewActions`
        // regardless of peek state, so the card-front faces are
        // always rendered in a GM session.
        await expect(panel.peekActionsButton(partyGroupId)).toHaveClass(
          /\bactive\b/
        );

        // GM group still has no peek button (gmCanPeek is false there —
        // the peek toggle is party-only).
        await expect(panel.peekActionsButton(gmGroupId)).toHaveCount(0);

        /* ---------- Assert: no world state mutated ---------- */

        // Peek is a purely local UI state — `#gmPeekGroups` lives on the
        // panel instance (conflict-panel.mjs L31-32) and is never
        // persisted to a document. A player client reading the same
        // combat sees the identical world state before and after.
        const worldAfterPeek = await page.evaluate(
          ({ cId, capId, monAid, pId, gId }) => {
            const c = game.combats.get(cId);
            const captain = c.combatants.get(capId);
            const mon = c.combatants.get(monAid);
            const round = c.system.rounds?.[c.system.currentRound];
            return {
              partyLocked: round?.locked?.[pId] ?? null,
              gmLocked: round?.locked?.[gId] ?? null,
              partyActions: foundry.utils.deepClone(round?.actions?.[pId] ?? []),
              gmActions: foundry.utils.deepClone(round?.actions?.[gId] ?? []),
              captainPendingActions: foundry.utils.deepClone(
                captain?._source.system?.pendingActions ?? []
              ),
              captainPendingLocked:
                captain?._source.system?.pendingActionsLocked ?? null,
              monPendingActions: foundry.utils.deepClone(
                mon?._source.system?.pendingActions ?? []
              ),
              monPendingLocked:
                mon?._source.system?.pendingActionsLocked ?? null,
              combatFlags: foundry.utils.deepClone(c.flags ?? {})
            };
          },
          {
            cId: combatId,
            capId: cmb.captain,
            monAid: cmb.monA,
            pId: partyGroupId,
            gId: gmGroupId
          }
        );
        expect(worldAfterPeek).toEqual(worldBefore);

        /* ---------- Act 2: click peek again → `.active` class off ---------- */

        await panel.peekActionsButton(partyGroupId).click();

        // Re-render with the group removed from `#gmPeekGroups`:
        // `gmIsPeeking` (conflict-panel.mjs L1165) flips back to false,
        // so L101/L133's `{{#if this.gmIsPeeking}}active{{/if}}` drops
        // the class.
        await expect(panel.peekActionsButton(partyGroupId)).not.toHaveClass(
          /\bactive\b/
        );

        // Final: still no world-state mutation.
        const worldAfterHide = await page.evaluate(
          ({ cId, capId, monAid, pId, gId }) => {
            const c = game.combats.get(cId);
            const captain = c.combatants.get(capId);
            const mon = c.combatants.get(monAid);
            const round = c.system.rounds?.[c.system.currentRound];
            return {
              partyLocked: round?.locked?.[pId] ?? null,
              gmLocked: round?.locked?.[gId] ?? null,
              partyActions: foundry.utils.deepClone(round?.actions?.[pId] ?? []),
              gmActions: foundry.utils.deepClone(round?.actions?.[gId] ?? []),
              captainPendingActions: foundry.utils.deepClone(
                captain?._source.system?.pendingActions ?? []
              ),
              captainPendingLocked:
                captain?._source.system?.pendingActionsLocked ?? null,
              monPendingActions: foundry.utils.deepClone(
                mon?._source.system?.pendingActions ?? []
              ),
              monPendingLocked:
                mon?._source.system?.pendingActionsLocked ?? null,
              combatFlags: foundry.utils.deepClone(c.flags ?? {})
            };
          },
          {
            cId: combatId,
            capId: cmb.captain,
            monAid: cmb.monA,
            pId: partyGroupId,
            gId: gmGroupId
          }
        );
        expect(worldAfterHide).toEqual(worldBefore);
      } finally {
        await cleanupTaggedActors(page, tag);
        await cleanupTaggedUsers(page, tag);
      }
    }
  );
});
