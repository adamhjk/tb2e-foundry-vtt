/**
 * Reset session-tracked trait fields for a new session/prologue.
 * Restores beneficial uses and clears usedAgainst flags.
 * @param {Actor} actor
 */
export async function resetTraitsForSession(actor) {
  const traits = actor.itemTypes.trait || [];
  if ( !traits.length ) return;

  const updates = traits.map(item => ({
    _id: item.id,
    "system.beneficial": item.system.level >= 3 ? 0 : item.system.level,
    "system.usedAgainst": false
  }));
  await actor.updateEmbeddedDocuments("Item", updates);
}
