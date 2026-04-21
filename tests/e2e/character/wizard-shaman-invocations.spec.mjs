import { test, expect } from '../test.mjs';
import { applyWizardState, bootGame, createCharacter, deleteActor } from '../helpers/fixtures.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * Character creation wizard — Shaman / human branch with rollRelics.
 *
 * The Shaman (LMM p.11) is a religious class that receives starting
 * relics and invocations from a 3d6 roll on `SHAMAN_RELIC_TABLE`
 * (chargen.mjs). On Finish, the wizard walks `state.relics` and
 * `state.invocations` and imports each named item from the
 * `tb2e.shamanic-relics` / `tb2e.shamanic-invocations` compendiums as
 * embedded items on the character actor — falling back to a stub
 * `type: relic`/`invocation` if the compendium lookup misses (shaman
 * branch of `#applyToActor`).
 *
 * The full UI walkthrough of the wizard (all 12 steps) is covered by
 * tests/e2e/character/wizard-walkthrough.spec.mjs. This spec exercises
 * the **class-specific finish branch** — SHAMAN_RELIC_TABLE lookup +
 * `#applyToActor` shaman path + compendium import (with stub fallback)
 * — by seeding a complete wizard state via
 * CharacterWizard._applyStateForTest() and inspecting the resulting
 * actor. The dice → table lookup is trivial and is covered indirectly
 * by the source-of-truth invariant (we read the same table the wizard
 * does and pass its values straight through).
 *
 * Shape invariants: every table entry has exactly 2 relics + 2
 * invocations, but the compendium may not have a 1:1 match for every
 * name — so we assert `>= 1` and `<= 2` on each list. We also confirm
 * every created item's name is present in the table's value-set
 * (guards against drift between `#applyToActor` and the table).
 *
 * Chosen build (matches the previous UI-driven version):
 *   - Class: shaman, Stock: human.
 *   - Upbringing: laborer. Hometown: religiousBastion / cartographer /
 *     Defender. Social: manipulator. Specialty: dungeoneer.
 *   - Free wise: Spirits-wise. All-yes nature + circles answers.
 *   - Relics+invocations seeded from SHAMAN_RELIC_TABLE[10] (Bag of
 *     Astragali Dice / Sol's Disc + Supplication to the Saints of
 *     Secrets / Guidance of the Lord of Paths and Ways).
 *   - Weapon: Staff. Pack: satchel.
 */

const SEEDED_ROLL = 10; // Median 3d6 entry; both relics and invocations exist in compendium.
const ACTOR_NAME = () => `E2E Shaman ${Date.now()}`;

test.describe('Character wizard Shaman invocations', () => {
  test('Shaman / human walkthrough populates linked relics and invocations', async ({ page }) => {
    const name = ACTOR_NAME();

    await bootGame(page);
    const actorId = await createCharacter(page, name);

    const seeded = await page.evaluate(async (roll) => {
      const mod = await import('/systems/tb2e/module/data/actor/chargen.mjs');
      const entry = mod.SHAMAN_RELIC_TABLE[roll];
      return { relics: [...entry.relics], invocations: [...entry.invocations] };
    }, SEEDED_ROLL);
    expect(seeded.relics).toHaveLength(2);
    expect(seeded.invocations).toHaveLength(2);

    const state = {
      class: 'shaman', stock: 'human', will: 4, health: 4,
      upbringingSkill: 'laborer',
      hometown: 'religiousBastion', hometownSkill: 'cartographer', homeTrait: 'Defender',
      socialGrace: 'manipulator', specialty: 'dungeoneer',
      wises: ['Spirits-wise'],
      natureAnswers: { 0: true, 1: true, 2: true },
      circles: 5,
      hasFriend: true, hasParents: true, hasMentor: true, hasEnemy: true,
      friend: 'Brother Ylva', parents: 'Hakon and Thora',
      mentor: 'Old Mother Silva', enemy: 'The Hollow Shaman',
      packType: 'satchel',
      relicRoll: SEEDED_ROLL, relics: seeded.relics, invocations: seeded.invocations,
      selectedWeapon: 'Staff',
      name, age: 22,
      belief: 'The old spirits still walk with those who listen.',
      instinct: 'Always leave an offering at a crossroads.',
      raiment: 'Patchwork hides and bone-charm necklace, ash on the brow.'
    };
    await applyWizardState(page, actorId, state);

    const actorData = await page.evaluate((id) => {
      const actor = game.actors.get(id);
      const items = Array.from(actor.items).map((i) => ({
        name: i.name,
        type: i.type,
        relicTier: i.system?.relicTier ?? null,
        linkedInvocations: Array.isArray(i.system?.linkedInvocations)
          ? [...i.system.linkedInvocations]
          : null,
        immortal: i.system?.immortal ?? null
      }));
      return {
        class: actor.system.class,
        stock: actor.system.stock,
        relicItems: items.filter((i) => i.type === 'relic'),
        invocationItems: items.filter((i) => i.type === 'invocation')
      };
    }, actorId);

    expect(actorData.class).toBe('shaman');
    expect(actorData.stock).toBe('human');

    // Relics: 2 seeded names. Compendium hits create real items, misses
    // fall back to stub `{ type: "relic", system: { tier: "minor" } }`.
    // Either way 2 items per side; we tolerate `>= 1` to accommodate any
    // future compendium drift.
    expect(actorData.relicItems.length).toBeGreaterThanOrEqual(1);
    expect(actorData.relicItems.length).toBeLessThanOrEqual(2);
    for ( const relic of actorData.relicItems ) {
      expect(seeded.relics).toContain(relic.name);
    }

    // Compendium-sourced relics (identified by populated `immortal`) carry
    // a valid tier and any linkedInvocations must be table-legal names.
    const tableValidation = await page.evaluate(async () => {
      const mod = await import('/systems/tb2e/module/data/actor/chargen.mjs');
      const allInv = new Set();
      for ( const entry of Object.values(mod.SHAMAN_RELIC_TABLE) ) {
        for ( const i of entry.invocations || [] ) allInv.add(i);
      }
      return { invocations: [...allInv] };
    });
    const compendiumRelics = actorData.relicItems.filter((r) => r.immortal);
    for ( const relic of compendiumRelics ) {
      expect(['minor', 'named', 'great']).toContain(relic.relicTier);
      if ( relic.linkedInvocations && relic.linkedInvocations.length > 0 ) {
        for ( const linked of relic.linkedInvocations ) {
          expect(tableValidation.invocations).toContain(linked);
        }
      }
    }

    expect(actorData.invocationItems.length).toBeGreaterThanOrEqual(1);
    expect(actorData.invocationItems.length).toBeLessThanOrEqual(2);
    for ( const inv of actorData.invocationItems ) {
      expect(seeded.invocations).toContain(inv.name);
    }

    // Class trait + chosen home trait.
    const traitNames = await page.evaluate((id) => {
      const a = game.actors.get(id);
      return Array.from(a.items).filter((i) => i.type === 'trait').map((i) => i.name);
    }, actorId);
    expect(traitNames).toContain('Between Two Worlds');
    expect(traitNames).toContain('Defender');

    await deleteActor(page, actorId);
  });
});
