#!/bin/bash
# Generate all token images for iconic characters and monsters
set -e

OUT="/home/adam/src/tb2e-foundry-vtt/tb2e-foundry-vtt/assets/tokens"
GEN="uv run tb2e-token generate"

echo "=== ICONIC CHARACTERS (9) ==="

echo "[1/49] Karolina..."
$GEN "Karolina. A 19-year-old orphaned human warrior woman. Wears a bearskin cloak gifted by her mentor Gudrun. Fierce young hunter who protects her friends with martial skill. Carries a spear and shield, wears leather armor. Cameo necklace from her mother. Strong, determined, practical." \
  --stock human --class warrior -o "$OUT/karolina.webp"

echo "[2/49] Beren..."
$GEN "Beren of Carcaroth. A 51-year-old dwarf outcast. Very proud of his sky blue hood. Scarred, stubborn. Carries a hand axe and round shield, wears leather armor. Signet ring on a thong around his neck. Keen at sniffing out lies, intimidating. Braided beard, weathered face." \
  --stock dwarf --class outcast -o "$OUT/beren.webp"

echo "[3/49] Taika..."
$GEN "Taika. A 73-year-old female elf ranger. Wears a green tunic that reminds her of her elfhome. Fiery and impulsive with sharp eyes that spy out ambushes and traps. Carries a bow, wears leather armor. Angular elven features, ageless bearing. Scout and pathfinder." \
  --stock elf --class ranger -o "$OUT/taika.webp"

echo "[4/49] Gerald..."
$GEN "Gerald. A 30-year-old male halfling burglar and scavenger. Never without his fluffy bright red scarf. Cheerful, excellent cook. Wears a helmet and leather armor. Carries a sling. Small stout halfling with curly hair, bright clever eyes, mischievous grin. Quick-witted." \
  --stock halfling --class burglar -o "$OUT/gerald.webp"

echo "[5/49] Varg..."
$GEN "Varg. A 21-year-old male human magician and cartographer. Never seen without his purple cloak covered in arcane sigils. Bronze bracelet on his wrist, a keepsake from his father. Vengeful, intellectual, tactical mind. Carries a dagger and spell book. Wears shoes and cloak." \
  --stock human --class magician -o "$OUT/varg.webp"

echo "[6/49] Ulrik..."
$GEN "Ulrik. A 17-year-old male human theurge and healer. Street urchin who adores fine clothes, especially his golden pantaloons. Bone knitting needles on his head, spindle relic around neck. Silver chain on hand. Carries a mace and shield. Easy smile masking moral ambiguity. Touched by the gods." \
  --stock human --class theurge -o "$OUT/ulrik.webp"

echo "[7/49] Rörik..."
$GEN "Rörik. A 21-year-old male human shaman and healer from a remote village. Wears a bearskin hat. Tongue of a liar necklace. Cloak and hand axe at belt. Wild appearance, perceptions straddle the physical world and the Otherworld. Haunted look. Carries two wineskins because he drinks constantly to quiet the spirit voices." \
  --stock human --class shaman -o "$OUT/rorik.webp"

echo "[8/49] Nienna..."
$GEN "Nienna. A 20-year-old female troll changeling skald and pathfinder. Wears a crimson tunic and cloak. Mother's locket at her neck. Carries a sword at her belt. Warrior-poet, wanderer, diplomat. Subtly otherworldly — her huldrekall nature gives her faintly uncanny features she must hide. Skeptical demeanor, voice of thunder." \
  --stock changeling --class skald -o "$OUT/nienna.webp"

echo "[9/49] Tiziri..."
$GEN "Tiziri. An 18-year-old female human thief and dungeoneer. Wears a distinctive purple-striped turban and cloak. Father's seal of office on a chain at her neck. Carries a dagger at her belt. Devil-may-care attitude, quick-witted. Outsider since childhood. Cleverness over might." \
  --stock human --class thief -o "$OUT/tiziri.webp"

