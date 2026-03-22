"""CLI entry point for Torchbearer 2E token generator."""

import argparse
import sys
from datetime import datetime
from pathlib import Path

from .prompts import STOCKS, CLASSES, STYLES
from .generate import generate_token


def main():
    parser = argparse.ArgumentParser(
        prog="tb2e-token",
        description="Generate Torchbearer 2E token images using DALL-E 3",
    )
    parser.add_argument("--api-key", help="OpenAI API key (default: OPENAI_API_KEY env var)")
    parser.add_argument("-v", "--verbose", action="store_true", help="Show prompt details")

    sub = parser.add_subparsers(dest="command")

    gen = sub.add_parser("generate", help="Generate a token image")
    gen.add_argument("description", help="Description of the character or creature")
    gen.add_argument("-o", "--output", type=Path,
                     help="Output file path (default: ./token-<timestamp>.webp)")
    gen.add_argument("--stock", choices=list(STOCKS.keys()),
                     help="Character stock for prompt modifiers")
    gen.add_argument("--class", dest="character_class", choices=list(CLASSES.keys()),
                     help="Character class for prompt modifiers")
    gen.add_argument("--style", choices=list(STYLES.keys()), default="portrait",
                     help="Image style/framing (default: portrait)")
    gen.add_argument("--no-remove-bg", action="store_true",
                     help="Skip background removal")
    gen.add_argument("--keep-intermediate", action="store_true",
                     help="Save raw and bg-removed PNGs alongside final WebP")
    gen.add_argument("--size", type=int, default=400,
                     help="Output size in pixels (default: 400)")
    gen.add_argument("--quality", type=int, default=90,
                     help="WebP quality 1-100 (default: 90)")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    if args.command == "generate":
        output = args.output
        if output is None:
            timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            output = Path(f"token-{timestamp}.webp")

        try:
            generate_token(
                args.description,
                style=args.style,
                stock=args.stock,
                character_class=args.character_class,
                output_path=output,
                size=args.size,
                quality=args.quality,
                remove_bg=not args.no_remove_bg,
                keep_intermediate=args.keep_intermediate,
                api_key=args.api_key,
                verbose=args.verbose,
            )
        except KeyboardInterrupt:
            print("\nAborted.", file=sys.stderr)
            sys.exit(130)
        except Exception as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)
