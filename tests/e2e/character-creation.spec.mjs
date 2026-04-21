import { test, expect } from './test.mjs';
import { GameUI } from './pages/GameUI.mjs';
import { ActorsSidebar } from './pages/ActorsSidebar.mjs';
import { CreateDocumentDialog } from './pages/CreateDocumentDialog.mjs';
import { CharacterSheet } from './pages/CharacterSheet.mjs';
import { getActorByName } from './helpers/game.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

test.describe('Character creation', () => {
  test('GM creates a new character actor from the sidebar', async ({ page }) => {
    const name = `E2E Hero ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    const sidebar = new ActorsSidebar(page);
    await sidebar.open();
    await sidebar.clickCreateActor();

    const dialog = new CreateDocumentDialog(page);
    await dialog.waitForOpen();
    await dialog.fillName(name);
    await dialog.selectType('character');
    await dialog.submit();

    const sheet = new CharacterSheet(page, name);
    await sheet.expectOpen();
    await expect(sheet.nameInput).toHaveValue(name);

    const created = await getActorByName(page, name);
    expect(created).not.toBeNull();
    expect(created.type).toBe('character');
  });
});
