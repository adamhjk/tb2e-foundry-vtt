import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §18 Conflict: HP & KO — synthetic-token parity for the `pendingConflictHP`
 * mailbox (TEST_PLAN L505). Regression test for the CLAUDE.md §Unlinked
 * Actors gotcha:
 *
 *   > For unlinked tokens, updates made via `combatant.actor.update()` only
 *   > affect the synthetic actor. The world actor's data stays at its
 *   > default values. Reading HP from the world actor will always return 0,
 *   > causing false KO detection.
 *
 * Rules under test:
 *   - Monsters ship with `prototypeToken.actorLink: false` (verified against
 *     `packs/_source/monsters/Bugbear_a1b2c3d4e5f60005.yml`), so dropping
 *     one onto a scene materializes a TokenDocument whose embedded actor is
 *     a SYNTHETIC actor (distinct uuid from the world template).
 *   - When a Combatant carries `{ tokenId, sceneId }`, Foundry's
 *     `combatant.actor` getter resolves to `token.actor` — the synthetic,
 *     NOT `game.actors.get(combatant.actorId)` (which returns the world
 *     template). This spec uses `addCombatant({actorId, tokenId, sceneId})`
 *     to mirror the panel's real add path at
 *     conflict-panel.mjs L2148-2156 / L2189-2197.
 *   - The `pendingConflictHP` GM hook (tb2e.mjs L193-204):
 *       targetActor = pendingHP.targetActorId
 *         ? game.actors.get(pendingHP.targetActorId)   // L196 — world actor!
 *         : actor;                                     // the hook arg
 *       targetActor.update({ "system.conflict.hp.value": newVal });
 *       actor.unsetFlag("tb2e", "pendingConflictHP");
 *
 * This spec's job is to pin down the actual routing behavior of both
 * branches when the combatant wraps an unlinked (synthetic) token:
 *
 *   Scenario 1 — synthetic self-write (direct-route): the mailbox is
 *     written ON the synthetic actor itself (`combatant.actor.update(...)`),
 *     so the `actor` arg of the `updateActor` hook at tb2e.mjs L185 IS the
 *     synthetic. With no `targetActorId` set, L196 falls through to
 *     `targetActor = actor` — the synthetic. The resulting
 *     `targetActor.update(...)` writes `system.conflict.hp.value` on the
 *     synthetic alone; the world actor stays at schema default
 *     (`initial: 0` for both value and max, per monster.mjs L48-49).
 *     EXPECTED: green.
 *
 *   Scenario 2 — captain-cross-write via `targetActorId`: a party captain
 *     (linked character) writes on herself with
 *     `{ newValue, targetActorId: monsterWorldId }`. The hook at L196
 *     resolves `game.actors.get(pendingHP.targetActorId)` — this returns
 *     the WORLD actor of the monster, not the synthetic behind the
 *     combatant's token. The HP update lands on the world template;
 *     the combatant's synthetic actor is never touched.
 *     EXPECTED: this IS the documented CLAUDE.md gotcha. The spec asserts
 *     the actual current behavior: world HP changes, synthetic HP does
 *     NOT — and marks the scenario `test.fixme` with a GitHub-issue-style
 *     annotation so a future fix that makes `targetActorId` token-aware
 *     flips the assertion. Fix shape: `targetActor` resolution should walk
 *     the active conflict Combat's combatants to find one whose
 *     `actorId === pendingHP.targetActorId` with a tokenId, and prefer its
 *     `combatant.actor` (the synthetic). If no synthetic match exists,
 *     fall back to the world actor. That would make the cross-write route
 *     work identically for linked characters AND unlinked monsters.
 *
 * Template-identity check (both scenarios): the synthetic and world actor
 * share the same `_id` (monsters.mjs — token's actorId references the
 * world template) but differ in `uuid`. The synthetic's uuid is rooted at
 * `Scene.X.Token.Y.Actor.Z`, while the world actor's uuid is `Actor.Z`.
 * We read both and assert the uuid difference + id equality to concretely
 * document the "same template, different runtime instance" relationship
 * that the CLAUDE.md gotcha hinges on.
 *
 * Harness constraint (shared with hp-player-mailbox.spec.mjs L47-56 and
 * grind/apply-condition-mailbox.spec.mjs): all Playwright sessions
 * authenticate as GM (tests/e2e/test.mjs L14-20). We simulate the player-
 * side write via `actor.update({"flags.tb2e.pendingConflictHP": ...})`;
 * the in-browser GM-side `updateActor` hook fires synchronously on the
 * same client so `expect.poll` observes the effect quickly.
 *
 * Scope:
 *   - Two assertion shapes: synthetic self-write (green) + targetActorId
 *     cross-write (fixme).
 *   - Out of scope: auto-damage from resolve (L500 fixme), KO-at-zero
 *     (L502 fixme), swap (L503), help-blocked (L504). Mailbox self-write
 *     + cross-write on LINKED characters is L501's scope — this spec's
 *     distinct value is exercising the UNLINKED path specifically.
 */

