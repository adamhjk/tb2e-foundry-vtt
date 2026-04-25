import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §X Camp Actor — Phase B: data model, sheet, prototype token.
 *
 * Implementation map:
 *   - Data model: `module/data/actor/camp.mjs` (`CampData`) registered in
 *     `module/data/actor/_module.mjs:config.camp`.
 *   - `system.json` lists `camp` under `documentTypes.Actor`.
 *   - Sheet: `module/applications/actor/camp-sheet.mjs` (`CampSheet`),
 *     registered via `DocumentSheetConfig.registerSheet` in `tb2e.mjs`
 *     init for `types: ["camp"]`.
 *   - `preCreateActor` hook in `tb2e.mjs` sets the camping-tent icon and
 *     `actorLink: true` on the prototype token (SG p. 91 — "The game master
 *     notes the camp and its amenities on the map").
 *
 * Rules citations:
 *   - SG p. 91 — amenities persist; camp is a map-pinned location.
 *   - SG p. 93 — dwarven-made toggle feeds outcast bonus.
 *   - SG p. 93 — disastersThisAdventure counter for the cumulative -1 penalty.
 *
 * Clean up after the test — we create actors and must remove them so the
 * shared world stays pristine for subsequent specs.
 */
test.describe('§X Camp Actor (Phase B)', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(async () => {
      const campActors = game.actors.filter(a => a.type === "camp");
      for ( const a of campActors ) await a.delete();
    });
  });

  test('creates a camp actor with the schema defaults and linked camping-tent token', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    const result = await page.evaluate(async () => {
      const actor = await Actor.create({ name: "The Overlook", type: "camp" });
      return {
        id:                     actor.id,
        type:                   actor.type,
        img:                    actor.img,
        systemType:             actor.system.type,
        defaultDanger:          actor.system.defaultDanger,
        isDwarvenMade:          actor.system.isDwarvenMade,
        amenityShelter:         actor.system.amenities.shelter,
        amenityConcealment:     actor.system.amenities.concealment,
        amenityWater:           actor.system.amenities.water,
        disastersThisAdventure: actor.system.disastersThisAdventure,
        visitsLength:           actor.system.visits.length,
        persistentEventsLength: actor.system.persistentEvents.length,
        notes:                  actor.system.notes,
        tokenActorLink:         actor.prototypeToken.actorLink,
        tokenTextureSrc:        actor.prototypeToken.texture.src
      };
    });

    expect(result.type).toBe("camp");
    expect(result.img).toContain("camping-tent");
    expect(result.systemType).toBe("wilderness");   // CampData default
    expect(result.defaultDanger).toBe("typical");   // CampData default
    expect(result.isDwarvenMade).toBe(false);
    expect(result.amenityShelter).toBe(false);
    expect(result.amenityConcealment).toBe(false);
    expect(result.amenityWater).toBe(false);
    expect(result.disastersThisAdventure).toBe(0);
    expect(result.visitsLength).toBe(0);
    expect(result.persistentEventsLength).toBe(0);
    expect(result.notes).toBe("");

    // Prototype token is document-linked with the camp icon (SG p. 91 map pin).
    expect(result.tokenActorLink).toBe(true);
    expect(result.tokenTextureSrc).toContain("camping-tent");
  });

  test('opens the CampSheet with amenities toggles, disaster reset, notes', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Create actor + open sheet.
    const actorId = await page.evaluate(async () => {
      const a = await Actor.create({ name: "Skogenby Barrow Entry", type: "camp" });
      await a.update({ "system.type": "ancient-ruins", "system.defaultDanger": "dangerous" });
      await a.sheet.render({ force: true });
      return a.id;
    });

    // Sheet DOM — the `tb2e sheet actor camp` classes come from
    // CampSheet.DEFAULT_OPTIONS. The body is split into header + scrollable
    // body parts (matching npc-sheet / monster-sheet).
    const sheet = page.locator('.application.tb2e.sheet.actor.camp').first();
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('.camp-header')).toBeVisible();
    await expect(sheet.locator('.camp-body.scrollable')).toBeVisible();

    // Type/danger selects reflect the post-create update.
    await expect(sheet.locator('select[name="system.type"]')).toHaveValue('ancient-ruins');
    await expect(sheet.locator('select[name="system.defaultDanger"]')).toHaveValue('dangerous');

    // Three amenity buttons, none active yet.
    const shelter     = sheet.locator('button[data-amenity="shelter"]');
    const concealment = sheet.locator('button[data-amenity="concealment"]');
    const water       = sheet.locator('button[data-amenity="water"]');
    await expect(shelter).not.toHaveClass(/\bactive\b/);
    await expect(concealment).not.toHaveClass(/\bactive\b/);
    await expect(water).not.toHaveClass(/\bactive\b/);

    // Toggle shelter; confirm the schema updates and the active class flips.
    await shelter.click();
    await expect
      .poll(() => page.evaluate((id) => game.actors.get(id).system.amenities.shelter, actorId))
      .toBe(true);
    await expect(shelter).toHaveClass(/\bactive\b/);

    // Seed disasters, then Reset.
    await page.evaluate((id) => game.actors.get(id).update({ "system.disastersThisAdventure": 3 }), actorId);
    await expect(sheet.locator('input[name="system.disastersThisAdventure"]')).toHaveValue('3');
    await sheet.locator('button[data-action="resetDisasters"]').click();
    await expect
      .poll(() => page.evaluate((id) => game.actors.get(id).system.disastersThisAdventure, actorId))
      .toBe(0);
  });

  test('fieldset legends render localized labels (no raw keys)', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    await page.evaluate(async () => {
      const a = await Actor.create({ name: 'Test', type: 'camp' });
      await a.sheet.render({ force: true });
    });

    const sheet = page.locator('.application.tb2e.sheet.actor.camp').first();
    await expect(sheet).toBeVisible();

    // Every legend must be localized text, not a raw TB2E.Camp.* key.
    const legends = await sheet.locator('fieldset legend').allTextContents();
    expect(legends.length).toBeGreaterThan(0);
    for ( const text of legends ) {
      expect(text).not.toMatch(/TB2E\./);
    }
    // Specifically verify the Site legend (which was broken before).
    expect(legends.join('\n')).toMatch(/Site/i);
  });

  test('visit history shows the resolved event name, not a raw UUID', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    await page.evaluate(async () => {
      // Fetch a real TableResult uuid so fromUuid can resolve it.
      const pack = game.packs.get('tb2e.camp-events');
      const tables = await pack.getDocuments();
      const dungeons = tables.find(t => t.name === 'Dungeons Camp Events');
      const foulVapors = [...dungeons.results].find(r => r.name.startsWith('Foul vapors'));

      const a = await Actor.create({
        name: 'Hall of the Dead',
        type: 'camp',
        system: {
          type: 'dungeons',
          visits: [{
            ts: Date.now(),
            outcome: 'ended',
            disasterKey: foulVapors.uuid,
            notes: ''
          }]
        }
      });
      await a.sheet.render({ force: true });
    });

    const sheet = page.locator('.application.tb2e.sheet.actor.camp').first();
    await expect(sheet).toBeVisible();

    const disaster = sheet.locator('.camp-sheet-visit-disaster').first();
    await expect(disaster).toBeVisible();
    const text = await disaster.textContent();
    // Shows a human label like "Foul vapors (SG p. 268)", not a uuid.
    expect(text).toContain('Foul vapors');
    expect(text).not.toContain('Compendium.');
    expect(text).not.toContain('TableResult');
  });

  test('body scrolls when content exceeds the window height', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Seed enough visit entries to overflow the body.
    await page.evaluate(async () => {
      const visits = Array.from({ length: 40 }, (_, i) => ({
        ts: Date.now() - i * 86_400_000,
        outcome: i % 3 === 0 ? 'ended' : (i % 3 === 1 ? 'averted' : 'safe'),
        disasterKey: i % 3 === 0 ? 'Cave-in (SG p. 270)' : '',
        notes: `Visit ${i}`
      }));
      const a = await Actor.create({
        name: 'Overlook',
        type: 'camp',
        system: { type: 'natural-caves', defaultDanger: 'typical', visits }
      });
      await a.sheet.render({ force: true });
    });

    const sheet = page.locator('.application.tb2e.sheet.actor.camp').first();
    await expect(sheet).toBeVisible();
    const body = sheet.locator('.camp-body.scrollable');
    await expect(body).toBeVisible();

    // The body's content must be taller than its scroll viewport, and
    // overflow-y must be `auto` (actually scrollable, not clipped).
    const scrollInfo = await body.evaluate(el => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      overflowY:    getComputedStyle(el).overflowY
    }));
    expect(scrollInfo.overflowY).toBe('auto');
    expect(scrollInfo.scrollHeight).toBeGreaterThan(scrollInfo.clientHeight);

    // Actually scroll it and verify the scroll position changed.
    await body.evaluate(el => { el.scrollTop = 300; });
    const afterScroll = await body.evaluate(el => el.scrollTop);
    expect(afterScroll).toBeGreaterThan(0);
  });
});
