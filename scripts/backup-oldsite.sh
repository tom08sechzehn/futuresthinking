#!/usr/bin/env bash
#
# backup-oldsite.sh — Spiegelt die alte futuresthinking.eu-Seite (2020, one.com)
# in einen zeitgestempelten lokalen Ordner — VOR der DNS-Migration zu Cloudflare.
#
# Backup-Pflicht aus DEPLOY-ANLEITUNG / backend-architektur.md §9: bevor die
# Nameserver auf Cloudflare zeigen, muss die alte Seite gesichert sein.
#
# Verfahren (das erste verfuegbare gewinnt):
#   1) wget    --mirror  (Standard, vollstaendiger Offline-Mirror)
#   2) httrack            (Fallback, falls wget fehlt)
#
# Idempotent: jeder Lauf legt einen NEUEN zeitgestempelten Ordner an,
# ueberschreibt nie ein bestehendes Backup.
#
# Nutzung:
#   ./scripts/backup-oldsite.sh
#   URL=https://futuresthinking.eu OUT_ROOT=./backups ./scripts/backup-oldsite.sh

set -euo pipefail

URL="${URL:-https://futuresthinking.eu}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_ROOT="${OUT_ROOT:-"${SCRIPT_DIR}/../backups"}"

# Host aus der URL extrahieren (ohne Schema, ohne Pfad)
HOST="$(printf '%s' "$URL" | sed -E 's#^[a-zA-Z]+://##; s#/.*$##')"
STAMP="$(date +%Y-%m-%d_%H%M%S)"
TARGET="${OUT_ROOT}/${HOST}_${STAMP}"

mkdir -p "$TARGET"
echo "==> Backup von $URL"
echo "==> Ziel:       $TARGET"

if command -v wget >/dev/null 2>&1; then
    echo "==> Verwende wget --mirror"
    # --mirror          = -r -N -l inf --no-remove-listing (rekursiv, timestamping)
    # --convert-links   = Links fuer lokales Browsen umschreiben
    # --adjust-extension= .html-Endungen ergaenzen
    # --page-requisites = Bilder/CSS/JS mitziehen
    # --no-parent       = nicht oberhalb des Startpfads crawlen
    # -e robots=off     = robots.txt ignorieren (Voll-Backup)
    wget \
        --mirror \
        --convert-links \
        --adjust-extension \
        --page-requisites \
        --no-parent \
        --domains "$HOST" \
        -e robots=off \
        --directory-prefix="$TARGET" \
        "$URL"
    echo "==> Fertig (wget). Backup unter: $TARGET"
    exit 0
fi

if command -v httrack >/dev/null 2>&1; then
    echo "==> wget fehlt — verwende httrack"
    httrack "$URL" -O "$TARGET" "+*.${HOST}/*" --robots=0 --quiet
    echo "==> Fertig (httrack). Backup unter: $TARGET"
    exit 0
fi

echo "FEHLER: Weder wget noch httrack gefunden." >&2
echo "  Installieren, z.B.:" >&2
echo "    Debian/Ubuntu: sudo apt-get install wget    (oder: httrack)" >&2
echo "    macOS:         brew install wget            (oder: httrack)" >&2
exit 1
