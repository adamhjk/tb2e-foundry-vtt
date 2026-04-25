import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §X Camp Events chat card (Phase B3).
 *
 * Implementation map:
 *   - `module/documents/loot-table.mjs` intercepts `.draw()` for both
 *     `tb2e.loot-tables` and `tb2e.camp-events` packs via a `TB2E_PACK_KINDS`
 *     dispatcher. The camp-event kind swaps the header label to
 *     "Camp Event" + `fa-campground` and the footer banner to
 *     "Camp is made" + `fa-fire-flame-curved`.
 *   - `templates/chat/loot-draw.hbs` reads `kind`, `labelIcon`, `labelKey`,
 *     `bannerIcon`, `bannerKey` from context. Same template for both packs.
 *
 * Rules citation — this is a visual-behavior test enforcing the plan §2
 * "Chat card — reuse the loot-draw style".
 */
test.describe('§X Camp Events chat card (Phase B3)', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(async () => {
      const ours = game.messages.filter(m => m.getFlag('tb2e', 'campEventDraw') || m.getFlag('tb2e', 'lootDraw'));
      for ( const m of ours ) await m.delete();
    });
  });

  test('drawing a camp events table posts a tb2e amber card labelled "Camp Event"', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Force a specific 3d6 total via a pre-built Roll instance and draw.
    await page.evaluate(async () => {
      const pack = game.packs.get('tb2e.camp-events');
      const docs = await pack.getDocuments();
      const natural = docs.find(d => d.name === 'Natural Caves Camp Events');
      // Roll exactly 11 — forcing a Safe camp result.
      const forced = new Roll('11');
      await forced.evaluate();
      await natural.draw({ roll: forced });
    });

    // Chat card renders with camp-event variant class.
    const card = page.locator('.tb2e-chat-card.loot-card.loot-card--camp-event').last();
    await expect(card).toBeVisible();
    await expect(card).toHaveClass(/card-accent--amber/);

    // Header label reads "Camp Event" with the campground icon.
    const label = card.locator('.card-label');
    await expect(label).toHaveText(/Camp Event/);
    await expect(label.locator('i.fa-campground')).toBeVisible();

    // Footer banner swapped to the camp variant.
    const banner = card.locator('.card-banner.banner-amber');
    await expect(banner).toHaveText(/Camp is made/);
    await expect(banner.locator('i.fa-fire-flame-curved')).toBeVisible();

    // The flag differentiates camp-event draws from loot draws — downstream
    // handlers can gate on this.
    const flagged = await page.evaluate(() => {
      const last = game.messages.contents.at(-1);
      return {
        campEventDraw: last?.getFlag('tb2e', 'campEventDraw'),
        lootDraw:      last?.getFlag('tb2e', 'lootDraw')
      };
    });
    expect(flagged.campEventDraw).toBe(true);
    expect(flagged.lootDraw).toBeFalsy();
  });

  test('disaster draw via subtable still renders the full chain trace + Disaster banner', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Force total = 4 → Dungeons row "Curiosity" (subtable). The 1d6
    // creature subtable produces Black Dragon / Troll haunt / Stone spider
    // / Owlbear — any of them works for chain-trace shape verification.
    await page.evaluate(async () => {
      window.__rollForceInstalled = true;
      const orig = Roll.prototype.evaluate;
      Roll.prototype.evaluate = async function() {
        await orig.call(this);
        if ( this.dice.length === 1 && this.dice[0].number === 3 && this.dice[0].faces === 6 ) {
          this.dice[0].results = [{ result: 1, active: true },
                                   { result: 1, active: true },
                                   { result: 2, active: true }];
          this._total = 4;
        }
        return this;
      };

      const s = await import('/systems/tb2e/module/data/camp/state.mjs');
      for ( const a of [...game.actors] ) {
        if ( a.type === 'camp' || a.type === 'character' ) await a.delete();
      }
      const camp = await Actor.create({ name: 'Hall', type: 'camp',
        system: { type: 'dungeons', defaultDanger: 'typical' } });
      await s.beginCamp(camp.id);
      await s.setPhase('events');
      await s.rollEvents();

      Roll.prototype.evaluate = orig;
    });

    const card = page.locator('.tb2e-chat-card.loot-card--camp-event').last();
    await expect(card).toBeVisible();

    // Chain trace: two links — Dungeons Camp Events (3d6) → Dungeon Curiosity (1d6).
    const chainLinks = card.locator('.loot-chain-link');
    await expect(chainLinks).toHaveCount(2);
    await expect(chainLinks.nth(0).locator('.loot-chain-name')).toContainText('Dungeons Camp Events');
    await expect(chainLinks.nth(0).locator('.loot-chain-formula')).toHaveText('3d6');
    await expect(chainLinks.nth(1).locator('.loot-chain-name')).toContainText('Dungeon Curiosity');
    await expect(chainLinks.nth(1).locator('.loot-chain-formula')).toHaveText('1d6');

    // Disaster banner.
    const banner = card.locator('.card-banner');
    await expect(banner).toContainText('Disaster');
    await expect(banner.locator('i.fa-triangle-exclamation')).toBeVisible();

    // Cleanup.
    await page.evaluate(async () => {
      for ( const a of [...game.actors] ) {
        if ( a.type === 'camp' ) await a.delete();
      }
    });
  });

  test('existing loot-table draws still label "Draw" with coins icon — no regression', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    await page.evaluate(async () => {
      const pack = game.packs.get('tb2e.loot-tables');
      const docs = await pack.getDocuments();
      const gear = docs.find(d => d.name === 'Gear Subtable');
      const forced = new Roll('7');
      await forced.evaluate();
      await gear.draw({ roll: forced });
    });

    const card = page.locator('.tb2e-chat-card.loot-card').last();
    await expect(card).toBeVisible();
    await expect(card).toHaveClass(/loot-card--loot/);
    const label = card.locator('.card-label');
    await expect(label).toHaveText(/Draw/);
    await expect(label.locator('i.fa-coins')).toBeVisible();
  });
});
