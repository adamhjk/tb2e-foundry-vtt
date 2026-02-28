export default class CombatantData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      isHelping: new fields.BooleanField({ initial: false }),
      chosenSkill: new fields.StringField({ blank: true })
    };
  }
}
