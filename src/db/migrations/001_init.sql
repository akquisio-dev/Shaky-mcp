-- Shaky schema v1. Never edit an applied migration: add a new file instead.

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Storage places. They double as scene zones for the mixing game (stage 2).
CREATE TABLE locations (
  key        TEXT PRIMARY KEY,
  label_en   TEXT NOT NULL,
  label_de   TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'storage',
  game_zone  TEXT,
  sort       INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Editable defaults per ingredient category. shelf_life_days NULL = keeps indefinitely.
CREATE TABLE category_defaults (
  category         TEXT PRIMARY KEY,
  shelf_life_days  INTEGER,
  default_location TEXT NOT NULL DEFAULT 'shelf',
  bottle_size_ml   REAL,
  color            TEXT NOT NULL DEFAULT '#c9a66b'
);

CREATE TABLE ingredients (
  id                 INTEGER PRIMARY KEY,
  name               TEXT NOT NULL,
  brand              TEXT,
  category           TEXT NOT NULL,
  subcategory        TEXT,
  tags               TEXT NOT NULL DEFAULT '[]',
  abv                REAL,
  color              TEXT,
  flavor_notes       TEXT,
  location           TEXT NOT NULL DEFAULT 'shelf',
  fill_level         TEXT NOT NULL DEFAULT 'full'
                     CHECK (fill_level IN ('full','three_quarters','half','quarter','almost_empty','empty')),
  amount_ml          REAL,
  amount_is_estimate INTEGER NOT NULL DEFAULT 0,
  bottle_size_ml     REAL,
  yield_ml           REAL,
  opened_at          TEXT,
  shelf_life_days    INTEGER,
  expires_at         TEXT,
  quantity           REAL NOT NULL DEFAULT 1,
  notes              TEXT,
  archived           INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX ingredients_category ON ingredients (category);
CREATE INDEX ingredients_location ON ingredients (location);

CREATE TABLE equipment (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL,
  available       INTEGER NOT NULL DEFAULT 1,
  substitutes_for TEXT NOT NULL DEFAULT '[]',
  notes           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE glassware (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL,
  count      INTEGER NOT NULL DEFAULT 1,
  notes      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE recipes (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL COLLATE NOCASE UNIQUE,
  description TEXT,
  tags        TEXT NOT NULL DEFAULT '[]',
  glass       TEXT,
  method      TEXT,
  source      TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','ai')),
  favorite    INTEGER NOT NULL DEFAULT 0,
  rating      INTEGER,
  notes       TEXT,
  color       TEXT,
  ingredients TEXT NOT NULL DEFAULT '[]',
  steps       TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE mix_log (
  id        INTEGER PRIMARY KEY,
  recipe_id INTEGER REFERENCES recipes (id) ON DELETE SET NULL,
  name      TEXT NOT NULL,
  made_at   TEXT NOT NULL,
  servings  REAL NOT NULL DEFAULT 1,
  rating    INTEGER,
  notes     TEXT,
  deducted  TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE shopping_list (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  ingredient_id INTEGER REFERENCES ingredients (id) ON DELETE SET NULL,
  quantity      TEXT,
  reason        TEXT,
  priority      TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  done          INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- Every change from any source. Also the live channel: the web server tails
-- this table, which is how it notices writes from other processes (stdio MCP).
CREATE TABLE activity (
  id        INTEGER PRIMARY KEY,
  at        TEXT NOT NULL,
  source    TEXT NOT NULL CHECK (source IN ('web','mcp','cli','system')),
  entity    TEXT NOT NULL,
  entity_id INTEGER,
  action    TEXT NOT NULL,
  summary   TEXT NOT NULL,
  data      TEXT NOT NULL DEFAULT '{}'
);

INSERT INTO locations (key, label_en, label_de, kind, game_zone, sort) VALUES
  ('shelf',   'Shelf',   'Regal',      'storage', 'shelf',   10),
  ('fridge',  'Fridge',  'Kühlschrank', 'storage', 'fridge',  20),
  ('freezer', 'Freezer', 'Gefrierfach', 'storage', 'freezer', 30),
  ('pantry',  'Pantry',  'Vorrat',     'storage', 'pantry',  40);

INSERT INTO category_defaults (category, shelf_life_days, default_location, bottle_size_ml, color) VALUES
  ('spirit',        NULL, 'shelf',  700,  '#d9a441'),
  ('liqueur',       365,  'shelf',  700,  '#e0703a'),
  ('wine_aperitif', 35,   'fridge', 750,  '#f2d16b'),
  ('syrup',         60,   'fridge', 700,  '#c2416b'),
  ('juice',         5,    'fridge', 1000, '#f5a623'),
  ('mixer',         3,    'fridge', 1000, '#bfe3e0'),
  ('fruit',         7,    'fridge', NULL, '#8cc152'),
  ('garnish',       7,    'fridge', NULL, '#5fa35a'),
  ('dairy_cream',   4,    'fridge', 500,  '#f3ead8'),
  ('bitters',       NULL, 'shelf',  200,  '#8a2b1f'),
  ('other',         NULL, 'pantry', NULL, '#b0a28f');

INSERT INTO settings (key, value) VALUES
  ('language', '"auto"'),
  ('units', '"cl"'),
  ('web_autostart', 'true'),
  ('expiry_warning_days', '7');
