import { inventoryFields } from "./_fields.mjs";

export default class RelicData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    const fields = foundry.data.fields;

    return {
      ...inventoryFields(fields),
      relicTier: new fields.StringField({ initial: "minor", choices: ["minor", "named", "great"] }),
      linkedInvocations: new fields.ArrayField(new fields.StringField()),
      linkedCircle: new fields.NumberField({ nullable: true, initial: null, integer: true, min: 1, max: 4 }),
      immortal: new fields.StringField(),
      lore: new fields.StringField()
    };
  }
}
