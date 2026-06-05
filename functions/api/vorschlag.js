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

import { EmailMessage } from "cloudflare:email";

// TEMP-DEBUG (2026-06-05): bei true wird der echte Send-Fehler (code/message, KEIN Secret)
// ins `fehler`-Feld geschrieben, damit die Ursache im Banner sichtbar ist. Vor Produktion: false.
const DEBUG = true;

/* Absender (MUSS auf der onboardeten Domain liegen) + fester Empfaenger. */
const MAIL_FROM = { email: "kontakt@futuresthinking.eu", name: "futuresthinking" };
const MAIL_TO = "tom.thi.2022@gmail.com"; // hart verdrahtet — VERIFIZIERTE Email-Routing-Zieladresse (Gratis-Versand); nie aus dem Body

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

/** UTF-8 -> Base64 (Worker-safe; btoa ist latin1-only, daher ueber die Bytes). */
function b64utf8(str) {
  const bytes = new TextEncoder().encode(String(str));
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Baut eine rohe RFC-5322-MIME-Mail (Plain-Text, UTF-8) fuer cloudflare:email EmailMessage.
 *  Betreff RFC-2047-kodiert, Body Base64 (sicher fuer UTF-8 + Zeilenlaengen), CRLF-Enden. */
function buildRawEmail({ fromName, fromAddr, to, replyTo, subject, text }) {
  const encWord = (s) => `=?UTF-8?B?${b64utf8(s)}?=`;
  const bodyB64 = b64utf8(text).replace(/(.{76})/g, "$1\r\n");
  const lines = [`From: ${fromName} <${fromAddr}>`, `To: ${to}`];
  if (replyTo) lines.push(`Reply-To: ${replyTo}`);
  lines.push(
    `Subject: ${encWord(subject)}`,
    `Message-ID: <${crypto.randomUUID()}@futuresthinking.eu>`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset="utf-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    bodyB64
  );
  return lines.join("\r\n");
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

  // 3) Mail als rohe MIME-Nachricht (Plain-Text, UTF-8) bauen. Der GRATIS-Weg ueber
  //    Email Routing erwartet ein cloudflare:email EmailMessage-Objekt — NICHT das
  //    Objekt-Format ({to,from,...}) des kostenpflichtigen Email Sending.
  const subject = `futuresthinking · Methoden-Vorschlag: ${methode}`;

  const absenderZeileText = email
    ? `Absender-Mail: ${email}${emailValid ? "" : "  (Format auffaellig — Rueckfrage pruefen)"}`
    : "Absender-Mail: (keine angegeben)";

  const text =
    `Neuer Methoden-Vorschlag ueber futuresthinking.eu\n\n` +
    `Methode:\n${methode}\n\n` +
    `Beschreibung:\n${beschreibung}\n\n` +
    `${absenderZeileText}\n`;

  const raw = buildRawEmail({
    fromName: MAIL_FROM.name,
    fromAddr: MAIL_FROM.email,
    to: MAIL_TO,
    replyTo: emailValid ? email : null,
    subject,
    text,
  });

  // 4) Versenden via send_email-Binding (cloudflare:email EmailMessage, kein API-Key).
  try {
    await env.EMAIL.send(new EmailMessage(MAIL_FROM.email, MAIL_TO, raw));
    return json({ ok: true });
  } catch (e) {
    const code = (e && (e.code || e.name)) || "unknown";
    const emsg = (e && e.message ? String(e.message) : "").replace(/\s+/g, " ").slice(0, 180);
    console.log("vorschlag SEND FAIL", JSON.stringify({ code, emsg }));
    // TEMP-DEBUG (2026-06-05): Ursache im Banner sichtbar machen (kein Secret). Vor Produktion DEBUG=false.
    return fehler(
      DEBUG
        ? `[debug] send ${code} — ${emsg}`
        : "konnte gerade nicht gesendet werden — versuch es gleich nochmal",
      503
    );
  }
}
