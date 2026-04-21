import { test, expect } from '../test.mjs';
import { applyWizardState, bootGame, createCharacter, deleteActor } from '../helpers/fixtures.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * Character creation wizard — Theurge / human branch with rollRelics.
 *
 * The Theurge (DH p.27) is a religious class that receives starting
 * relics and invocations from a 3d6 roll on `THEURGE_RELIC_TABLE`
 * (chargen.mjs). On Finish, the wizard walks `state.relics` and
 * `state.invocations` and imports each named item from the
 * `tb2e.theurge-relics` / `tb2e.theurge-invocations` compendiums as
 * embedded items on the character actor — falling back to a stub
 * `type: relic`/`invocation` if the compendium lookup misses.
 *
 * The full UI walkthrough of the wizard (all 12 steps) is covered by
 * tests/e2e/character/wizard-walkthrough.spec.mjs. This spec exercises
 * the **class-specific finish branch** — THEURGE_RELIC_TABLE lookup +
 * `#applyToActor` theurge path + compendium import (with stub fallback)
 * — by seeding a complete wizard state via
 * CharacterWizard._applyStateForTest() and inspecting the resulting
 * actor.
 *
 * Shape invariants: every table entry has exactly 2 relics + 2
 * invocations, but the compendium may not have a 1:1 match for every
 * name — so we assert `>= 1` and `<= 2` on each list. We also confirm
 * every created item's name is present in the table's value-set
 * (guards against drift between `#applyToActor` and the table).
 *
 * Chosen build (matches the previous UI-driven version):
 *   - Class: theurge, Stock: human.
 *   - Upbringing: laborer. Hometown: religiousBastion / cartographer /
 *     Defender. Social: manipulator. Specialty: dungeoneer.
 *   - Free wise: Hymns-wise. All-yes nature + circles answers.
 *   - Relics+invocations seeded from THEURGE_RELIC_TABLE[10] (Drinking
 *     Horn... / Vial of Perfume + Benediction... / Gift of Hospitality).
 *   - Weapon: Mace. Pack: satchel.
 */

const SEEDED_ROLL = 10; // Median 3d6 entry; both relics and invocations exist in compendium.
const ACTOR_NAME = () => `E2E Theurge ${Date.now()}`;

test.describe('Character wizard Theurge relics', () => {
  test('Theurge / human walkthrough populates linked relics and invocations', async ({ page }) => {
    const name = ACTOR_NAME();

    await bootGame(page);
    const actorId = await createCharacter(page, name);

    const seeded = await page.evaluate(async (roll) => {
      const mod = await import('/systems/tb2e/module/data/actor/chargen.mjs');
      const entry = mod.THEURGE_RELIC_TABLE[roll];
      return { relics: [...entry.relics], invocations: [...entry.invocations] };
    }, SEEDED_ROLL);
    expect(seeded.relics).toHaveLength(2);
    expect(seeded.invocations).toHaveLength(2);

    const state = {
      class: 'theurge', stock: 'human', will: 4, health: 4,
      upbringingSkill: 'laborer',
      hometown: 'religiousBastion', hometownSkill: 'cartographer', homeTrait: 'Defender',
      socialGrace: 'manipulator', specialty: 'dungeoneer',
      wises: ['Hymns-wise'],
      natureAnswers: { 0: true, 1: true, 2: true },
      circles: 5,
      hasFriend: true, hasParents: true, hasMentor: true, hasEnemy: true,
      friend: 'Sister Ingrid', parents: 'Orhan and Freyja',
      mentor: 'Archdeacon Jovan', enemy: 'The Heretic Miroslav',
      packType: 'satchel',
      relicRoll: SEEDED_ROLL, relics: seeded.relics, invocations: seeded.invocations,
      selectedWeapon: 'Mace',
      name, age: 19,
      belief: 'The old gods endure through those who remember.',
      instinct: 'Always light a candle before entering darkness.',
      raiment: 'Ashen wool robes, silver icon at the throat.'
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

    expect(actorData.class).toBe('theurge');
    expect(actorData.stock).toBe('human');

    expect(actorData.relicItems.length).toBeGreaterThanOrEqual(1);
    expect(actorData.relicItems.length).toBeLessThanOrEqual(2);
    for ( const relic of actorData.relicItems ) {
      expect(seeded.relics).toContain(relic.name);
    }

    const tableValidation = await page.evaluate(async () => {
      const mod = await import('/systems/tb2e/module/data/actor/chargen.mjs');
      const allInv = new Set();
      for ( const entry of Object.values(mod.THEURGE_RELIC_TABLE) ) {
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

    const traitNames = await page.evaluate((id) => {
      const a = game.actors.get(id);
      return Array.from(a.items).filter((i) => i.type === 'trait').map((i) => i.name);
    }, actorId);
    expect(traitNames).toContain('Touched by the Gods');
    expect(traitNames).toContain('Defender');

    await deleteActor(page, actorId);
  });
});
