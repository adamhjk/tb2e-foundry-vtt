import { expect } from '@playwright/test';

export class CompendiumWindow {
  constructor(page, packName) {
    this.page = page;
    this.packName = packName;
    this.root = page.locator(`#compendium-${packName.replace(/\./g, '_')}`);
  }

  async waitForOpen() {
    await expect(this.root).toBeVisible();
  }

  entryById(id) {
    return this.root.locator(`li.directory-item[data-entry-id="${id}"]`);
  }

  entryByName(name) {
    return this.root
      .locator('li.directory-item')
      .filter({ has: this.page.locator('.entry-name', { hasText: name }) });
  }
}
