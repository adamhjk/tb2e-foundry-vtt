import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CampPanel } from '../pages/CampPanel.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §X Camp Panel — scene-aware party + auto-select-camp-on-scene.
 *
 *   - The party for a camp visit is character actors whose tokens are on
 *     the CURRENT scene and whose conflict team is "party". GM-team PCs
 *     and PCs not in the scene don't appear in the check pool / watcher
 *     list / roster.
 *   - When the GM opens the panel and a camp actor is already pinned on
 *     the current scene, the panel auto-selects that camp and lands on
 *     the Setup tab.
 */

async function resetWorld(page) {
  await page.evaluate(async () => {
    const { defaultCampState } = await import('/systems/tb2e/module/data/camp/state.mjs');
    await game.settings.set('tb2e', 'campState', defaultCampState());
    for ( const a of [...game.actors] ) {
      if ( a.type === 'camp' || a.type === 'character' ) await a.delete();
    }
    // Wipe any tokens we created earlier in the run.
    if ( canvas?.scene ) {
      const ours = canvas.scene.tokens.filter(t => t.flags?.tb2e?.testToken);
      if ( ours.length ) await canvas.scene.deleteEmbeddedDocuments(
        "Token", ours.map(t => t.id)
      );
    }
  });
}

test.describe('§X Camp Panel — scene-aware party + auto-select', () => {
  test.afterEach(async ({ page }) => { await resetWorld(page); });

  test('partyChecks lists only scene-present PCs on the player team', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);

    // Three PCs, but only 2 on the scene; one of those is on the GM team.
    await page.evaluate(async () => {
      const onScene = await Actor.create({
        name: 'Thrar', type: 'character',
        system: { checks: 2, conflict: { team: 'party' } }
      });
      const onSceneGm = await Actor.create({
        name: 'Spy', type: 'character',
        system: { checks: 1, conflict: { team: 'gm' } }
      });
      await Actor.create({
        name: 'Offstage', type: 'character',
        system: { checks: 5, conflict: { team: 'party' } }
      });
      // Place tokens on the scene (only Thrar + Spy).
      await canvas.scene.createEmbeddedDocuments("Token", [
        { actorId: onScene.id,   x: 100, y: 100, width: 1, height: 1, flags: { tb2e: { testToken: true } } },
        { actorId: onSceneGm.id, x: 200, y: 200, width: 1, height: 1, flags: { tb2e: { testToken: true } } }
      ]);
      const camp = await Actor.create({
        name: 'Hall', type: 'camp',
        system: { type: 'dungeons', defaultDanger: 'typical' }
      });
      const s = await import('/systems/tb2e/module/data/camp/state.mjs');
      await s.beginCamp(camp.id);
    });

    const panel = new CampPanel(page);
    await panel.clickToolbarButton();
    await expect(panel.root).toBeVisible();
    await expect(panel.tabButton('setup')).toHaveClass(/\bactive\b/);

    const setup = panel.root.locator('.setup-tab');
    const names = await setup.locator('.camp-setup-pc-name').allTextContents();
    // Only Thrar — Spy is on the GM team, Offstage isn't on the scene.
    expect(names).toEqual(['Thrar']);
    // Total = Thrar's 2 checks.
    await expect(setup.locator('.camp-setup-checks-total')).toContainText('2');
  });

  test('opening the panel with a camp token on the scene auto-selects it', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);

    // Pre-place a camp token on the scene; do NOT begin a camp from script.
    const seeded = await page.evaluate(async () => {
      const camp = await Actor.create({
        name: 'The Overlook', type: 'camp',
        system: { type: 'natural-caves', defaultDanger: 'unsafe' }
      });
      await canvas.scene.createEmbeddedDocuments("Token", [
        { actorId: camp.id, x: 300, y: 300, width: 1, height: 1, flags: { tb2e: { testToken: true } } }
      ]);
      return camp.id;
    });

    const panel = new CampPanel(page);
    await panel.clickToolbarButton();
    await expect(panel.root).toBeVisible();

    // Auto-selected — campState picks up the scene camp on first open
    // and advances the phase to "setup".
    await expect
      .poll(() => page.evaluate(() => game.settings.get('tb2e', 'campState').campActorId))
      .toBe(seeded);
    await expect
      .poll(() => page.evaluate(() => game.settings.get('tb2e', 'campState').phase))
      .toBe('setup');
    await expect(panel.tabButton('setup')).toHaveClass(/\bactive\b/);
    await expect(panel.root.locator('.camp-setup-site-name')).toHaveText('The Overlook');
  });
});
