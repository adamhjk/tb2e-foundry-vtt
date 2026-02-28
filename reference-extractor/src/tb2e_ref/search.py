"""Search the Torchbearer 2E reference index."""

import json
import re
from pathlib import Path


def load_index(index_path: Path):
    """Load the index from disk."""
    with open(index_path) as f:
        return json.load(f)


def search(index: dict, query: str, max_results: int = 20):
    """Search the index for a topic.

    Returns ranked results combining:
    1. TOC heading matches (highest priority)
    2. Page heading matches (high priority)
    3. Full-text page matches with relevance scoring (lower priority)

    Args:
        index: The loaded index dict
        query: Search query string
        max_results: Maximum number of results to return

    Returns:
        List of result dicts with book, page, heading, score, snippet, match_type
    """
    query_lower = query.lower()
    query_words = query_lower.split()
    results = []

    # 1. Search TOC entries
    for entry in index["toc"]:
        title_lower = entry["title"].lower()
        score = _score_match(title_lower, query_lower, query_words)
        if score > 0:
            results.append({
                "book": entry["book"],
                "book_title": index["books"][entry["book"]]["title"],
                "page": entry["page"],
                "heading": entry["title"],
                "score": score + 100,  # TOC matches get a big bonus
                "snippet": "",
                "match_type": "toc",
            })

    # 2. Search page headings and text
    for page_data in index["pages"]:
        page_score = 0
        best_heading = ""
        snippet = ""

        # Check headings on this page
        for heading in page_data["headings"]:
            heading_lower = heading["text"].lower()
            h_score = _score_match(heading_lower, query_lower, query_words)
            if h_score > page_score:
                page_score = h_score + 50  # heading match bonus
                best_heading = heading["text"]

        # Full-text search
        text_lower = page_data["text"].lower()
        text_score = _score_text(text_lower, query_lower, query_words)
        if text_score > 0:
            snippet = _extract_snippet(page_data["text"], query_lower, query_words)
            if text_score > page_score:
                page_score = text_score

        if page_score > 0:
            # Find the best heading context for this page
            if not best_heading and page_data["headings"]:
                # Use running header or first heading as context
                for h in page_data["headings"]:
                    if h["type"] in ("running", "chapter"):
                        best_heading = h["text"]
                        break
                if not best_heading:
                    best_heading = page_data["headings"][0]["text"]

            results.append({
                "book": page_data["book"],
                "book_title": index["books"][page_data["book"]]["title"],
                "page": page_data["page"],
                "heading": best_heading,
                "score": page_score,
                "snippet": snippet,
                "match_type": "heading" if page_score >= 50 else "text",
            })

    # Deduplicate: keep highest-scoring result per (book, page)
    seen = {}
    for r in results:
        key = (r["book"], r["page"])
        if key not in seen or r["score"] > seen[key]["score"]:
            seen[key] = r
    results = list(seen.values())

    # Sort by score descending
    results.sort(key=lambda r: r["score"], reverse=True)

    return results[:max_results]


def _score_match(text: str, query: str, query_words: list[str]) -> float:
    """Score a heading/title match against the query."""
    score = 0.0

    # Exact match
    if query in text:
        score += 50
        # Bonus for exact full match
        if text == query:
            score += 50

    # Word matches
    matched_words = sum(1 for w in query_words if w in text)
    if matched_words > 0:
        word_ratio = matched_words / len(query_words)
        score += 30 * word_ratio

    return score


def _score_text(text: str, query: str, query_words: list[str]) -> float:
    """Score a full-text page match."""
    score = 0.0

    # Exact phrase match in text
    if query in text:
        score += 20
        # Count occurrences
        count = text.count(query)
        score += min(count * 5, 20)

    # Individual word matches
    matched_words = sum(1 for w in query_words if w in text)
    if matched_words > 0:
        word_ratio = matched_words / len(query_words)
        score += 10 * word_ratio

    return score


def _extract_snippet(text: str, query: str, query_words: list[str], context_chars: int = 150):
    """Extract a text snippet around the best match."""
    text_lower = text.lower()

    # Find the best position for the snippet
    pos = text_lower.find(query)
    if pos == -1:
        # Try finding first matching word
        for word in query_words:
            pos = text_lower.find(word)
            if pos != -1:
                break
    if pos == -1:
        return text[:context_chars] + "..."

    # Extract context around the match
    start = max(0, pos - context_chars // 2)
    end = min(len(text), pos + len(query) + context_chars // 2)

    snippet = text[start:end].strip()
    if start > 0:
        snippet = "..." + snippet
    if end < len(text):
        snippet = snippet + "..."

    # Clean up newlines in snippet
    snippet = re.sub(r"\n+", " ", snippet)

    return snippet


def format_results(results: list[dict]) -> str:
    """Format search results for display."""
    if not results:
        return "No results found."

    lines = []
    for i, r in enumerate(results, 1):
        score_bar = "#" * min(int(r["score"] / 10), 20)
        lines.append(f"{i:2d}. [{r['book_title']}] p.{r['page']} — {r['heading']}")
        lines.append(f"    Score: {r['score']:.0f} {score_bar}  ({r['match_type']})")
        if r["snippet"]:
            # Truncate long snippets
            snip = r["snippet"][:200]
            lines.append(f"    {snip}")
        lines.append("")

    return "\n".join(lines)
