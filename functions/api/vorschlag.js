/**
 * functions/api/vorschlag.js — Cloudflare Pages Function (Worker-Modul).
 *
 * Route: POST /api/vorschlag
 *
 * Die Kachel „Methode vorschlagen" (site/index.html) POSTet einen JSON-Vorschlag
 * hierher. Diese Function:
 *   1) verifiziert serverseitig den Cloudflare-Turnstile-Token (gleiche Logik wie submit.js),
 *   2) prueft Honeypot + validiert/sanitisiert methode / beschreibung / (optional) email,
 *   3) versendet den Vorschlag per Cloudflare-Email-Sending (Workers send_email-Binding,
 *      KEIN API-Key) an die fest verdrahtete Redaktions-Adresse.
 *
 * Sie speichert NICHTS, loggt keine IP, hat keinen State (DSGVO-by-design).
 * Bei jedem Fehler kommt ein FREUNDLICHER deutscher Fallback zurueck — NIE die
 * Mail-/API-Fehlermeldung, NIE interne Details (nur err.code in den Worker-Logs).
 *
 * BENOETIGTE BINDINGS / ENV (Cloudflare > Settings):
 *   TURNSTILE_SECRET  — Cloudflare-Turnstile Secret Key (Server-Seite, gleicher wie submit.js).
 *   EMAIL             — send_email-Binding (wrangler.toml [[send_email]] name="EMAIL").
 *                       OPTIONAL & DEGRADE-GRACEFUL: fehlt das Binding (z. B. weil
 *                       „wrangler email sending enable futuresthinking.eu" beim Go-Live
 *                       noch nicht lief), antwortet der Endpoint freundlich mit 503 und
 *                       der heutige Deploy bleibt sicher. Siehe wrangler.toml-Kommentar.
 *
 * Empfaenger ist HART verdrahtet (Besucher:innen waehlen NIE den Empfaenger).
 */

/* Absender (MUSS auf der onboardeten Domain liegen) + fester Empfaenger. */
const MAIL_FROM = { email: "kontakt@futuresthinking.eu", name: "futuresthinking" };
const MAIL_TO = "tom.siegel@08sechzehn.de"; // hart verdrahtet — nie aus dem Body

/* Eingabe-Haertung. */
const MAX_METHODE = 120;
const MAX_BESCHREIBUNG = 1500;
const MAX_EMAIL = 200;

// Bewusst simple, robuste Plausibilitaetspruefung (keine RFC-Vollvalidierung).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* -------------------------------------------------------------------------- */
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** Einheitlicher, freundlicher Fehler-Banner — nie Mail-/API-Detail, nie Secret. */
function fehler(text, status = 400) {
  return json({ fehler: text }, status);
}

/** Code-Point-Laenge (nicht UTF-16-Units). */
function cpLen(str) {
  return [...String(str)].length;
}

/** Entfernt Steuerzeichen, normalisiert Whitespace, kappt hart (wie submit.js). */
function sanitizeText(input, maxCp) {
  let s = String(input ?? "");
  s = s.replace(/\r\n/g, "\n").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  s = s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (maxCp && cpLen(s) > maxCp) {
    s = [...s].slice(0, maxCp).join("");
  }
  return s;
}

/** HTML-Escaping fuer den HTML-Teil der Mail (User-Inhalt ist unvertraut). */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Turnstile serverseitig verifizieren (identische Logik wie submit.js / oracle.js). */
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

