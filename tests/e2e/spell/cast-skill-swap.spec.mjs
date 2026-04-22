import { test, expect } from '../test.mjs';
import { GameUI } from '../pages/GameUI.mjs';
import { CharacterSheet } from '../pages/CharacterSheet.mjs';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §6 Spells — skillSwap casting type (DH p.99; Wizard's Ægis DH p.191).
 *
 * Rules under test:
 *   - `castingType: "skillSwap"` spells are conflict-weapon spells (DH p.99 —
 *     the "skill-swap" category, exercised by spells like Wizard's Ægis and
 *     Hammer of Heaven). They do NOT roll to cast — they are declared and
 *     activated, granting their stat profile to a conflict action slot.
 *   - In this system that is implemented as a short-circuit with two halves:
 *       1. `#onCastSpell` detects `castingType === "skillSwap"` at
 *          character-sheet.mjs:1402-1404 and calls
 *          `castSpell(actor, item, "memory")` directly — NO source chooser
 *          dialog (contrast with the multi-source branch at :1418-1429).
 *       2. `castSpell` in spell-casting.mjs:16-24 then returns early after
 *          posting a plain ChatMessage (type `CONST.CHAT_MESSAGE_STYLES.OTHER`)
 *          whose content is the localized string `TB2E.Spell.SkillSwapActive`
 *          (lang/en.json:856 — "{name} is now active as a conflict weapon.").
 *          No `rollTest` call, therefore NO roll dialog and NO roll-result
 *          chat card.
 *   - Crucially: `processSpellCast` is NEVER invoked (it only runs from the
 *     post-roll Finalize pathway in post-roll.mjs), so `spell.system.cast`
 *     and `spell.system.memorized` are NOT mutated by the cast. The spell
 *     remains in whatever state the player put it in. Per DH p.99 these
 *     spells have one-conflict duration tracked out-of-band — not via the
 *     `cast` flag that memory/spellbook/scroll spells use.
 *   - `canCast` for a skillSwap spell does NOT require memorized/spellbook/
 *     scroll (character-sheet.mjs:727-728 — the skillSwap short-circuit is
 *     the FIRST disjunct), so the Cast button renders on a skillSwap spell
 *     row even when none of those sources is present.
 *
 * Contrast with sibling §6 specs:
 *   - cast-fixed-obstacle: opens roll dialog, rolls Arcanist vs `fixedObstacle`,
 *     posts a `roll-result` chat card with `flags.tb2e.roll` + testContext.
 *     skillSwap emits NONE of those — no roll dialog, no `flags.tb2e.roll`,
 *     no `flags.tb2e.testContext` (castSpell returns before the testContext
 *     object is ever built per spell-casting.mjs:16-24 vs :45-51).
 *   - spellbook-source / scroll-one-use: rely on `processSpellCast` to post
 *     a spell-source confirmation card. skillSwap never reaches that code —
 *     the only chat message is the skillSwapActive announcement.
 *
 * Source spell: Wizard's Ægis (packs/_source/spells/wizards-aegis.yml,
 * `_id: a1b2c3d4e5f6000e`), circle 1, `castingType: skillSwap`. Chosen over
 * Hammer of Heaven (`a1b2c3d4e5f64002`, circle 4) because circle doesn't
 * affect the skillSwap short-circuit and circle 1 is the lowest-friction
 * pick; either would pass this spec.
 *
 * Narrow scope — out of scope:
 *   - Whether `swapSkill`/`swapConflictTypes` actually substitute in a
 *     subsequent conflict action (§8 Conflicts concern, not §6 Spells).
 *   - `conflictBonuses` / `conflictQualities` application (same — belongs
 *     to the conflict system, not the cast flow).
 *   - Materials/focus +1D bonuses (covered by materials-focus-bonus spec —
 *     and mechanically moot here because castSpell returns before building
 *     `contextModifiers` at spell-casting.mjs:27-43).
 *   - Localization string exact wording — we assert containment of the spell
 *     name; the {name} interpolation is the load-bearing contract.
 */
const SPELL_NAME = "Wizard's \u00C6gis";
const SPELL_ID = 'a1b2c3d4e5f6000e'; // packs/_source/spells/wizards-aegis.yml
const SPELLS_PACK = 'tb2e.spells';

