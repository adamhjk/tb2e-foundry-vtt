import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §8 Compendiums — drag a monster from the `tb2e.monsters` pack onto the
 * active scene; verify a token is created.
 *
 * Contract: dropping an Actor from a compendium onto the scene canvas goes
 * through Foundry's `TokenLayer#_onDropActorData`
 * (foundry/client/canvas/layers/tokens.mjs:681). That handler:
 *   1) resolves the drop payload via `Actor.implementation.fromDropData(data)`
 *   2) if the actor is in a compendium, imports it to the world via
 *      `Actor.implementation.create(actorData, {fromCompendium: true})`
 *      (tokens.mjs:698) — i.e. it materializes a world actor before creating
 *      any token
 *   3) builds a non-saved prototype token via `actor.getTokenDocument({...},
 *      {parent: canvas.scene})` (tokens.mjs:702 + actor.mjs:301)
 *   4) persists it with `TokenDocument.create(token, {parent: canvas.scene})`
 *      (tokens.mjs:714)
 *
 * Kobold's prototype token has `actorLink: false` (default), so the created
 * token is **unlinked** and has its own synthetic `token.actor` — per the
 * CLAUDE.md "Unlinked Actors" rule we read per-token state via `token.actor`
 * rather than `game.actors.get(actorId)`.
 *
 * Approach: programmatic drop. Native Playwright canvas drag is ill-defined
 * (the drop target is WebGL, not a DOM element) and doing a real drag would
 * mostly exercise Playwright's input pipeline rather than our system. The
 * drop handler doesn't touch the DOM event beyond `.altKey` / `.shiftKey`
 * (tokens.mjs:703, 709), so invoking it with a synthetic `DragEvent` and
 * the dropActorData payload exercises the identical code path.
 *
 * Source monster: `Kobold` (packs/_source/monsters/Kobold_a1b2c3d4e5f60001.yml)
 * — same stable entry used by tests/e2e/sheet/monster-open.spec.mjs.
 *
 * Narrow scope — out of scope for this spec (covered by sibling specs):
 *   - character-sheet drop handlers (lines 282, 283)
 *   - scene/canvas rendering assertions (we verify the TokenDocument, not
 *     the PIXI placeable)
 *   - conflict initialization (§12)
 */

const MONSTERS_PACK = 'tb2e.monsters';
const MONSTER_NAME = 'Kobold';
const MONSTER_ID = 'a1b2c3d4e5f60001'; // packs/_source/monsters/Kobold_a1b2c3d4e5f60001.yml