/* -------------------------------------------------------------------------- */
export async function onRequestPost({ request, env }) {
  // env-Validierung: TURNSTILE_SECRET ist Pflicht (sonst freundlicher Fallback).
  if (!env.TURNSTILE_SECRET) {
    return fehler(
      "die vorschlag-funktion wird gerade scharfgeschaltet — schreib uns solange direkt an tom.siegel@08sechzehn.de",
      503
    );
  }

  // EMAIL-Binding OPTIONAL & DEGRADE-GRACEFUL: ohne Binding (vor „email sending enable")
  // antwortet der Endpoint sicher mit 503, statt zu brechen.
  if (!env.EMAIL) {
    return fehler(
      "die vorschlag-funktion wird gerade scharfgeschaltet — schreib uns solange direkt an tom.siegel@08sechzehn.de",
      503
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return fehler("Body ist kein gültiges JSON", 400);
  }

  // Honeypot: unsichtbares Feld 'website' ausgefuellt = Bot -> stiller Fallback (503).
  if (body.website) {
    return fehler(
      "die vorschlag-funktion wird gerade scharfgeschaltet — schreib uns solange direkt an tom.siegel@08sechzehn.de",
      503
    );
  }

  // 1) Turnstile serverseitig pruefen (cookie-frei, DSGVO-arm).
  const ip = request.headers.get("cf-connecting-ip") || undefined; // NICHT geloggt
  const passed = await verifyTurnstile(body.cf_turnstile_token, env.TURNSTILE_SECRET, ip);
  if (!passed) return fehler("Challenge nicht bestanden (Turnstile)", 403);

  // 2) Felder validieren + sanitisieren.
  const methode = sanitizeText(body.methode, MAX_METHODE);
  if (methode === "") return fehler("Bitte einen Methoden-Namen angeben.", 422);

  const beschreibung = sanitizeText(body.beschreibung, MAX_BESCHREIBUNG);
  if (beschreibung === "")
    return fehler("Bitte eine kurze Beschreibung / Begründung angeben.", 422);

  // email optional: sanitisieren, bas-pruefen. Bei Unfug verwerfen wir NUR die Mail
  // (kein replyTo), der Vorschlag geht trotzdem raus.
  let email = "";
  let emailValid = false;
  if (body.email != null && String(body.email).trim() !== "") {
    email = sanitizeText(body.email, MAX_EMAIL).replace(/\s+/g, "");
    emailValid = cpLen(email) <= MAX_EMAIL && EMAIL_RE.test(email);
  }

  // 3) Mail bauen (plain-text + minimal-HTML; User-Inhalt im HTML escaped).
  const subject = `futuresthinking · Methoden-Vorschlag: ${methode}`;

  const absenderZeileText = email
    ? `Absender-Mail: ${email}${emailValid ? "" : "  (Format auffällig — Rückfrage prüfen)"}`
    : "Absender-Mail: (keine angegeben)";

  const text =
    `Neuer Methoden-Vorschlag über futuresthinking.eu\n` +
    `\n` +
    `Methode:\n${methode}\n` +
    `\n` +
    `Beschreibung:\n${beschreibung}\n` +
    `\n` +
    `${absenderZeileText}\n`;

  const absenderZeileHtml = email
    ? `<p><strong>Absender-Mail:</strong> ${escapeHtml(email)}${
        emailValid ? "" : " <em>(Format auffällig — Rückfrage prüfen)</em>"
      }</p>`
    : `<p><strong>Absender-Mail:</strong> (keine angegeben)</p>`;

  const html =
    `<h2>Neuer Methoden-Vorschlag</h2>` +
    `<p>über futuresthinking.eu</p>` +
    `<p><strong>Methode:</strong><br>${escapeHtml(methode)}</p>` +
    `<p><strong>Beschreibung:</strong><br>${escapeHtml(beschreibung).replace(/\n/g, "<br>")}</p>` +
    absenderZeileHtml;

  const mail = { to: MAIL_TO, from: MAIL_FROM, subject, html, text };
  // replyTo nur, wenn die Besucher-Mail plausibel aussieht.
  if (emailValid) mail.replyTo = email;

  // 4) Versenden via send_email-Binding (kein API-Key). Fehler -> freundlich + no-leak.
  try {
    await env.EMAIL.send(mail);
    return json({ ok: true });
  } catch (e) {
    // NIE err.message/Body nach aussen geben — nur err.code in die Worker-Logs.
    console.log("vorschlag SEND FAIL", JSON.stringify({ code: (e && e.code) || "unknown" }));
    return fehler("konnte gerade nicht gesendet werden — versuch es gleich nochmal", 503);
  }
}
