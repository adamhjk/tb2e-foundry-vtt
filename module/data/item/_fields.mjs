/**
 * Location keys for slotOptions — maps to allowed inventory positions.
 * @enum {string}
 */
export const SLOT_OPTION_KEYS = ["head", "neck", "wornHand", "carried", "torso", "belt", "feet", "pack", "pocket"];

/**
 * Shared inventory schema fields used by all gear item types.
 * @param {typeof foundry.data.fields} fields - The Foundry data fields namespace.
 * @returns {object} Schema field definitions.
 */
export function inventoryFields(fields) {
  // Build slotOptions: each key is a nullable NumberField (null = not allowed there).
  const slotOptionFields = {};
  for ( const key of SLOT_OPTION_KEYS ) {
    slotOptionFields[key] = new fields.NumberField({ nullable: true, initial: null, integer: true, min: 1 });
  }

  return {
    description: new fields.StringField(),
    slot: new fields.StringField({ initial: "" }),
    slotIndex: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
    slotOptions: new fields.SchemaField(slotOptionFields),
    cost: new fields.NumberField({ initial: 1, integer: true, min: 0 }),
    damaged: new fields.BooleanField({ initial: false }),
    dropped: new fields.BooleanField({ initial: false }),
    quantity: new fields.NumberField({ initial: 1, integer: true, min: 0 }),
    quantityMax: new fields.NumberField({ initial: 1, integer: true, min: 1 })
  };
}

/**
 * Resolve which slotOptions key applies to a given sheet slot + index.
 * @param {string} slotKey - The sheet slot group key (e.g. "hand-L", "torso", "belt", a container key).
 * @param {number} slotIndex - The index within the slot group.
 * @param {boolean} isContainer - Whether the slot group is a container.
 * @returns {string} The slotOptions key to look up.
 */
export function resolveSlotOptionKey(slotKey, slotIndex, isContainer = false) {
  if ( slotKey === "hand-L" || slotKey === "hand-R" ) {
    return slotIndex === 0 ? "wornHand" : "carried";
  }
  if ( isContainer ) return "pack";
  if ( SLOT_OPTION_KEYS.includes(slotKey) ) return slotKey;
  // Fallback: treat unknown keys as pack (container-derived keys).
  return "pack";
}

/**
 * Get the effective slots required for an item at a given location.
 * @param {object} slotOptions - The item's slotOptions object.
 * @param {string} optionKey - The resolved slotOptions key.
 * @returns {number|null} Slot cost, or null if placement is not allowed.
 */
export function getSlotCost(slotOptions, optionKey) {
  return slotOptions?.[optionKey] ?? null;
}

/**
 * Get the minimum slot cost across all allowed locations (for display when unassigned).
 * @param {object} slotOptions
 * @returns {number}
 */
export function getMinSlotCost(slotOptions) {
  let min = Infinity;
  for ( const key of SLOT_OPTION_KEYS ) {
    const v = slotOptions?.[key];
    if ( v != null && v < min ) min = v;
  }
  return min === Infinity ? 1 : min;
}

/**
 * Get the slot cost for cache placement — uses pack cost if available, otherwise the minimum slot cost.
 * @param {object} slotOptions
 * @returns {number}
 */
export function getCacheCost(slotOptions) {
  return slotOptions?.pack ?? getMinSlotCost(slotOptions);
}

/**
 * Format slotOptions into a human-readable inventory notation string.
 * @param {object} slotOptions
 * @returns {string}
 */
export function formatSlotOptions(slotOptions) {
  const labels = {
    head: "Head", neck: "Neck", wornHand: "Worn/hand",
    carried: "Carried", torso: "Torso", belt: "Belt",
    feet: "Feet", pack: "Pack", pocket: "Pocket"
  };
  const parts = [];
  for ( const key of SLOT_OPTION_KEYS ) {
    const v = slotOptions?.[key];
    if ( v != null ) parts.push(`${labels[key]} ${v}`);
  }
  return parts.join(" or ") || "—";
}
