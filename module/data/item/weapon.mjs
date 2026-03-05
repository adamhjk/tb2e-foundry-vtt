import { inventoryFields } from "./_fields.mjs";

export default class WeaponData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    const fields = foundry.data.fields;

    const bonusField = () => new fields.SchemaField({
      type: new fields.StringField({ initial: "dice", choices: ["dice", "success"] }),
      value: new fields.NumberField({ initial: 0, integer: true })
    });

    return {
      ...inventoryFields(fields),
      wield: new fields.NumberField({ initial: 1, integer: true, min: 1, max: 2 }),
      conflictBonuses: new fields.SchemaField({
        attack: bonusField(),
        defend: bonusField(),
        feint: bonusField(),
        maneuver: bonusField()
      }),
      specialRules: new fields.HTMLField()
    };
  }
}
