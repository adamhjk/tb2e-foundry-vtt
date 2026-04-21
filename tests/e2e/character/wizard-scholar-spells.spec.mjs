import { test, expect } from '../test.mjs';
import { applyWizardState, bootGame, createCharacter, deleteActor } from '../helpers/fixtures.mjs';

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
 * On Finish, the wizard walks `state.spells` and imports each named item
 * from the `tb2e.spells` compendium as embedded items on the character
 * actor (magician branch of `#applyToActor`, character-wizard.mjs ~L1395).
 * Unlike the theurge/shaman branches, there is **no stub fallback** for
 * missing compendium items — spells silently drop if the lookup misses.
 * All SPELL_SCHOOL_TABLE names for rolls 2-10 exist in the compendium,
 * so a seeded valid roll yields exactly 3 spell items.
 *
 * The full UI walkthrough of the wizard (all 12 steps) is covered by
 * tests/e2e/character/wizard-walkthrough.spec.mjs. This spec instead
 * exercises the **class-specific finish branch** — the SPELL_SCHOOL_TABLE
 * lookup + `#applyToActor` magician path + compendium import — by seeding
 * a complete wizard state via CharacterWizard._applyStateForTest() and
 * inspecting the resulting actor. The dice → table lookup is trivial
 * (roll → const map index) and was previously stubbed deterministically
 * anyway; we now skip it entirely and seed the table value directly.
 *
 * Chosen build, rationale (matches the previous UI-driven version so
 * the assertions remain comparable):
 *   - Class: magician, Stock: human (`requiresMentor: true`).
 *   - Upbringing: laborer (not in magician class skills).
 *   - Hometown: bustlingMetropolis, hometown skill `haggler`,
 *     home trait `Extravagant`.
 *   - Social: manipulator. Specialty: dungeoneer.
 *   - Free wise: Arcana-wise.
 *   - All-yes nature answers and circles answers (mentor required).
 *   - Spells seeded from SPELL_SCHOOL_TABLE[6] (Conjuration → 3 spells).
 *   - Weapon: Staff. Pack: satchel.
 */

const SEEDED_ROLL = 6; // Conjuration: Aetheric Appendage, Dæmonic Stupefaction, Wyrd Lights.
const ACTOR_NAME = () => `E2E Scholar ${Date.now()}`;

test.describe('Character wizard Magician spells', () => {
  test('Magician / human walkthrough populates starting spells', async ({ page }) => {
    const name = ACTOR_NAME();

    await bootGame(page);
    const actorId = await createCharacter(page, name);

    // Pull the table entry that the wizard would have rolled, so the
    // spec stays anchored to the same source-of-truth as production.
    const seeded = await page.evaluate(async (roll) => {
      const mod = await import('/systems/tb2e/module/data/actor/chargen.mjs');
      const entry = mod.SPELL_SCHOOL_TABLE[roll];
      return { school: entry.school, spells: [...entry.spells] };
    }, SEEDED_ROLL);
    expect(seeded.spells).toHaveLength(3);

    const state = {
      class: 'magician', stock: 'human', will: 4, health: 4,
      upbringingSkill: 'laborer',
      hometown: 'bustlingMetropolis', hometownSkill: 'haggler', homeTrait: 'Extravagant',
      socialGrace: 'manipulator', specialty: 'dungeoneer',
      wises: ['Arcana-wise'],
      natureAnswers: { 0: true, 1: true, 2: true },
      circles: 5,
      hasFriend: true, hasParents: true, hasMentor: true, hasEnemy: true,
      friend: 'Apprentice Brynhild', parents: 'Osmund and Gudrid',
      mentor: 'Archmage Thyra', enemy: 'The Burned One',
      packType: 'satchel',
      spellSchoolRoll: SEEDED_ROLL, spellSchool: seeded.school, spells: seeded.spells,
      selectedWeapon: 'Staff',
      name, age: 18,
      belief: 'Knowledge forbidden by fools is owed to the bold.',
      instinct: 'Always scribe a new sigil before sleeping.',
      raiment: 'Indigo robes dusted with chalk, silver-rimmed spectacles.'
    };
    await applyWizardState(page, actorId, state);

    const actorData = await page.evaluate((id) => {
      const actor = game.actors.get(id);
      const items = Array.from(actor.items).map((i) => ({ name: i.name, type: i.type }));
      return {
        name: actor.name,
        class: actor.system.class,
        stock: actor.system.stock,
        spellItems: items.filter((i) => i.type === 'spell')
      };
    }, actorId);

    expect(actorData.class).toBe('magician');
    expect(actorData.stock).toBe('human');

    // Spells: exactly 3 items materialised for the seeded Conjuration
    // roll. Magician branch has NO stub fallback — count drops if any
    // seeded name is absent from the `tb2e.spells` compendium. All
    // SPELL_SCHOOL_TABLE entries for rolls 2-10 are valid compendium
    // names, so 3/3 here is the source-of-truth invariant.
    expect(actorData.spellItems).toHaveLength(3);
    for ( const spell of actorData.spellItems ) {
      expect(seeded.spells).toContain(spell.name);
    }

    // Class trait (always granted) + chosen home trait (Extravagant).
    const traitNames = await page.evaluate((id) => {
      const a = game.actors.get(id);
      return Array.from(a.items).filter((i) => i.type === 'trait').map((i) => i.name);
    }, actorId);
    expect(traitNames).toContain("Wizard's Sight");
    expect(traitNames).toContain('Extravagant');

    await deleteActor(page, actorId);
  });
});
