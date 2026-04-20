import { expect } from '@playwright/test';

export class CreateDocumentDialog {
  constructor(page, { title = 'Create Actor', submitName = /create actor/i } = {}) {
    this.page = page;
    this.dialog = page.locator('dialog.application.dialog[open]').filter({
      has: page.locator('.window-title', { hasText: title }),
    });
    this.nameInput = this.dialog.locator('input[name="name"]');
    this.typeSelect = this.dialog.locator('select[name="type"]');
    this.submitButton = this.dialog.getByRole('button', { name: submitName });
  }

  async waitForOpen() {
    await expect(this.dialog).toBeVisible();
  }

  async fillName(name) {
    await this.nameInput.fill(name);
  }

  async selectType(type) {
    await this.typeSelect.selectOption(type);
  }

  async submit() {
    await this.submitButton.click();
    await expect(this.dialog).toBeHidden();
  }
}
