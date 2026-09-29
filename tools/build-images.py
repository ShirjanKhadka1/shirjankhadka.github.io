#!/usr/bin/env python3
"""Generate all per-story image variants for Nepse Decode newsroom.

Usage:
    python3 tools/build-images.py <slug> [<slug> ...]
    python3 tools/build-images.py --all        # process every _src/*.jpg

Inputs (per slug):
    assets/images/_src/{slug}.jpg   — vendored original (never hotlinked)
    assets/images/_src/{slug}.json  — sidecar: photographer, license, file-page URL, date, caption

Outputs (per slug, committed):
    assets/images/blog/{slug}-1600.webp   1600x840  WebP q78   <= 220 KB
    assets/images/blog/{slug}-1200.webp   1200x630  WebP q78   <= 170 KB
    assets/images/blog/{slug}-800.webp     800x420  WebP q72   <= 100 KB
    assets/images/blog/{slug}-1200.jpg    1200x630  JPEG q80   <= 200 KB
    assets/images/blog/{slug}-800.jpg      800x420  JPEG q78   <= 120 KB
    assets/images/blog/{slug}-og.jpg      1200x630  JPEG q82   <= 250 KB (og:image only)
    assets/images/blog/{slug}-thumb.webp   400x210  WebP q70   <=  30 KB
    assets/images/blog/{slug}-thumb.jpg    400x210  JPEG q75   <=  35 KB

All variants are center cover-crops, sRGB. Variants wider than the source are
skipped (except OG, which requires a >=1200px-wide source — enforced).

Spec: research_notes/newsroom-competitive-study-2026-09-29/spec.md section 3.
"""
import json
import os
import sys

from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(REPO, "assets", "images", "_src")
OUT_DIR = os.path.join(REPO, "assets", "images", "blog")

# (suffix, w, h, format, base quality, quality key, budget KB, min quality)
# The script encodes at the base quality, then steps quality down by 5 until the
# variant fits its KB budget (never below min quality). Budgets are the authority.
VARIANTS = [
    ("1600.webp", 1600, 840, "WEBP", 78, 220, 60),
    ("1200.webp", 1200, 630, "WEBP", 78, 170, 60),
    ("800.webp",   800, 420, "WEBP", 72, 100, 60),
    ("1200.jpg",  1200, 630, "JPEG", 80, 200, 62),
    ("800.jpg",    800, 420, "JPEG", 78, 120, 62),
    ("og.jpg",    1200, 630, "JPEG", 82, 250, 62),
    ("thumb.webp", 400, 210, "WEBP", 70,  30, 55),
    ("thumb.jpg",  400, 210, "JPEG", 75,  35, 55),
]


def cover(im, w, h):
    """Center cover-crop to w x h."""
    r = max(w / im.width, h / im.height)
    im2 = im.resize((round(im.width * r), round(im.height * r)), Image.LANCZOS)
    x, y = (im2.width - w) // 2, (im2.height - h) // 2
    return im2.crop((x, y, x + w, y + h))


def save_kwargs(fmt, quality):
    if fmt == "WEBP":
        return dict(quality=quality, method=6)
    return dict(quality=quality, progressive=True, optimize=True)


def build_variant(img, out, fmt, base_q, budget, min_q):
    """Encode, stepping quality down until within budget. Returns (kb, q, ok)."""
    q = base_q
    while True:
        img.save(out, fmt, **save_kwargs(fmt, q))
        kb = os.path.getsize(out) / 1024
        if kb <= budget or q <= min_q:
            return kb, q, kb <= budget
        q -= 5


def build_slug(slug):
    src_path = os.path.join(SRC_DIR, slug + ".jpg")
    if not os.path.exists(src_path):
        print(f"[{slug}] MISSING source: {src_path}")
        return False
    src = Image.open(src_path).convert("RGB")  # sRGB
    if src.width < 1200:
        print(f"[{slug}] FAIL: source too small for OG 1200x630: {src.size}")
        return False
    print(f"[{slug}] source {src.width}x{src.height}")
    ok = True
    for suffix, w, h, fmt, base_q, budget, min_q in VARIANTS:
        if w > src.width and suffix != "og.jpg":
            print(f"  skip {suffix}: source {src.width}px < {w}px")
            continue
        out = os.path.join(OUT_DIR, f"{slug}-{suffix}")
        kb, q, fits = build_variant(cover(src, w, h), out, fmt, base_q, budget, min_q)
        qnote = "" if q == base_q else f" (q{q})"
        verdict = "PASS" if fits else "FAIL"
        if not fits:
            ok = False
        print(f"  {verdict} {slug}-{suffix}: {w}x{h} {kb:6.1f} KB (budget {budget}){qnote}")
    return ok


def main(argv):
    slugs = []
    if "--all" in argv:
        slugs = sorted(
            f[:-4] for f in os.listdir(SRC_DIR)
            if f.endswith(".jpg") and not f.startswith(".")
        )
    else:
        slugs = [a for a in argv if not a.startswith("-")]
    if not slugs:
        sys.exit("usage: build-images.py <slug> [<slug> ...] | --all")
    os.makedirs(OUT_DIR, exist_ok=True)
    results = {slug: build_slug(slug) for slug in slugs}
    failed = [s for s, r in results.items() if not r]
    print()
    if failed:
        print("FAILED:", ", ".join(failed))
        sys.exit(1)
    print(f"ALL PASS ({len(results)} slugs)")


if __name__ == "__main__":
    main(sys.argv[1:])