echo "=== MONSTERS — UNDEAD (7) ==="

echo "[10/49] Barrow Wight..."
$GEN "A barrow wight. An evil elf or human spirit possessing its own corpse, risen from an unconsecrated grave. Undead warrior in ancient chain or plate armor. Wields a cursed blade. Terrifying aura, stench of death. Glowing eyes in a decayed face. Dark shadows, grave dirt." \
  --style undead -o "$OUT/barrow-wight.webp"

echo "[11/49] Ghoul..."
$GEN "A ghoul. A hideous undead human with an unceasing hunger for living flesh. Wears rotting rags. Carrion stench, filthy claws. Hunched, emaciated but unnaturally strong. Pale gray skin, sunken eyes glowing with hunger. Lurks at margins of civilization." \
  --style undead -o "$OUT/ghoul.webp"

echo "[12/49] Tomb Guardian..."
$GEN "A tomb guardian. An animated skeleton enslaved by evil magic to guard a tomb for eternity. Wears ancient corroded armor, carries a shield and battle axe. Empty eye sockets, bony frame. Standing rigid at attention in a dark stone tomb." \
  --style undead -o "$OUT/tomb-guardian.webp"

echo "[13/49] Aptrgangr..."
$GEN "An aptrgangr, an again-walker. A mindless animated corpse driven by insatiable hunger for living flesh. One fingernail torn from the roots. Shambling, decayed, ragged nails for weapons. Unliving flesh. Slow and relentless. Norse undead, dark and horrifying." \
  --style undead -o "$OUT/aptrgangr.webp"

echo "[14/49] Vampire Lord..."
$GEN "A vampire lord. A hideous immortal fiend who feeds on blood. Adopts an air of dark nobility despite being a creature of Chaos and death. Wears chain or plate armor. Pale skin, burning eyes, sharp fangs. Resides in a ruined castle. Can transform into wolf, bat or mist. Surrounded by gloom." \
  --style undead -o "$OUT/vampire-lord.webp"

echo "[15/49] Disturbed Spirit..."
$GEN "A disturbed spirit. An incorporeal spirit trapped in the land of the living, raging at those who disturb its rest. Ghostly, translucent, ethereal form. Ancient robes or burial wrappings partially visible. Glowing eyes full of fury. Cursed blade, terrifying visions. Dark, spectral energy." \
  --style undead -o "$OUT/disturbed-spirit.webp"

echo "[16/49] Vengeful Spirit..."
$GEN "A vengeful spirit. The spirit of a cruelly mistreated animal whose hatred has knit its bones together in a disturbing mass. Skeletal chimera of animal bones fused together. Glowing with bestial fury and inchoate rage. Gnashing teeth, broken bones reassembled wrong. Spectral, terrifying." \
  --style undead -o "$OUT/vengeful-spirit.webp"

echo "=== MONSTERS — BEASTS (7) ==="

echo "[17/49] Dire Wolf..."
$GEN "A dire wolf. A massive rangy wolf with savage lupine intellect. Fierce, territorial, capable of speech. Thick dark fur, piercing intelligent eyes, powerful jaws. Much larger than a normal wolf. Hunting in a pack." \
  --style beast -o "$OUT/dire-wolf.webp"

echo "[18/49] Stone Spider..."
$GEN "A stone spider. A cunning and vicious hunter. Massive spider with chitin armor equivalent to chain mail. Voracious appetite. Hides by clinging to walls and ceilings. Venomous fangs, eight horrible legs, eight eyes, camouflaged carapace. Silk webs." \
  --style beast -o "$OUT/stone-spider.webp"

echo "[19/49] Troll Bat..."
$GEN "A troll bat. A large carnivorous bat found in caves. Leathery wings, painful bite, keen hearing. Eye-watering ammoniac stench. Larger than a normal bat, dark and menacing. Lurks among stalactites." \
  --style beast -o "$OUT/troll-bat.webp"

