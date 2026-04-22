import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { GrindTracker } from '../pages/GrindTracker.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §10 Grind Tracker — torch exhaustion + pendingLightExtinguish mailbox
 * (DH p.75 grind phases; light/covered mechanics in grind-tracker.mjs).
 *
 * Rules under test. Two linked but separately observable legs of the torch-
 * extinguish flow:
 *
 *   1. END-TO-END (via Advance): the grind advance handler decrements lit
 *      light sources on scene-resident character actors; at turnsRemaining→0
 *      it flips `lit: false` on the item AND posts a torch-expired chat card.
 *      (module/applications/grind-tracker.mjs L305-360, esp. L320-339.)
 *      The `updateItem` hook (tb2e.mjs L251-271) then observes `lit: false`
 *      and — since the E2E harness is GM — darkens covered characters
 *      directly (GM branch L260-267). Observable: torch-expired card posted,
 *      item state flipped, covered-actor `lightLevel === "dark"`.
 *
 *   2. MAILBOX (pendingLightExtinguish): the non-GM branch of the
 *      `updateItem` hook (tb2e.mjs L268-270) sets
 *      `flags.tb2e.pendingLightExtinguish = true` on the holder actor. The
 *      `updateActor` hook (L232-243) picks it up, darkens all scene-resident
 *      characters whose `flags.tb2e.grindCoveredBy === holder.id`, and
 *      UNSETS the mailbox flag. This spec simulates the non-GM write via
 *      `page.evaluate` (same harness-constraint pattern as
 *      apply-condition-mailbox.spec.mjs L50-56 and
 *      versus/finalize-via-mailbox.spec.mjs L106-150) — all Playwright
 *      sessions authenticate as GM (tests/e2e/test.mjs L18-20).
 *
 * Card shape (not deep-tested): `templates/chat/torch-expired.hbs` renders a
 * `.tb2e-chat-card.grind-torch-card` with `.card-header`, `.card-body`, and
 * a dark `.card-banner`. We only assert `.grind-torch-card` is present and
 * the message count increment is exactly 1 — the template DOM shape is
 * out of scope per the briefing.
 *
 * Out of scope (covered by sibling §10 / §2 specs):
 *   - Turn counter increment mechanics (advance-turn.spec.mjs).
 *   - Phase cycling (set-phase.spec.mjs).
 *   - Consolidated grind card (consolidated-card.spec.mjs).
 *   - Apply-condition mailbox (apply-condition-mailbox.spec.mjs).
 *   - Per-turn consumeLight button UI (sheet/inventory-supplies.spec.mjs L319+).
 *   - Template DOM deep-assertions for the torch-expired card.
 *
 * World-state hygiene: each test creates its own actors, scene, items, and
 * chat messages and cleans them up in afterEach alongside grind settings and
 * any mailbox/grindCoveredBy flag stragglers. Repeat-each runs and
 * subsequent specs see a clean baseline.
 */
