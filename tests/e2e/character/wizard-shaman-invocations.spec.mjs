import { test, expect } from '@playwright/test';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterWizard } from '../pages/CharacterWizard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * Character creation wizard — Shaman / human branch with rollRelics.
 *
 * The Shaman (LMM p.11) is a religious class that receives starting
 * relics and invocations from a 3d6 roll on `SHAMAN_RELIC_TABLE`
 * (chargen.mjs). On the gear step the wizard exposes a "Roll Relics"
 * button whose handler (`#onRollRelics` in character-wizard.mjs) rolls
 * 3d6, looks up the entry in the class-appropriate table (Shaman vs.
 * Theurge, selected by `state.class === "shaman"`), stores
 * `state.relics` + `state.invocations`, and posts the roll to chat.
 *
 * On Finish, the wizard walks those two arrays and imports each named
 * item from the `tb2e.shamanic-relics` / `tb2e.shamanic-invocations`
 * compendiums as embedded items on the character actor (fallback to a
 * stub `type: relic`/`invocation` if the compendium lookup misses —
 * see the shaman branch of `#applyToActor`).
 *
 * Because the 3d6 roll is non-deterministic, this spec asserts shape
 * invariants only (counts, types, that every rolled name appears in
 * the table's value set). It does NOT assert specific relic or
 * invocation names — every table entry has exactly 2 relics + 2
 * invocations (3-18 inclusive), so the count invariant is stable
 * (mirrors the Theurge table's 3d6 shape; both use the same wizard
 * button + badge DOM).
 *
 * Chosen build, rationale:
 *   - Class: shaman — triggers the shaman relic branch we want to
 *     cover. CLASS_DEFS.shaman matches theurge in structure: stocks
 *     ["human", "changeling"], distributed 8 abilities, autoLeather
 *     false, helmet false, shield eligible.
 *   - Stock: human — shaman stocks are ["human", "changeling"]; human
 *     requires the Upbringing step (not skipped via
 *     shouldSkipUpbringing), whereas changeling also requires it but
 *     adds a Huldrekall trait we don't care about.
 *   - Upbringing: laborer — not in shaman class skills
 *     (ritualist/theologian/fighter/healer/scavenger), so fresh
 *     rating-3.
 *   - Hometown: religiousBastion — open to all stocks, thematically
 *     appropriate; we pick `cartographer` (fresh rating-2, not in
 *     class) since `theologian` would collide with the class-3 grant.
 *     Trait: Defender.
 *   - Social: manipulator — not in shaman class skills.
 *   - Specialty: dungeoneer — not in class, hometown, social, or
 *     upbringing picks so guaranteed to go in fresh at rating 2.
 *   - Wises: human has 0 required picks + 1 free slot (index 0).
 *   - Nature: all yes — human Q1/Q2/Q3 yes = +1 nature each, no
 *     secondary wise/trait choice required.
 *   - Circles: all yes.
 *   - Gear: satchel + rollRelics (asserts relic/invocation badges
 *     appear before advancing).
 *   - Weapons: Staff — in shaman's WEAPON_RESTRICTIONS list
 *     (["Dagger", "Hand Axe", "Sling", "Staff"]).
 *   - Armor: shaman has autoLeather=false and helmet=false, so the
 *     armor step renders the "no starting armor" note and has nothing
 *     to select; step-complete is inherited from weapons.
 *   - Finishing: name is the only required field.
 */

const WIZARD_ACTOR_NAME = () => `E2E Shaman ${Date.now()}`;

test.describe('Character wizard Shaman invocations', () => {
  test('Shaman / human walkthrough populates linked relics and invocations', async ({ page }) => {
    const originalName = WIZARD_ACTOR_NAME();
    const finalName = `${originalName} Varga`;
    const freeWise = 'Spirits-wise';

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Create a blank character actor directly via the game API.
    const actorId = await page.evaluate(async (n) => {
      const actor = await Actor.create({ name: n, type: 'character' });
      return actor.id;
    }, originalName);
    expect(actorId).toBeTruthy();

    // Open the wizard for this actor by constructing it directly.
    await page.evaluate(async (id) => {
      const { default: CharacterWizard } = await import(
        '/systems/tb2e/module/applications/actor/character-wizard.mjs'
      );
      const actor = game.actors.get(id);
      new CharacterWizard(actor).render(true);
    }, actorId);

    const wizard = new CharacterWizard(page, originalName);
    await wizard.expectOpen();

    // Step 1: Class & Stock ------------------------------------------------
    // Shaman has multiple stocks (human/changeling), so the class pick
    // does NOT auto-select a stock. We must click the stock button.
    await wizard.selectClass('shaman');
    await wizard.selectStock('human');
    await expect(wizard.currentStepHeading).toHaveText(/Class/i);
    await wizard.next();

    // Step 2: Upbringing (human gets this step) --------------------------
    await expect(wizard.currentStepHeading).toHaveText(/Upbringing/i);
    await wizard.selectUpbringing('laborer');
    await wizard.next();

    // Step 3: Hometown ---------------------------------------------------
    await expect(wizard.currentStepHeading).toHaveText(/Hometown/i);
    await wizard.selectHometown('religiousBastion');
    await wizard.selectHometownSkill('cartographer');
    await wizard.selectHomeTrait('Defender');
    await wizard.next();

    // Step 4: Social grace -----------------------------------------------
    await expect(wizard.currentStepHeading).toHaveText(/Social/i);
    await wizard.selectSocial('manipulator');
    await wizard.next();

    // Step 5: Specialty --------------------------------------------------
    await expect(wizard.currentStepHeading).toHaveText(/Specialty/i);
    await wizard.selectSpecialty('dungeoneer');
    await wizard.next();

    // Step 6: Wises ------------------------------------------------------
    // Human has 0 required picks but 1 free-choice slot at index 0.
    await expect(wizard.currentStepHeading).toHaveText(/Wises/i);
    await wizard.fillFreeWise(0, freeWise);
    await wizard.next();

    // Step 7: Nature -----------------------------------------------------
    // Human Q1/Q2/Q3 "yes" answers each grant +1 nature; no answer
    // requires a wise/trait secondary choice with all-yes answers.
    await expect(wizard.currentStepHeading).toHaveText(/Nature/i);
    await wizard.answerNature(0, 'yes');
    await wizard.answerNature(1, 'yes');
    await wizard.answerNature(2, 'yes');
    await wizard.next();

    // Step 8: Circles ----------------------------------------------------
    await expect(wizard.currentStepHeading).toHaveText(/Circles/i);
    await wizard.answerCircles('hasFriend', 'yes');
    await wizard.fillCirclesDetail('friend', 'Brother Ylva');
    await wizard.answerCircles('hasParents', 'yes');
    await wizard.fillCirclesDetail('parents', 'Hakon and Thora');
    await wizard.answerCircles('hasMentor', 'yes');
    await wizard.fillCirclesDetail('mentor', 'Old Mother Silva');
    await wizard.answerCircles('hasEnemy', 'yes');
    await wizard.fillCirclesDetail('enemy', 'The Hollow Shaman');
    await wizard.next();

    // Step 9: Gear + Roll Relics -----------------------------------------
    await expect(wizard.currentStepHeading).toHaveText(/Gear/i);
    await wizard.selectPackType('satchel');

    // Rolling relics is the load-bearing assertion of this spec. Every
    // SHAMAN_RELIC_TABLE entry (3-18) grants exactly 2 relics + 2
    // invocations, so after the roll both lists should be non-empty in
    // the DOM. The wizard's `#onRollRelics` dispatches to
    // SHAMAN_RELIC_TABLE based on state.class.
    await wizard.rollRelics();
    await expect(wizard.relicBadges).toHaveCount(2);
    await expect(wizard.invocationBadges).toHaveCount(2);

    // Snapshot the rolled names from the DOM so we can correlate them
    // against the compendium entries after finish.
    const rolledRelics = await wizard.relicBadges.allInnerTexts();
    const rolledInvocations = await wizard.invocationBadges.allInnerTexts();
    expect(rolledRelics).toHaveLength(2);
    expect(rolledInvocations).toHaveLength(2);

    await wizard.next();

    // Step 10: Weapons ---------------------------------------------------
    // Shaman WEAPON_RESTRICTIONS is ["Dagger", "Hand Axe", "Sling",
    // "Staff"]. Staff is thematically appropriate and always present
    // in the weapons compendium.
    await expect(wizard.currentStepHeading).toHaveText(/Weapons/i);
    await wizard.selectWeapon('Staff');
    await wizard.next();

    // Step 11: Armor -----------------------------------------------------
    // Shaman has autoLeather=false and helmet=false (same as theurge) —
    // the step renders a "no starting armor" note and is complete as
    // soon as weapons is complete.
    await expect(wizard.currentStepHeading).toHaveText(/Armor/i);
    await wizard.next();

    // Step 12: Finishing -------------------------------------------------
    await expect(wizard.currentStepHeading).toHaveText(/Finishing/i);
    await wizard.fillFinishing('name', finalName);
    await wizard.fillFinishing('belief', 'The old spirits still walk with those who listen.');
    await wizard.fillFinishing('instinct', 'Always leave an offering at a crossroads.');
    await wizard.fillFinishing('raiment', 'Patchwork hides and bone-charm necklace, ash on the brow.');
    await wizard.fillFinishing('age', 22);

    await wizard.finish();
    await wizard.expectClosed();

    // Poll until the actor reflects the updated name — the wizard
    // writes via actor.update() which resolves asynchronously.
    await expect
      .poll(() => page.evaluate((id) => game.actors.get(id)?.name ?? null, actorId))
      .toBe(finalName);

    // Also poll until the relic items are materialized. The wizard
    // creates items in a second batch after the actor update.
    await expect
      .poll(
        () =>
          page.evaluate((id) => {
            const a = game.actors.get(id);
            if ( !a ) return 0;
            return Array.from(a.items).filter((i) => i.type === 'relic').length;
          }, actorId),
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);

    const actorData = await page.evaluate((id) => {
      const actor = game.actors.get(id);
      const items = Array.from(actor.items).map((i) => ({
        name: i.name,
        type: i.type,
        relicTier: i.system?.relicTier ?? null,
        linkedInvocations: Array.isArray(i.system?.linkedInvocations)
          ? [...i.system.linkedInvocations]
          : null,
        linkedCircle: i.system?.linkedCircle ?? null,
        immortal: i.system?.immortal ?? null,
      }));
      return {
        name: actor.name,
        class: actor.system.class,
        stock: actor.system.stock,
        relicItems: items.filter((i) => i.type === 'relic'),
        invocationItems: items.filter((i) => i.type === 'invocation'),
      };
    }, actorId);

    // Class + stock.
    expect(actorData.class).toBe('shaman');
    expect(actorData.stock).toBe('human');

    // Relics: at least one relic was created. The 3d6 table always
    // yields 2 relic names, but some rolls map to relic names that
    // don't exist in the compendium — in that case the shaman branch
    // of `#applyToActor` falls back to creating a stub
    // `{ type: "relic", system: { tier: "minor" } }`. Either way we
    // expect `>= 1` relic item.
    expect(actorData.relicItems.length).toBeGreaterThanOrEqual(1);
    // Cap the count: the table yields exactly 2 relics, no more.
    expect(actorData.relicItems.length).toBeLessThanOrEqual(2);

    // Every created relic's name must match one of the names that
    // appeared in the UI after the roll (shape invariant, not
    // specific content).
    for ( const relic of actorData.relicItems ) {
      expect(rolledRelics).toContain(relic.name);
    }

    // Harvest the table's relic value-set to confirm the rolled names
    // are all legal entries (guards against drift between UI state
    // and the SHAMAN_RELIC_TABLE source-of-truth).
    const tableValidation = await page.evaluate(async () => {
      const mod = await import('/systems/tb2e/module/data/actor/chargen.mjs');
      const table = mod.SHAMAN_RELIC_TABLE;
      const allRelicNames = new Set();
      const allInvocationNames = new Set();
      for ( const entry of Object.values(table) ) {
        for ( const r of entry.relics || [] ) allRelicNames.add(r);
        for ( const i of entry.invocations || [] ) allInvocationNames.add(i);
      }
      return {
        relics: [...allRelicNames],
        invocations: [...allInvocationNames],
      };
    });
    for ( const name of rolledRelics ) {
      expect(tableValidation.relics).toContain(name);
    }
    for ( const name of rolledInvocations ) {
      expect(tableValidation.invocations).toContain(name);
    }

    // Shape invariant: relics that came from the compendium (as
    // opposed to stub fallbacks) should have a valid relicTier and
    // linked metadata. We inspect at least one relic to confirm the
    // schema is populated — but tolerate stub relics (relicTier
    // default "minor", empty linkedInvocations) if the compendium
    // lookup missed.
    //
    // A compendium-sourced relic is identified by a populated
    // `immortal` field (the stub fallback leaves it as the default
    // empty string). We check that at least one of the "real"
    // compendium matches has a sensible tier.
    const compendiumRelics = actorData.relicItems.filter((r) => r.immortal);
    for ( const relic of compendiumRelics ) {
      expect(['minor', 'named', 'great']).toContain(relic.relicTier);
      // linkedInvocations is always an array (possibly empty); if non-
      // empty, every entry should be one of the table's invocation
      // names. This verifies the compendium → rules linkage holds.
      if ( relic.linkedInvocations && relic.linkedInvocations.length > 0 ) {
        for ( const linked of relic.linkedInvocations ) {
          expect(tableValidation.invocations).toContain(linked);
        }
      }
    }

    // Invocations: at least one was created (same caveat as relics re.
    // compendium misses — but the wizard still creates a stub).
    expect(actorData.invocationItems.length).toBeGreaterThanOrEqual(1);
    expect(actorData.invocationItems.length).toBeLessThanOrEqual(2);
    for ( const inv of actorData.invocationItems ) {
      expect(rolledInvocations).toContain(inv.name);
    }

    // Class trait — Shaman's class trait is "Between Two Worlds"
    // (CLASS_DEFS.shaman.classTrait). Home trait "Defender" picked on
    // step 3.
    const traitNames = await page.evaluate((id) => {
      const a = game.actors.get(id);
      return Array.from(a.items)
        .filter((i) => i.type === 'trait')
        .map((i) => i.name);
    }, actorId);
    expect(traitNames).toContain('Between Two Worlds');
    expect(traitNames).toContain('Defender');

    // Clean up — avoid piling test actors into the world between runs.
    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });
});
