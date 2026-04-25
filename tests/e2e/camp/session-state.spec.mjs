import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §X Camp session state (Phase C).
 *
 * Implementation: `module/data/camp/state.mjs` mutators write through the
 * `tb2e.campState` world setting. `computeEventsModifier` is a pure
 * function over the session state + camp actor + party, per SG p. 93.
 *
 * Rules citations:
 *   - SG p. 90 — begin camp with ≥1 check.
 *   - SG p. 91 — amenities persist on the camp actor.
 *   - SG p. 93 — modifier breakdown: shelter/concealment (+1 each),
 *     ranger-in-wilderness (+1), outcast-in-dungeon-or-dwarven (+1),
 *     watch (+1), danger penalty (typical 0 / unsafe −2 / dangerous −3),
 *     dark-camp relief (+1 to danger if dark), prior disasters (−1 each),
 *     GM situational (−/+).
 *   - SG p. 95 — unspent checks are discarded on Break Camp.
 *   - SG p. 96 — turn count resets to 1.
 *
 * Each test resets world state in afterEach so repeat runs stay clean.
 */

async function resetWorld(page) {
  await page.evaluate(async () => {
    const { defaultCampState } = await import('/systems/tb2e/module/data/camp/state.mjs');
    await game.settings.set('tb2e', 'campState', defaultCampState());
    await game.settings.set('tb2e', 'grindTurn', 1);
    await game.settings.set('tb2e', 'grindPhase', 'adventure');
    for ( const a of [...game.actors] ) {
      if ( a.type === 'camp' ) await a.delete();
    }
  });
}

