export default class NPCData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    const fields = foundry.data.fields;

    return {
      // ---- Identity ----
      stock: new fields.StringField(),
      class: new fields.StringField(),
      goal: new fields.StringField(),

      // ---- Abilities (flat ratings, no advancement) ----
      abilities: new fields.SchemaField({
        nature: new fields.NumberField({ initial: 1, integer: true, min: 0 }),
        will: new fields.NumberField({ initial: 1, integer: true, min: 0 }),
        health: new fields.NumberField({ initial: 1, integer: true, min: 0 }),
        resources: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        circles: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        precedence: new fields.NumberField({ initial: 0, integer: true, min: 0 })
      }),

      // ---- Might (default 2 for regular folks) ----
      might: new fields.NumberField({ initial: 2, integer: true, min: 0 }),

      // ---- Skills (variable-length list, key references config.skills) ----
      skills: new fields.ArrayField(new fields.SchemaField({
        key: new fields.StringField(),
        rating: new fields.NumberField({ initial: 0, integer: true, min: 0 })
      })),

      // ---- Wises ----
      wises: new fields.ArrayField(new fields.StringField()),

      // ---- Conditions (no Fresh for NPCs) ----
      conditions: new fields.SchemaField({
        hungry: new fields.BooleanField({ initial: false }),
        angry: new fields.BooleanField({ initial: false }),
        afraid: new fields.BooleanField({ initial: false }),
        exhausted: new fields.BooleanField({ initial: false }),
        injured: new fields.BooleanField({ initial: false }),
        sick: new fields.BooleanField({ initial: false }),
        dead: new fields.BooleanField({ initial: false })
      }),

      // ---- Conflict (active) ----
      conflict: new fields.SchemaField({
        hp: new fields.SchemaField({
          value: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
          max: new fields.NumberField({ initial: 0, integer: true, min: 0 })
        }),
        team: new fields.StringField({ initial: "gm", choices: ["party", "gm"] }),
        weapon: new fields.StringField({ blank: true })
      }),

      // ---- Description (GM notes) ----
      description: new fields.HTMLField()
    };
  }
}
