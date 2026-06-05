# GO-LIVE — futuresthinking.eu umstellen (Schritt für Schritt)

> Die **eine** Anleitung, die du brauchst, um von der alten 2020er-Seite auf die neue
> Plattform umzustellen. Stand 2026-06-05. Architektur-Details: [`../backend-architektur.md`](../backend-architektur.md).
> Tom-Entscheidungen (alle ✅): Cloudflare Pages · volle DNS-Migration · Repo **public** ·
> Code MIT / Inhalte CC-BY-NC-4.0 · SVG-Default · Feed ohne Signatur (noch).

**Reihenfolge ernst nehmen** — besonders: **erst sichern (Phase 0), zuletzt DNS umstellen (Phase 7)**.
Interaktive Logins (`gh auth login`, `wrangler login`) startest du in dieser Session mit vorangestelltem `!`.

---

## Voraussetzungen (einmalig)
- **GitHub-Account** (für das öffentliche Repo). tom08sechzehn über tom.thi.2022@gmail.com
- **Cloudflare-Account** (Pages + Turnstile + DNS — alles kostenlos für diesen Umfang). über tom.thi.2022@gmail.com
- Lokal installiert: **git**, **Node ≥ 20**. Optional bequem: **GitHub CLI** (`gh`).
- Repo-Ordner: `…\2026-06-03-futuresthinking-nutzungs-ideen\repo`

---

## Phase 0 — Alte Seite sichern (PFLICHT, vor allem anderen)
Die alte one.com-Seite (2020) wird durch die DNS-Umstellung unerreichbar. Vorher spiegeln:

```powershell
! pwsh "…\repo\scripts\backup-oldsite.ps1"
```
→ legt einen zeitgestempelten Ordner mit der kompletten alten Seite an. Erst weiter, wenn das Backup steht.

---

## Phase 1 — Lokal prüfen + Lockfile erzeugen
```powershell
cd "…\repo"
npm install          # erzeugt package-lock.json (für CI nötig — MITcommitten!)
npm run validate     # erwartet: ✓ 8 Funde valide
npm run build        # erzeugt funds.json + Feed + public-build/
```
Alles grün? Weiter.

---

## Phase 2 — GitHub-Repo (public) anlegen + pushen
**Mit GitHub CLI (empfohlen):**
```powershell
cd "…\repo"
! gh auth login                      # einmalig, interaktiv
git init -b main
git add .
git commit -m "Initial: futuresthinking.eu — offene Plattform (No-Server)"
! gh repo create futuresthinking --public --source=. --push
```
**Ohne CLI:** Repo `futuresthinking` auf github.com manuell **public** anlegen, dann
`git remote add origin <url>` → `git push -u origin main`.

---

## Phase 3 — PR-Gate scharfschalten
GitHub → Repo → **Settings → Branches → Add branch protection rule** für `main`:
- ✅ *Require a pull request before merging*
- ✅ *Require status checks to pass* → Check **`validate`** auswählen.

Damit kann kein Fund ohne grüne Schema-Validierung gemerged werden.

---

## Phase 4 — Turnstile-Widget anlegen + Site-Key einsetzen
Cloudflare-Dashboard → **Turnstile → Add site**:
- Domain: `futuresthinking.eu`
- Widget-Modus: *Managed* (Standard)
- Du bekommst **zwei** Schlüssel:
  - **Site Key** (öffentlich) → kommt ins Frontend.
  - **Secret Key** (geheim) → kommt später in die Pages-Env (Phase 6).

**Site Key ins Formular eintragen:** in `repo/site/einreichen.html` den Platzhalter
**`PASTE_TURNSTILE_SITE_KEY`** durch deinen echten Site Key ersetzen, committen, pushen:
```powershell
# Suchen: PASTE_TURNSTILE_SITE_KEY  →  ersetzen, dann:
git commit -am "Turnstile Site-Key gesetzt"; git push
```

---

## Phase 5 — Cloudflare-Projekt verbinden (Workers + Static Assets)
> Cloudflare legt neue statische Projekte als **Worker mit Static Assets** an (nicht als klassisches Pages). Das Repo ist darauf eingestellt: `wrangler.toml` (`main = "worker.js"` + `[assets] directory = "./public-build"`) und `worker.js` routet `/api/submit`, alles andere sind statische Assets aus `public-build/`.

