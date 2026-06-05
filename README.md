# futuresthinking.eu — ein offenes Fundbüro der Zukunft

Eine Plattform, die **kein Dienst ist, sondern ein Repository, das publiziert wird.**
Jeder „Fund" aus den Jahren 2030–2070 ist **eine Datei** (`funde/<slug>.future`,
YAML-Frontmatter). Das Git-Repo ist die einzige Datenbank. Zur Laufzeit liegt nur
statisches HTML/JSON auf einem CDN — nichts, was abstürzen, gehackt oder teuer
werden kann. Die Idee dahinter: *„Deine Wunsch-Zukunft ist nur ein Pull-Request."*

> Vollständige Architektur, Risiken & Entscheidungen: [`../backend-architektur.md`](../backend-architektur.md)

---

## Architektur (Kurzform)

```
   LOKAL beim Submitter                          PUBLIKATION (CDN)
   ┌───────────────────────┐                     ┌───────────────────────┐
   │ Generator (statisch)  │                     │ futuresthinking.eu    │
   │ → .future-Frontmatter │                     │ (statisch, TLS, CDN)  │
   └──────────┬────────────┘                     │ /.well-known/         │
              │                                   │   futures-feed.json   │
   (A) git PR │      (B) Web-Formular             └──────────▲────────────┘
              │            │                                 │
              │            ▼                                 │ Deploy
              │   ┌──────────────────┐                ┌──────┴────────┐
              │   │ Pages Function   │                │ BUILD (CI)    │
              │   │ /api/submit      │                │ validate →    │
              │   │ Turnstile → PR   │                │ build.mjs →   │
              │   └────────┬─────────┘                │ public-build/ │
              │            │                          └──────▲────────┘
              ▼            ▼                                 │ push main
        ┌──────────────────────┐   CI-Gate    ┌─────────────┴───────┐
        │ GitHub Pull Request  │ ──validate──▶│ MENSCH merged       │
        └──────────────────────┘   (rot/grün) │ (Solo-Merge im MVP) │
                                              └─────────────────────┘
```

Alles **links** vom CI-Gate ist Beitrag, alles **rechts** ist Publikation.
Genau ein menschliches Gate dazwischen. Kein Pfad umgeht es.

---

## Repo-Baum

```
futuresthinking/
├── funde/                       ← DIE Datenbank (ein Fund = eine .future-Datei)
│   ├── 2034-bodenpass-terra-preta-kollektiv.future
│   ├── ...                      ← wächst per PR
│   └── _TEMPLATE.future         ← Vorlage für neue Funde
├── schema/
│   └── v1.0/future.schema.json  ← JSON-Schema (Draft 2020-12), versioniert
├── tools/
│   ├── validate.mjs             ← CI-Validator (Schema + Dedup + Slug-Jahr + FK + Beipackzettel)
│   └── build.mjs                ← Build: funds.json + Feed + public-build/
├── tests/fixtures/              ← Schema-Self-Test (valid grün, invalid rot)
│   ├── valid.future
│   └── invalid.future
├── site/                        ← statischer Frontend-Quellcode (zu deployen)
│   ├── index.html  einreichen.html  methoden.html
│   ├── impressum.html  datenschutz.html
│   ├── assets/zukuenftinnen/    ← SVG-Stil-Assets
│   └── data/                    ← funds.json (vom Build erzeugt, gitignored)
├── functions/
│   └── api/submit.js            ← Cloudflare Pages Function (Pfad B → PR)
├── scripts/
│   ├── backup-oldsite.ps1       ← Backup der alten one.com-Seite (Windows)
│   └── backup-oldsite.sh        ← dito (wget/httrack)
├── .github/workflows/
│   ├── validate.yml             ← CI-Gate (PR + Push)
│   └── deploy.yml               ← Build + Deploy nach Cloudflare Pages (push main)
├── .well-known/                 ← futures-feed.json (vom Build erzeugt, gitignored)
├── wrangler.toml                ← Cloudflare Pages + Functions Konfig
├── public-build/                ← CI-Output (gitignored)
├── package.json
├── CONTRIBUTING.md  PRIVACY.md
├── LICENSE          (MIT — Code)
└── LICENSE-CONTENT  (CC-BY-NC-4.0 — Inhalte)
```

---

## Lokal bauen

Voraussetzung: **Node ≥ 20**.

```bash
npm ci          # Dependencies (ajv, ajv-formats, yaml) lockfile-genau
npm run validate # CI-Gate-Logik: validiert alle funde/*.future
npm run selftest # Schema-Self-Test (valid grün, invalid rot)
npm run build    # erzeugt site/data/funds.json + .well-known/futures-feed.json + public-build/
```

`public-build/` ist danach das fertige Deploy-Verzeichnis (statische Site + Daten + Feed).
Lokal anschauen z.B. mit `npx serve public-build`.

> **Hinweis (Silas, load-bearing):** Der Validator/Builder importiert `ajv/dist/2020.js`
> (Draft-2020-12-Build). Der Default-Import `ajv` ist Draft-07 und kennt das
> 2020-12-Meta-Schema **nicht** — damit bräche das Gate.

---

## Beitragen (einen Fund öffnen)

Zwei Pfade, ein Ziel (ein PR gegen `main`). Details: [`CONTRIBUTING.md`](CONTRIBUTING.md).

- **Pfad A — Git-PR (Profis):** Repo forken → `funde/<slug>.future` aus
  `funde/_TEMPLATE.future` anlegen → PR öffnen. CI validiert sofort.
- **Pfad B — Web-Formular (alle):** `einreichen.html` → kombinatorisches Formular →
  `POST /api/submit` (Cloudflare Pages Function) öffnet automatisch einen PR.

Ein Mensch merged als „Archivar:in aus 2071". Im MVP **Solo-Merge** (zweite
Merge-Person ist noch offen, siehe CONTRIBUTING).

---

## Deploy (Cloudflare Pages + DNS-Migration)

Hosting = **Cloudflare Pages** (Static + Function + Turnstile + CDN in einem Projekt).
Deploy läuft automatisch aus `.github/workflows/deploy.yml` bei jedem Push auf `main`:
`npm ci → npm run validate → npm run build → wrangler pages deploy public-build`.

**DNS:** Volle Nameserver-Migration der Domain `futuresthinking.eu` von one.com zu
Cloudflare. **Vor** der Umstellung die alte Seite sichern:

```bash
# Linux/macOS:
./scripts/backup-oldsite.sh
# Windows:
pwsh ./scripts/backup-oldsite.ps1
```

Die genaue Schritt-für-Schritt-Verdrahtung (Secrets, Pages-Projekt, DNS, TLS)
steht im Übergabe-Return an Tom und in `../backend-architektur.md` §9.

---

## Lizenz-Aufteilung

| Teil | Lizenz |
|---|---|
| **Code** (`tools/`, `site/`, `functions/`, `scripts/`, Config) | **MIT** — siehe [`LICENSE`](LICENSE) |
| **Inhalte** (`funde/*.future`, Bilder, Texte) | **CC-BY-NC-4.0** — siehe [`LICENSE-CONTENT`](LICENSE-CONTENT) |

Default-Lizenz neuer Funde ist **CC-BY-NC-4.0** (Feld `lizenz`, Tom-Entscheidung
2026-06-05). Erlaubt sind außerdem CC-BY-SA-4.0, CC-BY-4.0, CC0-1.0.

---

## Datenschutz

Keine Accounts, kein Tracking, keine Cookies. Identität = selbstgewähltes Pseudonym.
Zweistufiger Löschprozess. Details: [`PRIVACY.md`](PRIVACY.md).
