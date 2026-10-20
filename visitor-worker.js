/*
 * Visitor globe + analytics backend — Cloudflare Worker (D1 edition).
 *
 * Every visit is one atomic INSERT into D1 (SQLite), so concurrent visits
 * never clobber each other the way the old KV read-modify-write did — far
 * fewer dropped records, especially when several people open the link at
 * once (e.g. shared in a group chat). Location/referrer/browser come from
 * Cloudflare's edge (request.cf); the browser sends no personal data. For
 * mainland-China visitors the city comes from data/cnip.bin on the site
 * (ip2region-based, see tools/build_cnip.py), which is far more accurate
 * there than Cloudflare's own geolocation. No IP address is ever stored.
 *
 * Endpoints & response shapes are unchanged from the KV version, so the
 * site's front-end needs no changes:
 *   POST /collect?ref=<referrer>   record a visit (one row)
 *   GET  /points                   [{lat,lon,city,country,count}]  (public globe)
 *   GET  /stats                    {total,countries,refs,browsers} (public)
 *   GET  /log?key=<ADMIN_KEY>      [{ts,city,region,country,ref,ua,net}] (owner only)
 *                                  net = "IPv4|IPv6 · ISP · geo source"; the column
 *                                  is added to D1 automatically on first use.
 *   POST /fix  {id,t,v4}           refine a just-recorded mainland IPv6 visit with
 *                                  the visitor's IPv4 address (see below).
 *
 * Why /fix: mainland carriers do not register IPv6 by province, so every IP
 * database (ip2region, Cloudflare, ip-api…) puts China Unicom/Telecom IPv6 in
 * Beijing and China Mobile IPv6 in Guangdong. Their IPv4 addresses, however,
 * resolve to the right city. When /collect sees a CN IPv6 visitor it returns
 * {fix: "<id>.<token>"}; the page then asks an IPv4-only echo service for the
 * visitor's IPv4 and posts it here, and the row's location is corrected. The
 * token is an HMAC of the row id (keyed by ADMIN_KEY), so only the visitor who
 * created a row can refine it, and only within 10 minutes. The IPv4 address
 * is used in memory for the lookup and never stored.
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

// ── Mainland China IP -> city ────────────────────────────────────────────
// Cloudflare's own geolocation pins many Chinese visitors to Beijing or
// Shanghai. For CN visitors we instead look the IP up in data/cnip.bin, a
// table built from ip2region (tools/build_cnip.py) and hosted on the site.
// The IP is used only in memory for this lookup and is never stored.
const CNIP_URL = "https://jiajindou.com/data/cnip.bin";
const CNIP_GAP = 0xffff;
let cnip = null, cnipLoadedAt = 0;

async function loadCnip() {
  if (cnip && Date.now() - cnipLoadedAt < 12 * 3600 * 1000) return cnip;
  const r = await fetch(CNIP_URL, { cf: { cacheTtl: 86400, cacheEverything: true } });
  if (!r.ok) throw new Error("cnip HTTP " + r.status);
  const buf = await r.arrayBuffer();
  const h = new DataView(buf);
  if (h.getUint32(0, true) !== 0x50494e43) throw new Error("cnip bad magic");   // "CNIP"
  const n4 = h.getUint32(8, true), n6 = h.getUint32(12, true);
  const cityOff = h.getUint32(16, true), cityLen = h.getUint32(20, true);
  let o = 24;
  const v4 = new Uint32Array(buf, o, n4); o += 4 * n4;
  const k4 = new Uint16Array(buf, o, n4); o += 2 * n4; o += (4 - (o % 4)) % 4;
  const v6hi = new Uint32Array(buf, o, n6); o += 4 * n6;
  const v6lo = new Uint32Array(buf, o, n6); o += 4 * n6;
  const k6 = new Uint16Array(buf, o, n6);
  const cities = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, cityOff, cityLen)));
  cnip = { v4, k4, v6hi, v6lo, k6, cities };
  cnipLoadedAt = Date.now();
  return cnip;
}

function ipv4ToInt(s) {
  const p = s.split(".");
  if (p.length !== 4) return -1;
  let n = 0;
  for (const x of p) {
    const v = Number(x);
    if (!(Number.isInteger(v) && v >= 0 && v <= 255)) return -1;
    n = n * 256 + v;
  }
  return n;
}

// First 64 bits of an IPv6 address as [bits 0-31, bits 32-63], or null.
function ipv6Top64(s) {
  const parts = s.split("::");
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":") : [];
  const tail = parts.length === 2 ? (parts[1] ? parts[1].split(":") : []) : null;
  const groups = tail === null ? head : head.concat(new Array(8 - head.length - tail.length).fill("0"), tail);
  if (groups.length !== 8) return null;
  const g = groups.map((x) => parseInt(x || "0", 16));
  if (g.some((x) => !(x >= 0 && x <= 0xffff))) return null;
  return [((g[0] << 16) | g[1]) >>> 0, ((g[2] << 16) | g[3]) >>> 0];
}

function lookupCn(db, ip) {
  if (!ip) return null;
  let key = CNIP_GAP, coarse = false;
  if (ip.includes(":") && !ip.includes(".")) {
    const t = ipv6Top64(ip);
    if (!t) return null;
    let lo = 0, hi = db.v6hi.length - 1, ans = -1;     // last segment starting <= ip
    while (lo <= hi) {
      const m = (lo + hi) >> 1, a = db.v6hi[m], b = db.v6lo[m];
      if (a < t[0] || (a === t[0] && b <= t[1])) { ans = m; lo = m + 1; } else hi = m - 1;
    }
    if (ans >= 0) {
      key = db.k6[ans];
      // Real city ranges are small (~/40-/48); a segment of /36 or more is
      // most likely a carrier-wide registration (China Unicom -> Beijing…).
      const span = ans + 1 >= db.v6hi.length ? Infinity
        : (db.v6hi[ans + 1] - db.v6hi[ans]) * 4294967296 + (db.v6lo[ans + 1] - db.v6lo[ans]);
      coarse = span >= 268435456;   // 2^28 /64s = a /36
    }
  } else {
    const n = ipv4ToInt(ip.slice(ip.lastIndexOf(":") + 1));  // also handles ::ffff:a.b.c.d
    if (n < 0) return null;
    let lo = 0, hi = db.v4.length - 1, ans = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (db.v4[m] <= n) { ans = m; lo = m + 1; } else hi = m - 1;
    }
    if (ans >= 0) key = db.k4[ans];
  }
  if (key === CNIP_GAP) return null;
  const c = db.cities[key];
  return c ? { city: c[0], region: c[1], lat: c[2], lon: c[3], precise: !!c[4], coarse } : null;
}

// HMAC token tying a /fix request to the /collect that created the row.
let fixKey = null;
async function fixToken(env, id) {
  if (!fixKey) {
    fixKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.ADMIN_KEY),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  }
  const sig = await crypto.subtle.sign("HMAC", fixKey, new TextEncoder().encode("fix:" + id));
  return [...new Uint8Array(sig).slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Adds the owner-log "net" column (IP version · ISP · geo source) on first use.
let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  try { await env.DB.prepare("ALTER TABLE visits ADD COLUMN net TEXT DEFAULT ''").run(); }
  catch (e) { /* column already exists */ }
  schemaReady = true;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { searchParams } = url;
    // Accept both the dedicated subdomain (stats.jiajindou.com/collect) and a
    // same-origin route on the main site (jiajindou.com/mv/collect). The
    // same-origin route reuses the page's own connection, so a visitor who
    // can load the site — notably in mainland China — can always reach the
    // collector without opening a second connection that might fail.
    const pathname = url.pathname.replace(/^\/mv(?=\/|$)/, "") || "/";

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    // ── Record a visit — one atomic INSERT, no lost writes ────────────
    if (pathname === "/collect") {
      const cf = request.cf || {};
      const ip = request.headers.get("CF-Connecting-IP") || "";
      const latN = parseFloat(cf.latitude);
      const lonN = parseFloat(cf.longitude);
      let lat = Number.isFinite(latN) ? +latN.toFixed(1) : null;
      let lon = Number.isFinite(lonN) ? +lonN.toFixed(1) : null;
      let city = cf.city || "", region = cf.region || "", geo = "cf";
      if (cf.country === "CN") {
        try {
          const hit = lookupCn(await loadCnip(), ip);
          // A province-only hit that agrees with Cloudflare's province keeps
          // Cloudflare's (possibly finer) city; otherwise the table wins.
          const sameProvince = hit && !hit.precise &&
            region.toLowerCase().includes(hit.region.toLowerCase());
          if (hit && !sameProvince) {
            city = hit.city; region = hit.region; lat = hit.lat; lon = hit.lon;
            geo = hit.coarse ? "ip2region (IPv6, coarse)"
              : hit.precise ? "ip2region" : "ip2region (province)";
          }
        } catch (e) {
          geo = "cf (table unavailable)";
        }
      }
      const isV6 = ip.includes(":");
      const net = [isV6 ? "IPv6" : "IPv4", cf.asOrganization || "", geo]
        .filter(Boolean).join(" · ").slice(0, 200);
      const ref = searchParams.get("ref") || "";
      const ua = request.headers.get("User-Agent") || "";

      await ensureSchema(env);
      const ins = await env.DB.prepare(
        "INSERT INTO visits (ts, lat, lon, city, region, country, ref, browser, ua, net, n) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)"
      ).bind(
        new Date().toISOString(),
        lat, lon,
        city,
        region,
        cf.country || "",
        refHostOf(ref),
        browserFromUA(ua),
        ua.slice(0, 300),
        net
      ).run();

      // Mainland IPv6: invite the page to send its IPv4 for a better location.
      const id = ins && ins.meta && ins.meta.last_row_id;
      if (cf.country === "CN" && isV6 && id && env.ADMIN_KEY) {
        return json({ ok: 1, fix: id + "." + (await fixToken(env, id)) });
      }
      return new Response("ok", { headers: CORS });
    }

    // ── Refine a mainland IPv6 visit with the visitor's IPv4 ──────────
    if (pathname === "/fix" && request.method === "POST") {
      let body = {};
      try { body = JSON.parse(await request.text()); } catch (e) {}
      const id = parseInt(body.id, 10);
      if (!(id > 0) || !env.ADMIN_KEY || body.t !== (await fixToken(env, id))) {
        return json({ error: "bad token" }, 403);
      }
      const v4 = String(body.v4 || "").trim();
      if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) return json({ error: "bad address" }, 400);
      const row = await env.DB.prepare("SELECT ts, country, net FROM visits WHERE id = ?").bind(id).first();
      if (!row || row.country !== "CN" || !String(row.net || "").startsWith("IPv6") ||
          String(row.net).includes("via IPv4") || Date.now() - Date.parse(row.ts) > 10 * 60 * 1000) {
        return json({ error: "not refinable" }, 409);
      }
      let hit = null;
      try { hit = lookupCn(await loadCnip(), v4); } catch (e) {}
      if (!hit) return json({ ok: 0, reason: "IPv4 not in mainland table" });
      const parts = String(row.net).split(" · ");          // [IPv6, ISP, old geo]
      const net = [parts[0], parts[1] && !parts[1].startsWith("ip2region") && !parts[1].startsWith("cf") ? parts[1] : "",
        hit.precise ? "ip2region via IPv4" : "ip2region via IPv4 (province)"].filter(Boolean).join(" · ");
      await env.DB.prepare("UPDATE visits SET lat = ?, lon = ?, city = ?, region = ?, net = ? WHERE id = ?")
        .bind(hit.lat, hit.lon, hit.city, hit.region, net, id).run();
      return json({ ok: 1, city: hit.city, region: hit.region });
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
      await ensureSchema(env);
      const q = await env.DB.prepare(
        "SELECT ts, city, region, country, ref, ua, net FROM visits " +
        "WHERE n = 1 ORDER BY id DESC LIMIT " + LOG_MAX
      ).all();
      return json(q.results || []);
    }

    return new Response("not found", { status: 404, headers: CORS });
  },
};
