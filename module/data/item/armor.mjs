import { inventoryFields } from "./_fields.mjs";

export default class ArmorData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    const fields = foundry.data.fields;

    return {
      ...inventoryFields(fields),
      armorType: new fields.StringField({
        initial: "leather",
        choices: ["leather", "chain", "plate", "helmet", "shield"]
      }),
      absorbs: new fields.NumberField({ initial: 1, integer: true, min: 0 }),
      specialRules: new fields.StringField()
    };
  }
}
