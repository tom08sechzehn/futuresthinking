/**
 * functions/api/submit.js — Cloudflare Pages Function (Pfad B).
 *
 * Route: POST /api/submit
 *
 * Niedrigschwelliges Web-Formular (site/einreichen.html) POSTet ein JSON hierher.
 * Diese Function:
 *   1) verifiziert serverseitig den Cloudflare-Turnstile-Token,
 *   2) baut aus KOMBINATORISCHEN Feldern (Enums) einen .future-Datensatz —
 *      einzige freie Textfelder: objektname + beipackzettel (werden sanitisiert),
 *   3) committet via GitHub-API einen neuen Branch + funde/<slug>.future und
 *      öffnet einen Pull Request gegen main.
 *
 * Sie speichert NICHTS, loggt keine IP, hat keinen State (DSGVO-by-design).
 * Der eigentliche Schema-Check ist das CI-Gate auf dem PR (tools/validate.mjs);
 * diese Function ist die niederschwellige, aber strenge Vorpruefung.
 *
 * BENOETIGTE ENV-VARIABLEN (in Cloudflare Pages > Settings > Environment variables;
 * Secrets als "encrypted" markieren — NIE im Repo, NIE im Frontend):
 *   TURNSTILE_SECRET   — Cloudflare-Turnstile Secret Key (Server-Seite)
 *   GITHUB_TOKEN       — Fine-grained PAT / GitHub-App-Token, Scope NUR dieses Repo:
 *                        contents:write + pull_requests:write. In Echos maskiert (gh_****).
 *   GITHUB_OWNER       — z.B. "deinuser" oder Orga
 *   GITHUB_REPO        — z.B. "futuresthinking"
 *   GITHUB_BASE_BRANCH — optional, Default "main"
 */

const ENUMS = {
  wahrscheinlichkeit: ["moeglich", "plausibel", "wahrscheinlich"],
  wuenschbarkeit: ["wuenschenswert", "neutral", "nicht"],
  lizenz: ["CC-BY-NC-4.0", "CC-BY-SA-4.0", "CC-BY-4.0", "CC0-1.0"],
  tonalitaet: [
    "solarpunk",
    "cyberpunk",
    "degrowth",
    "hightech-optimistisch",
    "klima-realistisch",
    "retro-futur",
    "buerokratisch-mundan",
    "unbestimmt",
  ],
};

const SLUG_RE = /^(203[0-9]|20[4-6][0-9]|2070)-[a-z0-9]+(-[a-z0-9]+)*$/;
const FUNDORT_RE = /^[^,]{2,},\s*\S.*$/;
const URHEBER_RE = /^\S(.*\S)?$/;

// Bild-Upload (Pfad B): nur PNG/WebP, hartes Byte-Limit (kleine PRs, Missbrauchsschutz).
const BILD_MAX_BYTES = 2_000_000; // 2 MB nach Client-Komprimierung
const BILD_B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

const UA = "futuresthinking-submit-fn";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
function reject(reason, status = 400) {
  return json({ ok: false, error: reason }, status);
}

/** Code-Point-Laenge (nicht UTF-16-Units) — wie der CI-Validator. */
function cpLen(str) {
  return [...String(str)].length;
}

/** Entfernt Steuerzeichen, normalisiert Whitespace, kappt hart. */
function sanitizeText(input, maxCp) {
  let s = String(input ?? "");
  // CRLF -> LF, dann Steuerzeichen raus (ausser \n=0x0A und \t=0x09)
  s = s.replace(/\r\n/g, "\n").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  // mehrfachen Whitespace zusammenfassen, trimmen
  s = s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  // YAML-/Injection-Sicherheit: der Wert wird immer als JSON-String ins YAML
  // geschrieben (gueltiges YAML), daher kein zusaetzliches Escaping noetig.
  if (maxCp && cpLen(s) > maxCp) {
    s = [...s].slice(0, maxCp).join("");
  }
  return s;
}

/** kebab-case ASCII-Slug aus freiem Objektnamen. */
function kebab(name) {
  return String(name)
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // diakritische Zeichen entfernen
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 60);
}

/** Base64 -> Uint8Array (Workers-Runtime, kein Node-Buffer). */
function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Magic-Byte-Sniff: 'webp' | 'png' | null. Vertraut NICHT dem Client-MIME. */
function sniffImage(bytes) {
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // "RIFF"
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50  // "WEBP"
  ) return "webp";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "png";
  return null;
}

