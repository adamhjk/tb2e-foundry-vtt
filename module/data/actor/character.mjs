export default class CharacterData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    const fields = foundry.data.fields;

    // Helper for an advancement-tracked ability/skill: { rating, pass, fail }
    const advancementField = (initial = 0) => new fields.SchemaField({
      rating: new fields.NumberField({ initial, integer: true, min: 0, max: 10 }),
      pass: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
      fail: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
      learning: new fields.NumberField({ initial: 0, integer: true, min: 0 })
    });

    return {
      // ---- Who You Are ----
      stock: new fields.StringField({ blank: true }),
      class: new fields.StringField({ blank: true }),
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
      bio: new fields.StringField(),
      levelChoices: new fields.SchemaField({
        2: new fields.StringField(),
        3: new fields.StringField(),
        4: new fields.StringField(),
        5: new fields.StringField(),
        6: new fields.StringField(),
        7: new fields.StringField(),
        8: new fields.StringField(),
        9: new fields.StringField(),
        10: new fields.StringField()
      }),

      // ---- Fate & Persona ----
      fate: new fields.SchemaField({
        current: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        spent: new fields.NumberField({ initial: 0, integer: true, min: 0 })
      }),
      persona: new fields.SchemaField({
        current: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        spent: new fields.NumberField({ initial: 0, integer: true, min: 0 })
      }),
      checks: new fields.NumberField({ initial: 0, integer: true, min: 0 }),

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
        nature: new fields.SchemaField({
          rating: new fields.NumberField({ initial: 3, integer: true, min: 0, max: 7 }),
          max: new fields.NumberField({ initial: 3, integer: true, min: 0, max: 7 }),
          pass: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
          fail: new fields.NumberField({ initial: 0, integer: true, min: 0 })
        }),
        resources: advancementField(0),
        circles: advancementField(0),
        precedence: new fields.NumberField({ initial: 0, integer: true, min: 0, max: 7 })
      }),
      might: new fields.NumberField({ initial: 1, integer: true, min: 0, max: 10 }),
      natureDescriptors: new fields.ArrayField(
        new fields.StringField(),
        { initial: [] }
      ),

      // ---- Skills (41 fixed skills) ----
      skills: new fields.SchemaField({
        alchemist: advancementField(),
        arcanist: advancementField(),
        armorer: advancementField(),
        beggar: advancementField(),
        butcher: advancementField(),
        carpenter: advancementField(),
        cartographer: advancementField(),
        commander: advancementField(),
        cook: advancementField(),
        criminal: advancementField(),
        dungeoneer: advancementField(),
        enchanter: advancementField(),
        fighter: advancementField(),
        fisher: advancementField(),
        haggler: advancementField(),
        healer: advancementField(),
        hunter: advancementField(),
        jeweler: advancementField(),
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
        strategist: advancementField(),
        survivalist: advancementField(),
        tanner: advancementField(),
        theologian: advancementField(),
        weaver: advancementField()
      }),

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
        headDamage: new fields.BooleanField({ initial: false }),
        torsoDamage: new fields.BooleanField({ initial: false }),
        torsoWeariness: new fields.BooleanField({ initial: false })
      }),

      // ---- Magic ----
      memoryPalaceSlots: new fields.NumberField({ initial: 4, integer: true, min: 0 }),
      urdr: new fields.SchemaField({
        capacity: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        burden: new fields.NumberField({ initial: 0, integer: true, min: 0 })
      }),

      // ---- Conflict ----
      conflict: new fields.SchemaField({
        hp: new fields.SchemaField({
          value: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
          max: new fields.NumberField({ initial: 0, integer: true, min: 0 })
        }),
        team: new fields.StringField({ initial: "party", choices: ["party", "gm"] }),
        weapon: new fields.StringField({ blank: true }),
        weaponId: new fields.StringField({ blank: true })
      }),

      // ---- Light Level ----
      lightLevel: new fields.StringField({
        initial: "full",
        choices: ["full", "dim", "dark"]
      }),

      // ---- Allies & Enemies ----
      allies: new fields.ArrayField(new fields.SchemaField({
        name: new fields.StringField(),
        location: new fields.StringField(),
        status: new fields.StringField()
      }))
    };
  }}
