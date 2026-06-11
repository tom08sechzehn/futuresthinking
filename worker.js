/**
 * worker.js — ESM Worker-Entry (Workers-Static-Assets-Modell).
 *
 * WARUM dieser Entry existiert:
 *   Cloudflare hat das Projekt als *Worker* deployt (nicht als klassisches Pages).
 *   Im Worker-Modell gibt es KEIN automatisches functions/-Verzeichnis-Routing mehr —
 *   ein Worker braucht einen expliziten fetch-Handler. Dieser Entry uebernimmt das.
 *
 * Wiederverwendung der bestehenden Pages-Function:
 *   functions/api/submit.js exportiert `onRequestPost({ request, env })` als reines
 *   ESM-Modul. Wir importieren diesen Handler unveraendert und rufen ihn fuer
 *   POST /api/submit auf — die gesamte Submit-Logik (Turnstile, Validierung,
 *   GitHub-PR) bleibt eine einzige Quelle, kein Copy-Paste.
 *
 * Statische Auslieferung:
 *   Alle Nicht-API-Pfade gehen ueber die ASSETS-Binding (siehe wrangler.toml,
 *   [assets] directory = "./public-build"). Im Static-Assets-Modell serviert
 *   Cloudflare vorhandene Assets ohnehin ZUERST; dieser Worker wird primaer fuer
 *   /api/submit aufgerufen. env.ASSETS.fetch(request) ist der explizite Fallback
 *   fuer alles andere und haelt das Verhalten auch bei run_worker_first o.ae.
 *   deterministisch.
 */

import { onRequestPost } from "./functions/api/submit.js";
import { onRequestPost as oraclePost } from "./functions/api/oracle.js";     // Orakel (Turnstile + Anthropic)
import { onRequestPost as vorschlagPost } from "./functions/api/vorschlag.js"; // Methoden-Vorschlag (Turnstile + Email)
import { onRequestGet as oracleLogGet } from "./functions/api/oracle-log.js"; // Admin: Eingangs-Übersicht + Blog-Freigabe
import { onRequestGet as blogGet } from "./functions/api/blog.js";             // Öffentlich: Blog-Posts

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // API-Route: POST /api/submit -> bestehende Pages-Function (als Modul wiederverwendet).
    if (url.pathname === "/api/submit") {
      if (request.method === "POST") {
        return onRequestPost({ request, env });
      }
      // Andere HTTP-Methoden auf /api/submit sind nicht erlaubt.
      return new Response("Method Not Allowed", { status: 405 });
    }

    // API-Route: POST /api/oracle -> Orakel-Function (Turnstile + Anthropic).
    if (url.pathname === "/api/oracle") {
      if (request.method === "POST") {
        return oraclePost({ request, env, ctx });
      }
      return new Response("Method Not Allowed", { status: 405 });
    }

    // API-Route: POST /api/vorschlag -> Methoden-Vorschlag (Turnstile + Email-Sending).
    if (url.pathname === "/api/vorschlag") {
      if (request.method === "POST") {
        return vorschlagPost({ request, env });
      }
      return new Response("Method Not Allowed", { status: 405 });
    }

    // API-Route: GET /api/oracle-log -> Admin-Übersicht (Token-geschützt).
    if (url.pathname === "/api/oracle-log") {
      if (request.method === "GET") {
        return oracleLogGet({ request, env });
      }
      return new Response("Method Not Allowed", { status: 405 });
    }

    // API-Route: GET /api/blog -> veröffentlichte Blog-Posts (öffentlich).
    if (url.pathname === "/api/blog") {
      if (request.method === "GET") {
        return blogGet({ request, env });
      }
      return new Response("Method Not Allowed", { status: 405 });
    }

    // sitemap.xml: explizit mit korrektem Content-Type ausliefern (Google erwartet application/xml).
    if (url.pathname === "/sitemap.xml") {
      const asset = await env.ASSETS.fetch(request);
      const headers = new Headers(asset.headers);
      headers.set("Content-Type", "application/xml; charset=utf-8");
      return new Response(asset.body, { status: asset.status, headers });
    }

    // Alles andere: statische Datei aus public-build/ via ASSETS-Binding ausliefern.
    return env.ASSETS.fetch(request);
  },
};
