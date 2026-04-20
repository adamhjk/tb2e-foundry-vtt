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

  /**
   * Click the Abilities tab in the sheet's tab navigation.
   */
  async openAbilitiesTab() {
    await this.root.locator('nav.sheet-tabs a[data-tab="abilities"]').click();
    await expect(this.root.locator('section[data-tab="abilities"].active')).toBeVisible();
  }

  /**
   * Click the Skills tab in the sheet's tab navigation.
   */
  async openSkillsTab() {
    await this.root.locator('nav.sheet-tabs a[data-tab="skills"]').click();
    await expect(this.root.locator('section[data-tab="skills"].active')).toBeVisible();
  }

  /**
   * Rating input for a given ability key (will, health, nature, circles, resources).
   * @param {string} key
   */
  abilityRating(key) {
    return this.root.locator(`input[name="system.abilities.${key}.rating"]`);
  }

  /**
   * Max input for a given ability key. Currently only `nature` exposes a max field.
   * @param {string} key
   */
  abilityMax(key) {
    return this.root.locator(`input[name="system.abilities.${key}.max"]`);
  }

  /**
   * Rating input for a given skill key (e.g. fighter, scholar, hunter).
   * Requires the Skills tab to be active.
   * @param {string} key
   */
  skillRating(key) {
    return this.root.locator(`input[name="system.skills.${key}.rating"]`);
  }

  /**
   * Condition toggle button in the sheet's conditions strip.
   * The strip is rendered at the top of the sheet (see
   * templates/actors/character-conditions.hbs) and is always visible —
   * no tab switch required. Buttons carry `data-condition="<key>"`
   * matching the condition key (fresh, hungry, angry, afraid, exhausted,
   * injured, sick, dead).
   * @param {string} key
   */
  conditionToggle(key) {
    return this.root.locator(`nav.conditions-strip button.condition-btn[data-condition="${key}"]`);
  }
}
