export default class TraitData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    const fields = foundry.data.fields;

    return {
      description: new fields.StringField(),
      level: new fields.NumberField({ initial: 1, integer: true, min: 1, max: 3 }),
      isClass: new fields.BooleanField({ initial: false }),
      beneficial: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
      usedAgainst: new fields.BooleanField({ initial: false }),
      checks: new fields.NumberField({ initial: 0, integer: true, min: 0 })
    };
  }

  /**
   * Maximum beneficial uses per session based on trait level.
   * L1 = 1/session, L2 = 2/session, L3 = unlimited +1s (no beneficial count).
   * @type {number}
   */
  get maxBeneficial() {
    return this.level >= 3 ? 0 : this.level;
  }
}
