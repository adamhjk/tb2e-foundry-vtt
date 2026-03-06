/**
 * Reset session-tracked trait fields for a new session/prologue.
 * Restores beneficial uses and clears usedAgainst flags.
 * Also clears the "cast" flag on all spell items and "performed" on invocations.
 * @param {Actor} actor
 */
export async function resetTraitsForSession(actor) {
  const updates = [];

  // Reset traits
  const traits = actor.itemTypes.trait || [];
  for ( const item of traits ) {
    updates.push({
      _id: item.id,
      "system.beneficial": item.system.level >= 3 ? 0 : item.system.level,
      "system.usedAgainst": false
    });
  }

  // Reset spell cast flags
  const spells = actor.itemTypes.spell || [];
  for ( const item of spells ) {
    if ( item.system.cast ) {
      updates.push({ _id: item.id, "system.cast": false });
    }
  }

  // Reset invocation performed flags
  const invocations = actor.itemTypes.invocation || [];
  for ( const item of invocations ) {
    if ( item.system.performed ) {
      updates.push({ _id: item.id, "system.performed": false });
    }
  }

  if ( updates.length ) await actor.updateEmbeddedDocuments("Item", updates);
}
