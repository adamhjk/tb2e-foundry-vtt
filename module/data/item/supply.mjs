import { inventoryFields } from "./_fields.mjs";

export default class SupplyData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    const fields = foundry.data.fields;

    return {
      ...inventoryFields(fields),
      supplyType: new fields.StringField({
        initial: "other",
        choices: ["food", "light", "spellMaterial", "sacramental", "ammunition", "other"]
      }),
      portions: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
      turnsRemaining: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
      skillBonuses: new fields.ArrayField(new fields.SchemaField({
        skill: new fields.StringField(),
        value: new fields.NumberField({ initial: 1, integer: true }),
        condition: new fields.StringField()
      }))
    };
  }
}
