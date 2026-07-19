from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


def resize_square(source: Path, destination: Path, size: int) -> None:
    with Image.open(source) as image:
        rgba = image.convert("RGBA")
        resized = rgba.resize((size, size), Image.Resampling.LANCZOS)
        destination.parent.mkdir(parents=True, exist_ok=True)
        resized.save(destination, format="WEBP", quality=84, method=6)


def main() -> None:
    parser = argparse.ArgumentParser(description="Create optimized game sprite variants.")
    parser.add_argument("--source-dir", required=True)
    parser.add_argument("--units-dir", required=True)
    parser.add_argument("--cards-dir", required=True)
    args = parser.parse_args()

    source_dir = Path(args.source_dir)
    units_dir = Path(args.units_dir)
    cards_dir = Path(args.cards_dir)

    sources = sorted(source_dir.glob("*.webp"))
    if not sources:
        raise SystemExit("No transparent WebP sources were found.")

    for source in sources:
        resize_square(source, units_dir / source.name, 512)
        resize_square(source, cards_dir / source.name, 256)
        print(f"Optimized {source.name}")


if __name__ == "__main__":
    main()
