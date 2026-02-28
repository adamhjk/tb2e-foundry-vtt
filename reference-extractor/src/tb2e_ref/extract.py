"""Extract pages from Torchbearer 2E PDFs to markdown + images."""

from pathlib import Path

import pymupdf

from .index import BOOKS, WATERMARK_FONT, WATERMARK_MAX_SIZE


# Font classification rules (from PDF analysis)
# Font name contains -> (markdown role, level)
FONT_RULES = [
    # LongbowBB large = decorative chapter title (shadow duplicated, take first)
    (lambda f, s: "LongbowBB" in f and s >= 100, "chapter_title"),
    # LongbowBB small = running header at top of page
    (lambda f, s: "LongbowBB" in f and s <= 25, "running_header"),
    # Souvenir-Medium 26+ = chapter intro drop cap (first letter of chapter intro)
    (lambda f, s: "Souvenir-Medium" in f and "Italic" not in f and s >= 20, "drop_cap"),
    # Souvenir-Demi-SC700 = section heading (small caps, duplicated for shadow)
    (lambda f, s: "SC700" in f, "section_heading"),
    # Souvenir-Demi 12pt = subsection heading
    (lambda f, s: "Souvenir-Demi" in f and "SC700" not in f and s >= 11, "subsection"),
    # Souvenir-MediumItalic = sub-subsection (recovery instructions etc)
    (lambda f, s: "MediumItalic" in f, "subsubsection"),
    # Souvenir-Demi 9pt = page number or bold inline
    (lambda f, s: "Souvenir-Demi" in f and "SC700" not in f and s < 11, "bold_or_pagenum"),
    # ComicPlain = example text
    (lambda f, s: "ComicPlain" in f, "example"),
    # Souvenir-Light = body text
    (lambda f, s: "Souvenir-Light" in f, "body"),
    # WoodtypeOrnaments = bullet markers
    (lambda f, s: "Woodtype" in f, "bullet"),
    # Souvenir-Medium 9pt = body text (sometimes used for first word after drop cap)
    (lambda f, s: "Souvenir-Medium" in f and "Italic" not in f and s < 20, "body"),
]


def _classify_span(span):
    """Classify a span by its font into a markdown role."""
    font = span["font"]
    size = round(span["size"], 0)

    # Skip watermark
    if font == WATERMARK_FONT and span["size"] <= WATERMARK_MAX_SIZE:
        return "watermark"

    for test, role in FONT_RULES:
        if test(font, size):
            return role

    return "unknown"


def _reassemble_sc700_line(spans):
    """Reassemble small-caps text from SC700 spans in a line."""
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


def _classify_line(spans):
    """Classify a line by examining all its spans.

    Returns (role, text) where role determines markdown formatting.
    """
    if not spans:
        return None, ""

    roles = []
    for span in spans:
        role = _classify_span(span)
        text = span["text"].strip()
        if text or role == "bullet":
            roles.append((role, text, span))

    if not roles:
        return None, ""

    # Filter out watermarks
    roles = [(r, t, s) for r, t, s in roles if r != "watermark"]
    if not roles:
        return None, ""

    # Check for specific patterns
    first_role = roles[0][0]

    # Pure bullet marker line (no text content)
    if all(r == "bullet" for r, t, s in roles):
        return "bullet_start", ""

    # Line starting with bullet marker + text
    if first_role == "bullet":
        text_parts = []
        for r, t, s in roles:
            if r == "bullet":
                continue
            if r == "bold_or_pagenum" and t and not t.isdigit():
                text_parts.append(f"**{t}**")
            elif t:
                text_parts.append(t)
        return "bullet_with_text", " ".join(text_parts)

    # Chapter title (LongbowBB large)
    if first_role == "chapter_title":
        text = " ".join(t for r, t, s in roles if t)
        return "chapter_title", text

    # Running header
    if first_role == "running_header":
        return "running_header", ""

    # Drop cap
    if first_role == "drop_cap":
        text = " ".join(t for r, t, s in roles if t and r != "watermark")
        return "drop_cap", text

    # Section heading (SC700 small caps)
    if first_role == "section_heading":
        text = _reassemble_sc700_line([s for r, t, s in roles])
        return "section_heading", text

    # Subsection heading (Souvenir-Demi 12pt)
    if first_role == "subsection":
        text = " ".join(t for r, t, s in roles if t)
        if text.isdigit():
            return "pagenum", text
        return "subsection", text

    # Sub-subsection (Souvenir-MediumItalic)
    if first_role == "subsubsection":
        text = " ".join(t for r, t, s in roles if t)
        return "subsubsection", text

    # Example text (ComicPlain)
    if first_role == "example":
        text = " ".join(t for r, t, s in roles if t)
        return "example", text

    # Bold/pagenum
    if first_role == "bold_or_pagenum":
        text = " ".join(t for r, t, s in roles if t)
        if text.isdigit():
            return "pagenum", text
        return "bold_text", f"**{text}**"

    # Body text (may contain inline bold)
    if first_role == "body":
        parts = []
        for r, t, s in roles:
            if r == "bullet":
                continue
            if r == "bold_or_pagenum" and t and not t.isdigit():
                parts.append(f"**{t}**")
            elif t:
                parts.append(t)
        return "body", " ".join(parts)

    # Unknown
    text = " ".join(t for r, t, s in roles if t)
    return "unknown", text


