/*
 * Visitor globe + analytics backend — Cloudflare Worker.
 *
 * Reads each visit's approximate location/referrer/browser from Cloudflare's
 * edge (request.cf) — the browser sends no personal data. Stores:
 *   - points : city-level aggregated coordinates for the public globe
 *   - agg    : public aggregate stats (total, by country / referrer / browser)
 *   - log    : private recent detail log (owner only, NO IP)
 *
 * ── Deploy / update (dashboard) ───────────────────────────────────────────
 * 1. Workers & Pages → your Worker → Edit code → paste this file → Deploy.
 * 2. KV binding: Settings → Bindings → KV namespace, variable VISITORS.
 * 3. Owner password: Settings → Variables and Secrets → Add Secret,
 *    name ADMIN_KEY, value = your password. Save/Deploy.
 *
 * Endpoints:
 *   POST /collect?ref=<referrer>&path=<path>   record a visit
 *   GET  /points                               globe coordinates (public)
 *   GET  /stats                                aggregate stats (public)
 *   GET  /log?key=<ADMIN_KEY>                  detail log (owner only)
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const LOG_MAX = 500;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function browserFromUA(ua) {
  ua = ua || "";
  if (/bot|crawl|spider|slurp|bingpreview/i.test(ua)) return "Bot";
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  return "Other";
}

function refHostOf(ref) {
  if (!ref) return "direct";
  try {
    return new URL(ref).hostname.replace(/^www\./, "") || "direct";
  } catch (e) {
    return "other";
  }
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
      const ref = searchParams.get("ref") || "";
      const ua = request.headers.get("User-Agent") || "";
      const browser = browserFromUA(ua);

      // 1) Globe points (public, city-level)
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

      // 2) Public aggregates (no PII)
      const agg = (await env.VISITORS.get("agg", "json")) ||
        { total: 0, countries: {}, refs: {}, browsers: {} };
      agg.total = (agg.total || 0) + 1;
      if (cf.country) agg.countries[cf.country] = (agg.countries[cf.country] || 0) + 1;
      var rh = refHostOf(ref);
      agg.refs[rh] = (agg.refs[rh] || 0) + 1;
      agg.browsers[browser] = (agg.browsers[browser] || 0) + 1;
      await env.VISITORS.put("agg", JSON.stringify(agg));

      // 3) Private detail log (owner only). No IP.
      const entry = {
        ts: new Date().toISOString(),
        city: cf.city || "",
        region: cf.region || "",
        country: cf.country || "",
        ref: ref.slice(0, 300),
        ua: ua.slice(0, 300),
      };
      const log = (await env.VISITORS.get("log", "json")) || [];
      log.unshift(entry);
      if (log.length > LOG_MAX) log.length = LOG_MAX;
      await env.VISITORS.put("log", JSON.stringify(log));

      return new Response("ok", { headers: CORS });
    }

    // ── Globe coordinates (public) ────────────────────────────────────
    if (pathname === "/points") {
      const data = (await env.VISITORS.get("points", "json")) || {};
      return json(Object.values(data));
    }

    // ── Aggregate stats (public, no PII) ──────────────────────────────
    if (pathname === "/stats") {
      const agg = (await env.VISITORS.get("agg", "json")) ||
        { total: 0, countries: {}, refs: {}, browsers: {} };
      return json(agg);
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
