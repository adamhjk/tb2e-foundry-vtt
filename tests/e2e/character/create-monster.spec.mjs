import { test, expect } from '@playwright/test';
import { GameUI } from '../pages/GameUI.mjs';
import { ActorsSidebar } from '../pages/ActorsSidebar.mjs';
import { CreateDocumentDialog } from '../pages/CreateDocumentDialog.mjs';
import { MonsterSheet } from '../pages/MonsterSheet.mjs';
import { getActorByName } from '../helpers/game.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

test.describe('Monster creation', () => {
  test('GM creates a new monster actor from the sidebar', async ({ page }) => {
    const name = `E2E Monster ${Date.now()}`;

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
    await dialog.selectType('monster');
    await dialog.submit();

    const sheet = new MonsterSheet(page, name);
    await sheet.expectOpen();

    const created = await getActorByName(page, name);
    expect(created).not.toBeNull();
    expect(created.type).toBe('monster');
  });
});