test.describe('§10 Grind Tracker — torch extinguish + pendingLightExtinguish mailbox', () => {
  let createdActorIds = [];
  let createdSceneId = null;
  let createdMessageIds = [];

  test.afterEach(async ({ page }) => {
    await page.evaluate(async ({ aIds, sId, mIds }) => {
      try { game.tb2e.grindTracker?.close?.(); } catch {}
      for ( const mId of mIds ) {
        const m = game.messages.get(mId);
        if ( m ) { try { await m.delete(); } catch {} }
      }
      for ( const aId of aIds ) {
        const a = game.actors.get(aId);
        if ( a ) {
          try { await a.unsetFlag('tb2e', 'pendingLightExtinguish'); } catch {}
          try { await a.unsetFlag('tb2e', 'grindCoveredBy'); } catch {}
          try { await a.delete(); } catch {}
        }
      }
      if ( sId ) {
        const s = game.scenes.get(sId);
        if ( s ) { try { await s.delete(); } catch {} }
      }
      await game.settings.set('tb2e', 'grindTurn', 1);
      await game.settings.set('tb2e', 'grindPhase', 'adventure');
      await game.settings.set('tb2e', 'grindExtreme', false);
    }, {
      aIds: createdActorIds,
      sId: createdSceneId,
      mIds: createdMessageIds
    });
    createdActorIds = [];
    createdSceneId = null;
    createdMessageIds = [];
  });

  test('advancing with a lit torch at turnsRemaining=1 flips lit→false, posts torch-expired card, darkens covered actor (DH p.75)', async ({ page }) => {
    const suffix = Date.now();
    const holderName = `E2E TorchHolder ${suffix}`;
    const coveredName = `E2E TorchCovered ${suffix}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Confirm GM. The advance button is gated by `isGM` in the template
    // (grind-tracker.hbs L6) and the advance handler posts/updates as GM.
    const isGM = await page.evaluate(() => game.user.isGM);
    expect(isGM).toBe(true);

    const tracker = new GrindTracker(page);
    await tracker.resetState();

    // Create two characters: one holds the lit torch, the other is covered
    // by it (grindCoveredBy = holderId). Seed lightLevel=full on covered so
    // the "full → dark" transition is observable.
    const ids = await page.evaluate(async ({ hN, cN }) => {
      const holder = await Actor.create({ name: hN, type: 'character' });
      const covered = await Actor.create({ name: cN, type: 'character' });
      // Lit torch, turnsRemaining=1 so the next advance drives it to 0 and
      // triggers the extinguish path. Must be in a hand slot (hand-L or
      // hand-R) for the grind-tracker's `hasLit` guard (grind-tracker.mjs
      // L288-294) — and the advance handler at L318-319 only requires
      // `supplyType: "light"` + `lit: true`, but slot placement keeps the
      // fixture consistent with the real sheet rendering contract.
      await holder.createEmbeddedDocuments('Item', [{
        name: `${hN} Torch`,
        type: 'supply',
        system: {
          supplyType: 'light',
          lit: true,
          turnsRemaining: 1,
          quantity: 1,
          quantityMax: 1,
          slot: 'hand-R',
          slotIndex: 0,
          slotOptions: { wornHand: 1, carried: 1 }
        }
      }]);
      // Wire covered → holder via grindCoveredBy + start at full light
      // (default, but set explicitly for assertion clarity).
      await covered.setFlag('tb2e', 'grindCoveredBy', holder.id);
      await covered.update({ 'system.lightLevel': 'full' });
      return { holderId: holder.id, coveredId: covered.id };
    }, { hN: holderName, cN: coveredName });
    createdActorIds = [ids.holderId, ids.coveredId];

    // Scene + tokens. The advance handler filters on `canvas?.scene?.tokens`
    // (grind-tracker.mjs L313, L317, L326-328) — actors without a token on
    // the active scene are invisible to both the decrement and the covered
    // lookup. Same pattern as consolidated-card.spec.mjs L135-162.
    createdSceneId = await page.evaluate(async ({ hId, cId, suf }) => {
      const scene = await Scene.create({
        name: `E2E TorchScene ${suf}`,
        active: true,
        width: 1000,
        height: 1000,
        padding: 0,
        grid: { type: 1, size: 100 }
      });
      await scene.createEmbeddedDocuments('Token', [
        {
          name: game.actors.get(hId).name,
          actorId: hId,
          actorLink: true,
          x: 100, y: 100,
          width: 1, height: 1
        },
        {
          name: game.actors.get(cId).name,
          actorId: cId,
          actorLink: true,
          x: 300, y: 100,
          width: 1, height: 1
        }
      ]);
      await scene.view();
      // Block until the canvas has finished drawing this scene — without
      // this, subsequent actor.update cascades hit a half-initialized
      // TokenDocument render pipeline (CONST.RENDER_FLAGS.OBJECTS undefined
      // in TokenDocument._onRelatedUpdate).
      if ( !canvas.ready || canvas.scene?.id !== scene.id ) {
        await new Promise((resolve) => Hooks.once('canvasReady', resolve));
      }
      return scene.id;
    }, { hId: ids.holderId, cId: ids.coveredId, suf: suffix });
    expect(createdSceneId).toBeTruthy();

    // Snapshot chat messages before advancing so we can isolate the card
    // this advance posts. Shared-worker world may have stale messages.
    const preMessageIds = await page.evaluate(
      () => game.messages.contents.map(m => m.id)
    );

    // Advance the turn: 1 → 2. cyclePos=2 (not a grind turn), so no
    // consolidated condition card fires — only the torch-expired card
    // from the decrement loop (grind-tracker.mjs L322-338).
    await tracker.open();
    await tracker.advanceTurn();

    // Block on settings update resolving — that's the last await in
    // #onAdvanceTurn (L358), so by then the torch-expired card has been
    // created and the item update has landed.
    await expect
      .poll(() => tracker.getTurnFromSettings(), { timeout: 10_000 })
      .toBe(2);

    // Assert the torch-expired card was posted exactly once.
    const newTorchMessageIds = await page.evaluate((preIds) => {
      const preSet = new Set(preIds);
      return game.messages.contents
        .filter(m => !preSet.has(m.id))
        .filter(m => /grind-torch-card/.test(m.content ?? ''))
        .map(m => m.id);
    }, preMessageIds);
    createdMessageIds = newTorchMessageIds;
    expect(newTorchMessageIds).toHaveLength(1);

    // Also sweep any non-torch messages posted by this advance into the
    // cleanup list so we don't leak them (e.g., if any future hook posts
    // a sibling card — defensive).
    const allNewMessageIds = await page.evaluate((preIds) => {
      const preSet = new Set(preIds);
      return game.messages.contents
        .filter(m => !preSet.has(m.id))
        .map(m => m.id);
    }, preMessageIds);
    createdMessageIds = allNewMessageIds;

    // Item state: lit=false, turnsRemaining=0 (grind-tracker.mjs L320-323).
    const itemState = await page.evaluate((hId) => {
      const holder = game.actors.get(hId);
      const torch = holder.items.find(i =>
        i.type === 'supply' && i.system.supplyType === 'light'
      );
      return {
        lit: torch.system.lit,
        turnsRemaining: torch.system.turnsRemaining
      };
    }, ids.holderId);
    expect(itemState).toEqual({ lit: false, turnsRemaining: 0 });

    // Covered actor darkened. The `updateItem` hook's GM branch (tb2e.mjs
    // L260-267) fires synchronously off the `item.update({lit:false})` and
    // directly writes `lightLevel: "dark"` on all covered scene actors.
    // Poll because the hook's inner awaits are independent of the advance
    // handler's return.
    await expect
      .poll(
        () => page.evaluate(
          (cId) => game.actors.get(cId)?.system.lightLevel,
          ids.coveredId
        ),
        { timeout: 10_000, message: 'covered actor should be darkened by updateItem GM hook' }
      )
      .toBe('dark');

    // Sanity: a chat-log entry with the `.grind-torch-card` class is
    // actually in the DOM — cheapest possible shape assertion, since card
    // template deep-testing is out of scope per the briefing.
    const cardLocator = page
      .locator(`[data-message-id="${newTorchMessageIds[0]}"]`)
      .first();
    await expect(cardLocator).toBeVisible();
    await expect(cardLocator.locator('.grind-torch-card')).toHaveCount(1);
  });

  test('pendingLightExtinguish mailbox write darkens covered actor and clears flag (CLAUDE.md §Mailbox Pattern)', async ({ page }) => {
    // This leg specifically exercises the `updateActor` mailbox-drain path
    // at tb2e.mjs L232-243 — the fallback non-GM path of the torch-
    // extinguish flow. The E2E harness has no non-GM session to drive
    // the real player-side write (the `updateItem` non-GM branch at
    // tb2e.mjs L268-270), so we simulate it with a direct `setFlag` call,
    // matching the idiom in apply-condition-mailbox.spec.mjs L179-185.
    const suffix = Date.now();
    const holderName = `E2E TorchMailboxHolder ${suffix}`;
    const coveredName = `E2E TorchMailboxCovered ${suffix}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    const isGM = await page.evaluate(() => game.user.isGM);
    expect(isGM).toBe(true);

    // Fresh actors — the holder owns the mailbox flag; the covered actor
    // has `grindCoveredBy = holderId` and starts at lightLevel=full.
    const ids = await page.evaluate(async ({ hN, cN }) => {
      const holder = await Actor.create({ name: hN, type: 'character' });
      const covered = await Actor.create({ name: cN, type: 'character' });
      await covered.setFlag('tb2e', 'grindCoveredBy', holder.id);
      await covered.update({ 'system.lightLevel': 'full' });
      return { holderId: holder.id, coveredId: covered.id };
    }, { hN: holderName, cN: coveredName });
    createdActorIds = [ids.holderId, ids.coveredId];

    // Scene + tokens. The mailbox processor (tb2e.mjs L234-239) filters
    // covered candidates by `canvas?.scene?.tokens` actor ids — same
    // scene-presence guard as the advance path.
    createdSceneId = await page.evaluate(async ({ hId, cId, suf }) => {
      const scene = await Scene.create({
        name: `E2E TorchMailboxScene ${suf}`,
        active: true,
        width: 1000,
        height: 1000,
        padding: 0,
        grid: { type: 1, size: 100 }
      });
      await scene.createEmbeddedDocuments('Token', [
        {
          name: game.actors.get(hId).name,
          actorId: hId,
          actorLink: true,
          x: 100, y: 100,
          width: 1, height: 1
        },
        {
          name: game.actors.get(cId).name,
          actorId: cId,
          actorLink: true,
          x: 300, y: 100,
          width: 1, height: 1
        }
      ]);
      await scene.view();
      // Block until the canvas has finished drawing this scene — without
      // this, subsequent actor.update cascades hit a half-initialized
      // TokenDocument render pipeline.
      if ( !canvas.ready || canvas.scene?.id !== scene.id ) {
        await new Promise((resolve) => Hooks.once('canvasReady', resolve));
      }
      return scene.id;
    }, { hId: ids.holderId, cId: ids.coveredId, suf: suffix });

    // Baseline: covered is full, no mailbox flag.
    const baseline = await page.evaluate(({ hId, cId }) => {
      return {
        coveredLight: game.actors.get(cId)?.system.lightLevel,
        mailbox: game.actors.get(hId)?.getFlag('tb2e', 'pendingLightExtinguish') ?? null
      };
    }, { hId: ids.holderId, cId: ids.coveredId });
    expect(baseline).toEqual({ coveredLight: 'full', mailbox: null });

    // Simulate the non-GM player-side write that lives at tb2e.mjs L268-270
    // (`holder.setFlag("tb2e", "pendingLightExtinguish", true)`). The GM
    // `updateActor` hook runs in the same client as this write (harness is
    // GM) and drives the darken + clear.
    await page.evaluate(async (hId) => {
      await game.actors.get(hId).setFlag('tb2e', 'pendingLightExtinguish', true);
    }, ids.holderId);

    // 1. Mailbox cleared (cardinal mailbox contract — tb2e.mjs L241).
    await expect
      .poll(
        () => page.evaluate(
          (hId) => game.actors.get(hId)?.getFlag('tb2e', 'pendingLightExtinguish') ?? null,
          ids.holderId
        ),
        { timeout: 10_000, message: 'pendingLightExtinguish should be cleared by GM hook' }
      )
      .toBeNull();

    // 2. Covered actor darkened (tb2e.mjs L240).
    const postCoveredLight = await page.evaluate(
      (cId) => game.actors.get(cId)?.system.lightLevel,
      ids.coveredId
    );
    expect(postCoveredLight).toBe('dark');
  });
});
