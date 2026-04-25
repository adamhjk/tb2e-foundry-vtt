/**
 * Camp actor — a map-pinned, persistent location where the party has made
 * camp (Scholar's Guide pp. 90–96, esp. p. 91 "The game master notes the
 * camp and its amenities on the map" and p. 94 "persistent events remain
 * in play should the players return").
 *
 * Session state for the active camp visit lives in the world setting
 * `tb2e.campState`; this actor holds only state that survives across visits.
 */
export default class CampData extends foundry.abstract.TypeDataModel {

  static CAMP_TYPES = [
    "ancient-ruins",
    "dungeons",
    "natural-caves",
    "outside-town",
    "squatting-in-town",
    "wilderness"
  ];

  static DANGER_LEVELS = ["typical", "unsafe", "dangerous"];

  static defineSchema() {
    const fields = foundry.data.fields;

    return {
      // Camp type (SG p. 91). One of CAMP_TYPES.
      type: new fields.StringField({
        initial: "wilderness",
        choices: CampData.CAMP_TYPES
      }),

      // Default danger level — can be overridden per-visit in session state.
      defaultDanger: new fields.StringField({
        initial: "typical",
        choices: CampData.DANGER_LEVELS
      }),

      // Dwarven-made structure (feeds the outcast bonus per SG p. 93).
      // Applies to dungeons and ancient-ruins types when the site is
      // specifically dwarven-worked.
      isDwarvenMade: new fields.BooleanField({ initial: false }),

      // Amenities accumulated via Survivalist tests (SG p. 91).
      amenities: new fields.SchemaField({
        shelter:     new fields.BooleanField({ initial: false }),
        concealment: new fields.BooleanField({ initial: false }),
        water:       new fields.BooleanField({ initial: false })
      }),

      // Persistent events that remain in play on return (SG p. 94,
      // e.g. cave-in, spring, sanctuary).
      persistentEvents: new fields.ArrayField(new fields.SchemaField({
        key:  new fields.StringField(),
        note: new fields.StringField(),
        ts:   new fields.NumberField({ initial: 0 })
      }), { initial: [] }),

      // Cumulative disaster count for the current adventure (SG p. 93,
      // "-1 per prior disaster in this area on this adventure"). GM resets
      // via a button on the camp sheet when the adventure ends (Phase B v1;
      // replaced by adventure-tracker wiring in a future pass).
      disastersThisAdventure: new fields.NumberField({ initial: 0, integer: true, min: 0 }),

      // Visit history — appended on Break Camp.
      visits: new fields.ArrayField(new fields.SchemaField({
        ts:          new fields.NumberField({ initial: 0 }),
        outcome:     new fields.StringField(),  // "safe" | "averted" | "ended"
        disasterKey: new fields.StringField({ blank: true }),
        notes:       new fields.StringField({ blank: true })
      }), { initial: [] }),

      notes: new fields.StringField({ blank: true, initial: "" })
    };
  }
}