test.describe('Compendium drag monster to scene', () => {
  test('dropping a pack monster onto the active scene creates an unlinked token', async ({
    page,
  }, testInfo) => {
    const tag = `e2e-drag-monster-${testInfo.workerIndex}-${Date.now()}`;
    const sceneName = `E2E Scene ${tag}`;

    // Surface uncaught page errors — the drop should complete clean.
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Pre-state: snapshot the pack source so we can cross-check the created
    // token / actor survived the "copy to world + make token" round trip.
    const source = await page.evaluate(async ({ packId, entryId }) => {
      const pack = window.game.packs.get(packId);
      if (!pack) throw new Error(`Pack not found: ${packId}`);
      const entry = await pack.getDocument(entryId);
      if (!entry) throw new Error(`Entry "${entryId}" not found in ${packId}`);
      const obj = entry.toObject();
      return {
        name: obj.name,
        type: obj.type,
        actorLink: obj.prototypeToken?.actorLink ?? false,
      };
    }, { packId: MONSTERS_PACK, entryId: MONSTER_ID });
    expect(source.name).toBe(MONSTER_NAME);
    expect(source.type).toBe('monster');
    // Kobold's prototype token is unlinked by default — the drop creates a
    // synthetic actor, not a reference. Covered by CLAUDE.md §Unlinked Actors.
    expect(source.actorLink).toBe(false);

    // Create and activate a scene. The seed world
    // (tests/e2e/fixtures/worlds/tb2e-e2e/world.json) ships with no scenes,
    // so every test that needs a canvas creates its own. We tag it so
    // cleanup is deterministic even if an earlier run crashed.
    const sceneId = await page.evaluate(async ({ name, t }) => {
      const [scene] = await window.Scene.implementation.create([{
        name,
        width: 2000,
        height: 2000,
        grid: { type: 1, size: 100 },
        padding: 0,
        flags: { tb2e: { e2eTag: t } },
      }]);
      await scene.activate();
      // Wait for canvas to finish drawing the activated scene — the token
      // drop handler reads `canvas.dimensions` + `canvas.scene`.
      if ( !window.canvas.ready || window.canvas.scene?.id !== scene.id ) {
        await new Promise((resolve) => window.Hooks.once('canvasReady', resolve));
      }
      return scene.id;
    }, { name: sceneName, t: tag });
    expect(sceneId).toBeTruthy();

    try {
      // Pre-drop: the new scene has no tokens yet.
      const initialTokenCount = await page.evaluate(
        (id) => window.game.scenes.get(id).tokens.size,
        sceneId
      );
      expect(initialTokenCount).toBe(0);

      // Drop position inside the canvas rect (scene is 2000x2000).
      const dropX = 500;
      const dropY = 500;

      // Programmatic drop through the canonical Foundry path
      // (TokenLayer#_onDropActorData — tokens.mjs:681). We build the
      // `{type:"Actor", uuid, x, y}` payload that the canvas' real drag
      // handler would have constructed from the sidebar drag source
      // (DragDrop → `dropActorData`), then invoke the handler directly.
      const result = await page.evaluate(
        async ({ packId, entryId, x, y, t }) => {
          const pack = window.game.packs.get(packId);
          const entry = await pack.getDocument(entryId);
          const uuid = entry.uuid;

          // Sanity: canvas must be ready + the active scene is ours.
          if ( !window.canvas.ready ) throw new Error('canvas not ready');

          const event = new DragEvent('drop', { bubbles: true, cancelable: true });
          const tokensLayer = window.canvas.tokens;
          const created = await tokensLayer._onDropActorData(event, {
            type: 'Actor',
            uuid,
            x,
            y,
          });

          // Tag the synthetic world-actor that the compendium import created
          // so afterEach can find + delete it. The import path at
          // tokens.mjs:697-698 copies via `game.actors.fromCompendium(actor)`
          // then `Actor.create(...)` — we retrieve that new world actor via
          // the created token's `actorId` (which references it) and stamp
          // our tag. Token is unlinked so `created.actor` is the synthetic.
          const worldActor = window.game.actors.get(created.actorId);
          if ( worldActor ) {
            await worldActor.setFlag('tb2e', 'e2eTag', t);
          }

          return {
            tokenId: created.id,
            tokenName: created.name,
            tokenActorId: created.actorId,
            tokenActorLink: created.actorLink,
            tokenX: created.x,
            tokenY: created.y,
            // `token.actor` is the synthetic actor for unlinked tokens
            // (CLAUDE.md §Unlinked Actors).
            syntheticActorName: created.actor?.name,
            syntheticActorType: created.actor?.type,
          };
        },
        {
          packId: MONSTERS_PACK,
          entryId: MONSTER_ID,
          x: dropX,
          y: dropY,
          t: tag,
        }
      );

      expect(result.tokenId, `drop failed: ${JSON.stringify(result)}`).toBeTruthy();
      // Kobold's prototype token has `appendNumber: true` (packs/_source/
      // monsters/Kobold_a1b2c3d4e5f60001.yml:75), so the created token is
      // named "Kobold (N)" — the lowest N not yet in use for this actor on
      // the scene (foundry actor.mjs:317-321). For a fresh scene, N=1.
      expect(result.tokenName).toBe(`${MONSTER_NAME} (1)`);
      expect(result.tokenActorLink).toBe(false);
      // Per-token synthetic actor reflects the monster — its name comes from
      // the underlying world actor (which is never renumbered), so it stays
      // "Kobold" even though the token gets a suffix.
      expect(result.syntheticActorName).toBe(MONSTER_NAME);
      expect(result.syntheticActorType).toBe('monster');

      // Scene now has exactly one TokenDocument.
      await expect
        .poll(
          () =>
            page.evaluate(
              (id) => window.game.scenes.get(id).tokens.size,
              sceneId
            ),
          { timeout: 10_000 }
        )
        .toBe(1);

      // The token on the scene matches what the drop returned. Cross-check
      // via `scene.tokens.get(id)` (the same source a GM would inspect).
      const sceneToken = await page.evaluate(
        ({ sId, tId }) => {
          const sc = window.game.scenes.get(sId);
          const tok = sc.tokens.get(tId);
          if ( !tok ) return null;
          return {
            id: tok.id,
            name: tok.name,
            actorId: tok.actorId,
            actorLink: tok.actorLink,
            x: tok.x,
            y: tok.y,
            actorName: tok.actor?.name,
            actorType: tok.actor?.type,
          };
        },
        { sId: sceneId, tId: result.tokenId }
      );
      expect(sceneToken).not.toBeNull();
      expect(sceneToken.id).toBe(result.tokenId);
      expect(sceneToken.name).toBe(`${MONSTER_NAME} (1)`);
      expect(sceneToken.actorLink).toBe(false);
      expect(sceneToken.actorName).toBe(MONSTER_NAME);
      expect(sceneToken.actorType).toBe('monster');

      // The drop coordinates are snapped by
      // Token._getDropActorPosition (tokens.mjs:708) — we don't assert exact
      // numbers (that would lock the test to snap rules), just that the
      // token landed on the canvas we dropped onto.
      expect(Number.isFinite(sceneToken.x)).toBe(true);
      expect(Number.isFinite(sceneToken.y)).toBe(true);

      expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toEqual([]);
    } finally {
      // Cleanup — delete the scene (cascade-deletes embedded TokenDocuments)
      // and any world actor the compendium import left behind. Find actors
      // by tag so we don't have to leak the id out of try{}.
      await page.evaluate(async ({ sId, t }) => {
        // If the active scene is ours, deactivate first so Foundry doesn't
        // hold a canvas reference to a deleted scene.
        const sc = window.game.scenes.get(sId);
        if ( sc ) await sc.delete();
        const actorIds = window.game.actors
          .filter((a) => a.getFlag?.('tb2e', 'e2eTag') === t)
          .map((a) => a.id);
        if ( actorIds.length ) {
          await window.Actor.implementation.deleteDocuments(actorIds);
        }
      }, { sId: sceneId, t: tag });
    }
  });
});
