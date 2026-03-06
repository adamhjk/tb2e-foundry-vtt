export default class SpellData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    const fields = foundry.data.fields;

    const bonusField = () => new fields.SchemaField({
      type: new fields.StringField({ initial: "dice", choices: ["dice", "success"] }),
      value: new fields.NumberField({ initial: 0, integer: true })
    });

    return {
      description: new fields.HTMLField(),
      circle: new fields.NumberField({ initial: 1, integer: true, min: 1, max: 5 }),

      // Casting
      castingType: new fields.StringField({ initial: "fixed", choices: ["fixed", "factors", "versus", "skillSwap"] }),
      fixedObstacle: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
      obstacleNote: new fields.StringField(),
      castingTime: new fields.StringField({ initial: "oneTurn", choices: ["free", "oneTurn", "twoTurns", "special"] }),
      duration: new fields.StringField(),

      // Factors (for factor-type spells)
      factors: new fields.ArrayField(new fields.SchemaField({
        name: new fields.StringField(),
        options: new fields.ArrayField(new fields.SchemaField({
          label: new fields.StringField(),
          value: new fields.NumberField({ initial: 0, integer: true })
        }))
      })),
      factorNote: new fields.StringField(),

      // Skill swap
      swapSkill: new fields.StringField(),
      swapConflictTypes: new fields.ArrayField(new fields.StringField()),

      // Versus test
      versusDefense: new fields.StringField({ choices: ["will", "nature", "willOrNature"] }),
      mightPenalty: new fields.BooleanField({ initial: false }),

      // Components
      materials: new fields.StringField(),
      focus: new fields.StringField(),

      // Learning/scribing
      scribeObstacle: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
      learnObstacle: new fields.NumberField({ initial: 0, integer: true, min: 0 }),

      // Conflict bonuses (skill-swap combat spells)
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
      library: new fields.BooleanField({ initial: false }),
      spellbookId: new fields.StringField({ initial: "" }),
      memorized: new fields.BooleanField({ initial: false }),
      cast: new fields.BooleanField({ initial: false })
    };
  }
}