/**
 * Validiert ein optionales Upload-Bild aus dem Web-Formular.
 *   - kein bild_data  -> { ok:true, bild:null }
 *   - gültiges Bild   -> { ok:true, bild:{ext,alt,credit,width,height}, b64 }
 *   - ungültig        -> { ok:false, error }
 * Das Schema verlangt bei gesetztem bild: src/alt/credit. alt ist Pflicht (a11y),
 * credit fällt auf urheber zurück. Nur PNG/WebP (Schema-bild.src-Muster).
 */
function validateBild(body) {
  const raw = body.bild_data;
  if (raw == null || String(raw).trim() === "") return { ok: true, bild: null };

  let b64 = String(raw).replace(/^data:[^;]+;base64,/, "").trim();
  if (!BILD_B64_RE.test(b64) || b64.length < 16) {
    return { ok: false, error: "Bilddaten sind kein gültiges Base64" };
  }
  if (Math.floor((b64.length * 3) / 4) > BILD_MAX_BYTES) {
    return { ok: false, error: `Bild zu groß (max ${Math.floor(BILD_MAX_BYTES / 1024)} KB nach Komprimierung)` };
  }
  let bytes;
  try { bytes = base64ToBytes(b64); } catch { return { ok: false, error: "Bilddaten nicht dekodierbar" }; }
  if (bytes.length > BILD_MAX_BYTES) {
    return { ok: false, error: `Bild zu groß (max ${Math.floor(BILD_MAX_BYTES / 1024)} KB)` };
  }
  const ext = sniffImage(bytes);
  if (!ext) return { ok: false, error: "Bildformat nicht erkannt — nur PNG oder WebP" };

  const alt = sanitizeText(body.bild_alt, 300);
  if (cpLen(alt) < 8) {
    return { ok: false, error: "Bildbeschreibung (Alt-Text) ist Pflicht, 8–300 Zeichen" };
  }
  let credit = sanitizeText(body.bild_credit, 120);
  if (cpLen(credit) < 1) {
    credit = sanitizeText(body.urheber, 120) || "anonyme Einreichung";
  }
  let width = Number(body.bild_width);
  let height = Number(body.bild_height);
  width = Number.isInteger(width) && width >= 256 && width <= 4096 ? width : null;
  height = Number.isInteger(height) && height >= 256 && height <= 4096 ? height : null;

  return { ok: true, bild: { ext, alt, credit, width, height }, b64 };
}

/** Turnstile serverseitig verifizieren. */
async function verifyTurnstile(token, secret, ip) {
  if (!token || !secret) return false;
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  try {
    const r = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body: form }
    );
    const data = await r.json();
    return data && data.success === true;
  } catch {
    return false;
  }
}

/**
 * Validiert die eingereichten Felder gegen die kombinatorische Auswahl.
 * Gibt { ok, record, slug } oder { ok:false, error } zurueck.
 */
function validateSubmission(body) {
  const errs = [];

  // Pflicht-Enums (kombinatorisch, kein offener Vektor)
  for (const key of ["wahrscheinlichkeit", "wuenschbarkeit"]) {
    if (!ENUMS[key].includes(body[key])) errs.push(`${key} ungueltig`);
  }
  const lizenz = ENUMS.lizenz.includes(body.lizenz) ? body.lizenz : "CC-BY-NC-4.0";
  const tonalitaet =
    body.tonalitaet == null
      ? null
      : ENUMS.tonalitaet.includes(body.tonalitaet)
      ? body.tonalitaet
      : null;

  // fundjahr
  const fundjahr = Number(body.fundjahr);
  if (!Number.isInteger(fundjahr) || fundjahr < 2030 || fundjahr > 2070)
    errs.push("fundjahr ausserhalb 2030-2070");

  // fundort (begrenzt freies Feld, Form erzwungen + sanitisiert)
  const fundort = sanitizeText(body.fundort, 120);
  if (!FUNDORT_RE.test(fundort)) errs.push("fundort muss Form 'Etwas, Ort' haben");

  // objektname (freies Feld — sanitisiert)
  const objektname = sanitizeText(body.objektname, 80);
  if (cpLen(objektname) < 2) errs.push("objektname zu kurz");

  // beipackzettel (freies Feld — sanitisiert, 280-600 Code-Points)
  const beipackzettel = sanitizeText(body.beipackzettel, 600);
  const bzLen = cpLen(beipackzettel);
  if (bzLen < 280 || bzLen > 600)
    errs.push(`beipackzettel ${bzLen} Zeichen (erlaubt 280-600)`);

  // urheber (Pseudonym, optional — sanitisiert)
  let urheber = null;
  if (body.urheber != null && String(body.urheber).trim() !== "") {
    urheber = sanitizeText(body.urheber, 60);
    if (cpLen(urheber) < 2 || !URHEBER_RE.test(urheber))
      errs.push("urheber ungueltig");
  }

  if (errs.length) return { ok: false, error: errs.join("; ") };

  // Slug aus Jahr + Objektname
  const slug = `${fundjahr}-${kebab(objektname)}`;
  if (!SLUG_RE.test(slug))
    return { ok: false, error: "Slug nicht bildbar (objektname zu exotisch)" };

  const record = {
    schema_version: "1.0",
    objekt_id: slug,
    objektname,
    fundjahr,
    fundort,
    wahrscheinlichkeit: body.wahrscheinlichkeit,
    wuenschbarkeit: body.wuenschbarkeit,
    beipackzettel,
    lizenz,
    urheber,
    tonalitaet,
  };
  return { ok: true, record, slug };
}

