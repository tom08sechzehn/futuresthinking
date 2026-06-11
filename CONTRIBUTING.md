# Beitragen — einen Fund einreichen

Danke, dass du einen Fund aus der Zukunft beisteuern willst. Ein **Fund** ist ein
fiktives Alltagsobjekt aus den Jahren 2030–2070, beschrieben in **einer Datei**.
Es gibt zwei Wege, beide enden in einem Pull Request gegen `main`.

---

## Das `.future`-Format

Eine `.future`-Datei ist **YAML-Frontmatter**. Ein optionaler Markdown-Body
darunter (nach einem schließenden `---`) ist erlaubt, aber **nicht-normativ**
(nur Kuratoren-Notiz). Vorlage: [`funde/_TEMPLATE.future`](funde/_TEMPLATE.future).
Schema: [`schema/v1.0/future.schema.json`](schema/v1.0/future.schema.json).

### Die Pflichtfelder (7 + Lizenz)

| Feld | Pflicht | Regel |
|---|---|---|
| `objekt_id` | ✅ | Slug = Dateiname (ohne `.future`). Muster `JAHR-kebab-case`, z.B. `2043-leihschein-paar-haende`. Beginnt mit `fundjahr`. |
| `objektname` | ✅ | Anzeigename, 2–80 Zeichen. |
| `fundjahr` | ✅ | Ganzzahl 2030–2070. Muss zum Jahr-Präfix der `objekt_id` passen. |
| `fundort` | ✅ | Form `Etwas, Ort`, z.B. `Tauschregal, Augsburg-Oberhausen`. |
| `wahrscheinlichkeit` | ✅ | deskriptive Achse: `moeglich` · `plausibel` · `wahrscheinlich`. |
| `wuenschbarkeit` | ✅ | Wertungsachse: `wuenschenswert` · `neutral` · `nicht`. |
| `beipackzettel` | ✅ | **280–600 Zeichen** (Code-Points). Der Kern: die Geschichte des Objekts. |
| `lizenz` | ✅ | Default `CC-BY-NC-4.0`. Auch: `CC-BY-SA-4.0`, `CC-BY-4.0`, `CC0-1.0`. |

> **Wichtig (Zwei-Achsen-Modell):** Frage 2 ist **zweistufig** —
> `wahrscheinlichkeit` und `wuenschbarkeit` werden **getrennt** angegeben.
> Das alte einwertige `cone_position` ist **deprecated** und wird **nicht**
> mehr automatisch gemappt. Gib beide Achsen direkt an.

### Optionale Felder

`schema_version`, `urheber` (Pseudonym!), `tonalitaet`, `material`,
`remix_von` / `verweist_auf` (Lineage-FK auf eine bestehende `objekt_id` oder `null`),
`bild`, `audio_fundnotiz`.

---

## Pfad A — Git-Pull-Request (für Profis)

1. Repo **forken**.
2. `funde/<objekt_id>.future` aus `funde/_TEMPLATE.future` anlegen und ausfüllen.
3. (Optional) Bild als `bilder/<objekt_id>.png|webp|svg` ergänzen, `bild.src` setzen.
4. Lokal prüfen: `npm ci && npm run validate`.
5. **Pull Request** öffnen. Das CI-Gate validiert sofort (grün/rot).

## Pfad B — Web-Formular (für alle ohne Git)

1. [`einreichen.html`](site/einreichen.html) öffnen.
2. Kombinatorisches Formular ausfüllen (Auswahlfelder + Beipackzettel-Text).
   Optional: **ein eigenes Bild hochladen** (PNG/WebP/JPEG, max. 8 MB) — es wird
   im Browser verkleinert, ohne Metadaten zu WebP komprimiert und mit einem
   Pflicht-Alt-Text versehen. Kein Generator: das Bild kommt von dir.
3. Absenden → die Cloudflare Pages Function `/api/submit` verifiziert Turnstile,
   baut die `.future`-Datei (inkl. `bild`-Block, falls ein Bild dabei ist),
   committet das Bild nach `funde/bilder/<slug>.<webp|png>` und **öffnet
   automatisch einen PR**.

---

## Das CI-Gate (was geprüft wird)

Bei jedem PR läuft [`.github/workflows/validate.yml`](.github/workflows/validate.yml):

0. **Schema-Self-Test** — die Fixtures müssen passen (`valid` grün, `invalid` rot).
1. **JSON-Schema** (ajv, Draft 2020-12) — Felder, Enums, Muster, Längen-Vorfilter.
2. **Dedup** — keine doppelte `objekt_id`.
3. **Slug ↔ Jahr** — `objekt_id` beginnt mit `fundjahr`.
4. **Referenz-Integrität** — `verweist_auf` / `remix_von` zeigen auf existierende Funde.
5. **Beipackzettel** — 280–600 **Code-Points** (nicht UTF-16-Units).

**🔴 rot = nicht mergebar. 🟢 grün = mergebar.** Branch-Protection auf `main`
verlangt grünes `validate` vor dem Merge.

---

## Das Merge-Gate — Review als „Archivar:in aus 2071"

Ein grünes CI macht einen PR **technisch** mergebar, nicht automatisch mergewürdig.
Den letzten Schritt macht ein **Mensch**. Review-Haltung: Du bist **Archivar:in aus
dem Jahr 2071** und entscheidest, ob dieser Fund in den Bestand gehört —

- Ist es ein **mundanes Alltagsobjekt** (kein Hochglanz-Manifest, kein Slogan)?
- Sind `wahrscheinlichkeit`/`wuenschbarkeit` plausibel zur Geschichte?
- Sind die **Freitext-Felder** (`fundort`, `urheber`, `beipackzettel`) sauber —
  kein Klarname Dritter, kein Doxing, keine Beleidigung? (Diese Felder hebt das
  Review besonders hervor.)
- Passt die Lineage (`verweist_auf`/`remix_von`), wenn gesetzt?

Review-Kommentare dürfen **in-world** sein („als hätte 2071 sie geschrieben") —
das ist Teil der Design-Fiction und bleibt öffentlich sichtbar.

### Solo-Merge im MVP (offene Entscheidung #9)

Die Architektur empfiehlt **≥ 2 Personen mit Merge-Recht ab Tag 1** (gegen den
Maintainer-Flaschenhals, Pre-Mortem FM-1). Diese **zweite Merge-Person ist derzeit
offen** (Tom klärt). Bis dahin gilt **Solo-Merge im MVP**:

- Merge-SLA-Ziel: **PR-Antwort < 72 h.**
- Trusted-Contributor (verlässliche Wiederholungs-Einreicher via Pfad A) = leichteres Review.
- Caveat (Viktor): liegt das realistische Merge-Budget bei **< 30 min/Woche**, ist
  die Beitragshürde zu hoch zu setzen und radikaler zu senken, statt die Architektur
  zu skalieren.

Sobald eine zweite Merge-Person feststeht, wird dieser Abschnitt durch eine
`CURATION.md` mit Team + SLA ersetzt.
