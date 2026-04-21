import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { ActorsSidebar } from '../pages/ActorsSidebar.mjs';
import { CreateDocumentDialog } from '../pages/CreateDocumentDialog.mjs';
import { NPCSheet } from '../pages/NPCSheet.mjs';
import { getActorByName } from '../helpers/game.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

test.describe('NPC creation', () => {
  test('GM creates a new NPC actor from the sidebar', async ({ page }) => {
    const name = `E2E NPC ${Date.now()}`;

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
    await dialog.selectType('npc');
    await dialog.submit();

    const sheet = new NPCSheet(page, name);
    await sheet.expectOpen();

    const created = await getActorByName(page, name);
    expect(created).not.toBeNull();
    expect(created.type).toBe('npc');
  });
});
