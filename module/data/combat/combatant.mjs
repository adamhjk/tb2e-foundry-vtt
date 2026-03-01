export default class CombatantData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      isHelping: new fields.BooleanField({ initial: false }),
      chosenSkill: new fields.StringField({ blank: true }),
      weapon: new fields.StringField({ blank: true }),
      knockedOut: new fields.BooleanField({ initial: false }),

      // Mailbox fields — player writes here, GM processes via _onUpdateDescendantDocuments.
      pendingDisposition: new fields.ObjectField(),
      pendingDistribution: new fields.ObjectField(),
      pendingActions: new fields.ArrayField(new fields.ObjectField()),
      pendingActionsLocked: new fields.BooleanField({ initial: false })
    };
  }
}
