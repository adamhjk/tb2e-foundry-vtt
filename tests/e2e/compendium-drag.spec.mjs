import { test, expect } from '@playwright/test';
import { GameUI } from './pages/GameUI.mjs';
import { ActorsSidebar } from './pages/ActorsSidebar.mjs';
import { CompendiumSidebar } from './pages/CompendiumSidebar.mjs';
import { CompendiumWindow } from './pages/CompendiumWindow.mjs';
import { CharacterSheet } from './pages/CharacterSheet.mjs';
import { getActorByName } from './helpers/game.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

test.describe('Compendium drag-drop', () => {
  test('drag Gerald from Iconic Characters into the Actors directory', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    const compSidebar = new CompendiumSidebar(page);
    await compSidebar.open();
    await compSidebar.openPack('tb2e.iconic-characters');

    const compWindow = new CompendiumWindow(page, 'tb2e.iconic-characters');
    await compWindow.waitForOpen();

    const actors = new ActorsSidebar(page);
    await actors.open();

    const geraldEntry = compWindow.entryByName('Gerald');
    await expect(geraldEntry).toBeVisible();
    await expect(actors.directoryList).toBeVisible();

    await geraldEntry.dragTo(actors.directoryList);

    await expect
      .poll(() => getActorByName(page, 'Gerald'), { timeout: 10_000 })
      .not.toBeNull();

    const created = await getActorByName(page, 'Gerald');
    expect(created.type).toBe('character');

    await actors.entry('Gerald').locator('.entry-name').click();

    const sheet = new CharacterSheet(page, 'Gerald');
    await sheet.expectOpen();
    await expect(sheet.nameInput).toHaveValue('Gerald');
  });
});
