-- D1 schema for the visitor analytics backend.
-- One row per visit (n = 1); historical baseline rows carry n > 1.
-- Run this once in the D1 console before deploying the Worker.

CREATE TABLE IF NOT EXISTS visits (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       TEXT    NOT NULL,          -- ISO timestamp (UTC)
  lat      REAL,                      -- Cloudflare edge latitude  (rounded 0.1°), may be NULL
  lon      REAL,                      -- Cloudflare edge longitude (rounded 0.1°), may be NULL
  city     TEXT    DEFAULT '',
  region   TEXT    DEFAULT '',        -- province / state
  country  TEXT    DEFAULT '',        -- ISO country code
  ref      TEXT    DEFAULT '',        -- referrer host (e.g. scholar.google.com), '' = direct
  browser  TEXT    DEFAULT '',
  ua       TEXT    DEFAULT '',        -- user agent (owner log only)
  n        INTEGER NOT NULL DEFAULT 1 -- 1 for real visits; >1 for migrated baseline buckets
);

CREATE INDEX IF NOT EXISTS idx_visits_country ON visits(country);
CREATE INDEX IF NOT EXISTS idx_visits_latlon  ON visits(lat, lon);
CREATE INDEX IF NOT EXISTS idx_visits_id       ON visits(id);

-- CV / PDF downloads (one row per counted click; no IP). The Worker also
-- creates this table itself on first use, so running this is optional.
CREATE TABLE IF NOT EXISTS downloads (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       TEXT    NOT NULL,          -- ISO timestamp (UTC)
  file     TEXT    NOT NULL,          -- e.g. Jindou_Jia_CV.pdf
  page     TEXT    DEFAULT '',        -- page the link was clicked on, e.g. /cv.html
  city     TEXT    DEFAULT '',
  region   TEXT    DEFAULT '',
  country  TEXT    DEFAULT '',
  ref      TEXT    DEFAULT '',        -- referrer host of that page, 'direct' if none
  ua       TEXT    DEFAULT '',
  net      TEXT    DEFAULT ''         -- IP version · ISP · geo source
);