test.describe('§6 Spells — skillSwap casting (no roll)', () => {
  test('activates Wizard\u2019s \u00C6gis: no roll dialog, success chat card posted, spell state untouched', async ({ page }) => {
    const actorName = `E2E SkillSwap ${Date.now()}`;

    await page.goto('/game');
    const ui = new GameUI(page);
    await ui.waitForReady();
    await ui.dismissTours();

    // Minimal character. Arcanist is irrelevant for skillSwap (no roll), but
    // we give a rating so the Magic tab renders consistently with sibling
    // specs. fresh=false purely for parity — not load-bearing here.
    const actorId = await page.evaluate(async (n) => {
      const actor = await Actor.create({
        name: n,
        type: 'character',
        system: {
          abilities: {
            will:   { rating: 4, pass: 0, fail: 0 },
            health: { rating: 3, pass: 0, fail: 0 },
            nature: { rating: 3, max: 3, pass: 0, fail: 0 }
          },
          skills: {
            arcanist: { rating: 3, pass: 0, fail: 0, learning: 0 }
          },
          conditions: { fresh: false }
        }
      });
      return actor.id;
    }, actorName);
    expect(actorId).toBeTruthy();

    // Seed the spell from the compendium. For skillSwap, `canCast` flips
    // true unconditionally (character-sheet.mjs:727-728), so we deliberately
    // leave memorized=false / no spellbookId / no scroll — this is the
    // unique skillSwap property and is worth asserting via the Cast button's
    // visibility alone. Materials/focus cleared for parity with siblings
    // (moot — never consulted on the skillSwap branch).
    const spellItemId = await page.evaluate(
      async ({ id, packId, entryId }) => {
        const actor = game.actors.get(id);
        const pack = game.packs.get(packId);
        const src = await pack.getDocument(entryId);
        const data = src.toObject();
        data.system.memorized = false;
        data.system.materials = '';
        data.system.focus = '';
        data.system.cast = false;
        data.system.spellbookId = '';
        const [created] = await actor.createEmbeddedDocuments('Item', [data]);
        return created.id;
      },
      { id: actorId, packId: SPELLS_PACK, entryId: SPELL_ID }
    );
    expect(spellItemId).toBeTruthy();

    // Sanity-check the embedded spell is the skillSwap Wizard's Ægis and
    // that we really have no conventional source (memorized/spellbook/scroll).
    // This makes the Cast-button visibility assertion downstream meaningful —
    // it proves the skillSwap short-circuit at character-sheet.mjs:727 is
    // what's enabling the button, not any of the source disjuncts.
    const initialState = await page.evaluate(
      ({ id, iid }) => {
        const actor = game.actors.get(id);
        const spell = actor.items.get(iid);
        const scrolls = (actor.itemTypes.scroll || [])
          .filter(s => s.system.spellId === spell?.id);
        return spell ? {
          name: spell.name,
          castingType: spell.system.castingType,
          memorized: spell.system.memorized,
          cast: spell.system.cast,
          spellbookId: spell.system.spellbookId,
          scrollCount: scrolls.length
        } : null;
      },
      { id: actorId, iid: spellItemId }
    );
    expect(initialState).toEqual({
      name: SPELL_NAME,
      castingType: 'skillSwap',
      memorized: false,
      cast: false,
      spellbookId: '',
      scrollCount: 0
    });

    try {
      await page.evaluate((id) => {
        game.actors.get(id).sheet.render(true);
      }, actorId);

      const sheet = new CharacterSheet(page, actorName);
      await sheet.expectOpen();
      await sheet.openMagicTab();

      // Cast button is present even without memorized/spellbook/scroll —
      // the skillSwap short-circuit at character-sheet.mjs:727 is the
      // load-bearing canCast disjunct here.
      const spellRow = sheet.spellRow(spellItemId);
      await expect(spellRow).toBeVisible();
      const castButton = spellRow.locator('button[data-action="castSpell"]');
      await expect(castButton).toBeVisible();

      // Snapshot chat count + any already-open dialogs before clicking, so
      // we can prove that NO roll dialog opens and exactly one new chat
      // message is posted.
      const initialChatCount = await page.evaluate(
        () => game.messages.contents.length
      );
      const initialDialogCount = await page.locator('dialog.dialog, .application.dialog').count();

      await castButton.click();

      // Wait for the chat message to land (the skillSwap branch of
      // `castSpell` calls `ChatMessage.create` at spell-casting.mjs:18-22
      // synchronously — it's the ONLY observable effect).
      await expect
        .poll(
          () => page.evaluate(() => game.messages.contents.length),
          { timeout: 10_000 }
        )
        .toBe(initialChatCount + 1);

      // CRITICAL contract: NO roll dialog opened. `castSpell` returns at
      // spell-casting.mjs:23 before `rollTest` is ever invoked — so none of
      // the RollDialog DOM (`.roll-dialog`, input[name="poolSize"]) should
      // appear. We give the app a generous tick to catch any async render,
      // then assert no dialog count increase.
      // eslint-disable-next-line playwright/no-wait-for-timeout -- intentional: prove non-occurrence, not waiting for occurrence.
      await page.waitForTimeout(500);
      const rollDialog = page.locator('.roll-dialog');
      await expect(rollDialog).toHaveCount(0);
      const finalDialogCount = await page.locator('dialog.dialog, .application.dialog').count();
      expect(finalDialogCount).toBe(initialDialogCount);

      // Locate the announcement message. It's scoped via `speaker.actor`
      // (spell-casting.mjs:19 — `ChatMessage.getSpeaker({ actor })`), not
      // via `flags.tb2e.actorId` — that flag is only set by `_buildRollFlags`
      // in tb2e-roll.mjs, which is NOT called on this branch.
      const msgSnapshot = await page.evaluate((id) => {
        const msg = game.messages.contents
          .filter(m => m.speaker?.actor === id)
          .at(-1);
        if ( !msg ) return null;
        return {
          content: msg.content,
          speakerActor: msg.speaker?.actor ?? null,
          hasRollFlag: !!msg.flags?.tb2e?.roll,
          hasTestContextFlag: !!msg.flags?.tb2e?.testContext,
          hasSpellSourceFlag: !!msg.flags?.tb2e?.spellSource,
          isRoll: msg.isRoll === true
        };
      }, actorId);
      expect(msgSnapshot).not.toBeNull();

      // Content contains the spell name (the `{name}` interpolation in
      // `TB2E.Spell.SkillSwapActive` — lang/en.json:856). The exact string
      // is "{name} is now active as a conflict weapon." but we deliberately
      // only assert containment of the spell name to keep this spec robust
      // against localization-copy tweaks.
      expect(msgSnapshot.content).toContain(SPELL_NAME);
      // The announcement is a plain OTHER-type message, not a roll — so it
      // must NOT carry any of the roll/spell-source flag payloads that the
      // rolling branches set. This is the positive proof that the
      // skillSwap branch short-circuited BEFORE reaching any of them.
      expect(msgSnapshot.hasRollFlag).toBe(false);
      expect(msgSnapshot.hasTestContextFlag).toBe(false);
      expect(msgSnapshot.hasSpellSourceFlag).toBe(false);
      expect(msgSnapshot.isRoll).toBe(false);
      expect(msgSnapshot.speakerActor).toBe(actorId);

      // No roll-result chat card was rendered (the DOM companion to the
      // "no roll dialog" contract above). roll-result cards live inside a
      // `.tb2e-roll-card` container — scope to messages whose speaker is
      // this actor and check none exist.
      const rollCardForActor = page.locator('.chat-message').filter({
        has: page.locator(`[data-actor-id="${actorId}"]`)
      }).locator('.tb2e-roll-card');
      await expect(rollCardForActor).toHaveCount(0);

      // Post-cast: no state mutation. The skillSwap branch returns before
      // `processSpellCast` can run (it's only called from the post-roll
      // Finalize flow in post-roll.mjs, which requires a rollTest — skipped
      // here). So `memorized` and `cast` remain exactly as we seeded them.
      const postCast = await page.evaluate(
        ({ id, iid }) => {
          const spell = game.actors.get(id).items.get(iid);
          return spell ? {
            memorized: spell.system.memorized,
            cast: spell.system.cast,
            spellbookId: spell.system.spellbookId
          } : null;
        },
        { id: actorId, iid: spellItemId }
      );
      expect(postCast).toEqual({
        memorized: false,
        cast: false,
        spellbookId: ''
      });
    } finally {
      await page.evaluate((id) => game.actors.get(id)?.delete(), actorId);
    }
  });
});
