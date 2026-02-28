"""Build a searchable JSON index from the Torchbearer 2E PDFs."""

import json
from pathlib import Path

import pymupdf


BOOKS = {
    "scholars-guide": {
        "file": "scholars-guide.pdf",
        "title": "Scholar's Guide",
        "description": "Game mechanics — obstacles, grind, conditions, conflict, fate, camp, town, respite, adventure design, denizens, loot",
    },
    "dungeoneers-handbook": {
        "file": "dungeoneers-handbook.pdf",
        "title": "Dungeoneer's Handbook",
        "description": "Character-focused — abilities, nature, skills, traits, inventory, arcana, ritual, advancement, levels, gear, spells",
    },
}

# Watermark text to strip
WATERMARK_FONT = "Helvetica"
WATERMARK_MAX_SIZE = 7.0


def _extract_page_text(page):
    """Extract clean text from a page, stripping watermarks."""
    blocks = page.get_text("dict")["blocks"]
    lines = []
    for block in blocks:
        if "lines" not in block:
            continue
        for line in block["lines"]:
            parts = []
            for span in line["spans"]:
                # Skip watermark
                if span["font"] == WATERMARK_FONT and span["size"] <= WATERMARK_MAX_SIZE:
                    continue
                text = span["text"].strip()
                if text:
                    parts.append(text)
            if parts:
                lines.append(" ".join(parts))
    return "\n".join(lines)


def _detect_headings(page):
    """Detect headings on a page using font analysis.

    Returns a list of {"level": int, "text": str} dicts.

    Font hierarchy (from PDF analysis):
      LongbowBB ~120pt  -> chapter title (decorative, duplicated for shadow)
      LongbowBB ~20pt   -> running header
      Souvenir-Medium 26.8pt -> chapter intro drop cap (skip)
      Souvenir-Demi-SC700 18/12.6pt -> section heading (small caps, duplicated)
      Souvenir-Demi 12pt -> subsection heading
      Souvenir-MediumItalic 10pt -> sub-subsection heading
    """
    blocks = page.get_text("dict")["blocks"]
    headings = []
    seen_sc_texts = set()  # deduplicate shadow-duplicated SC700 headings

    for block in blocks:
        if "lines" not in block:
            continue
        for line in block["lines"]:
            spans = line["spans"]
            if not spans:
                continue

            first_font = spans[0]["font"]
            first_size = round(spans[0]["size"], 0)

            # LongbowBB large = chapter title (skip shadow duplicates)
            if "LongbowBB" in first_font and first_size >= 100:
                text = " ".join(s["text"].strip() for s in spans if s["text"].strip())
                if text:
                    headings.append({"level": 1, "text": text, "type": "chapter"})

            # LongbowBB small = running header (useful for context)
            elif "LongbowBB" in first_font and first_size <= 25:
                text = " ".join(s["text"].strip() for s in spans if s["text"].strip())
                if text:
                    headings.append({"level": 1, "text": text, "type": "running"})

            # Souvenir-Demi-SC700 = section heading (small caps)
            elif "SC700" in first_font:
                # Reassemble small-caps text from split spans
                text = _reassemble_sc700(spans)
                if text and text not in seen_sc_texts:
                    seen_sc_texts.add(text)
                    headings.append({"level": 2, "text": text, "type": "section"})

            # Souvenir-Demi 12pt = subsection
            elif "Souvenir-Demi" in first_font and "SC700" not in first_font and first_size >= 11:
                text = " ".join(s["text"].strip() for s in spans if s["text"].strip())
                # Skip page numbers (single number, 9pt)
                if text and not text.isdigit():
                    headings.append({"level": 3, "text": text, "type": "subsection"})

            # Souvenir-MediumItalic = sub-subsection
            elif "MediumItalic" in first_font:
                text = " ".join(s["text"].strip() for s in spans if s["text"].strip())
                if text:
                    headings.append({"level": 4, "text": text, "type": "subsubsection"})

    return headings


def _reassemble_sc700(spans):
    """Reassemble small-caps text from SC700 font spans.

    These are split character-by-character with alternating 18pt caps and 12.6pt lowercase.
    E.g. [T][est] [to] [O][vercome] [an] [O][bstacle]
    """
    # Collect raw text from SC700 spans, preserving internal spaces
    raw_parts = []
    for span in spans:
        if "SC700" not in span["font"]:
            continue
        text = span["text"]
        if text:
            raw_parts.append(text)
    if not raw_parts:
        return ""
    # Join spans intelligently:
    # - If prev ends with uppercase and next starts with lowercase, they're
    #   parts of the same word (cap + rest) — join directly
    # - If prev ends with lowercase and next starts with lowercase, they're
    #   separate words — add space
    # - Otherwise, concatenate raw (the span text itself has spaces)
    result = raw_parts[0]
    for part in raw_parts[1:]:
        if result and part:
            last_ch = result[-1]
            first_ch = part[0]
            if last_ch.isupper() and first_ch.islower():
                # Same word: capital letter + rest (e.g., "R" + "ating")
                result += part
            elif last_ch.islower() and first_ch.islower():
                # Different words, both lowercase
                result += " " + part
            else:
                result += part
        else:
            result += part
    # Clean up multiple spaces and strip
    while "  " in result:
        result = result.replace("  ", " ")
    return result.strip()


def build_index(reference_dir: Path, output_path: Path):
    """Build the searchable index from both PDFs.

    Args:
        reference_dir: Directory containing the PDF files
        output_path: Where to save index.json
    """
    index = {"books": {}, "pages": [], "toc": []}

    for book_key, book_info in BOOKS.items():
        pdf_path = reference_dir / book_info["file"]
        if not pdf_path.exists():
            print(f"Warning: {pdf_path} not found, skipping")
            continue

        print(f"Indexing {book_info['title']}...")
        doc = pymupdf.open(str(pdf_path))

        index["books"][book_key] = {
            "title": book_info["title"],
            "description": book_info["description"],
            "pages": len(doc),
        }

        # Extract TOC bookmarks
        toc = doc.get_toc()
        for level, title, page_num in toc:
            index["toc"].append({
                "book": book_key,
                "level": level,
                "title": title,
                "page": page_num,
            })

        # Extract page data
        for pg_idx in range(len(doc)):
            page = doc[pg_idx]
            text = _extract_page_text(page)
            headings = _detect_headings(page)

            # Only store pages with actual content
            if text.strip():
                index["pages"].append({
                    "book": book_key,
                    "page": pg_idx + 1,  # 1-based page number
                    "text": text,
                    "headings": headings,
                })

            if (pg_idx + 1) % 50 == 0:
                print(f"  ...page {pg_idx + 1}/{len(doc)}")

        print(f"  Done: {len(doc)} pages indexed")
        doc.close()

    # Write index
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(index, f, indent=2)

    total_pages = len(index["pages"])
    total_toc = len(index["toc"])
    print(f"\nIndex saved to {output_path}")
    print(f"  {total_pages} pages, {total_toc} TOC entries")
