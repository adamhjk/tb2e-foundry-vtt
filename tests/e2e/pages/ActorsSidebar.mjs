export class ActorsSidebar {
  constructor(page) {
    this.page = page;
    this.tab = page.getByRole('tab', { name: 'Actors', exact: true });
    this.panel = page.locator('#actors');
    this.createButton = this.panel.getByRole('button', { name: /create actor/i });
    this.directoryList = this.panel.locator('.directory-list').first();
  }

  async open() {
    await this.tab.click();
  }

  async clickCreateActor() {
    await this.createButton.click();
  }

  entry(actorName) {
    return this.directoryList
      .locator('li.directory-item')
      .filter({ has: this.page.locator('.entry-name', { hasText: actorName }) });
  }
}
