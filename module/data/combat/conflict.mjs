export default class ConflictData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      conflictType: new fields.StringField({ initial: "capture" }),
      phase: new fields.StringField({
        initial: "setup",
        choices: ["setup", "rolling", "distribution", "active"]
      }),
      groupDispositions: new fields.ObjectField(),
      currentRound: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
      rounds: new fields.ObjectField()
    };
  }
}