echo "[20/49] Troll Rat..."
$GEN "A troll rat. A massive rat with frightening intelligence. Much larger than a normal rat, dark matted fur, sharp bite, quick claws, lithe body. Lurks in dark corners of dungeons near undead lairs. Carries diseases. Steals shiny objects." \
  --style beast -o "$OUT/troll-rat.webp"

echo "[21/49] Aurochs..."
$GEN "An aurochs. A massive horned cattle, intelligent and stubborn. Enormous, much larger than domestic cattle. Powerful rippling muscles, great curved horns. Protective and territorial. Wild and untamed, too dangerous to domesticate. Used by giants to till fields." \
  --style beast -o "$OUT/aurochs.webp"

echo "[22/49] Strix..."
$GEN "A strix. A nightmarish blood-drinking creature. Two sets of leathery wings propel a sack-like body that swells with victims' vital fluids. Long rigid proboscis that pierces flesh and bone. Claws for clinging to victims. Lurks among stalactites like bats. Hideous chittering." \
  --style beast -o "$OUT/strix.webp"

echo "[23/49] War Wasp..."
$GEN "A war wasp. A giant aggressive wasp. Massive insect with powerful mandibles and a lethal stinger. Iridescent dark wings, armored exoskeleton. Nests in colonies, hunts to feed grubs. Much larger than normal wasps. Menacing, predatory." \
  --style beast -o "$OUT/war-wasp.webp"

echo "=== MONSTERS — CREATURES (24) ==="

echo "[24/49] Kobold..."
$GEN "A kobold. A scaly, dog-like troll about the size of a halfling. Lives underground in caverns. Male with colorful head crest fanning out in display. Fascination with bombs and explosives. Loves traps. Small, scrappy, carrying a spear and sling." \
  --style creature -o "$OUT/kobold.webp"

echo "[25/49] Orc..."
$GEN "An orc. Twisted body with fanged maw, cable-like muscles and red eyes that burn like coals in darkness. Heart of granite, laugh like the clash of metal. Volatile temper. Wears a black iron shield and spiked helmet. Carries a spear and hand axe. Skulking bandit raider." \
  --style creature -o "$OUT/orc.webp"

echo "[26/49] Bugbear..."
$GEN "A bugbear. A massive furred troll with rippling muscles, savage fangs and claws. Silent when walking through forests. Wears patchwork hide armor. Carries a polearm. Over-reliant on size, with a weakness for child-flesh. Matriarchal clan creature." \
  --style creature -o "$OUT/bugbear.webp"

echo "[27/49] Creeping Ooze..."
$GEN "A creeping ooze. An alien corrosive slime — green, gray or clear. Hides in crevices or clings to walls and ceilings. Drops on unsuspecting passers-by. Dissolves wood, metal and flesh. Pseudopods, oozing mass, sticky fluid. Amorphous, translucent, horrifying." \
  --style creature -o "$OUT/creeping-ooze.webp"

echo "[28/49] Dragefolk..."
$GEN "A dragefolk warrior. A reptilian person with toothy jaws and a thick muscular tail used for balance. Scales like chain armor. Carries a trident and battle net. Found in jungles and swamps. Suspicious of fleshier peoples. Dull intelligent eyes, standing upright." \
  --style creature -o "$OUT/dragefolk.webp"

echo "[29/49] Gnoll..."
$GEN "A gnoll. A wild hyena-like troll standing seven to eight feet tall. Rangy and muscular with heavy razor-fanged jaws that crush bone. Demon-worshipping. Wears leather armor. Carries a flail and battle axe with a bow. Keeps hyenas as pets. Named after actions: Drinks Blood, Crushes Skulls." \
  --style creature -o "$OUT/gnoll.webp"

