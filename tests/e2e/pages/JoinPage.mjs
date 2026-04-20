import { expect } from '@playwright/test';

export class JoinPage {
  constructor(page) {
    this.page = page;
    this.form = page.locator('#join-game-form');
    this.userSelect = this.form.locator('select[name="userid"]');
    this.passwordInput = this.form.locator('input[name="password"]');
    this.joinButton = page.getByRole('button', { name: /join game session/i });
  }

  async goto() {
    await this.page.goto('/');
    await expect(this.form).toBeVisible();
  }

  async joinAs(userName, password = '') {
    await this.userSelect.selectOption({ label: userName });
    if (password) await this.passwordInput.fill(password);
    await this.joinButton.click();
  }
}
