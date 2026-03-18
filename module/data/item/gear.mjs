import { inventoryFields } from "./_fields.mjs";

export default class GearData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    const fields = foundry.data.fields;

    return {
      ...inventoryFields(fields),
      skillBonuses: new fields.ArrayField(new fields.SchemaField({
        skill: new fields.StringField(),
        value: new fields.NumberField({ initial: 1, integer: true }),
        condition: new fields.StringField()
      })),
      specialRules: new fields.StringField()
    };
  }
}