const MONSTER_PACK_ID = 'tb2e.monsters';

/**
 * Import a monster from the `tb2e.monsters` compendium as a world actor and
 * tag it for cleanup. Mirrors the idiom in disposition-flat-monster.spec.mjs
 * L76-95 and setup-add-combatants.spec.mjs L62-80.
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
      return created.id;
    },
    { pId: MONSTER_PACK_ID, src: sourceName, name: uniqueName, t: tag }
  );
}

async function createCharacter(page, { name, tag, maxHP, startHP }) {
  return page.evaluate(
    async ({ n, t, m, s }) => {
      const actor = await Actor.implementation.create({
        name: n,
        type: 'character',
        flags: { tb2e: { e2eTag: t } },
        system: {
          abilities: {
            health: { rating: 3, pass: 0, fail: 0 },
            will:   { rating: 3, pass: 0, fail: 0 },
            nature: { rating: 3, max: 3, pass: 0, fail: 0 }
          },
          conflict: { hp: { value: s, max: m } }
        }
      });
      return actor.id;
    },
    { n: name, t: tag, m: maxHP, s: startHP }
  );
}

/**
 * Create a scene, drop an unlinked token for the given monster world actor,
 * and return `{ sceneId, tokenId }`. Mirrors the drop path in
 * tests/e2e/compendium/drag-monster-to-scene.spec.mjs L89-174 but drops from
 * a world actor (we already imported one) rather than from the compendium.
 *
 * `actorLink: false` is inherited from the monster's prototypeToken (the
 * monster YAML files all set it — verified against Bugbear_a1b2c3d4e5f60005.yml).
 * We pass it explicitly anyway so the spec doesn't silently drift if the
 * pack defaults change.
 */
async function dropUnlinkedToken(page, { actorId, sceneName, tag }) {
  return page.evaluate(
    async ({ aId, sName, t }) => {
      const [scene] = await Scene.implementation.create([{
        name: sName,
        width: 2000,
        height: 2000,
        grid: { type: 1, size: 100 },
        padding: 0,
        flags: { tb2e: { e2eTag: t } }
      }]);
      await scene.activate();
      // Wait for canvas to draw — drop/token-resolution reads canvas.scene.
      if ( !canvas.ready || canvas.scene?.id !== scene.id ) {
        await new Promise((resolve) => Hooks.once('canvasReady', resolve));
      }
      const actor = game.actors.get(aId);
      if ( !actor ) throw new Error(`Actor not found: ${aId}`);
      // Build the prototype token data and create the TokenDocument on the
      // scene. `actorLink: false` means `token.actor` is the synthetic.
      const tokenData = (await actor.getTokenDocument({
        x: 500, y: 500
      })).toObject();
      tokenData.actorLink = false;
      const [token] = await scene.createEmbeddedDocuments('Token', [tokenData]);
      return { sceneId: scene.id, tokenId: token.id };
    },
    { aId: actorId, sName: sceneName, t: tag }
  );
}

/**
 * Create a Combat and add a single Combatant that carries
 * `{ actorId, tokenId, sceneId }` — the shape the panel emits at
 * conflict-panel.mjs L2148-2156 / L2189-2197. The tokenId+sceneId pair is
 * what causes `combatant.actor` to resolve to the SYNTHETIC actor
 * (token.actor for an unlinked token) rather than the world actor.
 */
