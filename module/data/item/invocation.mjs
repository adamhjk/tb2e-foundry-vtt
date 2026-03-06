export default class InvocationData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    const fields = foundry.data.fields;

    const bonusField = () => new fields.SchemaField({
      type: new fields.StringField({ initial: "dice", choices: ["dice", "success"] }),
      value: new fields.NumberField({ initial: 0, integer: true })
    });

    return {
      description: new fields.HTMLField(),
      circle: new fields.NumberField({ initial: 1, integer: true, min: 1, max: 4 }),

      // Casting
      castingType: new fields.StringField({ initial: "fixed", choices: ["fixed", "factors", "versus", "skillSwap"] }),
      fixedObstacle: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
      obstacleNote: new fields.StringField(),
      invocationTime: new fields.NumberField({ initial: 1, integer: true, min: 0 }),
      invocationTimeWithRelic: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
      duration: new fields.StringField(),

      // Factors (for factor-type invocations)
      factors: new fields.ArrayField(new fields.SchemaField({
        name: new fields.StringField(),
        options: new fields.ArrayField(new fields.SchemaField({
          label: new fields.StringField(),
          value: new fields.NumberField({ initial: 0, integer: true })
        }))
      })),
      factorNote: new fields.StringField(),

      // Versus test
      versusDefense: new fields.StringField({ choices: ["nature"] }),
      mightPenalty: new fields.BooleanField({ initial: true }),

      // Components
      sacramental: new fields.StringField(),

      // Relic info
      relic: new fields.StringField(),
      relicInventory: new fields.StringField(),
      burden: new fields.NumberField({ initial: 1, integer: true, min: 0 }),
      burdenWithRelic: new fields.NumberField({ initial: 0, integer: true, min: 0 }),

      // Skill swap
      swapSkill: new fields.StringField(),
      swapConflictTypes: new fields.ArrayField(new fields.StringField()),

      // Conflict bonuses (skill-swap combat invocations)
      conflictBonuses: new fields.SchemaField({
        attack: bonusField(),
        defend: bonusField(),
        feint: bonusField(),
        maneuver: bonusField()
      }),
      conflictQualities: new fields.ArrayField(new fields.SchemaField({
        name: new fields.StringField(),
        description: new fields.StringField()
      })),
      specialRules: new fields.HTMLField(),

      // Per-character tracking (state on the owned item)
      performed: new fields.BooleanField({ initial: false })
    };
  }
}
