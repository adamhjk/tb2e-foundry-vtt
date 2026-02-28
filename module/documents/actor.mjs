export default class TB2EActor extends Actor {

  /** @override */
  async _preCreate(data, options, user) {
    if ( (await super._preCreate(data, options, user)) === false ) return false;

    const prototypeToken = {};
    if ( this.type === "character" ) {
      Object.assign(prototypeToken, {
        actorLink: true,
        disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY,
        displayBars: CONST.TOKEN_DISPLAY_MODES.ALWAYS,
        displayName: CONST.TOKEN_DISPLAY_MODES.OWNER,
        bar1: { attribute: "conflict.hp" }
      });
    }
    this.updateSource({ prototypeToken });
  }
}