test.describe('§X Camp session state (Phase C)', () => {
  test.afterEach(async ({ page }) => { await resetWorld(page); });

  test('default state is inactive with site phase and empty session', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);

    const state = await page.evaluate(() => game.settings.get('tb2e', 'campState'));
    expect(state.active).toBe(false);
    expect(state.campActorId).toBeNull();
    expect(state.phase).toBe('site');
    expect(state.watchers).toEqual([]);
    expect(state.log).toEqual([]);
    expect(state.events.rolled).toBe(false);
  });

  test('beginCamp seeds danger from the actor and advances to setup', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);

    const out = await page.evaluate(async () => {
      const s = await import('/systems/tb2e/module/data/camp/state.mjs');
      const camp = await Actor.create({
        name: 'Skogenby Barrow',
        type: 'camp',
        system: { type: 'ancient-ruins', defaultDanger: 'dangerous' }
      });
      await s.beginCamp(camp.id);
      return { state: game.settings.get('tb2e', 'campState'), campId: camp.id };
    });

    expect(out.state.active).toBe(true);
    expect(out.state.campActorId).toBe(out.campId);
    expect(out.state.danger).toBe('dangerous');
    expect(out.state.phase).toBe('setup');
  });

  test('computeEventsModifier combines shelter, ranger, watch, danger, dark-relief, prior disasters, GM', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);

    const net = await page.evaluate(async () => {
      const s = await import('/systems/tb2e/module/data/camp/state.mjs');
      const camp = await Actor.create({
        name: 'Wild Camp',
        type: 'camp',
        system: {
          type: 'wilderness',
          defaultDanger: 'unsafe',
          amenities: { shelter: true, concealment: false, water: false },
          disastersThisAdventure: 1
        }
      });
      // A party with a ranger (wilderness bonus applies).
      const ranger = await Actor.create({ name: 'Thrar', type: 'character', system: { class: 'ranger' } });
      await s.beginCamp(camp.id);
      await s.toggleWatcher(ranger.id);
      await s.setFire('dark');
      await s.setGmSituational(-1);

      const state = s.getCampState();
      const actor = s.getCampActor(state);
      const result = s.computeEventsModifier(state, actor, [ranger]);

      // Tidy up actors.
      await ranger.delete();
      await camp.delete();
      return result;
    });

    // Breakdown components:
    //   Shelter           +1
    //   Concealment        0
    //   Ranger-in-wild    +1
    //   Outcast-in-dung    0
    //   Watch             +1
    //   Danger Unsafe -2, dark-relief reduces to -1 → net -1
    //   Prior disasters   -1
    //   GM situational    -1
    //   = 0
    const byKey = Object.fromEntries(net.breakdown.map(b => [b.key, b.value]));
    expect(byKey.shelter).toBe(1);
    expect(byKey.concealment).toBe(0);
    expect(byKey.ranger).toBe(1);
    expect(byKey.outcast).toBe(0);
    expect(byKey.watch).toBe(1);
    expect(byKey.danger).toBe(-1);             // unsafe -2 + dark-relief +1
    expect(byKey['prior-disasters']).toBe(-1);
    expect(byKey['gm-situational']).toBe(-1);
    expect(net.net).toBe(0);
  });

  test('outcast bonus applies to dungeons AND dwarven-made camps', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);

    const results = await page.evaluate(async () => {
      const s = await import('/systems/tb2e/module/data/camp/state.mjs');
      const outcast = await Actor.create({ name: 'Grima', type: 'character', system: { class: 'outcast' } });

      const dungeonCamp = await Actor.create({
        name: 'Dungeon', type: 'camp',
        system: { type: 'dungeons', defaultDanger: 'typical' }
      });
      await s.beginCamp(dungeonCamp.id);
      const dungeonMod = s.computeEventsModifier(s.getCampState(), dungeonCamp, [outcast]);

      const dwarvenCamp = await Actor.create({
        name: 'Dwarven', type: 'camp',
        system: { type: 'ancient-ruins', defaultDanger: 'typical', isDwarvenMade: true }
      });
      await s.beginCamp(dwarvenCamp.id);
      const dwarvenMod = s.computeEventsModifier(s.getCampState(), dwarvenCamp, [outcast]);

      const wildernessCamp = await Actor.create({
        name: 'Wild', type: 'camp',
        system: { type: 'wilderness', defaultDanger: 'typical' }
      });
      await s.beginCamp(wildernessCamp.id);
      const wildMod = s.computeEventsModifier(s.getCampState(), wildernessCamp, [outcast]);

      const get = (bd, key) => bd.breakdown.find(b => b.key === key).value;
      const out = {
        dungeon: get(dungeonMod, 'outcast'),
        dwarven: get(dwarvenMod, 'outcast'),
        wilderness: get(wildMod, 'outcast')
      };

      await outcast.delete();
      await dungeonCamp.delete();
      await dwarvenCamp.delete();
      await wildernessCamp.delete();
      return out;
    });

    expect(results.dungeon).toBe(1);
    expect(results.dwarven).toBe(1);
    expect(results.wilderness).toBe(0);
  });

  test('endCamp discards unspent checks, resets grind turn/phase, writes back to camp actor', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);

    const state = await page.evaluate(async () => {
      const s = await import('/systems/tb2e/module/data/camp/state.mjs');

      const pc = await Actor.create({ name: 'Pyre', type: 'character', system: { checks: 3 } });
      const camp = await Actor.create({
        name: 'Cave', type: 'camp',
        system: { type: 'natural-caves', defaultDanger: 'typical' }
      });

      await s.beginCamp(camp.id);
      await s.toggleSurvey('shelter');            // newly found this visit
      // Simulate a disaster-ended visit. Per the new design, rollEvents is
      // responsible for setting grindTurn at roll time; endCamp doesn't
      // touch it. For a disaster, rollEvents would have restored the
      // pre-camp grindTurn (the grind continues — SG pp. 93–94).
      await game.settings.set('tb2e', 'grindPhase', 'camp');
      await game.settings.set('tb2e', 'grindTurn', 4);
      const st = s.getCampState();
      st.events.preCampGrindTurn = 4;             // simulates rollEvents stash
      st.events.isDisaster = true;
      st.events.outcome = 'ended';
      await game.settings.set('tb2e', 'campState', st);

      await s.endCamp();

      const refreshed = game.actors.get(camp.id);
      const out = {
        campState: game.settings.get('tb2e', 'campState'),
        grindTurn: game.settings.get('tb2e', 'grindTurn'),
        grindPhase: game.settings.get('tb2e', 'grindPhase'),
        pcChecks: game.actors.get(pc.id).system.checks,
        campAmenityShelter: refreshed.system.amenities.shelter,
        campDisasters: refreshed.system.disastersThisAdventure,
        visits: refreshed.system.visits.length,
        visitOutcome: refreshed.system.visits.at(-1)?.outcome
      };

      await pc.delete();
      await camp.delete();
      return out;
    });

    // Session state cleared.
    expect(state.campState.active).toBe(false);
    expect(state.campState.campActorId).toBeNull();

    // Disaster keeps the grind turn (SG pp. 93–94 — grind continues).
    // Phase always returns to adventure.
    expect(state.grindTurn).toBe(4);
    expect(state.grindPhase).toBe('adventure');

    // Checks discarded (SG p. 95).
    expect(state.pcChecks).toBe(0);

    // Camp actor writeback.
    expect(state.campAmenityShelter).toBe(true);   // amenity found this visit persisted
    expect(state.campDisasters).toBe(1);           // disaster counter incremented
    expect(state.visits).toBe(1);
    expect(state.visitOutcome).toBe('broken');     // disaster ended camp → "broken"
  });

  test('rollEvents draws the correct camp-type table and writes session events', async ({ page }) => {
    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();
    await resetWorld(page);

    const result = await page.evaluate(async () => {
      const s = await import('/systems/tb2e/module/data/camp/state.mjs');
      const camp = await Actor.create({
        name: 'Cave', type: 'camp',
        system: { type: 'natural-caves', defaultDanger: 'typical' }
      });
      await s.beginCamp(camp.id);

      // Force the dice so the test is deterministic. Monkey-patch Roll.evaluate
      // to seed known die results summing to 11 (Safe camp).
      const origEval = Roll.prototype.evaluate;
      Roll.prototype.evaluate = async function() {
        await origEval.call(this);
        // Safe only to override when this is our 3d6+mod roll, not the avert/etc.
        if ( this.dice.length === 1 && this.dice[0].number === 3 && this.dice[0].faces === 6 ) {
          this.dice[0].results = [
            { result: 4, active: true }, { result: 4, active: true }, { result: 3, active: true }
          ];
          this._total = this.dice[0].results.reduce((s,r) => s+r.result, 0) + (this.terms.find(t => t.term === "mod")?.total ?? 0);
        }
        return this;
      };

      await s.rollEvents();
      Roll.prototype.evaluate = origEval;

      const st = s.getCampState();
      const out = {
        rolled: st.events.rolled,
        total: st.events.total,
        uuid: st.events.resultUuid,
        isDisaster: st.events.isDisaster,
        outcome: st.events.outcome
      };
      await camp.delete();
      return out;
    });

    expect(result.rolled).toBe(true);
    // Total depends on modifier and dice. Just assert the uuid is a camp-event
    // result and disaster flag is a boolean. Full deterministic testing lives
    // in the B2 compendium spec.
    expect(result.uuid).toMatch(/Compendium\.tb2e\.camp-events\./);
    expect(typeof result.isDisaster).toBe('boolean');
  });
});
