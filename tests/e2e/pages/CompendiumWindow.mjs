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

  /**
   * The search input in the compendium window's header.
   * Matches the `<input type="search">` inside `<search>` (the header
   * template binds to selector "search input"; see
   * foundry/templates/sidebar/directory/header.hbs:23 and
   * foundry/client/applications/sidebar/document-directory.mjs:132).
   */
  get searchInput() {
    return this.root.locator('search input[type="search"]');
  }

  /**
   * All rendered entry rows (includes rows the search filter has hidden via
   * inline display:none — caller should use `visibleEntryRows` to count
   * post-filter rows).
   */
  get entryRows() {
    return this.root.locator('li.directory-item[data-entry-id]');
  }

  /**
   * Entry rows currently visible (excludes rows hidden by the search filter,
   * which toggles `style.display = "none"` on non-matching items — see
   * foundry/client/applications/sidebar/document-directory.mjs:678).
   * Uses a CSS attribute selector against the inline style rather than
   * `:visible` so the count is deterministic regardless of viewport.
   */
  get visibleEntryRows() {
    return this.root.locator(
      'li.directory-item[data-entry-id]:not([style*="display: none"])'
    );
  }

  /**
   * Type a query into the search input. The input has a 200ms debounce
   * (SearchFilter default; see
   * foundry/client/applications/ux/search-filter.mjs:60), so callers must
   * wait for the filter to settle — use `expect.poll(...)` against a
   * visible-row count rather than a fixed sleep.
   */
  async search(query) {
    await this.searchInput.fill(query);
  }

  async clearSearch() {
    await this.searchInput.fill('');
  }
}
