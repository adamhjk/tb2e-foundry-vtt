import { expect } from '@playwright/test';

export class CharacterSheet {
  constructor(page, actorName) {
    this.page = page;
    this.actorName = actorName;
    this.root = page
      .locator('form.application.sheet.tb2e.actor.character')
      .filter({ has: page.locator('.window-title', { hasText: `Character: ${actorName}` }) });
    this.nameInput = this.root.locator('input[name="name"]');
    // Identity tab inputs — live inside the identity tab panel, which is
    // not visible until the Identity tab is activated. Selecting by
    // `name` attribute works regardless of tab visibility.
    this.levelInput = this.root.locator('input[name="system.level"]');
    this.homeInput = this.root.locator('input[name="system.home"]');
  }

  async expectOpen() {
    await expect(this.root).toBeVisible();
  }

  /**
   * Click the Identity tab in the sheet's tab navigation.
   */
  async openIdentityTab() {
    await this.root.locator('nav.sheet-tabs a[data-tab="identity"]').click();
    await expect(this.root.locator('section[data-tab="identity"].active')).toBeVisible();
  }
}
