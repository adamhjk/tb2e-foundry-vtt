import { expect } from '@playwright/test';

/**
 * Page object for the Maneuver MoS Spend Dialog (SG p.69).
 *
 * Source: `module/applications/conflict/maneuver-spend-dialog.mjs` —
 * `HandlebarsApplicationMixin(ApplicationV2)` subclass rendered as
 * `<div id="maneuver-spend-dialog" class="application ... tb2e
 * maneuver-spend-dialog">` (DEFAULT_OPTIONS L77-89).
 *
 * Trigger surface (the thing §16 L457 asserts — the dialog's mere open):
 *   - Versus resolution card (versus maneuver wins): a "spend-maneuver"
 *     button is emitted in templates/chat/versus-resolution.hbs L39-45
 *     when `showManeuverSpend` is set by `_executeVersusResolution`
 *     (versus.mjs L170-182 — winner's testContext.conflictAction ===
 *     "maneuver" and margin > 0). The button is wired in
 *     `activatePostRollListeners` (post-roll.mjs L21-27) to call
 *     `_handleManeuverSpend` (post-roll.mjs L63-107) which imports
 *     `ManeuverSpendDialog` and renders it with the winner's metadata.
 *   - Independent roll-result card (independent maneuver with successes):
 *     same post-roll.mjs path, but `args` come from the roll-card's
 *     `testContext` block. Same `.spend-maneuver` class.
 *
 * Template (templates/conflict/maneuver-spend-dialog.hbs):
 *   - `.maneuver-spend`                      content root
 *   - `.maneuver-spend-mos`                  "{{margin}} MoS" span
 *   - `.maneuver-spend-combos`               radio-list of spend combos
 *   - `input[name="combo"][value="<key>"]`   one per option (impede,
 *                                             position, disarm, rearm,
 *                                             impedePosition, impedeDisarm)
 *   - `.maneuver-spend-disarm`               target-picker (combo=disarm*)
 *   - `.maneuver-spend-rearm`                weapon-picker (combo=rearm)
 *   - `.disarm-target-select`, `.rearm-target-select`
 *   - `button[data-action="submit"]`         commit the chosen combo
 *
 * §17 (7 specs) will drive individual combos; this POM is kept minimal
 * but exposes the submit/cancel + per-combo radio + target selects up-
 * front so §17 can plug in without further reshape.
 */
export class ManeuverSpendDialog {
  /**
   * @param {import('@playwright/test').Page} page
   */
  constructor(page) {
    this.page = page;
    // DEFAULT_OPTIONS.id is "maneuver-spend-dialog" (maneuver-spend-
    // dialog.mjs L78) → ApplicationV2 emits an outer element with that
    // id. The template renders `.maneuver-spend` inside it.
    this.root = page.locator('#maneuver-spend-dialog');
    this.content = this.root.locator('.maneuver-spend');
    this.mosLabel = this.content.locator('.maneuver-spend-mos');
    this.combos = this.content.locator('input[name="combo"]');
    this.submitButton = this.content.locator(
      'button[data-action="submit"]'
    );
    this.disarmSection = this.content.locator(
      '[data-combo-section="disarm"]'
    );
    this.rearmSection = this.content.locator(
      '[data-combo-section="rearm"]'
    );
    this.disarmSelect = this.content.locator('.disarm-target-select');
    this.rearmSelect = this.content.locator('.rearm-target-select');
  }

  /** Wait for the dialog to mount. */
  async waitForOpen() {
    await expect(this.root).toBeVisible();
    await expect(this.content).toBeVisible();
  }

  /** True if the dialog is currently mounted. */
  async isOpen() {
    return (await this.root.count()) > 0;
  }

  /** Radio for a specific combo key (e.g. "impede", "position", "disarm"). */
  comboRadio(key) {
    return this.content.locator(
      `input[name="combo"][value="${key}"]`
    );
  }

  /**
   * Click a combo radio. Triggers the `change` handler (maneuver-spend-
   * dialog.mjs L200-206) which flips the hidden disarm/rearm section
   * visibility without a re-render.
   * @param {string} key
   */
  async selectCombo(key) {
    await this.comboRadio(key).check();
  }

  /**
   * Close the dialog via ApplicationV2's public API. Preferred over
   * clicking a header button because the MoS spend dialog intentionally
   * sets `window: { resizable: false, minimizable: false }` (maneuver-
   * spend-dialog.mjs L82) and the spec scope is only to open it, not to
   * spend — §17 will drive submit.
   */
  async close() {
    await this.page.evaluate(async () => {
      // `foundry.applications.instances` is a Map (Application2.mjs L512/L841);
      // use `.values()` to iterate. DEFAULT_OPTIONS.id "maneuver-spend-dialog"
      // is applied verbatim to `app.id` (no per-instance suffix since the
      // dialog doesn't pass an id override — maneuver-spend-dialog.mjs L78).
      const fa = foundry.applications.instances;
      const all = fa?.values ? Array.from(fa.values()) : Object.values(fa ?? {});
      for ( const app of all ) {
        const ctor = app?.constructor?.name ?? '';
        if ( app?.id === 'maneuver-spend-dialog'
          || ctor === 'ManeuverSpendDialog' ) {
          try { await app.close(); } catch {}
        }
      }
    });
    await expect(this.root).toHaveCount(0);
  }

  /**
   * Click the submit button — commits the currently-selected combo
   * (maneuver-spend-dialog.mjs #onSubmit L227-288). §17 will assert the
   * `system.pendingManeuverSpend` mailbox write on the combatant.
   */
  async submit() {
    await expect(this.submitButton).toBeVisible();
    await this.submitButton.click();
  }
}
