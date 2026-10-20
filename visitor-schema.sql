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
