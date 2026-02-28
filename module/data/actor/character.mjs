export default class CharacterData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    const fields = foundry.data.fields;

    // Helper for an advancement-tracked ability/skill: { rating, pass, fail }
    const advancementField = (initial = 0) => new fields.SchemaField({
      rating: new fields.NumberField({ initial, integer: true, min: 0, max: 10 }),
      pass: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
      fail: new fields.NumberField({ initial: 0, integer: true, min: 0 })
    });

    return {
      // ---- Who You Are ----
      stock: new fields.StringField(),
      class: new fields.StringField(),
      age: new fields.StringField(),
      home: new fields.StringField(),
      raiment: new fields.StringField(),
      parents: new fields.StringField(),
      mentor: new fields.StringField(),
      friend: new fields.StringField(),
      enemy: new fields.StringField(),
      level: new fields.NumberField({ initial: 1, integer: true, min: 1, max: 10 }),

      // ---- What You Fight For ----
      belief: new fields.StringField(),
      creed: new fields.StringField(),
      goal: new fields.StringField(),
      instinct: new fields.StringField(),

      // ---- Biography ----
      bio: new fields.HTMLField(),

      // ---- Fate & Persona ----
      fate: new fields.SchemaField({
        current: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        total: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        spent: new fields.NumberField({ initial: 0, integer: true, min: 0 })
      }),
      persona: new fields.SchemaField({
        current: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        total: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        spent: new fields.NumberField({ initial: 0, integer: true, min: 0 })
      }),
      checks: new fields.SchemaField({
        earned: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        remaining: new fields.NumberField({ initial: 0, integer: true, min: 0 })
      }),

      // ---- Conditions ----
      conditions: new fields.SchemaField({
        fresh: new fields.BooleanField({ initial: true }),
        hungry: new fields.BooleanField({ initial: false }),
        angry: new fields.BooleanField({ initial: false }),
        afraid: new fields.BooleanField({ initial: false }),
        exhausted: new fields.BooleanField({ initial: false }),
        injured: new fields.BooleanField({ initial: false }),
        sick: new fields.BooleanField({ initial: false }),
        dead: new fields.BooleanField({ initial: false })
      }),

      // ---- Abilities ----
      abilities: new fields.SchemaField({
        will: advancementField(4),
        health: advancementField(4),
        nature: advancementField(3),
        resources: advancementField(0),
        circles: advancementField(0),
        precedence: advancementField(0)
      }),
      might: new fields.NumberField({ initial: 1, integer: true, min: 0, max: 10 }),
      natureDescriptors: new fields.StringField(),

      // ---- Skills (34 fixed skills) ----
      skills: new fields.SchemaField({
        alchemist: advancementField(),
        arcanist: advancementField(),
        armorer: advancementField(),
        carpenter: advancementField(),
        cartographer: advancementField(),
        commander: advancementField(),
        cook: advancementField(),
        criminal: advancementField(),
        dungeoneer: advancementField(),
        fighter: advancementField(),
        haggler: advancementField(),
        healer: advancementField(),
        hunter: advancementField(),
        laborer: advancementField(),
        loremaster: advancementField(),
        manipulator: advancementField(),
        mentor: advancementField(),
        orator: advancementField(),
        pathfinder: advancementField(),
        peasant: advancementField(),
        persuader: advancementField(),
        rider: advancementField(),
        ritualist: advancementField(),
        sailor: advancementField(),
        sapper: advancementField(),
        scavenger: advancementField(),
        scholar: advancementField(),
        scout: advancementField(),
        smith: advancementField(),
        steward: advancementField(),
        stonemason: advancementField(),
        survivalist: advancementField(),
        theologian: advancementField(),
        weaver: advancementField()
      }),

      // ---- Traits (4 slots) ----
      traits: new fields.ArrayField(new fields.SchemaField({
        name: new fields.StringField(),
        level: new fields.NumberField({ initial: 1, integer: true, min: 1, max: 3 }),
        beneficial: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        checks: new fields.NumberField({ initial: 0, integer: true, min: 0 })
      })),

      // ---- Wises (4 slots) ----
      wises: new fields.ArrayField(new fields.SchemaField({
        name: new fields.StringField(),
        pass: new fields.BooleanField({ initial: false }),
        fail: new fields.BooleanField({ initial: false }),
        fate: new fields.BooleanField({ initial: false }),
        persona: new fields.BooleanField({ initial: false })
      })),

      // ---- Inventory config ----
      inventory: new fields.SchemaField({
        packType: new fields.StringField({ initial: "none", choices: ["none", "satchel", "backpack"] }),
        hasLargeSack: new fields.BooleanField({ initial: false }),
        smallSacks: new fields.NumberField({ initial: 0, integer: true, min: 0, max: 3 }),
        torsoDamage: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        torsoWeariness: new fields.NumberField({ initial: 0, integer: true, min: 0 })
      }),

      // ---- Magic ----
      spells: new fields.ArrayField(new fields.SchemaField({
        name: new fields.StringField(),
        obstacle: new fields.StringField(),
        library: new fields.BooleanField({ initial: false }),
        spellbook: new fields.BooleanField({ initial: false }),
        memorized: new fields.BooleanField({ initial: false }),
        cast: new fields.BooleanField({ initial: false }),
        scroll: new fields.BooleanField({ initial: false }),
        supplies: new fields.StringField()
      })),
      relics: new fields.ArrayField(new fields.SchemaField({
        name: new fields.StringField(),
        inventory: new fields.StringField(),
        invocation: new fields.StringField(),
        circle: new fields.StringField()
      })),
      urdr: new fields.SchemaField({
        burden: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        memoryPalace: new fields.HTMLField()
      }),

      // ---- Conflict ----
      conflict: new fields.SchemaField({
        hp: new fields.SchemaField({
          value: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
          max: new fields.NumberField({ initial: 0, integer: true, min: 0 })
        })
      }),

      // ---- Allies & Enemies ----
      allies: new fields.ArrayField(new fields.SchemaField({
        name: new fields.StringField(),
        location: new fields.StringField(),
        status: new fields.StringField()
      }))
    };
  }
}
