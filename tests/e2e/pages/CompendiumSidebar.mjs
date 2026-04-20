export class CompendiumSidebar {
  constructor(page) {
    this.page = page;
    this.tab = page.getByRole('tab', { name: 'Compendium Packs', exact: true });
  }

  async open() {
    await this.tab.click();
  }

  packEntry(packName) {
    return this.page.locator(`[data-pack="${packName}"]`);
  }

  async openPack(packName) {
    const entry = this.packEntry(packName);
    await entry.locator('a[data-action="activateEntry"]').click();
  }
}
