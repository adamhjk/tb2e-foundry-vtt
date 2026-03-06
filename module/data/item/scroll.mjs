import { inventoryFields } from "./_fields.mjs";

export default class ScrollData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...inventoryFields(fields),
      spellId: new fields.StringField({ initial: "" })
    };
  }
}
