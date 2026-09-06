/*
 * Visitor globe backend — Cloudflare Worker.
 *
 * Records each visit's approximate location (read for free from Cloudflare's
 * edge via request.cf — the browser sends nothing) into a KV namespace, and
 * serves the aggregated points to the visitor globe on the homepage.
 *
 * ── Deploy (dashboard, ~10 min, no CLI needed) ────────────────────────────
 * 1. Cloudflare dashboard → Workers & Pages → Create → Create Worker.
 *    Name it e.g. "visitor-globe". Deploy the default, then "Edit code".
 * 2. Paste this whole file over the default code and Deploy.
 * 3. Storage: Workers & Pages → KV → Create namespace, name it "VISITORS".
 * 4. Back in the Worker → Settings → Bindings → Add → KV namespace:
 *       Variable name: VISITORS   →   select the "VISITORS" namespace. Save.
 * 5. Copy the Worker URL (https://visitor-globe.<sub>.workers.dev) and put it
 *    in _config.yml as `visitor_worker_url:`.
 *
 * Endpoints:  POST /collect  (record a visit)   ·   GET /points  (aggregated JSON)
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    // ── Record a visit ────────────────────────────────────────────────
    if (pathname === "/collect") {
      const cf = request.cf || {};
      const lat = parseFloat(cf.latitude);
      const lon = parseFloat(cf.longitude);

      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        // Bucket to ~0.1° (roughly city level) to keep the point set small.
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
      return new Response("ok", { headers: CORS });
    }

    // ── Serve aggregated points ───────────────────────────────────────
    if (pathname === "/points") {
      const data = (await env.VISITORS.get("points", "json")) || {};
      return new Response(JSON.stringify(Object.values(data)), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    return new Response("not found", { status: 404, headers: CORS });
  },
};
