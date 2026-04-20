import { test, expect } from '@playwright/test';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterWizard } from '../pages/CharacterWizard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * Character creation wizard — Magician ("Scholar" arcane caster) / human
 * branch with rollSpells.
 *
 * The Magician (DH p.26) is the arcane caster class. It is parallel in
 * shape to the Theurge / Shaman (both also religious casters), but draws
 * from `SPELL_SCHOOL_TABLE` (chargen.mjs) — a **2d6** table (not 3d6 like
 * relics) mapping to a spell school label + an array of 3 starting spell
 * names. Rolls 11-12 yield `school: "Choose"` with an empty spells list
 * so the player picks their own school in play. Rolls 2-10 each grant
 * exactly 3 spells, all of which exist in the `tb2e.spells` compendium.
 *
 * On the gear step the wizard exposes a "Roll Spells" button whose
 * handler (`#onRollSpells` in character-wizard.mjs) rolls 2d6, looks up
 * the entry in `SPELL_SCHOOL_TABLE`, stores `state.spellSchool` +
 * `state.spells`, and posts the roll to chat. The button disappears
 * after the first roll (template guards on `needsSpellRoll`) — there is
 * no re-roll path, so rolls 11-12 would leave `spells[]` empty. Because
 * the 2d6 PRNG hits 11-12 about 8% of the time, we stub
 * `CONFIG.Dice.randomUniform` to force a deterministic face before
 * clicking rollSpells. This is a **test-only** seed — it does not alter
 * the class logic under test; the wizard still dispatches through its
 * real `#onRollSpells` handler, the real table, and the real finish
 * pipeline. Seeded total = 6 → Conjuration → {Aetheric Appendage,
 * Dæmonic Stupefaction, Wyrd Lights}.
 *
 * On Finish, the wizard walks `state.spells` and imports each named item
 * from the `tb2e.spells` compendium as embedded items on the character
 * actor (magician branch of `#applyToActor`, character-wizard.mjs ~L1395).
 * Unlike the theurge/shaman branches, there is **no stub fallback** for
 * missing compendium items — spells silently drop if the lookup misses.
 * All SPELL_SCHOOL_TABLE names for rolls 2-10 exist in the compendium,
 * so with our seeded roll we expect exactly 3 spell items.
 *
 * Key differences vs. theurge/shaman specs:
 *   - Class: `magician` (not a separate "scholar" — the Scholar in the
 *     task brief is the magician arcane caster). `classTrait = "Wizard's
 *     Sight"`, `memoryPalaceSlots: 1`, `urdr: 0`, `requiresMentor: true`.
 *   - Weapon list: ["Dagger", "Staff"] — narrowest in the game.
 *   - Spell table is 2d6 (not 3d6) → 3 spells per entry (not 2).
 *   - Compendium lookup has no stub fallback — count is deterministic.
 *   - `requiresMentor: true` on the magician class hides the "self-made"
 *     circles option and prints a note — we must answer `hasMentor: yes`.
 *
 * Chosen build, rationale:
 *   - Class: magician — triggers the spell branch we want to cover.
 *   - Stock: human — magician stocks are ["human", "changeling"]; human
 *     requires the Upbringing step (not skipped), and doesn't pull in the
 *     Huldrekall trait the way changeling does.
 *   - Upbringing: laborer — not in magician class skills (arcanist,
 *     loremaster, alchemist, cartographer, scholar), so fresh rating-3.
 *   - Hometown: bustlingMetropolis — skills [haggler, sailor, steward],
 *     none of which collide with magician class skills; traits
 *     [Extravagant, Jaded]. We pick `haggler` (fresh rating-2).
 *   - Social: manipulator — not in magician class skills.
 *   - Specialty: dungeoneer — guaranteed fresh rating-2.
 *   - Wises: human has 0 required picks + 1 free slot (index 0).
 *   - Nature: all yes — human Q1/Q2/Q3 yes = +1 nature each, no
 *     secondary choice required.
 *   - Circles: all yes. magician `requiresMentor: true` so `hasMentor`
 *     must be yes (the "no" option is hidden in the template).
 *   - Gear: satchel + seeded rollSpells. Asserts 3 spell badges render.
 *   - Weapons: Staff — in magician's narrow [Dagger, Staff] list.
 *   - Armor: magician has `autoLeather: false`, `helmet: false` — the
 *     step renders a "no starting armor" note and is complete as soon
 *     as weapons is complete.
 *   - Finishing: name is the only required field.
 */

