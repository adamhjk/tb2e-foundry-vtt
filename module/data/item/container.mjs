import { inventoryFields } from "./_fields.mjs";

export default class ContainerData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    const fields = foundry.data.fields;

    return {
      ...inventoryFields(fields),
      containerKey: new fields.StringField(),
      containerSlots: new fields.NumberField({ initial: 6, integer: true, min: 0 }),
      containerType: new fields.StringField({
        initial: "backpack",
        choices: ["backpack", "satchel", "largeSack", "smallSack", "pouch", "quiver", "waterskin", "bottle", "jug"]
      }),
      liquidType: new fields.StringField({ initial: "water" }),
      lost: new fields.BooleanField({ initial: false })
    };
  }
}
