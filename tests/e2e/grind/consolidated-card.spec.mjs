import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { GrindTracker } from '../pages/GrindTracker.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §10 Grind Tracker — multiple conditions in one grind turn render as a
 * single consolidated chat card (DH p.53 conditions, p.75 grind phases).
 *
 * Rules under test:
 *   - On a grind turn (every 4th turn by default, 3rd in extreme mode), each
 *     scene-resident character suffers the next condition in the sequence
 *     `hungry → exhausted → angry → sick → injured → afraid → dead`
 *     (GRIND_ORDER at `module/applications/grind-tracker.mjs` L3). The UI
 *     consolidates these into ONE chat card with per-actor Apply buttons
 *     instead of posting N independent cards.
 *
 * Implementation map (verified against
 * `module/applications/grind-tracker.mjs`):
 *   - Advance handler at L305-360. On `cyclePos === maxTurns` (L344) it
 *     collects one entry per scene-resident character that still has an
 *     unapplied condition (L345-352) and calls `#postConsolidatedGrindCard`
 *     exactly once with the batched array (L353-355).
 *   - `#postConsolidatedGrindCard` (L390-399) writes ONE ChatMessage with
 *     `flags.tb2e = { grindCondition: true, turn, entries: [{ actorId,
 *     condKey, applied: false }] }`. The `entries` array carries every
 *     actor×condition pair for the turn — the distinguishing shape for
 *     "consolidated".
 *   - Template `templates/chat/grind-consolidated.hbs` renders one
 *     `.grind-entry[data-actor-id]` per entry plus a single "Apply All"
 *     button (L30-36) when at least one entry is still unapplied.
 *
 * Triggering path:
 *   - The advance handler filters on `canvas?.scene?.tokens` (L313, L317,
 *     L347) so characters must have a token on the active scene to be
 *     included. We provision a scene + one token per actor, same pattern as
 *     `roll/help-accept.spec.mjs` L139-172.
 *   - Turn baseline is set to 3 so the next advance crosses into
 *     `cyclePos === 4 === maxTurns` and fires the grind branch. This
 *     directly exercises the real trigger — not the template in isolation —
 *     per the briefing's preferred approach.
 *
 * Scope (narrow per briefing):
 *   - Exactly ONE ChatMessage is posted by the grind branch (not two).
 *   - `flags.tb2e.grindCondition === true`, `flags.tb2e.turn === 4`.
 *   - `flags.tb2e.entries` contains one entry per scene actor, each with
 *     `condKey === "hungry"` (first in GRIND_ORDER for a fresh character)
 *     and `applied === false`.
 *   - The rendered DOM has `.grind-entry` per entry and ONE "Apply All"
 *     button — enough to confirm the template shape consumed the batched
 *     entries. We do NOT deep-test HTML or the apply-click wiring (that's
 *     the mailbox spec at L326).
 *
 * Out of scope (covered by sibling §10 specs):
 *   - Turn counter increment mechanics (advance-turn.spec.mjs).
 *   - Phase cycling (set-phase.spec.mjs).
 *   - Apply button click → condition applied (apply-condition-mailbox.spec.mjs).
 *   - Light source extinguish / torch-expired card (light-extinguish.spec.mjs).
 *
 * World-state hygiene: the test creates its own scene, two actors, and one
 * chat message. `afterEach` deletes all three + resets the grind settings to
 * their registered defaults so repeat-each runs (and subsequent specs) see
 * a clean baseline.
 */