async function createCombatWithTokenCombatant(page, { actorId, tokenId, sceneId }) {
  return page.evaluate(
    async ({ aId, tId, sId }) => {
      const combat = await Combat.implementation.create({
        type: 'conflict',
        active: true,
        system: { conflictType: 'kill', phase: 'setup' }
      });
      const actor = game.actors.get(aId);
      const groupId = Array.from(combat.groups)[1]?.id ?? null; // NPC group
      const [cmb] = await combat.createEmbeddedDocuments('Combatant', [{
        actorId: actor.id,
        name: actor.name,
        img: actor.img,
        type: 'conflict',
        group: groupId,
        tokenId: tId,
        sceneId: sId
      }]);
      return { combatId: combat.id, combatantId: cmb.id };
    },
    { aId: actorId, tId: tokenId, sId: sceneId }
  );
}

async function cleanupTaggedActorsAndScenes(page, tag) {
  await page.evaluate(async (t) => {
    // Close conflict panel singleton, delete any combats.
    try { await game.tb2e?.conflictPanel?.close(); } catch {}
    const combatIds = Array.from(game.combats ?? []).map((c) => c.id);
    if ( combatIds.length ) await Combat.deleteDocuments(combatIds);
    // Delete scenes (cascade-deletes tokens).
    const sceneIds = (game.scenes ?? [])
      .filter((s) => s.getFlag?.('tb2e', 'e2eTag') === t)
      .map((s) => s.id);
    if ( sceneIds.length ) await Scene.implementation.deleteDocuments(sceneIds);
    // Delete actors.
    const actorIds = game.actors
      .filter((a) => a.getFlag?.('tb2e', 'e2eTag') === t)
      .map((a) => a.id);
    if ( actorIds.length ) await Actor.implementation.deleteDocuments(actorIds);
  }, tag);
}

