import { GameUI } from '../pages/GameUI.mjs';

/** Navigate to /game, wait for ready, dismiss tours. Returns the GameUI POM. */
export async function bootGame(page) {
  await page.goto('/game');
  const ui = new GameUI(page);
  await ui.waitForReady();
  await ui.dismissTours();
  return ui;
}

/** Create a blank character actor via Foundry API. Returns its id. */
export async function createCharacter(page, name) {
  return page.evaluate(async (n) => {
    const actor = await Actor.create({ name: n, type: 'character' });
    return actor.id;
  }, name);
}

/**
 * Run the wizard's finish pipeline against an actor with a seeded state,
 * bypassing the 12-step UI. The full-path wizard flow is covered by
 * tests/e2e/character/wizard-walkthrough.spec.mjs.
 */
export async function applyWizardState(page, actorId, state) {
  await page.evaluate(async ({ id, s }) => {
    const { default: CharacterWizard } = await import(
      '/systems/tb2e/module/applications/actor/character-wizard.mjs'
    );
    const actor = game.actors.get(id);
    await CharacterWizard._applyStateForTest(actor, s);
  }, { id: actorId, s: state });
}

/** Delete a test actor to keep the world tidy between runs. */
export async function deleteActor(page, actorId) {
  await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
}