echo "[30/49] Goblin..."
$GEN "A goblin. Small, filthy and incredibly ugly. Springs from shadows. Lives to lie, cheat, steal and murder. Dark sight eyes. Carries a short sword. Wears leather armor. Scrawny legs, snaggle-toothed, cruel sense of humor. Hunched, malicious, sneering expression." \
  --style creature -o "$OUT/goblin.webp"

echo "[31/49] Guardian Statue..."
$GEN "A guardian statue. A massive construct carved from stone, enchanted by magicians to guard treasure rooms. Stone flesh like plate armor. Carries a stone mace. Heavy tread, crushing grip. Fearless, nerveless, mindless sentinel. Carved runes glow faintly. Imposing and immovable." \
  --style creature -o "$OUT/guardian-statue.webp"

echo "[32/49] Harpy..."
$GEN "A harpy. Head and torso of a woman combined with the wings and lower body of a bird of prey. Filthy, hideous despite enchanting song. Extremely vain. Savage talons, piercing screech. Fouled nest with excrement. Lazy scavenger with choking stench." \
  --style creature -o "$OUT/harpy.webp"

echo "[33/49] Hobgoblin..."
$GEN "A hobgoblin. Vicious, ruthless and disciplined troll. More dangerous than orcs or bugbears. Tyrannical. Wears leather armor with shields and helmets. Carries mace, spear and crossbow. Dreams of conquest and enslaving weaker peoples. Military bearing, cruel eyes." \
  --style creature -o "$OUT/hobgoblin.webp"

echo "[34/49] Troll Haunt..."
$GEN "A troll haunt. A gaunt yet hulking creature with rubbery skin covered in coarse hair. Prefers to dine on intelligent creatures for the dinner conversation. Lurks in ruined dwellings. Long claws, terrifying bellow, long legs. Regenerates from any wound. Dark eyes that see in complete darkness." \
  --style creature -o "$OUT/troll-haunt.webp"

echo "[35/49] Wererat..."
$GEN "A wererat in anthropomorphic form. A cursed human with a rat's head and tail walking upright. Wears leather armor and carries a shield and sword, with a bow. Scheming, skulking, cunning. Diseased accursed bite. Serves wicked masters." \
  --style creature -o "$OUT/wererat.webp"

echo "[36/49] Black Dragon..."
$GEN "A black dragon. A massive serpentine wyrm with glossy black scales. Lurks in swamps and bogs. Spitting venom, lashing tail. Dragon scales like chain armor. Sinuous form. Corrosive blood. Predatory, strikes from ambush in murky waters. Ancient, terrifying." \
  --style creature -o "$OUT/black-dragon.webp"

echo "[37/49] Red Dragon..."
$GEN "A red dragon. The largest and most powerful dragon. Gleaming red scales, enormous wingspan. Covetous, arrogant and evil beyond mortal ken. Fire breath gouts. Dragon scales like plate armor. Lairs in mountains and volcanoes. Serpentine neck, dragon terror. Hoards gold and gems." \
  --style creature -o "$OUT/red-dragon.webp"

echo "[38/49] Cyclops..."
$GEN "A cyclops. A lumbering giant, rumored offspring of the Lord of Forges. Single enormous eye. Hunched shoulders, massive frame. Wields a massive cudgel. Wears the pelt of a golden lion. Tends flocks of sheep in remote mountain valleys. Angry, hungry for human flesh." \
  --style creature -o "$OUT/cyclops.webp"

echo "[39/49] Devil Boar..."
$GEN "A jordurr, a devil boar. Massive swine rivaling a small horse in size. Aggressive and ill-tempered with razor-sharp tusks and hooves that crack stone. Tough leather hide. Roams forested lands. One ton of fury and appetite. Dark bristly fur, red eyes, foaming mouth." \
  --style beast -o "$OUT/devil-boar.webp"

