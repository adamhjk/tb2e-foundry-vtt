import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';
import { RollDialog } from '../pages/RollDialog.mjs';
import { RollChatCard } from '../pages/RollChatCard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §11 Nature Crisis (DH p.119) — deep shape of the nature-crisis chat card
 * emitted when a post-roll nature tax drops `system.abilities.nature.rating`
 * to 0. The tax-to-0 TRIGGER path is already covered by
 * `tests/e2e/roll/nature-tax-decrement.spec.mjs` (§3, see "tax decrement to
 * rating=0 emits a nature-crisis chat card" — which intentionally stops at a
 * smoke-level "card was posted" assertion); this spec asserts the card
 * template's DOM + flag shape that the trigger spec deferred.
 *
 * Production sources cited:
 *   - `module/dice/post-roll.mjs` `_postNatureCrisis` (lines 600-632) — the
 *     ChatMessage.create() call that stamps:
 *       flags.tb2e.natureCrisis = true
 *       flags.tb2e.actorId      = actor.id
 *     and the template invocation:
 *       actorName, actorImg, actorId, crisisTitle, crisisText,
 *       eligibleTraits, hasTraits, selectTraitLabel, newTraitLabel,
 *       confirmLabel
 *   - `templates/chat/nature-crisis.hbs` — the pending-crisis branch
 *     (`{{else}}` of `{{#if resolved}}`) renders:
 *       `.tb2e-chat-card.card-accent--amber[data-actor-id]`
 *       `.card-header img.card-portrait`
 *       `.card-header .card-name` (actor name)
 *       `.card-header .card-label` (crisisTitle — "{name}'s Nature Crumbles")
 *       `.card-body p.crisis-text` (crisisText — DH p.119 instructions)
 *       `.crisis-form` with a `.crisis-trait-select <select>` including one
 *         `<option value="">—</option>` placeholder and one `<option>` per
 *         non-class trait, `.crisis-new-name` input, and
 *         `button.nature-crisis-confirm`.
 *     The resolved branch is NOT asserted here — that's §11's next checkbox
 *     (recovery / resolve — line 344).
 *   - `lang/en.json`:
 *       TB2E.Nature.Crisis          = "{name}'s Nature Crumbles"
 *       TB2E.Nature.CrisisText      = "Nature has been taxed to 0! Choose …"
 *       TB2E.Nature.SelectTrait     = "Select trait to replace"
 *       TB2E.Nature.NewTraitName    = "New trait name"
 *       TB2E.Nature.ConfirmCrisis   = "Confirm Change"
 *
 * Dice determinism: same pattern as §3 — stub `CONFIG.Dice.randomUniform =
 * () => 0.001` so every d6 rolls face 6 (success). Actor is built with
 * Will 2 + Nature 1, Ob 2 → 3D channeled pool, all-6s → clear PASS →
 * `calculateNatureTax` (roll-utils.mjs line 69) returns 1 on pass →
 * rating 1 → 0 → `_postNatureCrisis` runs.
 *
 * Scope (narrow, per briefing):
 *   - DO assert DOM + flag shape of the pending crisis card.
 *   - DO assert nature.rating is now 0 and nature.max is UNCHANGED
 *     (crisis does NOT mutate max until resolve — that's the confirm-button
 *     path in `activateNatureCrisisListeners` post-roll.mjs line 671-677).
 *   - DO NOT click the crisis-confirm button or exercise recovery — those
 *     belong to `tests/e2e/nature/recovery.spec.mjs` (next checkbox).
 *   - DO NOT re-test the tax trigger — the §3 spec has it.
 */
