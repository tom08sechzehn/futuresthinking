# Datenschutz / DSGVO

futuresthinking.eu ist **datenschutz-by-design**: keine Accounts, kein Tracking,
keine Cookies, keine Analytics-Pixel, keine Drittanbieter-Fonts/JS. Zur Laufzeit
liegt nur statisches HTML/JSON auf einem CDN. Diese Datei beschreibt die wenigen
Stellen, an denen überhaupt Daten berührt werden, und den Löschprozess.

---

## Identität = Pseudonym (First-Line)

Es gibt **keine personenbezogenen Accounts**. Die einzige Identitätsangabe ist das
Feld `urheber` — ein **selbstgewähltes Pseudonym** oder ein Kollektiv-Name. Es ist
**optional**. Die First-Line-Empfehlung an alle Einreichenden ist ausdrücklich:
**ein Pseudonym verwenden, keinen Klarnamen** — weder den eigenen noch den Dritter.

Das Merge-Review hebt die Freitext-Felder (`urheber`, `fundort`, `beipackzettel`)
hervor und blockiert Klarnamen Dritter, Doxing und Beleidigungen, bevor ein Fund
in den Bestand kommt.

---

## Die Submit-Function (Pfad B) — IP-Handling

Das Web-Formular `POST /api/submit` (Cloudflare Pages Function) ist **stateless**
und **speichert nichts**:

- Sie **loggt keine IP-Adresse**. Die Function sieht über `cf-connecting-ip` eine
  IP nur flüchtig für die Turnstile-Verifikation (Spam-Abwehr) und schreibt sie
  **nirgendwo** hin — nicht in die `.future`-Datei, nicht in den PR, nicht in eine
  Antwort, nicht in ein Log.
- **Cloudflare Turnstile** ist cookie-frei und DSGVO-arm (kein Tracking-Cookie,
  keine Profilbildung). Es dient ausschließlich der Bot-Abwehr.
- Eine kurzzeitige IP-Nutzung fürs Rate-Limiting / die Challenge ist **berechtigtes
  Interesse** (Schutz vor Spam/Missbrauch) und wird in der Datenschutzerklärung
  benannt. Keine darüber hinausgehende Verarbeitung, keine Aufbewahrung.

Kein Einwilligungs-Banner nötig, weil keine einwilligungspflichtige Verarbeitung
stattfindet.

---

## Recht auf Löschung — zweistufiger Prozess

Da ein Fund **eine Datei in Git** ist, ist Löschung nachvollziehbar — aber Git
behält standardmäßig die History. Deshalb ein **zweistufiger** Prozess
(Entscheidung Tom/Larry 2026-06-05):

### Stufe 1 — Default: Datei per Commit entfernen

Für den Regelfall (Inhalt soll nicht mehr publiziert werden):

1. `funde/<slug>.future` (und ggf. `bilder/<slug>.*`) **löschen**, committen, mergen.
2. Der nächste Build entfernt den Fund aus `site/data/funds.json` und dem Feed.
3. Cloudflare-Cache invalidieren (Purge), damit das CDN die Seite nicht weiter ausliefert.

Der Inhalt ist damit **nicht mehr publiziert**. In der öffentlichen Git-History
bleibt er prinzipiell auffindbar — für den Normalfall genügt das, weil die Identität
ohnehin pseudonym ist (siehe oben).

### Stufe 2 — Echtes DSGVO-Erasure: History-Rewrite

Wenn ein begründetes Löschverlangen nach **Art. 17 DSGVO** vorliegt und die bloße
Entfernung aus dem aktuellen Stand nicht ausreicht (z.B. weil doch personenbezogene
Daten in die History gelangt sind):

1. **History-Rewrite** mit `git filter-repo` — den/die betroffenen Pfad(e) aus der
   gesamten Historie entfernen:
   ```bash
   git filter-repo --invalidate-refs --path funde/<slug>.future --invert-paths
   # ggf. zusätzlich: --path bilder/<slug>.png --invert-paths
   ```
2. **Force-Push** auf alle Remotes (`origin` **und** der Off-GitHub-Mirror, z.B.
   Codeberg), damit kein Spiegel die alte History behält.
3. **Cache-Invalidierung** auf Cloudflare (vollständiger Purge der betroffenen URLs
   + Feed).
4. Vorgang **dokumentieren** (Datum, Anlass, betroffene Pfade) — ohne den gelöschten
   Inhalt zu reproduzieren.

> History-Rewrite ist ein **Sonderfall**, kein Routinevorgang: er bricht alle
> bestehenden Commit-Hashes und erfordert, dass Forks/Klone neu ziehen. Deshalb
> Stufe 1 als Default, Stufe 2 nur auf belegtes Löschverlangen.

---

## Pflicht-Seiten & Hosting

- **Impressum** (`site/impressum.html`) und **Datenschutzerklärung**
  (`site/datenschutz.html`) müssen **vor** dem öffentlichen Livegang stehen.
  Bis dahin `noindex` setzen / nicht öffentlich verlinken.
- **Hosting-Standort:** Cloudflare mit EU-Edge; mit dem Host einen
  Auftragsverarbeitungsvertrag (DPA/AV-Vertrag) abschließen.

---

## Kontakt für Datenschutz-Anliegen

Löschverlangen und Datenschutz-Anfragen über die im Impressum genannte
Kontaktadresse. Bearbeitung gemäß dem oben beschriebenen zweistufigen Prozess.