echo "[40/49] Elder Nixie..."
$GEN "An elder nixie. An ancient aquatic being who has slowly lost its human-like appearance over aeons. Dangerous and powerful god-king of the deep. Ancient scales like leather armor. Protean claws, unearthly fluke tail. Sleek form. Dwells in silent deeps. Alien, primordial, terrifying water creature." \
  --style creature -o "$OUT/elder-nixie.webp"

echo "[41/49] Frosk..."
$GEN "A frosk. A frog-like humanoid that inhabits forlorn swamps and bogs. Amphibious with moist skin. Pieces together gear from scavenged goods — everything twisted, broken, covered in rust and decay. Carries a spear. Leaping legs, wide mouth. Guards spawning pools ferociously." \
  --style creature -o "$OUT/frosk.webp"

echo "[42/49] Gruxu..."
$GEN "A gruxu. A cold calculating reptilian who walks like a human but is not human. Scales gleam, eyes are dull black, tail descends from spine, head ridged with horns. Ancient civilization predating elves. Scales like chain armor. Venomous bite, lightning reflexes. Philosophical, cruel hunter of humans." \
  --style creature -o "$OUT/gruxu.webp"

echo "[43/49] Halja..."
$GEN "Halja, Queen of the Dead. An ancient Jotunn born from the blood of the First One. Wears her authority over the souls of the dead like a cloak. Piercing eyes that see through all deception. Air of deep melancholy. Sister to the Lords of Creation. Regal, ancient, terrible, crowned with dark power. Impenetrable gloom surrounds her." \
  --style creature -o "$OUT/halja.webp"

echo "[44/49] Manticore..."
$GEN "A manticore. Face of a man combined with a powerful lion-like body, red as cinnabar. Scorpion tail with a cluster of hollow poisonous spikes it hurls like javelins. Three rows of razor-sharp teeth. Cunning mind, mimics human voices. Relentless hunter, ever hungry." \
  --style creature -o "$OUT/manticore.webp"

echo "[45/49] Ogre..."
$GEN "An ogre. A human child stolen and fed giant's blood until it became a bloodthirsty massive hunched figure. Hairy bulky arms, leathery warty mitts, cruelly plucked pointed ears. Caked in dirt and filth. Collects skulls and bones as toys. Wields a bludgeon. Broken, twisted, pitiful and terrifying." \
  --style creature -o "$OUT/ogre.webp"

echo "[46/49] Owlbear..."
$GEN "An owlbear. A dangerous beast with the beak and eyes of an owl and the massive body of a bear. Aggressive and territorial. Rending claws, crushing beak. Unusual agility despite monstrous bulk. Hunts in mated pairs. Makes lair in shallow caves in deep forests." \
  --style creature -o "$OUT/owlbear.webp"

echo "[47/49] Sprikken..."
$GEN "A sprikken. A malign faerie with gnarled and twisted features, sharp lean face and mottled gray skin. Often mistaken for goblins but are not. Speaks heavily accented ancient elvish. Malicious sense of humor. Can grow to immense size when angry. Greedy, fond of pranking. Found in ruined battlements." \
  --style creature -o "$OUT/sprikken.webp"

echo "[48/49] Turtloid..."
$GEN "A turtloid. A hard-shelled reptilian humanoid. Snapping beak, retractable neck, webbed feet. Shell like plate armor. Clever and cruel. Inhabits swamps and marshes. Proud, vengeful. Creeps from behind to snatch victims. Adores candlelit dinners. Upright walking turtle person." \
  --style creature -o "$OUT/turtloid.webp"

echo "[49/49] Cinder Imp..."
$GEN "A cinder imp. A small demon that manifests in hearths and fires. Mischievous more than murderous. Spews sparks and ash, chokes dwellings with acrid smoke. Glows with the light of a candle. Fiery, impish, nasty little creature made of embers and soot. Burning eyes, smoldering skin." \
  --style creature -o "$OUT/cinder-imp.webp"

echo "=== ALL 49 TOKENS GENERATED ==="
