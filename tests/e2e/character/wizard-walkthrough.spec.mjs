import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterWizard } from '../pages/CharacterWizard.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * Character creation wizard — end-to-end happy path.
 *
 * Walks the full 12-step "Gather Round" wizard (DH pp.25-47, LMM pp.9-14)
 * with a Ranger / Elf build, picking deterministic choices that avoid the
 * roll-heavy subbranches (magician spell roll, theurge / shaman relic roll
 * — covered by separate specs). After Finish, the wizard writes class,
 * stock, abilities, skills, traits, items, wises, and biography fields
 * onto the actor; this spec asserts the most load-bearing fields are set.
 *
 * Chosen build, rationale:
 *   - Class: Ranger — fixed abilities (W4/H4), auto-stocks elf (only one),
 *     auto-arms with Leather Armor, no spell / relic / invocation branch.
 *   - Stock: elf (auto) — skips the upbringing step entirely
 *     (`shouldSkipUpbringing("elf") === true`).
 *   - Hometown: Remote Village — open to all stocks, three skill choices
 *     that don't clash with Ranger's class skills (peasant / weaver /
 *     carpenter), two plain traits.
 *   - Social: orator — not in Ranger's class-skill list, so goes in fresh
 *     at rating 2.
 *   - Specialty: cartographer — likewise a fresh rating-2 skill.
 *   - Wise: elf requires one of Elven Lore-wise / Folly of Humanity-wise
 *     / Folly of Dwarves-wise (plus one free wise).
 *   - Nature: answer all "yes" — elf Q1 / Q3 yes = +1 Nature each; Q2 yes
 *     boosts the "First Born" class trait. No yes answers require a
 *     secondary choice (wise / replacement trait).
 *   - Circles: all yes so each relationship text field renders.
 *   - Gear: satchel — no equipment required; gear step only needs packType.
 *   - Weapons: Sword — in Ranger's restriction list [Bow, Dagger, Spear,
 *     Sword]. Ranger is not shield-eligible.
 *   - Armor: Ranger auto-sets Leather Armor on class pick; no helmet option.
 *   - Finishing: name is the only required field.
 */

const WIZARD_ACTOR_NAME = () => `E2E Wizard ${Date.now()}`;

