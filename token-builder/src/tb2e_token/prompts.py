"""Prompt templates and assembly for Torchbearer 2E token generation."""

BASELINE = (
    "A single character portrait for a tabletop RPG token. "
    "Inspired by 1980s Dungeons & Dragons illustration art — "
    "Larry Elmore, Jeff Easley, Keith Parkinson — with a Norse dark fantasy twist. "
    "Rich oil-painting style, warm lamplight and deep shadows, "
    "slightly grainy texture like a classic module cover. "
    "Medieval Scandinavian clothing and equipment. "
    "Weathered, travel-worn, and determined. "
    "Solid neutral background. "
    "No borders, frames, or rings."
)

STYLES = {
    "portrait": "Chest-up portrait of a person.",
    "creature": "Full body depiction of a fantasy creature or monster.",
    "beast": "Full body depiction of a natural or supernatural animal.",
    "undead": "Decaying, spectral, or skeletal figure. Eerie glow.",
}

STOCKS = {
    "halfling": "Small, stout halfling with curly hair and bright eyes. Rustic, pastoral appearance.",
    "human": "Human of Norse or Germanic appearance. Rugged, practical demeanor.",
    "dwarf": "Stout dwarf with braided beard and strong features. Stone-carved resilience.",
    "elf": "Tall, slender elf with angular features and an ageless, melancholic bearing.",
    "changeling": "Subtly otherworldly human with faintly uncanny features. Something slightly off about their appearance.",
}

CLASSES = {
    "burglar": "Wears practical, dark clothing. Nimble and alert, with clever eyes.",
    "magician": "Robed in arcane vestments. Carries rune-inscribed tools. Intellectual bearing.",
    "outcast": "Heavily scarred or marked. Wears patchwork armor. Defiant expression.",
    "ranger": "Wears forest-green cloak and leather. Carries a bow. Watchful and silent.",
    "theurge": "Wears religious vestments with Norse iconography. Carries a holy relic.",
    "warrior": "Wears chain mail or leather armor. Carries a shield. Battle-hardened.",
    "shaman": "Adorned with bone fetishes and animal totems. Wild, untamed appearance.",
    "skald": "Carries a musical instrument. Wears storyteller's garb. Charismatic presence.",
    "thief": "Wears dark, nondescript clothing. Has a calculating look and quick hands.",
}

SUFFIX = "No text, no watermark, no border, no frame."


def assemble_prompt(description, *, style="portrait", stock=None, character_class=None):
    """Assemble a full DALL-E prompt from components."""
    parts = [BASELINE]

    if style in STYLES:
        parts.append(STYLES[style])

    if stock and stock in STOCKS:
        parts.append(STOCKS[stock])

    if character_class and character_class in CLASSES:
        parts.append(CLASSES[character_class])

    parts.append(description)
    parts.append(SUFFIX)

    return " ".join(parts)
