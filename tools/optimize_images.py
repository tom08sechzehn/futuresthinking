#!/usr/bin/env python3
"""
tools/optimize_images.py — responsive Karten-Bilder erzeugen.

Hintergrund: die Funde laden mobil langsam, weil bisher das volle 1200px-WebP
auch in eine ~358px-Karte geladen wird. Dieses Skript erzeugt zu jedem
Basis-Bild `funde/bilder/<slug>.webp` zwei kleinere Varianten:

    funde/bilder/<slug>-480.webp   (480 px breit — Desktop-Karte / 1x-Phone)
    funde/bilder/<slug>-800.webp   (800 px breit — Retina-Phone / Tablet)

Der Renderer (ft-shell.js: imgSrcset) baut daraus ein `srcset`; der Browser
lädt die kleinste passende Datei. Das Basis-1200px-WebP bleibt unangetastet
(Fallback + Hero auf der Detailseite).

Konvention (LOAD-BEARING): der Renderer setzt srcset NUR per Namens-Konvention.
Jedes Basis-WebP MUSS daher seine -480/-800-Varianten haben. Nach jedem neuen
Bild dieses Skript laufen lassen:  python tools/optimize_images.py

Idempotent: Varianten werden bei jedem Lauf deterministisch neu geschrieben.
Nur Pillow nötig (kein cwebp/sharp).  Aufruf aus dem Repo-Root.
"""
import os
import re
import sys
import glob
from PIL import Image

# Windows-Konsole (cp1252) verträgt kein ✓/×/–: Ausgabe auf UTF-8 zwingen.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
BILDER = os.path.join(REPO, "funde", "bilder")

# Ziel-Breite -> WebP-Qualität. method=6 = beste (langsamste) Kompression.
VARIANTS = [(480, 70), (800, 74)]
VARIANT_RE = re.compile(r"-\d+\.webp$", re.IGNORECASE)


def is_base(name: str) -> bool:
    return name.lower().endswith(".webp") and not VARIANT_RE.search(name)


def make_variant(src_path: str, width: int, quality: int) -> str:
    base = src_path[:-len(".webp")]
    out = f"{base}-{width}.webp"
    with Image.open(src_path) as im:
        im = im.convert("RGB")
        w, h = im.size
        if w <= width:
            # nicht hochskalieren — Original-Breite behalten
            target = im.copy()
        else:
            target = im.resize((width, round(h * width / w)), Image.LANCZOS)
        target.save(out, "WEBP", quality=quality, method=6)
    return out


def kb(path: str) -> float:
    return os.path.getsize(path) / 1024


def main() -> int:
    if not os.path.isdir(BILDER):
        print(f"✗ Bilder-Ordner fehlt: {BILDER}", file=sys.stderr)
        return 1
    bases = sorted(p for p in glob.glob(os.path.join(BILDER, "*.webp"))
                   if is_base(os.path.basename(p)))
    if not bases:
        print("Keine Basis-WebP gefunden — nichts zu tun.")
        return 0
    print(f"{'Basis':52s} {'1200':>7s}  {'480':>7s}  {'800':>7s}")
    print("-" * 80)
    total_saved = 0
    for src in bases:
        name = os.path.basename(src)
        sizes = {}
        for width, quality in VARIANTS:
            out = make_variant(src, width, quality)
            sizes[width] = kb(out)
        print(f"{name:52s} {kb(src):6.0f}K  {sizes[480]:6.0f}K  {sizes[800]:6.0f}K")
    print("-" * 80)
    print(f"✓ {len(bases)} Basis-Bilder × {len(VARIANTS)} Varianten erzeugt.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
