export default class ConflictData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      conflictType: new fields.StringField({ initial: "manual" }),
      phase: new fields.StringField({
        initial: "setup",
        choices: ["setup", "disposition", "weapons", "scripting", "resolve", "resolution"]
      }),
      conflictName: new fields.StringField({ blank: true }),
      groupDispositions: new fields.ObjectField(),
      currentRound: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
      rounds: new fields.ObjectField(),
      currentAction: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
      manualDispositionSkills: new fields.ArrayField(new fields.StringField()),
      manualDispositionAbility: new fields.StringField({ blank: true }),
      manualActions: new fields.ObjectField(),

      // Weapons dropped by a Disarm effect, keyed by groupId. Consumed by Rearm.
      droppedWeapons: new fields.ObjectField()
    };
  }
}