/** Baut den .future-Dateiinhalt (YAML). Werte als JSON-Strings = injection-sicher. */
function buildFutureYaml(rec) {
  const q = (v) => JSON.stringify(v); // gueltiges YAML-Skalar, escaped korrekt
  const lines = [
    `schema_version:     ${q(rec.schema_version)}`,
    `objekt_id:          ${q(rec.objekt_id)}`,
    `objektname:         ${q(rec.objektname)}`,
    `fundjahr:           ${rec.fundjahr}`,
    `fundort:            ${q(rec.fundort)}`,
    `wahrscheinlichkeit: ${q(rec.wahrscheinlichkeit)}`,
    `wuenschbarkeit:     ${q(rec.wuenschbarkeit)}`,
  ];
  if (rec.tonalitaet) lines.push(`tonalitaet:         ${q(rec.tonalitaet)}`);
  lines.push(`beipackzettel:      ${q(rec.beipackzettel)}`);
  if (rec.urheber) lines.push(`urheber:            ${q(rec.urheber)}`);
  lines.push(`lizenz:             ${q(rec.lizenz)}`);
  if (rec.bild) {
    lines.push(`bild:`);
    lines.push(`  src:    ${q(rec.bild.src)}`);
    lines.push(`  alt:    ${q(rec.bild.alt)}`);
    lines.push(`  credit: ${q(rec.bild.credit)}`);
    if (rec.bild.width) lines.push(`  width:  ${rec.bild.width}`);
    if (rec.bild.height) lines.push(`  height: ${rec.bild.height}`);
  }
  lines.push(`remix_von:          null`);
  lines.push(`verweist_auf:       null`);
  lines.push(`audio_fundnotiz:    null`);
  return lines.join("\n") + "\n";
}

