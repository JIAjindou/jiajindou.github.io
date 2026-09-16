/*
 * Visitor globe backend — Cloudflare Worker.
 *
 * Records each visit's approximate location (read for free from Cloudflare's
 * edge via request.cf — the browser sends nothing) into a KV namespace, and
 * serves aggregated points to the public globe. It also keeps a private,
 * password-protected detail log (city / region / country / time / referrer /
 * browser — NO IP) that only the owner can read.
 *
 * ── Deploy / update (dashboard) ───────────────────────────────────────────
 * 1. Workers & Pages → your Worker → Edit code → paste this whole file → Deploy.
 * 2. KV binding (if not done already): Settings → Bindings → add KV namespace,
 *    variable name VISITORS → your "VISITORS" namespace.
 * 3. Owner password: Settings → Variables and Secrets → Add → type "Secret",
 *    name ADMIN_KEY, value = a password you choose. Save/Deploy.
 *
 * Endpoints:
 *   POST /collect?ref=<referrer>   record a visit
 *   GET  /points                   aggregated points (public, for the globe)
 *   GET  /log?key=<ADMIN_KEY>      detail log (owner only; 401 without key)
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const LOG_MAX = 500; // keep the most recent N visits in the detail log

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname, searchParams } = url;

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    // ── Record a visit ────────────────────────────────────────────────
    if (pathname === "/collect") {
      const cf = request.cf || {};
      const lat = parseFloat(cf.latitude);
      const lon = parseFloat(cf.longitude);

      // Aggregated map points (public).
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        const key = lat.toFixed(1) + "," + lon.toFixed(1);
        const data = (await env.VISITORS.get("points", "json")) || {};
        if (!data[key]) {
          data[key] = {
            lat: +lat.toFixed(1),
            lon: +lon.toFixed(1),
            city: cf.city || "",
            country: cf.country || "",
            count: 0,
          };
        }
        data[key].count++;
        await env.VISITORS.put("points", JSON.stringify(data));
      }

      // Private detail log (owner only). No IP is stored.
      const entry = {
        ts: new Date().toISOString(),
        city: cf.city || "",
        region: cf.region || "",
        country: cf.country || "",
        ref: (searchParams.get("ref") || "").slice(0, 300),
        ua: (request.headers.get("User-Agent") || "").slice(0, 300),
      };
      const log = (await env.VISITORS.get("log", "json")) || [];
      log.unshift(entry);
      if (log.length > LOG_MAX) log.length = LOG_MAX;
      await env.VISITORS.put("log", JSON.stringify(log));

      return new Response("ok", { headers: CORS });
    }

    // ── Aggregated points (public) ────────────────────────────────────
    if (pathname === "/points") {
      const data = (await env.VISITORS.get("points", "json")) || {};
      return json(Object.values(data));
    }

    // ── Detail log (owner only) ───────────────────────────────────────
    if (pathname === "/log") {
      const key = searchParams.get("key") || "";
      if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
        return json({ error: "unauthorized" }, 401);
      }
      const log = (await env.VISITORS.get("log", "json")) || [];
      return json(log);
    }

    return new Response("not found", { status: 404, headers: CORS });
  },
};
