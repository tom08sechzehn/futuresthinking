/**
 * functions/api/oracle-log.js — Admin-Übersicht + Freigabe für den Blog.
 *
 * Route: GET /api/oracle-log
 *
 * Zeigt alle gespeicherten Orakel-Fragen als HTML-Seite (neueste zuerst).
 * Geschützt durch URL-Parameter ?token=<ORACLE_LOG_SECRET>.
 *
 * Aktionen:
 *   ?token=SECRET                           → HTML-Übersicht aller Fragen
 *   ?token=SECRET&action=publish&key=KEY    → Frage freigeben (Blog)
 *   ?token=SECRET&action=unpublish&key=KEY  → Freigabe zurückziehen
 *
 * LinkedIn-Halbautomatik:
 *   Jeder veröffentlichte Eintrag bekommt einen „↗ auf LinkedIn teilen"-Link,
 *   der den LinkedIn-Composer mit vorbefülltem Text öffnet (Prefill via
 *   /feed/?shareActive=true&text=… — undokumentiert, aber etabliert; Versand
 *   bleibt manuell). Der publish-Redirect hängt &pkey=KEY an, damit die
 *   Erfolgsleiste den Share-Link für genau diesen Eintrag direkt anbietet.
 *
 * BENOETIGTE BINDINGS / ENV (alle degrade-graceful):
 *   ORACLE_LOG_SECRET — Geheimes Token (als Cloudflare Secret hinterlegen)
 *   ORACLE_LOG        — KV-Namespace (wrangler.toml: binding = "ORACLE_LOG")
 *   ORACLE_BLOG       — KV-Namespace (wrangler.toml: binding = "ORACLE_BLOG")
 */

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Kürzt einen Text an einer Wortgrenze auf max. `max` Zeichen und hängt „…" an. */
function truncateAtWord(str, max) {
  const s = String(str ?? "").trim();
  if (s.length <= max) return s;
  let cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > max * 0.5) cut = cut.slice(0, lastSpace);
  return cut.replace(/[\s,;:.\-–—]+$/, "") + " …";
}

/**
 * Baut die LinkedIn-Composer-URL mit vorbefülltem Text für einen Eintrag.
 * Halbautomatik: Tom prüft/editiert den Text im Composer und sendet manuell ab.
 * Budget: Frage ≤180 + Teaser ≤~280 + Rahmentext ≈200 → Gesamttext < ~700 Zeichen
 * (URL-Längen-Sicherheit). Der Rückgabewert ist eine rohe URL — im HTML-Attribut
 * muss sie durch esc() laufen.
 */