def _page_to_markdown(page):
    """Convert a PDF page to markdown text.

    Flattens all lines across blocks, classifies each, then runs a state
    machine to produce markdown. Body text after a bullet is treated as
    continuation of that bullet until a new bullet marker or heading appears.
    """
    blocks = page.get_text("dict")["blocks"]
    md_parts = []
    seen_chapter_titles = set()
    seen_sc_headings = set()

    # State
    in_example = False
    in_bullet_list = False
    pending_bullet = False
    current_body = []  # accumulates body paragraph text

    after_drop_cap = False  # next body text should join without space

    def flush_body():
        nonlocal current_body, after_drop_cap
        if current_body:
            md_parts.append(" ".join(current_body))
            md_parts.append("")
            current_body = []
        after_drop_cap = False

    def flush_example():
        nonlocal in_example
        if in_example:
            in_example = False
            md_parts.append("")

    def flush_bullets():
        nonlocal in_bullet_list, pending_bullet
        if in_bullet_list:
            in_bullet_list = False
            md_parts.append("")
        pending_bullet = False

    def last_bullet():
        """Return last md_parts entry if it's a bullet, else None."""
        for i in range(len(md_parts) - 1, -1, -1):
            if md_parts[i].startswith("- "):
                return i
            if md_parts[i] == "":
                continue
            break
        return None

    # Flatten all lines and classify
    all_lines = []
    for block in blocks:
        if "lines" not in block:
            continue
        for line in block["lines"]:
            role, text = _classify_line(line["spans"])
            if role is not None and role != "pagenum":
                all_lines.append((role, text))

    for role, text in all_lines:
        if role == "chapter_title":
            # Decorative large titles (LongbowBB ~120pt) are shadow-duplicated
            # and purely decorative — skip them entirely. The actual chapter
            # structure comes from section headings (SC700) and subsections.
            pass

        elif role == "running_header":
            pass

        elif role == "drop_cap":
            if text:
                flush_body()
                flush_example()
                flush_bullets()
                current_body.append(text)
                after_drop_cap = True

        elif role == "section_heading":
            if text and text not in seen_sc_headings:
                seen_sc_headings.add(text)
                flush_body()
                flush_example()
                flush_bullets()
                md_parts.append(f"## {text}")
                md_parts.append("")

        elif role == "subsection":
            if text:
                flush_body()
                flush_example()
                flush_bullets()
                md_parts.append(f"### {text}")
                md_parts.append("")

        elif role == "subsubsection":
            if text:
                flush_body()
                flush_example()
                flush_bullets()
                md_parts.append(f"#### {text}")
                md_parts.append("")

        elif role == "example":
            flush_body()
            flush_bullets()
            if text:
                in_example = True
                md_parts.append(f"> {text}")

        elif role == "bold_text":
            if text:
                current_body.append(text)

        elif role == "bullet_start":
            flush_body()
            flush_example()
            pending_bullet = True
            in_bullet_list = True

        elif role == "bullet_with_text":
            flush_body()
            flush_example()
            pending_bullet = False
            in_bullet_list = True
            md_parts.append(f"- {text}")

        elif role == "body":
            flush_example()
            if text:
                if pending_bullet:
                    # Body text right after a bare bullet marker
                    pending_bullet = False
                    in_bullet_list = True
                    md_parts.append(f"- {text}")
                elif in_bullet_list:
                    # Continuation of current bullet item
                    idx = last_bullet()
                    if idx is not None:
                        md_parts[idx] += " " + text
                    else:
                        flush_bullets()
                        current_body.append(text)
                elif after_drop_cap and current_body:
                    # Join directly with drop cap (no space)
                    current_body[-1] += text
                    after_drop_cap = False
                else:
                    current_body.append(text)

        else:
            if text:
                current_body.append(text)

    flush_body()
    flush_example()
    flush_bullets()

    return "\n".join(md_parts)


