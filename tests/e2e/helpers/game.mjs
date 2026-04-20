/**
 * Helpers for interacting with Foundry's `game` global from Playwright.
 */

export async function waitForGameReady(page, timeout = 60_000) {
  await page.waitForFunction(() => window.game?.ready === true, null, { timeout });
}

export async function getSystemId(page) {
  return page.evaluate(() => window.game.system.id);
}

export async function getActorByName(page, name) {
  return page.evaluate((n) => {
    const actor = window.game.actors.getName(n);
    if (!actor) return null;
    return { id: actor.id, name: actor.name, type: actor.type };
  }, name);
}
