"""CLI for Torchbearer 2E reference extraction."""

import argparse
import sys
from pathlib import Path

from .index import build_index, BOOKS
from .search import load_index, search, format_results
from .extract import extract_pages, extract_topic


def _find_reference_dir():
    """Find the reference directory relative to the project."""
    # Try common locations
    candidates = [
        Path(__file__).resolve().parent.parent.parent.parent / ".." / "reference",
        Path.cwd() / ".." / "reference",
        Path.cwd().parent / "reference",
    ]
    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved.exists():
            return resolved
    return None


def _find_index(reference_dir: Path):
    """Find or build the index."""
    index_path = reference_dir / "index.json"
    if not index_path.exists():
        print("Index not found. Run 'tb2e-ref index' first.")
        sys.exit(1)
    return index_path


def cmd_index(args):
    """Build the searchable index."""
    ref_dir = args.reference_dir
    if ref_dir is None:
        ref_dir = _find_reference_dir()
    else:
        ref_dir = Path(ref_dir)

    if ref_dir is None or not ref_dir.exists():
        print("Error: Could not find reference directory.")
        print("Specify with --reference-dir or ensure ../reference/ exists.")
        sys.exit(1)

    output = ref_dir / "index.json"
    build_index(ref_dir, output)


def cmd_search(args):
    """Search the index."""
    ref_dir = args.reference_dir
    if ref_dir is None:
        ref_dir = _find_reference_dir()
    else:
        ref_dir = Path(ref_dir)

    if ref_dir is None:
        print("Error: Could not find reference directory.")
        sys.exit(1)

    index_path = _find_index(ref_dir)
    index = load_index(index_path)
    results = search(index, args.query, max_results=args.max_results)
    print(format_results(results))


def _parse_pages(pages_str: str) -> tuple[int, int]:
    """Parse a page range string like '36-42' or '36'."""
    if "-" in pages_str:
        parts = pages_str.split("-", 1)
        return int(parts[0]), int(parts[1])
    else:
        p = int(pages_str)
        return p, p


def cmd_extract(args):
    """Extract pages to markdown."""
    ref_dir = args.reference_dir
    if ref_dir is None:
        ref_dir = _find_reference_dir()
    else:
        ref_dir = Path(ref_dir)

    if ref_dir is None:
        print("Error: Could not find reference directory.")
        sys.exit(1)

    output_dir = Path(args.output) if args.output else ref_dir / "rules" / args.topic.lower().replace(" ", "-")
    topic = args.topic

    # Parse page specifications
    page_ranges = {}
    if args.pages:
        # --pages "scholars-guide:36-42" or --pages "36-42" (applies to specified book)
        for page_spec in args.pages:
            if ":" in page_spec:
                book_key, pages = page_spec.split(":", 1)
                page_ranges[book_key] = _parse_pages(pages)
            else:
                # Apply to specified book or both
                start, end = _parse_pages(page_spec)
                if args.book:
                    page_ranges[args.book] = (start, end)
                else:
                    # If no book specified and no book prefix, error
                    print("Error: Specify --book or use 'book:pages' format")
                    print("  e.g., --pages scholars-guide:36-42")
                    sys.exit(1)
    elif args.book:
        print("Error: --pages required with --book")
        sys.exit(1)
    else:
        # No pages specified — search and suggest
        index_path = _find_index(ref_dir)
        index = load_index(index_path)
        results = search(index, topic, max_results=10)
        if not results:
            print(f"No results found for '{topic}'. Try a different search term.")
            sys.exit(1)
        print(f"Search results for '{topic}':")
        print(format_results(results))
        print("Re-run with --pages to extract specific pages.")
        print("  e.g., tb2e-ref extract --topic '{topic}' --pages scholars-guide:36-42")
        sys.exit(0)

    extract_topic(ref_dir, topic, page_ranges, output_dir)
    print(f"\nOutput: {output_dir}")


def main():
    parser = argparse.ArgumentParser(
        prog="tb2e-ref",
        description="Torchbearer 2E PDF reference extractor",
    )
    parser.add_argument(
        "--reference-dir",
        help="Path to reference directory containing PDFs (default: auto-detect)",
    )

    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    # index command
    subparsers.add_parser("index", help="Build searchable index from PDFs")

    # search command
    search_parser = subparsers.add_parser("search", help="Search for a topic")
    search_parser.add_argument("query", help="Search query")
    search_parser.add_argument("--max-results", type=int, default=20, help="Max results")

    # extract command
    extract_parser = subparsers.add_parser("extract", help="Extract pages to markdown")
    extract_parser.add_argument("--topic", required=True, help="Topic name")
    extract_parser.add_argument(
        "--pages", action="append",
        help="Page range: 'book:start-end' or 'start-end' with --book (repeatable)",
    )
    extract_parser.add_argument("--book", choices=list(BOOKS.keys()), help="Book to extract from")
    extract_parser.add_argument("--output", help="Output directory (default: ../reference/rules/<topic>/)")
    extract_parser.add_argument("--no-images", action="store_true", help="Skip image extraction")

    args = parser.parse_args()

    if args.command is None:
        parser.print_help()
        sys.exit(1)

    if args.command == "index":
        cmd_index(args)
    elif args.command == "search":
        cmd_search(args)
    elif args.command == "extract":
        cmd_extract(args)


if __name__ == "__main__":
    main()