function buildLinkedInShareUrl(item) {
  const frage = truncateAtWord(item.frage || "", 180);
  const teaser = item.synthese ? truncateAtWord(item.synthese, 280) : "";
  const text =
    "Das Orakel wurde gefragt:\n" +
    "»" + frage + "«\n\n" +
    (teaser ? teaser + "\n\n" : "") +
    "Sechs Schulen der Zukunftsforschung, eine integrale Synthese — die ganze Antwort:\n" +
    "https://futuresthinking.eu/zukuenftinnen#blog\n\n" +
    "#FuturesThinking #Zukunftsforschung";
  return "https://www.linkedin.com/feed/?shareActive=true&text=" + encodeURIComponent(text);
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";

  if (!env.ORACLE_LOG_SECRET || token !== env.ORACLE_LOG_SECRET) {
    return new Response("401 Unauthorized", {
      status: 401,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const action = url.searchParams.get("action");
  const key = url.searchParams.get("key");
  const baseUrl = url.origin + "/api/oracle-log?token=" + encodeURIComponent(token);

  // --- Veröffentlichen ---
  if (action === "publish" && key) {
    if (!env.ORACLE_LOG || !env.ORACLE_BLOG) {
      return new Response("KV-Namespaces nicht gebunden (ORACLE_LOG / ORACLE_BLOG).", {
        status: 503, headers: { "content-type": "text/plain" },
      });
    }
    const raw = await env.ORACLE_LOG.get(key);
    if (!raw) return new Response("key not found", { status: 404 });
    let item;
    try { item = JSON.parse(raw); } catch { return new Response("parse error", { status: 500 }); }
    item.published = true;

    let posts = [];
    const existing = await env.ORACLE_BLOG.get("posts");
    if (existing) { try { posts = JSON.parse(existing); } catch {} }
    if (!posts.some(p => p.key === key)) {
      posts.unshift({ key, ...item });
      await env.ORACLE_BLOG.put("posts", JSON.stringify(posts));
    }
    await env.ORACLE_LOG.put(key, JSON.stringify(item), { expirationTtl: 30 * 24 * 3600 });
    return Response.redirect(baseUrl + "&msg=published&pkey=" + encodeURIComponent(key), 303);
  }

  // --- Zurückziehen ---
  if (action === "unpublish" && key) {
    if (env.ORACLE_BLOG) {
      const existing = await env.ORACLE_BLOG.get("posts");
      if (existing) {
        let posts;
        try { posts = JSON.parse(existing); } catch { posts = []; }
        await env.ORACLE_BLOG.put("posts", JSON.stringify(posts.filter(p => p.key !== key)));
      }
    }
    if (env.ORACLE_LOG) {
      const raw = await env.ORACLE_LOG.get(key);
      if (raw) {
        let item;
        try { item = JSON.parse(raw); } catch { item = {}; }
        item.published = false;
        await env.ORACLE_LOG.put(key, JSON.stringify(item), { expirationTtl: 30 * 24 * 3600 });
      }
    }
    return Response.redirect(baseUrl + "&msg=unpublished", 303);
  }

  // --- Übersicht ---
  let items = [];
  let kv_error = "";
  if (!env.ORACLE_LOG) {
    kv_error = "ORACLE_LOG KV nicht gebunden — siehe wrangler.toml.";
  } else {
    const list = await env.ORACLE_LOG.list({ prefix: "q:", limit: 100 });
    const fetched = await Promise.all(
      list.keys.map(async (k) => {
        const v = await env.ORACLE_LOG.get(k.name);
        try { return { key: k.name, ...JSON.parse(v) }; } catch { return null; }
      })
    );
    items = fetched.filter(Boolean).sort((a, b) => (b.ts > a.ts ? 1 : -1));
  }

  const msg = url.searchParams.get("msg") || "";
  const pkey = url.searchParams.get("pkey") || "";
  return new Response(renderHtml(items, token, kv_error, msg, pkey), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function renderHtml(items, token, error, msg, pkey) {
  // Frisch veröffentlichter Eintrag (via &pkey=… im publish-Redirect):
  // direkt in der Erfolgsleiste den LinkedIn-Share anbieten.
  const publishedItem =
    msg === "published" && pkey ? items.find((i) => i.key === pkey) : null;
  const shareBarLink = publishedItem
    ? ` <a class="act act--ln" href="${esc(buildLinkedInShareUrl(publishedItem))}" target="_blank" rel="noopener">↗ jetzt auf LinkedIn teilen</a>`
    : "";

  const msgBar =
    msg === "published"
      ? `<p class="bar bar--ok">✓ Frage im Blog veröffentlicht.${shareBarLink}</p>`
      : msg === "unpublished"
      ? `<p class="bar bar--warn">✓ Freigabe zurückgezogen.</p>`
      : "";

  const rows = items
    .map((item) => {
      const frage = esc(item.frage || "—");
      const ts = esc((item.ts || "").slice(0, 16).replace("T", " "));
      const isPublished = !!item.published;
      const actionLink = isPublished
        ? `<a class="act act--warn" href="?token=${esc(token)}&action=unpublish&key=${esc(item.key)}">zurückziehen</a>`
        : `<a class="act act--ok" href="?token=${esc(token)}&action=publish&key=${esc(item.key)}">→ veröffentlichen</a>`;
      const shareLink = isPublished
        ? `<a class="act act--ln" href="${esc(buildLinkedInShareUrl(item))}" target="_blank" rel="noopener">↗ auf LinkedIn teilen</a>`
        : "";

      const stimmenHtml = Array.isArray(item.stimmen)
        ? item.stimmen
            .map(
              (s, i) =>
                `<details class="voice-detail">
                   <summary>${i + 1}. ${esc(s.schule)}</summary>
                   <p class="voice-kern">${esc(s.kernfrage)}</p>
                   <p class="voice-body">${esc(s.beitrag)}</p>
                 </details>`
            )
            .join("")
        : "";

      const syntheseHtml = item.synthese
        ? `<details class="voice-detail voice-detail--syn">
             <summary>Integrale Synthese</summary>
             <p class="voice-body">${esc(item.synthese)}</p>
           </details>`
        : "";

      return `<article class="entry${isPublished ? " entry--published" : ""}">
        <div class="entry__head">
          <strong class="entry__frage">${frage}</strong>
          <div class="entry__meta">
            <span class="ts">${ts}</span>
            ${isPublished ? `<span class="badge badge--ok">im Blog</span>` : ""}
            ${shareLink}
            ${actionLink}
          </div>
        </div>
        ${stimmenHtml}
        ${syntheseHtml}
      </article>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Orakel-Eingang · futuresthinking</title>
<style>
:root{--bg:#0B0E1A;--surf:#141A2E;--surf2:#1E2742;--line:#2C3658;
  --ink:#F2F0FF;--body:#C3C7DB;--muted:#7A82A6;
  --signal:#3DF2C4;--flare:#FF6B4A;--ultra:#B57BFF;}
*{box-sizing:border-box;margin:0;padding:0;}
body{background:var(--bg);color:var(--body);font-family:system-ui,'Inter',sans-serif;
  font-size:1rem;line-height:1.6;padding:32px 20px;max-width:900px;margin:0 auto;}
h1{font-size:1.4rem;color:var(--ink);margin-bottom:4px;}
.sub{font-family:monospace;font-size:0.8rem;color:var(--muted);display:block;margin-bottom:28px;}
.bar{padding:10px 16px;border-radius:6px;font-family:monospace;font-size:0.85rem;margin-bottom:20px;}
.bar--ok{background:rgba(61,242,196,.1);border-left:3px solid var(--signal);color:var(--signal);}
.bar--warn{background:rgba(255,107,74,.1);border-left:3px solid var(--flare);color:var(--flare);}
.err{padding:10px 16px;border-radius:6px;font-family:monospace;font-size:0.85rem;
  background:rgba(242,85,90,.08);border-left:3px solid #F2555A;color:#F2555A;margin-bottom:24px;}
.entry{padding:16px 20px;border:1px solid var(--line);border-radius:10px;
  background:var(--surf);margin-bottom:12px;}
.entry--published{border-color:rgba(61,242,196,.35);}
.entry__head{display:flex;justify-content:space-between;align-items:baseline;
  gap:12px;flex-wrap:wrap;margin-bottom:8px;}
.entry__frage{color:var(--ink);font-size:1rem;}
.entry__meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex:none;}
.ts{font-family:monospace;font-size:0.75rem;color:var(--muted);white-space:nowrap;}
.badge{font-family:monospace;font-size:0.72rem;padding:2px 8px;border-radius:999px;
  border:1px solid;white-space:nowrap;}
.badge--ok{color:var(--signal);border-color:rgba(61,242,196,.5);}
.act{font-family:monospace;font-size:0.78rem;text-decoration:none;white-space:nowrap;
  padding:3px 10px;border-radius:6px;border:1px solid;}
.act--ok{color:var(--signal);border-color:rgba(61,242,196,.45);}
.act--warn{color:var(--flare);border-color:rgba(255,107,74,.4);}
.act--ln{color:var(--ultra);border-color:rgba(181,123,255,.45);}
.act:hover{opacity:.75;}
.voice-detail{margin-top:5px;border-left:2px solid var(--line);padding-left:10px;}
.voice-detail--syn{border-left-color:var(--ultra);}
.voice-detail summary{cursor:pointer;font-family:monospace;font-size:0.8rem;color:var(--muted);list-style:none;}
.voice-detail summary::-webkit-details-marker{display:none;}
.voice-detail[open] summary{color:var(--ink);}
.voice-kern{font-family:monospace;font-size:0.78rem;color:var(--muted);margin-top:4px;}
.voice-body{font-size:0.88rem;color:var(--body);margin-top:4px;}
.empty{color:var(--muted);font-family:monospace;}
</style>
</head>
<body>
<h1>Orakel-Eingang</h1>
<span class="sub">futuresthinking.eu · ${items.length} Einträge · geschützt · max. 30 Tage</span>
${error ? `<p class="err">${esc(error)}</p>` : ""}
${msgBar}
${items.length === 0 && !error ? `<p class="empty">Noch keine Fragen gespeichert.</p>` : rows}
</body>
</html>`;
}
