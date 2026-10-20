/*
 * Visitor globe + analytics backend — Cloudflare Worker (D1 edition).
 *
 * Every visit is one atomic INSERT into D1 (SQLite), so concurrent visits
 * never clobber each other the way the old KV read-modify-write did — far
 * fewer dropped records, especially when several people open the link at
 * once (e.g. shared in a group chat). Location/referrer/browser still come
 * from Cloudflare's edge (request.cf); the browser sends no personal data.
 *
 * Endpoints & response shapes are unchanged from the KV version, so the
 * site's front-end needs no changes:
 *   POST /collect?ref=<referrer>   record a visit (one row)
 *   GET  /points                   [{lat,lon,city,country,count}]  (public globe)
 *   GET  /stats                    {total,countries,refs,browsers} (public)
 *   GET  /log?key=<ADMIN_KEY>      [{ts,city,region,country,ref,ua}] (owner only)
 *
 * ── Deploy / update (Cloudflare dashboard, no CLI needed) ──────────────────
 * 1. Workers & Pages → D1 → Create database (e.g. "visitors").
 * 2. Open it → Console → paste & run visitor-schema.sql, then visitor-seed.sql
 *    (the seed loads your existing ~1.4k visits as a baseline — run it once).
 * 3. Your Worker → Settings → Bindings → add D1 database binding:
 *    variable name DB, database = the one you created.
 * 4. Owner password: Settings → Variables and Secrets → Secret ADMIN_KEY.
 * 5. Edit code → paste this file → Deploy. (The old KV binding can stay or be
 *    removed; this Worker no longer uses it.)
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

    // ── Record a visit — one atomic INSERT, no lost writes ────────────
    if (pathname === "/collect") {
      const cf = request.cf || {};
      const latN = parseFloat(cf.latitude);
      const lonN = parseFloat(cf.longitude);
      const lat = Number.isFinite(latN) ? +latN.toFixed(1) : null;
      const lon = Number.isFinite(lonN) ? +lonN.toFixed(1) : null;
      const ref = searchParams.get("ref") || "";
      const ua = request.headers.get("User-Agent") || "";

      await env.DB.prepare(
        "INSERT INTO visits (ts, lat, lon, city, region, country, ref, browser, ua, n) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)"
      ).bind(
        new Date().toISOString(),
        lat, lon,
        cf.city || "",
        cf.region || "",
        cf.country || "",
        refHostOf(ref),
        browserFromUA(ua),
        ua.slice(0, 300)
      ).run();

      return new Response("ok", { headers: CORS });
    }

    // ── Globe coordinates (public) ────────────────────────────────────
    if (pathname === "/points") {
      const q = await env.DB.prepare(
        "SELECT lat, lon, MAX(city) AS city, MAX(country) AS country, SUM(n) AS count " +
        "FROM visits WHERE lat IS NOT NULL AND lon IS NOT NULL " +
        "GROUP BY lat, lon ORDER BY count DESC"
      ).all();
      const points = (q.results || []).map((r) => ({
        lat: r.lat, lon: r.lon, city: r.city || "", country: r.country || "", count: r.count,
      }));
      return json(points);
    }

    // ── Aggregate stats (public, no PII) ──────────────────────────────
    if (pathname === "/stats") {
      const totalRow = await env.DB.prepare("SELECT SUM(n) AS t FROM visits").first();
      const total = (totalRow && totalRow.t) || 0;

      const group = async (col) => {
        const q = await env.DB.prepare(
          "SELECT " + col + " AS k, SUM(n) AS c FROM visits WHERE " + col + " != '' GROUP BY " + col
        ).all();
        const out = {};
        (q.results || []).forEach((r) => { out[r.k] = r.c; });
        return out;
      };

      return json({
        total,
        countries: await group("country"),
        refs: await group("ref"),
        browsers: await group("browser"),
      });
    }

    // ── Detail log (owner only). No IP. Real visits only (n = 1) ───────
    if (pathname === "/log") {
      const key = searchParams.get("key") || "";
      if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
        return json({ error: "unauthorized" }, 401);
      }
      const q = await env.DB.prepare(
        "SELECT ts, city, region, country, ref, ua FROM visits " +
        "WHERE n = 1 ORDER BY id DESC LIMIT " + LOG_MAX
      ).all();
      return json(q.results || []);
    }

    return new Response("not found", { status: 404, headers: CORS });
  },
};
