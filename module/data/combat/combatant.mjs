export default class CombatantData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      weapon: new fields.StringField({ blank: true }),
      weaponId: new fields.StringField({ blank: true }),
      knockedOut: new fields.BooleanField({ initial: false }),
      isBoss: new fields.BooleanField({ initial: false }),
      actedLastRound: new fields.ArrayField(new fields.NumberField({ integer: true })),

      // Weapon assignment for "assignable" conflict weapons (e.g., Blackmail, Locals).
      weaponAssignment: new fields.StringField({ blank: true }),

      // Item IDs (weapons, gear, traits) disabled by a Disarm effect for the
      // duration of this conflict (SG p.69). Cleared when combat ends.
      disabledItemIds: new fields.ArrayField(new fields.StringField()),

      // Mailbox fields — player writes here, GM processes via _onUpdateDescendantDocuments.
      pendingDisposition: new fields.ObjectField(),
      pendingDistribution: new fields.ObjectField(),
      pendingActions: new fields.ArrayField(new fields.ObjectField()),
      pendingActionsLocked: new fields.BooleanField({ initial: false }),
      pendingManeuverSpend: new fields.ObjectField()
    };
  }
}