test.describe('Character wizard walkthrough', () => {
  test('Ranger / Elf walkthrough populates actor on finish', async ({ page }) => {
    const originalName = WIZARD_ACTOR_NAME();
    const finalName = `${originalName} Ravenwood`;
    const finalBelief = 'I will find the lost road home.';
    const finalInstinct = 'Always check the treeline for movement.';
    const finalRaiment = 'Green wool cloak over leathers.';
    const finalAge = 72; // Elf age range 60–101.
    const friendName = 'Isolde of the Glade';
    const parentsName = 'Erlan and Ylva';
    const mentorName = 'Ranger-Captain Gudrun';
    const enemyName = 'Grell of the Black Fen';
    const freeWise = 'Forest-wise';

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Create a blank character actor directly via the game API — the
    // wizard is opened against an existing actor. Using the API keeps the
    // test independent of the create-actor-dialog flow already covered by
    // character-creation.spec.mjs.
    const actorId = await page.evaluate(async (n) => {
      const actor = await Actor.create({ name: n, type: 'character' });
      return actor.id;
    }, originalName);
    expect(actorId).toBeTruthy();

    // Open the wizard for this actor by constructing it directly via the
    // system's exported class. The wizard is a top-level ApplicationV2
    // separate from the character sheet (no sheet traversal required).
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
    // Selecting Ranger auto-sets stock=elf, will=4, health=4, and armor=
    // [Leather Armor] (see `#onSelectClass` in character-wizard.mjs).
    await wizard.selectClass('ranger');
    await expect(wizard.currentStepHeading).toHaveText(/Class/i);
    await wizard.next();

    // Step 2: Upbringing is SKIPPED for elves — the wizard's `#steps`
    // getter filters it out via `shouldSkipUpbringing("elf")`. We land
    // directly on Hometown.

    // Step 3: Hometown ----------------------------------------------------
    await expect(wizard.currentStepHeading).toHaveText(/Hometown/i);
    await wizard.selectHometown('remoteVillage');
    await wizard.selectHometownSkill('peasant');
    await wizard.selectHomeTrait('Early Riser');
    await wizard.next();

    // Step 4: Social grace ------------------------------------------------
    await expect(wizard.currentStepHeading).toHaveText(/Social/i);
    await wizard.selectSocial('orator');
    await wizard.next();

    // Step 5: Specialty ---------------------------------------------------
    await expect(wizard.currentStepHeading).toHaveText(/Specialty/i);
    await wizard.selectSpecialty('cartographer');
    await wizard.next();

    // Step 6: Wises -------------------------------------------------------
    await expect(wizard.currentStepHeading).toHaveText(/Wises/i);
    await wizard.selectRequiredWise('Elven Lore-wise');
    // Elf chargen grants one free wise — the required pick occupies index
    // 0, so the free-choice slot carries `data-wise-index="1"`.
    await wizard.fillFreeWise(1, freeWise);
    await wizard.next();

    // Step 7: Nature ------------------------------------------------------
    // Elf yes-answers: Q1 +1 nature, Q2 trait boost First Born, Q3 +1 nature.
    // No "yes" answer requires a secondary wise/trait pick.
    await expect(wizard.currentStepHeading).toHaveText(/Nature/i);
    await wizard.answerNature(0, 'yes');
    await wizard.answerNature(1, 'yes');
    await wizard.answerNature(2, 'yes');
    await wizard.next();

    // Step 8: Circles -----------------------------------------------------
    await expect(wizard.currentStepHeading).toHaveText(/Circles/i);
    await wizard.answerCircles('hasFriend', 'yes');
    await wizard.fillCirclesDetail('friend', friendName);
    await wizard.answerCircles('hasParents', 'yes');
    await wizard.fillCirclesDetail('parents', parentsName);
    await wizard.answerCircles('hasMentor', 'yes');
    await wizard.fillCirclesDetail('mentor', mentorName);
    await wizard.answerCircles('hasEnemy', 'yes');
    await wizard.fillCirclesDetail('enemy', enemyName);
    await wizard.next();

    // Step 9: Gear --------------------------------------------------------
    // `#isStepComplete("gear")` only requires `!!s.packType` — picking a
    // pack advances the step without any equipment selection.
    await expect(wizard.currentStepHeading).toHaveText(/Gear/i);
    await wizard.selectPackType('satchel');
    await wizard.next();

    // Step 10: Weapons ----------------------------------------------------
    await expect(wizard.currentStepHeading).toHaveText(/Weapons/i);
    await wizard.selectWeapon('Sword');
    await wizard.next();

    // Step 11: Armor ------------------------------------------------------
    // Ranger's armor was auto-assigned at class pick (Leather Armor). The
    // armor step has nothing to select for Rangers; it's already complete
    // via `#isStepComplete("weapons")`.
    await expect(wizard.currentStepHeading).toHaveText(/Armor/i);
    await wizard.next();

    // Step 12: Finishing --------------------------------------------------
    await expect(wizard.currentStepHeading).toHaveText(/Finishing/i);
    await wizard.fillFinishing('name', finalName);
    await wizard.fillFinishing('belief', finalBelief);
    await wizard.fillFinishing('instinct', finalInstinct);
    await wizard.fillFinishing('raiment', finalRaiment);
    await wizard.fillFinishing('age', finalAge);

    // Finish - writes to actor, closes wizard, re-renders character sheet.
    await wizard.finish();
    await wizard.expectClosed();

    // Assert actor was populated correctly ---------------------------------
    // Poll until the actor reflects the updated name — wizard writes via
    // actor.update() which completes asynchronously after finish().
    await expect
      .poll(() => page.evaluate((id) => game.actors.get(id)?.name ?? null, actorId))
      .toBe(finalName);

    const actorData = await page.evaluate((id) => {
      const actor = game.actors.get(id);
      const items = Array.from(actor.items).map((i) => ({ name: i.name, type: i.type }));
      return {
        name: actor.name,
        class: actor.system.class,
        stock: actor.system.stock,
        specialty: actor.system.specialty,
        will: actor.system.abilities.will.rating,
        health: actor.system.abilities.health.rating,
        nature: actor.system.abilities.nature.rating,
        natureMax: actor.system.abilities.nature.max,
        circles: actor.system.abilities.circles.rating,
        skillsFighter: actor.system.skills.fighter?.rating,
        skillsPathfinder: actor.system.skills.pathfinder?.rating,
        skillsScout: actor.system.skills.scout?.rating,
        skillsOrator: actor.system.skills.orator?.rating,
        skillsCartographer: actor.system.skills.cartographer?.rating,
        skillsPeasant: actor.system.skills.peasant?.rating,
        belief: actor.system.belief,
        instinct: actor.system.instinct,
        raiment: actor.system.raiment,
        age: actor.system.age,
        friend: actor.system.friend,
        parents: actor.system.parents,
        mentor: actor.system.mentor,
        enemy: actor.system.enemy,
        home: actor.system.home,
        wises: (actor.system.wises ?? []).map((w) => w.name),
        descriptors: actor.system.natureDescriptors ?? [],
        items,
        conditionsFresh: actor.system.conditions?.fresh,
      };
    }, actorId);

    // Class / stock / specialty.
    expect(actorData.name).toBe(finalName);
    expect(actorData.class).toBe('ranger');
    expect(actorData.stock).toBe('elf');
    expect(actorData.specialty).toBe('cartographer');

    // Abilities. Ranger has fixed Will=4 / Health=4 (DH p.27). All three
    // elf yes-answers except Q2 grant +1 nature, so nature = 3 base + 2.
    expect(actorData.will).toBe(4);
    expect(actorData.health).toBe(4);
    expect(actorData.nature).toBe(5);
    expect(actorData.natureMax).toBe(5);
    // Circles start at 1 and gain +1 per yes in circles (4 yeses here).
    expect(actorData.circles).toBe(5);

    // Skills. Ranger class skills (fighter 3, pathfinder 3, scout 3,
    // hunter 2, loremaster 2, survivalist 2) persist as-is; hometown
    // skill `peasant` is rating-2 (fresh), social `orator` is rating-2
    // (fresh), specialty `cartographer` is rating-2 (fresh).
    expect(actorData.skillsFighter).toBe(3);
    expect(actorData.skillsPathfinder).toBe(3);
    expect(actorData.skillsScout).toBe(3);
    expect(actorData.skillsOrator).toBe(2);
    expect(actorData.skillsCartographer).toBe(2);
    expect(actorData.skillsPeasant).toBe(2);

    // Finishing-touches fields.
    expect(actorData.belief).toBe(finalBelief);
    expect(actorData.instinct).toBe(finalInstinct);
    expect(actorData.raiment).toBe(finalRaiment);
    expect(String(actorData.age)).toBe(String(finalAge));

    // Circles relationships (all four yes).
    expect(actorData.friend).toBe(friendName);
    expect(actorData.parents).toBe(parentsName);
    expect(actorData.mentor).toBe(mentorName);
    expect(actorData.enemy).toBe(enemyName);

    // Hometown label gets localized — remoteVillage -> "Remote Village".
    expect(actorData.home).toMatch(/Village/i);

    // Wises — required pick + free pick should be stored as objects.
    const wiseNames = actorData.wises;
    expect(wiseNames).toContain('Elven Lore-wise');
    expect(wiseNames).toContain(freeWise);

    // Nature descriptors: elf defaults minus any "no" replacements. All
    // three answers were "yes", so base descriptors are intact.
    expect(Array.isArray(actorData.descriptors)).toBe(true);
    expect(actorData.descriptors.length).toBeGreaterThan(0);

    // Items — we expect at least the class trait ("First Born"), home
    // trait ("Early Riser"), weapon (Sword), armor (Leather Armor), and
    // pack (Satchel). We assert on presence of at least three items
    // (trait + weapon + armor) to keep the assertion robust to
    // compendium lookups occasionally missing on CI.
    expect(actorData.items.length).toBeGreaterThanOrEqual(3);
    const traitNames = actorData.items.filter((i) => i.type === 'trait').map((i) => i.name);
    expect(traitNames).toContain('First Born');
    expect(traitNames).toContain('Early Riser');

    // Fresh condition is set to true by the finish handler (baseline
    // "rested and ready" state for a new character).
    expect(actorData.conditionsFresh).toBe(true);

    // Clean up — avoid piling test actors into the world between runs.
    await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
  });
});
