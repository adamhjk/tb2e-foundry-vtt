export default class MonsterData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    const fields = foundry.data.fields;

    return {
      // ---- Core Stats ----
      nature: new fields.NumberField({ initial: 1, integer: true, min: 0 }),
      natureDescriptors: new fields.StringField(),
      might: new fields.NumberField({ initial: 1, integer: true, min: 0, max: 8 }),
      precedence: new fields.StringField(),
      type: new fields.StringField(),
      instinct: new fields.StringField(),
      armor: new fields.StringField(),
      specialRules: new fields.HTMLField(),
      isBoss: new fields.BooleanField({ initial: false }),

      // ---- Conditions (no Fresh for monsters) ----
      conditions: new fields.SchemaField({
        hungry: new fields.BooleanField({ initial: false }),
        angry: new fields.BooleanField({ initial: false }),
        afraid: new fields.BooleanField({ initial: false }),
        exhausted: new fields.BooleanField({ initial: false }),
        injured: new fields.BooleanField({ initial: false }),
        sick: new fields.BooleanField({ initial: false }),
        dead: new fields.BooleanField({ initial: false })
      }),

      // ---- Conflict Dispositions (3 predetermined) ----
      dispositions: new fields.ArrayField(new fields.SchemaField({
        conflictType: new fields.StringField(),
        hp: new fields.NumberField({ initial: 0, integer: true, min: 0 })
      }), { initial: [{}, {}, {}] }),

      // ---- Weapons ----
      weapons: new fields.ArrayField(new fields.SchemaField({
        name: new fields.StringField(),
        conflictTypes: new fields.StringField(),
        attack: new fields.StringField(),
        defend: new fields.StringField(),
        feint: new fields.StringField(),
        maneuver: new fields.StringField()
      })),

      // ---- Conflict (active) ----
      conflict: new fields.SchemaField({
        hp: new fields.SchemaField({
          value: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
          max: new fields.NumberField({ initial: 0, integer: true, min: 0 })
        }),
        team: new fields.StringField({ initial: "gm", choices: ["party", "gm"] })
      }),

      // ---- Description (GM notes) ----
      description: new fields.HTMLField()
    };
  }

  /* -------------------------------------------- */

  prepareDerivedData() {
    const n = this.nature;

    // Suggested disposition HP per tier (reference hints, not stored values).
    this.dispositionSuggestions = [
      { key: "strength", multiplier: 2, hp: n * 2, dispositionIndex: 0, actual: this.dispositions[0]?.hp ?? 0 },
      { key: "competency", multiplier: 1, hp: n, dispositionIndex: 1, actual: this.dispositions[1]?.hp ?? 0 },
      { key: "weakness", multiplier: 0.5, hp: Math.ceil(n / 2), dispositionIndex: 2, actual: this.dispositions[2]?.hp ?? 0 }
    ];

    // Effective Nature accounting for conditions (-1D per injured/sick).
    const injured = this.conditions.injured ? 1 : 0;
    const sick = this.conditions.sick ? 1 : 0;
    this.effectiveNature = Math.max(this.nature - injured - sick, 1);
  }
}
