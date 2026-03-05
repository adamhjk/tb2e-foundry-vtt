/**
 * Shared inventory schema fields used by all gear item types.
 * @param {typeof foundry.data.fields} fields - The Foundry data fields namespace.
 * @returns {object} Schema field definitions.
 */
export function inventoryFields(fields) {
  return {
    description: new fields.HTMLField(),
    slot: new fields.StringField({ initial: "" }),
    slotIndex: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
    slotsRequired: new fields.NumberField({ initial: 1, integer: true, min: 1 }),
    cost: new fields.NumberField({ initial: 1, integer: true, min: 0 }),
    inventoryNotation: new fields.StringField(),
    damaged: new fields.BooleanField({ initial: false }),
    dropped: new fields.BooleanField({ initial: false }),
    quantity: new fields.NumberField({ initial: 1, integer: true, min: 0 }),
    quantityMax: new fields.NumberField({ initial: 1, integer: true, min: 1 })
  };
}
