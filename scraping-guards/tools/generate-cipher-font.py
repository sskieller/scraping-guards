#!/usr/bin/env python3
"""Generate the glyph-substitution cipher font used by guard 28.

The technique: take a normal font and rewrite its `cmap` so that the codepoint
for one character renders the *outline of a different character*. The page then
ships ciphertext in the DOM; a browser with the font renders the plaintext,
while any parser reading the DOM sees gibberish.

    plaintext "FLAG-GLYPHFONT-d4c7"  ->  DOM ciphertext "SYNT.TYLCUSBAG.q9p2"

Cipher: letters ROT13, digits +5 mod 10, "-" <-> ".".

Usage:  python3 tools/generate-cipher-font.py
Writes: fonts/cipher.woff2  (and prints the cipher mapping)

Requires: fonttools, brotli   (pip install fonttools brotli)
"""
import os
import string
import sys

from fontTools.ttLib import TTFont
from fontTools.subset import Subsetter, Options

# A clean, widely-available source face. Override with SOURCE_FONT=/path/to.ttf
SOURCE_FONT = os.environ.get(
    "SOURCE_FONT",
    "/mnt/skills/examples/canvas-design/canvas-fonts/BricolageGrotesque-Regular.ttf",
)
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fonts")
OUT_FILE = os.path.join(OUT_DIR, "cipher.woff2")

# Characters whose outlines must survive subsetting (the plaintext alphabet).
PLAIN_ALPHABET = string.ascii_uppercase + string.ascii_lowercase + string.digits + "-."


def encode_char(ch: str) -> str:
    """plaintext char -> ciphertext char (what actually sits in the DOM)."""
    if ch.isalpha():
        base = ord("A") if ch.isupper() else ord("a")
        return chr((ord(ch) - base + 13) % 26 + base)
    if ch.isdigit():
        return chr((ord(ch) - ord("0") + 5) % 10 + ord("0"))
    if ch == "-":
        return "."
    if ch == ".":
        return "-"
    return ch


def encode(text: str) -> str:
    return "".join(encode_char(c) for c in text)


def main() -> int:
    if not os.path.exists(SOURCE_FONT):
        print(f"error: source font not found: {SOURCE_FONT}", file=sys.stderr)
        print("set SOURCE_FONT=/path/to/a.ttf and re-run", file=sys.stderr)
        return 1

    font = TTFont(SOURCE_FONT)
    cmap = font.getBestCmap()

    missing = [c for c in PLAIN_ALPHABET if ord(c) not in cmap]
    if missing:
        print(f"error: source font lacks glyphs for: {missing}", file=sys.stderr)
        return 1

    # 1. Subset down to just the plaintext outlines we need (keeps the file tiny).
    opts = Options()
    opts.set(layout_features=[], notdef_outline=True, recalc_bounds=True)
    subsetter = Subsetter(options=opts)
    subsetter.populate(text=PLAIN_ALPHABET)
    subsetter.subset(font)

    # Glyph names must be resolved *after* subsetting.
    sub_cmap = font.getBestCmap()
    plain_glyph = {c: sub_cmap[ord(c)] for c in PLAIN_ALPHABET}

    # 2. The swap: codepoint(cipher char) -> outline of the plaintext char.
    remapped = {ord(encode_char(p)): plain_glyph[p] for p in PLAIN_ALPHABET}

    for table in font["cmap"].tables:
        # Keep only Unicode subtables and give them all the ciphered mapping.
        if table.isUnicode():
            table.cmap = dict(remapped)
    font["cmap"].tables = [t for t in font["cmap"].tables if t.isUnicode()]

    # Rename so it can never collide with the real installed face.
    name_table = font["name"]
    for record in name_table.names:
        if record.nameID in (1, 3, 4, 6):  # family, unique id, full name, postscript
            name_table.setName("ScrapeGuardCipher", record.nameID,
                               record.platformID, record.platEncID, record.langID)

    os.makedirs(OUT_DIR, exist_ok=True)
    font.flavor = "woff2"
    font.save(OUT_FILE)

    size = os.path.getsize(OUT_FILE)
    print(f"wrote {OUT_FILE} ({size} bytes)")
    for sample in ("FLAG-GLYPHFONT-d4c7",):
        print(f"  plaintext : {sample}")
        print(f"  ciphertext: {encode(sample)}   <-- put THIS in the DOM")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