/* --- GitHub-REST-Client (least-privilege Token, nur fetch) ---------------- */
function ghHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "user-agent": UA,
    "x-github-api-version": "2022-11-28",
  };
}
function ghBase(owner, repo) {
  return `https://api.github.com/repos/${owner}/${repo}`;
}
async function ghJson(url, opts) {
  const r = await fetch(url, opts);
  const text = await r.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!r.ok) {
    const msg = (data && data.message) || `GitHub ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
  return data;
}

/** UTF-8-sicheres Base64 (Workers-Runtime, kein Node-Buffer). */
function toBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/* -------------------------------------------------------------------------- */
export async function onRequestPost({ request, env }) {
  // env-Validierung (klare Fehler, keine Secrets im Body)
  for (const k of ["TURNSTILE_SECRET", "GITHUB_TOKEN", "GITHUB_OWNER", "GITHUB_REPO"]) {
    if (!env[k]) return reject(`Server nicht konfiguriert (${k} fehlt)`, 500);
  }
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const base = env.GITHUB_BASE_BRANCH || "main";

  let body;
  try {
    body = await request.json();
  } catch {
    return reject("Body ist kein gueltiges JSON", 400);
  }

  // Honeypot: unsichtbares Feld 'website' ausgefuellt = Bot -> still ok
  if (body.website) return json({ ok: true });

  // 1) Turnstile serverseitig pruefen (cookie-frei, DSGVO-arm)
  const ip = request.headers.get("cf-connecting-ip") || undefined; // NICHT geloggt
  const passed = await verifyTurnstile(body.cf_turnstile_token, env.TURNSTILE_SECRET, ip);
  if (!passed) return reject("Challenge nicht bestanden (Turnstile)", 403);

  // 2) Felder gegen das gemeinsame Modell pruefen + sanitisieren
  const v = validateSubmission(body);
  if (!v.ok) return reject(v.error, 422);

  const { record, slug } = v;

  // 2b) optionales Bild prüfen + an den Datensatz hängen (VOR dem YAML-Bau)
  const vb = validateBild(body);
  if (!vb.ok) return reject(vb.error, 422);
  if (vb.bild) {
    record.bild = {
      src: `bilder/${slug}.${vb.bild.ext}`,
      alt: vb.bild.alt,
      credit: vb.bild.credit,
      width: vb.bild.width,
      height: vb.bild.height,
    };
  }

  const path = `funde/${slug}.future`;
  const branch = `submit/${slug}-${crypto.randomUUID().slice(0, 6)}`;
  const content = buildFutureYaml(record);

  try {
    // 3a) base-Branch-SHA holen
    const ref = await ghJson(`${ghBase(owner, repo)}/git/ref/heads/${base}`, {
      headers: ghHeaders(env.GITHUB_TOKEN),
    });
    const baseSha = ref.object.sha;

    // 3b) Existenz pruefen (Slug-Kollision -> 409, kein Ueberschreiben)
    const existsRes = await fetch(
      `${ghBase(owner, repo)}/contents/${encodeURIComponent(path)}?ref=${base}`,
      { headers: ghHeaders(env.GITHUB_TOKEN) }
    );
    if (existsRes.status === 200) {
      return reject(`Ein Fund mit diesem Slug existiert bereits (${slug})`, 409);
    }

    // 3c) neuen Branch anlegen
    await ghJson(`${ghBase(owner, repo)}/git/refs`, {
      method: "POST",
      headers: ghHeaders(env.GITHUB_TOKEN),
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
    });

    // 3d) Datei in den Branch committen (Base64-Inhalt, UTF-8-sicher)
    await ghJson(`${ghBase(owner, repo)}/contents/${encodeURIComponent(path)}`, {
      method: "PUT",
      headers: ghHeaders(env.GITHUB_TOKEN),
      body: JSON.stringify({
        message: `Fund: ${record.objektname} (${record.fundjahr})`,
        content: toBase64Utf8(content),
        branch,
      }),
    });

    // 3d-bild) optionales Bild in DENSELBEN Branch committen (Binär, Base64 direkt).
    if (record.bild && vb.bild) {
      const imgPath = `funde/bilder/${slug}.${vb.bild.ext}`;
      await ghJson(`${ghBase(owner, repo)}/contents/${encodeURIComponent(imgPath)}`, {
        method: "PUT",
        headers: ghHeaders(env.GITHUB_TOKEN),
        body: JSON.stringify({
          message: `Bild: ${record.objektname} (${record.fundjahr})`,
          content: vb.b64,
          branch,
        }),
      });
    }

    // 3e) Pull Request oeffnen
    const pr = await ghJson(`${ghBase(owner, repo)}/pulls`, {
      method: "POST",
      headers: ghHeaders(env.GITHUB_TOKEN),
      body: JSON.stringify({
        title: `Fund: ${record.objektname} (${record.fundjahr})`,
        head: branch,
        base,
        body:
          "Eingereicht via Web-Formular (Pfad B).\n\n" +
          (record.bild ? `Mit Bild: \`${record.bild.src}\` (vom Einreicher hochgeladen).\n\n` : "") +
          "Das CI-Gate validiert automatisch (Schema, Slug-Jahr, Beipackzettel-Laenge, FK).\n" +
          "Ein Mensch merged als Archivar:in aus 2071. Siehe CONTRIBUTING.md.",
      }),
    });

    return json({ ok: true, pr: pr.html_url, slug });
  } catch (e) {
    // Kein Token, keine IP, keine Secrets in der Antwort.
    const status = e.status === 401 || e.status === 403 ? 502 : 500;
    return json(
      { ok: false, error: "Einreichung fehlgeschlagen", detail: e.message },
      status
    );
  }
}
