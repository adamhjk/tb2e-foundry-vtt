import TraitData from "./trait.mjs";
import WeaponData from "./weapon.mjs";
import ArmorData from "./armor.mjs";
import ContainerData from "./container.mjs";
import GearData from "./gear.mjs";
import SupplyData from "./supply.mjs";
import SpellData from "./spell.mjs";
import SpellbookData from "./spellbook.mjs";
import ScrollData from "./scroll.mjs";
import InvocationData from "./invocation.mjs";
import RelicData from "./relic.mjs";
export { SLOT_OPTION_KEYS, resolveSlotOptionKey, getSlotCost, getMinSlotCost, formatSlotOptions } from "./_fields.mjs";

export { TraitData, WeaponData, ArmorData, ContainerData, GearData, SupplyData, SpellData, SpellbookData, ScrollData, InvocationData, RelicData };

export const config = {
  trait: TraitData,
  weapon: WeaponData,
  armor: ArmorData,
  container: ContainerData,
  gear: GearData,
  supply: SupplyData,
  spell: SpellData,
  spellbook: SpellbookData,
  scroll: ScrollData,
  invocation: InvocationData,
  relic: RelicData
};