test.describe('§18 Conflict: HP & KO — synthetic-token parity (CLAUDE.md regression)', () => {
  test('synthetic self-write: mailbox on unlinked monster writes to synthetic actor; world template untouched (tb2e.mjs L193-204)', async ({ page }, testInfo) => {
    const tag = `e2e-hp-syn-self-${testInfo.parallelIndex}-${Date.now()}`;
    const stamp = Date.now();
    const monsterName = `E2E Bugbear Syn ${stamp}`;
    const sceneName = `E2E HP Syn Scene ${stamp}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    expect(await page.evaluate(() => game.user.isGM)).toBe(true);

    try {
      // Arrange — import world monster, drop an unlinked token, wire a
      // Combatant that carries tokenId+sceneId so `combatant.actor` resolves
      // to the synthetic.
      const monsterId = await importMonster(page, {
        sourceName: 'Bugbear', uniqueName: monsterName, tag
      });
      expect(monsterId).toBeTruthy();

      // Confirm the world template starts at schema defaults (monster.mjs
      // L48-49: hp.value=0, hp.max=0). This is the "baseline" the gotcha
      // warns about — reading HP from the world actor returns 0 regardless
      // of the per-token state.
      const worldBefore = await page.evaluate((id) => {
        const a = game.actors.get(id);
        return {
          hp: a?.system.conflict?.hp?.value ?? null,
          max: a?.system.conflict?.hp?.max ?? null,
          uuid: a?.uuid ?? null
        };
      }, monsterId);
      expect(worldBefore).toEqual({ hp: 0, max: 0, uuid: `Actor.${monsterId}` });

      const { sceneId, tokenId } = await dropUnlinkedToken(page, {
        actorId: monsterId, sceneName, tag
      });
      expect(sceneId).toBeTruthy();
      expect(tokenId).toBeTruthy();

      const { combatId, combatantId } = await createCombatWithTokenCombatant(page, {
        actorId: monsterId, tokenId, sceneId
      });
      expect(combatId).toBeTruthy();
      expect(combatantId).toBeTruthy();

      // Sanity — combatant.actor IS the synthetic (different uuid from
      // world; same template id). This captures the CLAUDE.md invariant
      // concretely so a regression that short-circuits combatant.actor to
      // game.actors.get(actorId) would fail THIS assertion, not just the
      // HP assertions further down.
      const identity = await page.evaluate(({ cId, coId, mId }) => {
        const combat = game.combats.get(cId);
        const combatant = combat.combatants.get(coId);
        const synthetic = combatant.actor;
        const world = game.actors.get(mId);
        return {
          syntheticUuid: synthetic?.uuid ?? null,
          worldUuid: world?.uuid ?? null,
          syntheticId: synthetic?.id ?? null,
          worldId: world?.id ?? null,
          syntheticEqualsWorld: synthetic === world,
          actorIdMatch: combatant.actorId === world?.id
        };
      }, { cId: combatId, coId: combatantId, mId: monsterId });
      // Template id matches (same monster template) ...
      expect(identity.syntheticId).toBe(identity.worldId);
      expect(identity.actorIdMatch).toBe(true);
      // ... but the two actor DOCUMENTS differ — synthetic's uuid is rooted
      // at the scene/token, world's uuid is the top-level `Actor.<id>`.
      expect(identity.syntheticEqualsWorld).toBe(false);
      expect(identity.syntheticUuid).not.toBe(identity.worldUuid);
      expect(identity.syntheticUuid).toContain(`Scene.${sceneId}`);
      expect(identity.syntheticUuid).toContain(`Token.${tokenId}`);
      expect(identity.worldUuid).toBe(`Actor.${monsterId}`);

      // Seed hp on the SYNTHETIC only — max=3, value=3. Per CLAUDE.md, this
      // write lands on the synthetic, not the world actor. We use this to
      // (a) satisfy the hook's `max > 0` clamp at tb2e.mjs L198-199, and
      // (b) establish the canonical "world stays at defaults" baseline.
      await page.evaluate(({ cId, coId }) => {
        const combatant = game.combats.get(cId).combatants.get(coId);
        return combatant.actor.update({
          'system.conflict.hp': { value: 3, max: 3 }
        });
      }, { cId: combatId, coId: combatantId });

      // Poll for the synthetic write to land (its own updateActor round-trip).
      await expect
        .poll(
          () => page.evaluate(({ cId, coId }) => {
            const combatant = game.combats.get(cId).combatants.get(coId);
            return combatant.actor?.system.conflict?.hp?.max ?? null;
          }, { cId: combatId, coId: combatantId }),
          { timeout: 10_000, message: 'synthetic actor hp.max seed should land' }
        )
        .toBe(3);

      // Baseline after seed: synthetic is 3/3, WORLD is still 0/0 —
      // precisely the CLAUDE.md gotcha scenario the spec is built around.
      const baseline = await page.evaluate(({ cId, coId, mId }) => {
        const combatant = game.combats.get(cId).combatants.get(coId);
        const world = game.actors.get(mId);
        return {
          synHp: combatant.actor?.system.conflict?.hp?.value ?? null,
          synMax: combatant.actor?.system.conflict?.hp?.max ?? null,
          synFlag: combatant.actor?.getFlag('tb2e', 'pendingConflictHP') ?? null,
          worldHp: world?.system.conflict?.hp?.value ?? null,
          worldMax: world?.system.conflict?.hp?.max ?? null
        };
      }, { cId: combatId, coId: combatantId, mId: monsterId });
      expect(baseline).toEqual({
        synHp: 3, synMax: 3, synFlag: null, worldHp: 0, worldMax: 0
      });

      // Act — write the mailbox on the SYNTHETIC actor itself. This mirrors
      // the non-GM write path a player would take if they owned this token
      // (in production: a GM-only action, but the mailbox is the uniform
      // cross-permission write primitive per CLAUDE.md §Mailbox Pattern).
      // Bundled update, not setFlag — matches hp-player-mailbox.spec.mjs L162
      // + grind/apply-condition-mailbox.spec.mjs L179-185.
      await page.evaluate(async ({ cId, coId }) => {
        const combatant = game.combats.get(cId).combatants.get(coId);
        await combatant.actor.update({
          'flags.tb2e.pendingConflictHP': { newValue: 1 }
        });
      }, { cId: combatId, coId: combatantId });

      // 1. Synthetic HP applied at 1 (no targetActorId → hook falls through
      //    to `targetActor = actor`, tb2e.mjs L196, which IS the synthetic
      //    here because the `updateActor` hook fires on whichever document
      //    emitted the update). Value is within clamp [0, max=3] so no
      //    silent clamp-to-zero.
      await expect
        .poll(
          () => page.evaluate(({ cId, coId }) => {
            const combatant = game.combats.get(cId).combatants.get(coId);
            return combatant.actor?.system.conflict?.hp?.value ?? null;
          }, { cId: combatId, coId: combatantId }),
          { timeout: 10_000, message: 'synthetic hp.value should land at 1' }
        )
        .toBe(1);

      // 2. Mailbox cleared on the synthetic writer — cardinal contract.
      await expect
        .poll(
          () => page.evaluate(({ cId, coId }) => {
            const combatant = game.combats.get(cId).combatants.get(coId);
            return combatant.actor?.getFlag('tb2e', 'pendingConflictHP') ?? null;
          }, { cId: combatId, coId: combatantId }),
          { timeout: 10_000, message: 'synthetic pendingConflictHP should be cleared' }
        )
        .toBeNull();

      // 3. WORLD actor untouched — the core regression assertion. If a
      //    future refactor swapped the hook to `game.actors.get(actor.id)`
      //    for targetActor (trying to "normalize" to the world record),
      //    this assertion would fail — HP would land on the world template
      //    instead of the synthetic.
      const worldAfter = await page.evaluate((id) => {
        const a = game.actors.get(id);
        return {
          hp: a?.system.conflict?.hp?.value ?? null,
          max: a?.system.conflict?.hp?.max ?? null,
          uuid: a?.uuid ?? null
        };
      }, monsterId);
      expect(worldAfter).toEqual({ hp: 0, max: 0, uuid: `Actor.${monsterId}` });

      // 4. Identity invariants unchanged — combatant.actor still resolves
      //    to the synthetic, not the world.
      const finalIdentity = await page.evaluate(({ cId, coId, mId }) => {
        const combatant = game.combats.get(cId).combatants.get(coId);
        const world = game.actors.get(mId);
        return {
          syntheticEqualsWorld: combatant.actor === world,
          syntheticId: combatant.actor?.id ?? null,
          worldId: world?.id ?? null
        };
      }, { cId: combatId, coId: combatantId, mId: monsterId });
      expect(finalIdentity.syntheticEqualsWorld).toBe(false);
      expect(finalIdentity.syntheticId).toBe(finalIdentity.worldId);
    } finally {
      await cleanupTaggedActorsAndScenes(page, tag);
    }
  });

  // Scenario 2 — cross-write via `targetActorId` on an unlinked monster is
  // the documented CLAUDE.md gotcha. Empirically verified (diagnostic run
  // during authoring): with world seeded to 5/5 and synthetic to 3/3, a
  // captain cross-write of `{ newValue: 1, targetActorId: monsterWorldId }`
  // causes WORLD hp to drop from 5 → 1 while SYNTHETIC stays at 3. The
  // write reaches the world template via tb2e.mjs L196 `game.actors.get(
  // targetActorId)` and never touches the per-token synthetic actor that
  // `combatant.actor` resolves to. This is a live production gap.
  //
  // The spec seeds the world's max to 5 deliberately — otherwise the
  // default `max = 0` (monster.mjs L49) would clamp `newValue = 1` to 0
  // at tb2e.mjs L199, and "no visible change" would mask whether the
  // write reached the world or was routed elsewhere. With max=5, a 1 is
  // within range, so a successful world-write is observable as 5 → 1.
  //
  // `test.fixme` asserts the DESIRED behavior (synthetic HP lands at 1,
  // world HP untouched at 5) — the same shape the spec would take after a
  // fix. When the fix lands (targetActor resolution walks active conflict
  // combatants to prefer a synthetic match), flip fixme → test.
  test('targetActorId cross-write on unlinked monster: synthetic HP lands, world actor untouched (CLAUDE.md §Unlinked Actors)', async ({ page }, testInfo) => {
    const tag = `e2e-hp-syn-tgt-${testInfo.parallelIndex}-${Date.now()}`;
    const stamp = Date.now();
    const captainName = `E2E Captain Syn ${stamp}`;
    const monsterName = `E2E Bugbear Syn Tgt ${stamp}`;
    const sceneName = `E2E HP Syn Tgt Scene ${stamp}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    expect(await page.evaluate(() => game.user.isGM)).toBe(true);

    try {
      // Arrange — party captain (linked character, the writer) + unlinked
      // monster combatant (the cross-write target).
      const captainId = await createCharacter(page, {
        name: captainName, tag, maxHP: 4, startHP: 4
      });
      const monsterId = await importMonster(page, {
        sourceName: 'Bugbear', uniqueName: monsterName, tag
      });

      // Seed the WORLD actor's max/value to 5/5 up front. This is
      // critical: the default `max = 0` on monster.mjs L49 would cause
      // the hook's clamp at tb2e.mjs L198-199 to pin `newValue = 1` to 0,
      // and a no-op world write (0 → 0) would be invisible. With world
      // max=5, the buggy routing is observable as world 5 → 1.
      await page.evaluate((id) => {
        return game.actors.get(id).update({
          'system.conflict.hp': { value: 5, max: 5 }
        });
      }, monsterId);

      const { sceneId, tokenId } = await dropUnlinkedToken(page, {
        actorId: monsterId, sceneName, tag
      });
      const { combatId, combatantId } = await createCombatWithTokenCombatant(page, {
        actorId: monsterId, tokenId, sceneId
      });

      // Seed hp on the SYNTHETIC — max=3, value=3. World is 5/5 per
      // above; synthetic is an independent runtime instance so the two
      // stay divergent.
      await page.evaluate(({ cId, coId }) => {
        const combatant = game.combats.get(cId).combatants.get(coId);
        return combatant.actor.update({
          'system.conflict.hp': { value: 3, max: 3 }
        });
      }, { cId: combatId, coId: combatantId });
      await expect
        .poll(
          () => page.evaluate(({ cId, coId }) => {
            const combatant = game.combats.get(cId).combatants.get(coId);
            return combatant.actor?.system.conflict?.hp?.max ?? null;
          }, { cId: combatId, coId: combatantId }),
          { timeout: 10_000 }
        )
        .toBe(3);

      // Baseline: synthetic is 3/3, world 5/5, captain unflagged.
      const baseline = await page.evaluate(({ cId, coId, mId, capId }) => {
        const combatant = game.combats.get(cId).combatants.get(coId);
        const world = game.actors.get(mId);
        const captain = game.actors.get(capId);
        return {
          synHp: combatant.actor?.system.conflict?.hp?.value ?? null,
          worldHp: world?.system.conflict?.hp?.value ?? null,
          captainFlag: captain?.getFlag('tb2e', 'pendingConflictHP') ?? null
        };
      }, { cId: combatId, coId: combatantId, mId: monsterId, capId: captainId });
      expect(baseline).toEqual({ synHp: 3, worldHp: 5, captainFlag: null });

      // Act — captain writes the mailbox on herself with the MONSTER'S
      // WORLD id as targetActorId. In the current implementation, the hook
      // at tb2e.mjs L196 resolves this to the world actor, and the HP write
      // lands there — missing the synthetic entirely.
      await page.evaluate(async ({ capId, mId }) => {
        const captain = game.actors.get(capId);
        await captain.update({
          'flags.tb2e.pendingConflictHP': { newValue: 1, targetActorId: mId }
        });
      }, { capId: captainId, mId: monsterId });

      // Desired behavior (the fix target): synthetic HP lands at 1.
      // Current behavior: synthetic stays at 3 (world gets the write instead).
      await expect
        .poll(
          () => page.evaluate(({ cId, coId }) => {
            const combatant = game.combats.get(cId).combatants.get(coId);
            return combatant.actor?.system.conflict?.hp?.value ?? null;
          }, { cId: combatId, coId: combatantId }),
          { timeout: 10_000, message: 'synthetic hp.value SHOULD land at 1 (fails today — write reaches world template)' }
        )
        .toBe(1);

      // Desired behavior: world template stays at 5/5 (the seed). Today
      // this fails — world drops 5 → 1 because tb2e.mjs L196's
      // `game.actors.get(targetActorId)` lookup resolves to the world
      // template, and the write lands there. The fix should route the
      // write to the combatant's synthetic actor instead.
      const worldHpAfter = await page.evaluate(
        (id) => game.actors.get(id)?.system.conflict?.hp?.value ?? null,
        monsterId
      );
      expect(worldHpAfter).toBe(5);

      // Mailbox cleared on the WRITER (captain) — regardless of routing,
      // the .then() at tb2e.mjs L201 runs after the target update settles.
      await expect
        .poll(
          () => page.evaluate(
            (id) => game.actors.get(id)?.getFlag('tb2e', 'pendingConflictHP') ?? null,
            captainId
          ),
          { timeout: 10_000 }
        )
        .toBeNull();
    } finally {
      await cleanupTaggedActorsAndScenes(page, tag);
    }
  });
});