const WIZARD_ACTOR_NAME = () => `E2E Scholar ${Date.now()}`;

test.describe('Character wizard Magician spells', () => {
  test('Magician / human walkthrough populates starting spells', async ({ page }) => {
    const originalName = WIZARD_ACTOR_NAME();
    const finalName = `${originalName} Yrsa`;
    const freeWise = 'Arcana-wise';

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

    // Step 1: Class & Stock ----------------------------------------------
    // Magician has two stocks (human/changeling), so the class pick does
    // NOT auto-select a stock. We click the stock button explicitly.
    await wizard.selectClass('magician');
    await wizard.selectStock('human');
    await expect(wizard.currentStepHeading).toHaveText(/Class/i);
    await wizard.next();

    // Step 2: Upbringing (human gets this step) --------------------------
    await expect(wizard.currentStepHeading).toHaveText(/Upbringing/i);
    await wizard.selectUpbringing('laborer');
    await wizard.next();

    // Step 3: Hometown ---------------------------------------------------
    await expect(wizard.currentStepHeading).toHaveText(/Hometown/i);
    await wizard.selectHometown('bustlingMetropolis');
    await wizard.selectHometownSkill('haggler');
    await wizard.selectHomeTrait('Extravagant');
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
    // Human Q1/Q2/Q3 "yes" = +1 nature each; no secondary choice required.
    await expect(wizard.currentStepHeading).toHaveText(/Nature/i);
    await wizard.answerNature(0, 'yes');
    await wizard.answerNature(1, 'yes');
    await wizard.answerNature(2, 'yes');
    await wizard.next();

    // Step 8: Circles ----------------------------------------------------
    // Magician has `requiresMentor: true` — `hasMentor: no` button is
    // hidden in the template, so we must answer yes.
    await expect(wizard.currentStepHeading).toHaveText(/Circles/i);
    await wizard.answerCircles('hasFriend', 'yes');
    await wizard.fillCirclesDetail('friend', 'Apprentice Brynhild');
    await wizard.answerCircles('hasParents', 'yes');
    await wizard.fillCirclesDetail('parents', 'Osmund and Gudrid');
    await wizard.answerCircles('hasMentor', 'yes');
    await wizard.fillCirclesDetail('mentor', 'Archmage Thyra');
    await wizard.answerCircles('hasEnemy', 'yes');
    await wizard.fillCirclesDetail('enemy', 'The Burned One');
    await wizard.next();

    // Step 9: Gear + Roll Spells -----------------------------------------
    await expect(wizard.currentStepHeading).toHaveText(/Gear/i);
    await wizard.selectPackType('satchel');

    // Seed the 2d6 roll to a deterministic non-Choose value.
    // Foundry dice read CONFIG.Dice.randomUniform(); each d6 face is
    // `Math.ceil((1 - u) * 6)`. With u=0.5 each die rolls 3 → total 6 →
    // Conjuration → [Aetheric Appendage, Dæmonic Stupefaction, Wyrd Lights].
    // We also stash the original so we can restore it after to avoid
    // polluting any later rolls (chat posts, etc.).
    await page.evaluate(() => {
      globalThis.__tb2ePrevRandomUniform = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => 0.5;
    });

    await wizard.rollSpells();
    // Every non-Choose entry (rolls 2-10) grants exactly 3 spells; rolled
    // 6 here yields 3. Shape-invariant count assertion.
    await expect(wizard.spellBadges).toHaveCount(3);

    // Restore the PRNG before finish — the wizard's toMessage call
    // already completed, and subsequent dice (none expected) should use
    // the default Mersenne Twister.
    await page.evaluate(() => {
      CONFIG.Dice.randomUniform = globalThis.__tb2ePrevRandomUniform;
      delete globalThis.__tb2ePrevRandomUniform;
    });

    // Snapshot the rolled names from the DOM so we can correlate them
    // against the compendium entries after finish.
    const rolledSpells = await wizard.spellBadges.allInnerTexts();
    expect(rolledSpells).toHaveLength(3);

    await wizard.next();

    // Step 10: Weapons ---------------------------------------------------
    // Magician WEAPON_RESTRICTIONS is the narrow ["Dagger", "Staff"].
    await expect(wizard.currentStepHeading).toHaveText(/Weapons/i);
    await wizard.selectWeapon('Staff');
    await wizard.next();

    // Step 11: Armor -----------------------------------------------------
    // Magician has autoLeather=false and helmet=false — the step renders
    // a "no starting armor" note and is complete once weapons is.
    await expect(wizard.currentStepHeading).toHaveText(/Armor/i);
    await wizard.next();

    // Step 12: Finishing -------------------------------------------------
    await expect(wizard.currentStepHeading).toHaveText(/Finishing/i);
    await wizard.fillFinishing('name', finalName);
    await wizard.fillFinishing('belief', 'Knowledge forbidden by fools is owed to the bold.');
    await wizard.fillFinishing('instinct', 'Always scribe a new sigil before sleeping.');
    await wizard.fillFinishing('raiment', 'Indigo robes dusted with chalk, silver-rimmed spectacles.');
    await wizard.fillFinishing('age', 18);

    await wizard.finish();
    await wizard.expectClosed();

    // Poll until the actor reflects the updated name — the wizard writes
    // via actor.update() which resolves asynchronously.
    await expect
      .poll(() => page.evaluate((id) => game.actors.get(id)?.name ?? null, actorId))
      .toBe(finalName);

    // Also poll until the spell items are materialized. The wizard
    // creates items in a second batch after the actor update.
    await expect
      .poll(
        () =>
          page.evaluate((id) => {
            const a = game.actors.get(id);
            if ( !a ) return 0;
            return Array.from(a.items).filter((i) => i.type === 'spell').length;
          }, actorId),
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);

    const actorData = await page.evaluate((id) => {
      const actor = game.actors.get(id);
      const items = Array.from(actor.items).map((i) => ({
        name: i.name,
        type: i.type,
      }));
      return {
        name: actor.name,
        class: actor.system.class,
        stock: actor.system.stock,
        spellItems: items.filter((i) => i.type === 'spell'),
      };
    }, actorId);

    // Class + stock.
    expect(actorData.class).toBe('magician');
    expect(actorData.stock).toBe('human');

    // Spells: exactly 3 were created for our seeded roll (Conjuration).
    // Unlike the theurge/shaman branches there is NO stub fallback in
    // `#applyToActor` for missing compendium matches — if any of the
    // seeded names were missing from `tb2e.spells`, the count would
    // drop. All SPELL_SCHOOL_TABLE spells for rolls 2-10 exist in the
    // compendium, so with seed total 6 we expect 3/3.
    expect(actorData.spellItems).toHaveLength(3);

    // Every created spell's name must match one of the names that
    // appeared in the UI after the roll (shape invariant, not specific
    // content — even though our seed makes it deterministic, keeping
    // the assertion shape-based preserves the spec's structure).
    for ( const spell of actorData.spellItems ) {
      expect(rolledSpells).toContain(spell.name);
    }

    // Harvest the table's spell value-set to confirm the rolled names
    // are all legal entries (guards against drift between UI state and
    // the SPELL_SCHOOL_TABLE source-of-truth).
    const tableSpells = await page.evaluate(async () => {
      const mod = await import('/systems/tb2e/module/data/actor/chargen.mjs');
      const table = mod.SPELL_SCHOOL_TABLE;
      const allSpellNames = new Set();
      for ( const entry of Object.values(table) ) {
        for ( const sp of entry.spells || [] ) allSpellNames.add(sp);
      }
      return [...allSpellNames];
    });
    for ( const name of rolledSpells ) {
      expect(tableSpells).toContain(name);
    }

    // Class trait.
    const traitNames = await page.evaluate((id) => {
      const a = game.actors.get(id);
      return Array.from(a.items)
        .filter((i) => i.type === 'trait')
        .map((i) => i.name);
    }, actorId);
    expect(traitNames).toContain("Wizard's Sight");
    expect(traitNames).toContain('Extravagant');

    // Clean up — avoid piling test actors into the world between runs.
    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });
});