def _extract_images(page, page_num, output_dir, book_key):
    """Extract images from a page, converting CMYK/DeviceN to RGB.

    Returns list of image filenames that were saved.
    """
    images = page.get_images(full=True)
    saved = []

    for img_idx, img_info in enumerate(images):
        xref = img_info[0]
        try:
            base_image = page.parent.extract_image(xref)
        except Exception:
            continue

        if not base_image:
            continue

        image_bytes = base_image["image"]
        image_ext = base_image["ext"]
        width = base_image["width"]
        height = base_image["height"]

        # Skip very small images (likely icons/decorations)
        if width < 50 or height < 50:
            continue

        # Skip full-page background images (close to page dimensions)
        page_rect = page.rect
        if width >= page_rect.width * 0.9 and height >= page_rect.height * 0.9:
            continue

        # Convert to PNG via pixmap for color space handling
        try:
            pix = pymupdf.Pixmap(page.parent, xref)
            # Convert CMYK/DeviceN to RGB
            if pix.n > 4:  # DeviceN or similar
                pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
            elif pix.n == 4:  # CMYK
                pix = pymupdf.Pixmap(pymupdf.csRGB, pix)

            filename = f"{book_key}-p{page_num:03d}-img{img_idx}.png"
            filepath = output_dir / filename
            pix.save(str(filepath))
            saved.append(filename)
        except Exception as e:
            print(f"  Warning: Could not extract image {xref} from p.{page_num}: {e}")

    return saved


def extract_pages(
    reference_dir: Path,
    book_key: str,
    page_start: int,
    page_end: int,
    output_dir: Path,
    extract_images: bool = True,
):
    """Extract a range of pages from a book to markdown.

    Args:
        reference_dir: Directory containing PDF files
        book_key: Book identifier (e.g. "scholars-guide")
        page_start: First page number (1-based, inclusive)
        page_end: Last page number (1-based, inclusive)
        output_dir: Output directory for markdown and images
        extract_images: Whether to extract images

    Returns:
        Tuple of (markdown_text, list_of_image_filenames)
    """
    book_info = BOOKS[book_key]
    pdf_path = reference_dir / book_info["file"]
    doc = pymupdf.open(str(pdf_path))

    md_sections = []
    all_images = []
    images_dir = output_dir / "images"

    if extract_images:
        images_dir.mkdir(parents=True, exist_ok=True)

    for pg_num in range(page_start, min(page_end + 1, len(doc) + 1)):
        page = doc[pg_num - 1]  # 0-indexed
        md = _page_to_markdown(page)
        if md.strip():
            md_sections.append(f"<!-- Page {pg_num} -->\n\n{md}")

        if extract_images:
            imgs = _extract_images(page, pg_num, images_dir, book_key)
            all_images.extend(imgs)

    doc.close()

    # Combine all pages
    full_md = "\n\n---\n\n".join(md_sections)

    # Add image references at the end if any
    if all_images:
        full_md += "\n\n## Images\n\n"
        for img in all_images:
            full_md += f"![{img}](images/{img})\n\n"

    return full_md, all_images


def extract_topic(
    reference_dir: Path,
    topic: str,
    page_ranges: dict[str, tuple[int, int]],
    output_dir: Path,
):
    """Extract a topic from one or both books.

    Args:
        reference_dir: Directory containing PDF files
        topic: Topic name for labeling
        page_ranges: Dict of book_key -> (start_page, end_page)
        output_dir: Base output directory

    Returns:
        Dict of book_key -> (markdown_path, image_filenames)
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    results = {}

    # Create README
    readme_lines = [f"# {topic.title()}", "", "## Sources", ""]

    for book_key, (start, end) in page_ranges.items():
        book_info = BOOKS[book_key]
        print(f"Extracting {book_info['title']} pp.{start}-{end}...")

        md_text, images = extract_pages(
            reference_dir, book_key, start, end, output_dir
        )

        # Write book-specific markdown
        filename = f"{book_key}-{topic.lower().replace(' ', '-')}.md"
        md_path = output_dir / filename
        header = f"# {topic.title()} — {book_info['title']}\n\n"
        header += f"*Pages {start}–{end}*\n\n---\n\n"
        with open(md_path, "w") as f:
            f.write(header + md_text)

        readme_lines.append(f"- [{book_info['title']}]({filename}) (pp.{start}–{end})")
        results[book_key] = (md_path, images)
        print(f"  Saved: {filename} ({len(images)} images)")

    # Write README
    readme_path = output_dir / "README.md"
    with open(readme_path, "w") as f:
        f.write("\n".join(readme_lines) + "\n")

    return results
