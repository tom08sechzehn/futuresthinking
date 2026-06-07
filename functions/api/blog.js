/**
 * functions/api/blog.js — Öffentlicher Endpunkt für veröffentlichte Blog-Posts.
 *
 * Route: GET /api/blog
 *
 * Gibt alle in ORACLE_BLOG gespeicherten, freigegebenen Orakel-Q&As zurück.
 * Degrade-graceful: ohne KV → leere Liste [].
 * Cache: 60 Sekunden (CDN-Edge).
 */

export async function onRequestGet({ env }) {
  if (!env.ORACLE_BLOG) {
    return new Response("[]", {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  const raw = (await env.ORACLE_BLOG.get("posts")) || "[]";
  return new Response(raw, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60",
    },
  });
}