test.describe('§10 Grind Tracker — consolidated condition card', () => {
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
        if ( a ) { try { await a.delete(); } catch {} }
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

  test('advancing into a grind turn with two scene actors posts ONE consolidated card with both entries (DH p.53/p.75)', async ({ page }) => {
    const suffix = Date.now();
    const actorAName = `E2E GrindA ${suffix}`;
    const actorBName = `E2E GrindB ${suffix}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // The advance handler runs GM-only server logic via settings writes +
    // ChatMessage.create — but the button itself is gated by `isGM` in the
    // template (grind-tracker.hbs L6), and the whole E2E harness
    // authenticates as GM (tests/e2e/test.mjs L18-20).
    const isGM = await page.evaluate(() => game.user.isGM);
    expect(isGM).toBe(true);

    const tracker = new GrindTracker(page);

    // Known baseline: turn=1, adventure phase, not extreme.
    await tracker.resetState();

    // Create two fresh characters. The data model initializes all negative
    // conditions to false (module/data/actor/character.mjs) so
    // `GRIND_ORDER.find(k => !conds[k])` picks `hungry` first for each.
    createdActorIds = await page.evaluate(async ({ nA, nB }) => {
      const a = await Actor.create({ name: nA, type: 'character' });
      const b = await Actor.create({ name: nB, type: 'character' });
      return [a.id, b.id];
    }, { nA: actorAName, nB: actorBName });
    expect(createdActorIds).toHaveLength(2);

    // Provision a scene + one token per actor. The advance handler filters
    // by `canvas?.scene?.tokens` (grind-tracker.mjs L313, L347), so actors
    // without tokens on the active scene are invisible to the grind branch.
    // Mirrors the scene-bootstrap in roll/help-accept.spec.mjs L139-172.
    createdSceneId = await page.evaluate(async ({ aId, bId, suf }) => {
      const scene = await Scene.create({
        name: `E2E Grind Scene ${suf}`,
        active: true,
        width: 1000,
        height: 1000,
        padding: 0,
        grid: { type: 1, size: 100 }
      });
      await scene.createEmbeddedDocuments('Token', [
        {
          name: game.actors.get(aId).name,
          actorId: aId,
          actorLink: true,
          x: 100, y: 100,
          width: 1, height: 1
        },
        {
          name: game.actors.get(bId).name,
          actorId: bId,
          actorLink: true,
          x: 300, y: 100,
          width: 1, height: 1
        }
      ]);
      await scene.view();
      return scene.id;
    }, { aId: createdActorIds[0], bId: createdActorIds[1], suf: suffix });
    expect(createdSceneId).toBeTruthy();

    // Jump the counter to 3 so the next advance crosses into cyclePos ===
    // maxTurns === 4 and fires the grind branch at grind-tracker.mjs L344.
    // We bypass the HUD input — the handler only cares about the setting.
    await page.evaluate(async () => {
      await game.settings.set('tb2e', 'grindTurn', 3);
    });

    // Snapshot the chat-message set BEFORE advancing so we can isolate any
    // cards posted by this advance. The shared worker world may have stale
    // messages from earlier specs; filtering by "messages-after-minus-
    // messages-before" gives us just the batch this call produced.
    const preMessageIds = await page.evaluate(
      () => game.messages.contents.map(m => m.id)
    );

    // Advance via the POM so the button-click wiring is exercised end to
    // end (not just a direct settings write).
    await tracker.open();
    await tracker.advanceTurn();

    // Settings write lands inside the handler; poll for the counter to
    // cross to 4, which proves the handler finished (including the
    // ChatMessage.create above the settings write at L354 vs L358).
    await expect
      .poll(() => tracker.getTurnFromSettings(), { timeout: 10_000 })
      .toBe(4);

    // Collect the messages added by this advance. The grind branch posts
    // EXACTLY ONE card with `flags.tb2e.grindCondition === true` — that's
    // the consolidated contract. A regression that posts one card per
    // actor would show up here as length === 2.
    const newGrindMessageIds = await page.evaluate((preIds) => {
      const preSet = new Set(preIds);
      return game.messages.contents
        .filter(m => !preSet.has(m.id))
        .filter(m => m.getFlag('tb2e', 'grindCondition') === true)
        .map(m => m.id);
    }, preMessageIds);

    createdMessageIds = newGrindMessageIds;
    expect(newGrindMessageIds).toHaveLength(1);

    const grindMessageId = newGrindMessageIds[0];

    // Assert the consolidated shape (grind-tracker.mjs L398). Both actors
    // (with `hungry=false` baselines) must appear in `entries`, both with
    // `condKey: 'hungry'` (first-missing in GRIND_ORDER L3) and unapplied.
    const flags = await page.evaluate((mid) => {
      const m = game.messages.get(mid);
      return {
        grindCondition: m.getFlag('tb2e', 'grindCondition'),
        turn: m.getFlag('tb2e', 'turn'),
        entries: m.getFlag('tb2e', 'entries')
      };
    }, grindMessageId);

    expect(flags.grindCondition).toBe(true);
    expect(flags.turn).toBe(4);
    expect(flags.entries).toHaveLength(2);

    // Sort by actorId for deterministic comparison (the advance handler
    // iterates `game.actors`, which is effectively insertion order but
    // not contractually stable across Foundry versions).
    const sortedEntries = [...flags.entries].sort(
      (x, y) => x.actorId.localeCompare(y.actorId)
    );
    const expectedEntries = [...createdActorIds]
      .sort((x, y) => x.localeCompare(y))
      .map(id => ({ actorId: id, condKey: 'hungry', applied: false }));
    expect(sortedEntries).toEqual(expectedEntries);

    // Assert the template shape consumed the batched entries: one
    // `.grind-entry[data-actor-id]` per entry AND a single "Apply All"
    // button (grind-consolidated.hbs L13 and L30-36). The DOM lives inside
    // the chat log at `#chat-message-<messageId>` — Foundry v13 renders
    // messages as `<li id="chat-message-{id}">` inside `#chat-log`.
    const cardLocator = page.locator(`[data-message-id="${grindMessageId}"]`).first();
    await expect(cardLocator).toBeVisible();

    // One entry row per actor. Use the data-actor-id selector to avoid
    // matching any unrelated `.grind-entry` in other messages.
    for ( const aId of createdActorIds ) {
      await expect(
        cardLocator.locator(`.grind-entry[data-actor-id="${aId}"]`)
      ).toHaveCount(1);
    }

    // Exactly one "Apply All" affordance across the consolidated card.
    await expect(
      cardLocator.locator('[data-action="applyAllGrindConditions"]')
    ).toHaveCount(1);

    // And exactly one "Apply" button per unapplied entry (2 in this case).
    await expect(
      cardLocator.locator('[data-action="applyGrindCondition"]')
    ).toHaveCount(2);
  });
});