Cloudflare → **Workers & Pages** → Projekt `futuresthinking` → **Settings → Build** (bzw. „Build configuration"):
- **Build command:** `npm ci && npm run build`
- **Deploy command:** `npx wrangler deploy`
- **Production branch / Branch:** `main`

`wrangler deploy` liest `wrangler.toml`, lädt `public-build/` als Assets hoch und deployt den Worker inklusive `/api/submit`. **NICHT** `wrangler pages deploy` verwenden (das ist der alte Pages-Weg und schlägt hier fehl).

(Der CI-Workflow `deploy.yml` ist der alternative manuelle Weg — er nutzt jetzt ebenfalls `wrangler deploy`. Für den Start reicht die Git-Build-Integration oben.)

---

## Phase 6 — Secrets & Env setzen
**Cloudflare Pages → Projekt → Settings → Environment variables** (als *encrypted* markieren):

| Variable | Wert | Wofür |
|---|---|---|
| `TURNSTILE_SECRET` | Turnstile **Secret** Key (Phase 4) | Bot-Check serverseitig |
| `GITHUB_TOKEN` | Fine-grained PAT (Phase 7) | öffnet PRs |
| `GITHUB_OWNER` | `tom08sechzehn` (dein GitHub-Account) | Ziel-Repo |
| `GITHUB_REPO` | `futuresthinking` | Ziel-Repo |
| `GITHUB_BASE_BRANCH` | `main` *(optional)* | Ziel-Branch |

**Nur falls du auf CI-Deploy via `deploy.yml` umstellst** (GitHub → Settings → Secrets → Actions):
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

---

## Phase 7 — GitHub-Token für die Submit-Function erstellen
GitHub → **Settings → Developer settings → Fine-grained personal access tokens → Generate**:
- **Repository access:** *Only select repositories* → nur `futuresthinking`.
- **Permissions:** *Contents* = **Read and write**, *Pull requests* = **Read and write**.
- Token kopieren → als `GITHUB_TOKEN` in Phase 6 eintragen. (Least privilege: nur dieses Repo.)

---

## Phase 8 — DNS migrieren (zuletzt!)
1. Cloudflare → **Add a site** → `futuresthinking.eu` → Free-Plan.
2. Cloudflare liest die bestehenden DNS-Einträge ein — prüfen/übernehmen.
3. Bei **one.com** die **Nameserver** auf die zwei von Cloudflare genannten umstellen (volle Migration).
4. In Cloudflare Pages → Projekt → **Custom domains**: `futuresthinking.eu` **und** `www` hinzufügen; `www` → Apex per 301.
5. TLS: Cloudflare stellt das Zertifikat automatisch aus (Minuten bis Stunden bis NS-Propagation durch ist).

---

## Phase 9 — Live-Checks
- `https://futuresthinking.eu` lädt die neue Startseite (Hard-Reload `Strg+F5`).
- `/methoden.html`, `/einreichen.html`, `/impressum.html`, `/datenschutz.html` erreichbar.
- `/.well-known/futures-feed.json` liefert JSON (8 Funde).
- **Formular-Test:** auf `/einreichen.html` einen Test-Fund einreichen → es muss ein **Pull Request** im Repo auftauchen (nicht auto-veröffentlicht). PR wieder schließen.
- **Bis Impressum/Datenschutz final geprüft sind:** Seite auf `noindex` setzen bzw. nicht öffentlich bewerben.

---

## Rollback (falls etwas schiefgeht)
- **Seite kaputt, DNS schon um:** in Cloudflare Pages auf ein früheres Deployment „Rollback".
- **DNS-Migration zurück:** Nameserver bei one.com auf die alten zurückstellen (Backup aus Phase 0 wieder hochladen).
- **Function spinnt:** Env-Variablen prüfen (Function meldet „Server nicht konfiguriert (X fehlt)", wenn ein Secret fehlt).

---

## Was bewusst (noch) NICHT live ist
- **Ed25519-Feed-Signatur** — Feed läuft unsigniert (`signature:null`), wird scharf, sobald Key-Rotation steht.
- **Batch-Bild-Generierung beim Merge** — erlaubt, aber als separater Schritt nicht im MVP-Build.
- **Zweite Merge-Person (#9)** — in Klärung; bis dahin Solo-Merge (siehe `CONTRIBUTING.md`).

---

## Die kürzeste Fassung (TL;DR)
1. `backup-oldsite.ps1` laufen lassen. 2. `npm install && npm run validate && npm run build`.
3. Repo **public** pushen. 4. PR-Gate `validate` verpflichtend. 5. Turnstile-Widget anlegen, Site-Key in `einreichen.html` einsetzen. 6. Cloudflare Pages mit Repo verbinden (output `public-build`). 7. 4–5 Env-Secrets setzen + GitHub-Token. 8. DNS zu Cloudflare migrieren. 9. Seite + Formular testen, `noindex` bis Legal steht.
