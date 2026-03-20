export default class TB2EActor extends Actor {

  /** @override */
  static getDefaultArtwork(actorData = {}) {
    const icons = {
      character: "icons/svg/cowled.svg",
      npc: "icons/svg/village.svg",
      monster: "icons/svg/skull.svg"
    };
    const img = icons[actorData.type];
    if ( img ) return { img, texture: { src: img } };
    return super.getDefaultArtwork(actorData);
  }

  /** @override */
  async _preCreate(data, options, user) {
    if ( (await super._preCreate(data, options, user)) === false ) return false;

    const dispositions = {
      character: CONST.TOKEN_DISPOSITIONS.FRIENDLY,
      npc: CONST.TOKEN_DISPOSITIONS.NEUTRAL,
      monster: CONST.TOKEN_DISPOSITIONS.HOSTILE
    };
    const disposition = dispositions[this.type];
    if ( disposition !== undefined ) {
      const isCharacter = this.type === "character";
      this.updateSource({ prototypeToken: {
        actorLink: isCharacter,
        appendNumber: !isCharacter,
        disposition,
        displayBars: CONST.TOKEN_DISPLAY_MODES.ALWAYS,
        displayName: CONST.TOKEN_DISPLAY_MODES.ALWAYS,
        bar1: { attribute: "conflict.hp" }
      }});
    }
  }
}
