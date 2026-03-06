import { inventoryFields } from "./_fields.mjs";

export default class SpellbookData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...inventoryFields(fields),
      folios: new fields.NumberField({ initial: 5, integer: true, min: 1 })
    };
  }
}