test.describe('§11 Nature Crisis — triggered chat card shape (DH p.119)', () => {
  test.afterEach(async ({ page }) => {
    // Restore PRNG so subsequent specs on a shared Page get real randomness.
    // Same pattern as nature-tax-decrement.spec.mjs.
    await page.evaluate(() => {
      if (globalThis.__tb2eE2EPrevRandomUniform) {
        CONFIG.Dice.randomUniform = globalThis.__tb2eE2EPrevRandomUniform;
        delete globalThis.__tb2eE2EPrevRandomUniform;
      }
    });
  });

  test('posts a pending nature-crisis card with full DOM + flag shape when tax lands nature at 0 (DH p.119)', async ({ page }) => {
    const actorName = `E2E Nature Crisis Trigger ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Nature rating=1 so the -1 tax on pass lands at 0 → crisis. Max=4 so
    // the recovery spec has a nontrivial ceiling (rating 0 → max 3 post-
    // resolve, per `_postNatureCrisis` resolve path at post-roll.mjs
    // line 671-677). Two non-class traits so the select renders MULTIPLE
    // real options (not just the placeholder), and one class trait that
    // MUST be filtered out (post-roll.mjs line 609: filter(t => t.name
    // && !t.isClass)).
    const { actorId, nonClassTraitIds } = await page.evaluate(async (n) => {
      const actor = await Actor.create({
        name: n,
        type: 'character',
        system: {
          abilities: {
            will:   { rating: 2, pass: 0, fail: 0 },
            health: { rating: 3, pass: 0, fail: 0 },
            nature: { rating: 1, max: 4, pass: 0, fail: 0 }
          },
          persona: { current: 1, spent: 0 },
          fate:    { current: 0, spent: 0 },
          conditions: { fresh: false }
        }
      });
      const traits = await actor.createEmbeddedDocuments('Item', [
        { name: 'Stubborn', type: 'trait', system: { level: 1, beneficial: 0, checks: 0, isClass: false } },
        { name: 'Curious',  type: 'trait', system: { level: 2, beneficial: 0, checks: 0, isClass: false } },
        // Class traits are filtered out of eligibleTraits — asserting via
        // the select's option count below verifies this branch.
        { name: 'Ranger',   type: 'trait', system: { level: 1, beneficial: 0, checks: 0, isClass: true } }
      ]);
      return {
        actorId: actor.id,
        nonClassTraitIds: traits.filter(t => !t.system.isClass).map(t => t.id)
      };
    }, actorName);
    expect(actorId).toBeTruthy();
    expect(nonClassTraitIds).toHaveLength(2);

    // Stub: every d6 rolls 6 (success). With Will 2 + Nature 1 = 3D vs Ob 2
    // → 3 successes → PASS → calculateNatureTax on pass returns 1.
    await page.evaluate(() => {
      globalThis.__tb2eE2EPrevRandomUniform = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => 0.001;
    });

    await page.evaluate((id) => {
      game.actors.get(id).sheet.render(true);
    }, actorId);

    const sheet = new CharacterSheet(page, actorName);
    await sheet.expectOpen();
    await sheet.openAbilitiesTab();

    const initialChatCount = await page.evaluate(() => game.messages.contents.length);

    await sheet.rollAbilityRow('will').click();

    const dialog = new RollDialog(page);
    await dialog.waitForOpen();

    // Channel Nature: +natureRating (1) dice → 2+1 = 3D pool.
    await dialog.toggleChannelNature();
    await dialog.fillObstacle(2);
    await dialog.submit();

    await expect
      .poll(() => page.evaluate(() => game.messages.contents.length), { timeout: 10_000 })
      .toBeGreaterThan(initialChatCount);

    const card = new RollChatCard(page);
    await card.expectPresent();
    await expect(card.natureTaxPrompt).toBeVisible();

    // Capture the chat-message count BEFORE clicking nature-no so we can
    // poll for the crisis card as a new message (separate from the roll
    // card's re-render, which only updates existing content).
    const beforeCrisisMsgCount = await page.evaluate(() => game.messages.contents.length);

    await card.clickNatureTaxNo();

    // Step 1: the actor's nature rating is now 0 (post-roll.mjs line 345
    // `newNature = max(0, current - tax)` → max(0, 1 - 1) = 0).
    await expect
      .poll(() =>
        page.evaluate((id) => game.actors.get(id).system.abilities.nature.rating, actorId)
      )
      .toBe(0);

    // Step 2: max is UNCHANGED at 4. `_handleNatureTax` writes only
    // `abilities.nature.rating` (post-roll.mjs line 347) — `max` is only
    // touched by the resolve path (`activateNatureCrisisListeners`
    // post-roll.mjs line 671-677) which this spec does NOT exercise.
    const natureAfterTax = await page.evaluate((id) => {
      const n = game.actors.get(id).system.abilities.nature;
      return { rating: n.rating, max: n.max, pass: n.pass, fail: n.fail };
    }, actorId);
    expect(natureAfterTax).toEqual({ rating: 0, max: 4, pass: 0, fail: 0 });

    // Step 3: a new chat message was posted — the crisis card
    // (ChatMessage.create at post-roll.mjs line 626).
    await expect
      .poll(() => page.evaluate(() => game.messages.contents.length), { timeout: 10_000 })
      .toBeGreaterThan(beforeCrisisMsgCount);

    // Step 4: flag shape — locate the crisis message by actor-scoped
    // filter so parallel workers / prior tests on the shared Page don't
    // pollute the query.
    const crisisFlags = await page.evaluate((id) => {
      const msgs = game.messages.contents
        .filter(msg => msg.flags?.tb2e?.natureCrisis && msg.flags?.tb2e?.actorId === id);
      if (!msgs.length) return null;
      const m = msgs.at(-1);
      return {
        count: msgs.length,
        natureCrisis: !!m.flags.tb2e.natureCrisis,
        actorId: m.flags.tb2e.actorId,
        // Crisis is NOT resolved yet — `activateNatureCrisisListeners`
        // writes `flags.tb2e.crisisResolved: true` only after the
        // confirm button is clicked (post-roll.mjs line 680). The
        // pending branch of the template relies on `{{#if resolved}}`
        // being falsy to render the crisis form.
        crisisResolved: m.flags.tb2e.crisisResolved ?? null,
        hasContent: typeof m.content === 'string' && m.content.length > 0,
        messageId: m.id
      };
    }, actorId);
    expect(crisisFlags).toEqual({
      count: 1,
      natureCrisis: true,
      actorId,
      crisisResolved: null,
      hasContent: true,
      messageId: expect.any(String)
    });

    // Step 5: DOM shape of the crisis card. Scope to the unique message id
    // to avoid matching the roll card or any other rendered .tb2e-chat-card.
    // Foundry V13 emits `<li class="chat-message" data-message-id="<id>">`
    // as the outer wrapper, and the template's own `data-actor-id` attr is
    // the natural scoping boundary inside it. V13 renders each message
    // BOTH in the sidebar tab AND the popout notifications area (same
    // id/content) — `.first()` pins to a single instance (the POMs do the
    // same thing, see RollChatCard).
    const crisisCard = page.locator(
      `.chat-message[data-message-id="${crisisFlags.messageId}"] .tb2e-chat-card[data-actor-id="${actorId}"]`
    ).first();
    await expect(crisisCard).toBeVisible();
    // Amber accent class on the root (template line 1).
    await expect(crisisCard).toHaveClass(/card-accent--amber/);

    // Header — actor name + crisis title ("{name}'s Nature Crumbles",
    // lang TB2E.Nature.Crisis line 707 of en.json).
    await expect(crisisCard.locator('.card-header .card-name')).toHaveText(actorName);
    await expect(crisisCard.locator('.card-header .card-label')).toHaveText(
      `${actorName}'s Nature Crumbles`
    );
    // Portrait is rendered — it points at actor.img (default placeholder
    // for a blank actor is `icons/svg/mystery-man.svg`, but we don't pin
    // to a literal path here; just assert presence + non-empty src).
    const portraitSrc = await crisisCard.locator('.card-header img.card-portrait').getAttribute('src');
    expect(portraitSrc).toBeTruthy();

    // Body — crisis text string is the full localized rule-intent message
    // from lang/en.json (TB2E.Nature.CrisisText). Match substring to stay
    // resilient to i18n tweaks while still verifying rule content.
    const crisisText = await crisisCard.locator('.card-body p.crisis-text').innerText();
    expect(crisisText).toContain('Nature has been taxed to 0');
    expect(crisisText).toContain('non-class trait');
    expect(crisisText).toContain('Maximum Nature is reduced by 1');

    // Form — select + new-name input + confirm button.
    const form = crisisCard.locator('.crisis-form');
    await expect(form).toBeVisible();

    // Select: one placeholder `<option value="">—</option>` + one option
    // per non-class trait. Class traits are filtered out by
    // post-roll.mjs line 609 — so "Ranger" (isClass:true) must NOT appear.
    const options = form.locator('.crisis-trait-select option');
    await expect(options).toHaveCount(3); // placeholder + 2 non-class traits
    // Read both the `value` DOM property and the attribute map. The
    // template emits `<option value="">—</option>` at line 34, and
    // `<option value="{{itemId}}">{{name}} (L{{level}})</option>` at
    // line 36. HTMLOptionElement peculiarities:
    //   - The browser may strip an empty `value=""` attribute when
    //     parsing, so `getAttribute("value")` returns null for the
    //     placeholder on some engines.
    //   - `option.value` falls back to the option's trimmed text when
    //     the attribute is empty/absent (WHATWG spec), so on the
    //     placeholder `.value === "—"` rather than "".
    // The reliable way to distinguish the placeholder from trait options
    // is: the trait options have a non-null `value` attribute whose
    // string equals an existing itemId, so we check attribute-set vs
    // attribute-null separately.
    const allOpts = await options.evaluateAll(os => os.map(o => ({
      attrValue: o.getAttribute('value'),
      propValue: o.value,
      label: o.textContent.trim()
    })));
    // Placeholder: attribute is absent OR empty string; label is "—".
    expect(allOpts[0].label).toBe('—');
    expect(allOpts[0].attrValue === null || allOpts[0].attrValue === '').toBe(true);
    // Non-placeholder options — the filter order matches the actor's
    // itemTypes.trait order (post-roll.mjs line 601), which for a freshly
    // created actor with `createEmbeddedDocuments` follows insertion order.
    const traitOpts = allOpts.slice(1).map(o => ({
      value: o.attrValue,
      label: o.label
    }));
    expect(traitOpts).toEqual(expect.arrayContaining([
      { value: nonClassTraitIds[0], label: 'Stubborn (L1)' },
      { value: nonClassTraitIds[1], label: 'Curious (L2)' }
    ]));
    // Negative assertion: no option for the class trait "Ranger" — it's
    // filtered out by post-roll.mjs line 609 `filter(t => t.name && !t.isClass)`.
    for (const opt of allOpts) {
      expect(opt.label).not.toContain('Ranger');
    }

    // New-trait-name input. Placeholder is a plain-text rule-flavor hint
    // (template line 42 — hard-coded to "Pariah, Odd, Faded...").
    const newNameInput = form.locator('input.crisis-new-name');
    await expect(newNameInput).toBeVisible();
    await expect(newNameInput).toHaveAttribute('type', 'text');
    await expect(newNameInput).toHaveValue('');

    // Confirm button — carries the `.nature-crisis-confirm` class that
    // `activateNatureCrisisListeners` (post-roll.mjs line 644) looks for.
    const confirmBtn = form.locator('button.nature-crisis-confirm');
    await expect(confirmBtn).toBeVisible();
    await expect(confirmBtn).toContainText('Confirm Change');

    // Resolved branch must NOT be rendered — the {{#if resolved}} in the
    // template (line 10) only lights up after the resolve handler runs.
    await expect(crisisCard.locator('.crisis-resolved')).toHaveCount(0);
    await expect(crisisCard.locator('.card-banner.banner-amber')).toHaveCount(0);

    // Cleanup: deleting the actor also removes the sheet + associated
    // embedded items. The crisis message remains in the chat log, scoped
    // by actorId to our Date.now() suffix, and is harmless for subsequent
    // specs (they filter by their own actorId).
    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });
});
