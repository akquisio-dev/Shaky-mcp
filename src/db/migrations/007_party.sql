-- What a bottle, pack or piece cost, for cost per drink and party budgets.
ALTER TABLE ingredients ADD COLUMN price REAL;
-- Ice: how long a batch takes to freeze, so a party plan knows when to start.
ALTER TABLE ingredients ADD COLUMN freeze_hours REAL;

INSERT INTO category_defaults (category, shelf_life_days, default_location, bottle_size_ml, color, container, abv)
VALUES ('ice', NULL, 'freezer', NULL, '#dff4ff', 'freezer_bag', 0)
ON CONFLICT (category) DO NOTHING;

-- "Ginger ale for ginger beer, milder": a missing line can be covered by a
-- stand-in, and the recipe counts as makeable with a substitute.
CREATE TABLE substitutions (
  id         INTEGER PRIMARY KEY,
  for_words  TEXT NOT NULL,
  use_words  TEXT NOT NULL,
  ratio      REAL NOT NULL DEFAULT 1,
  note       TEXT,
  two_way    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
INSERT INTO substitutions (for_words, use_words, ratio, note, two_way, created_at) VALUES
  ('ginger beer', 'ginger ale', 1, 'milder, less spicy', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('lime juice', 'lemon juice', 1, 'a little less tart and more lemony', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('orange liqueur', 'triple sec', 1, NULL, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('simple syrup', 'rich syrup', 0.67, 'use two thirds, it is sweeter', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('soda water', 'sparkling water', 1, NULL, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('dark rum', 'aged rum', 1, NULL, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- Guest diets: replace or leave out ingredients ("vegan: egg white -> aquafaba").
CREATE TABLE diet_rules (
  id          INTEGER PRIMARY KEY,
  diet        TEXT NOT NULL,
  match_words TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('replace', 'exclude')),
  replacement TEXT,
  ratio       REAL NOT NULL DEFAULT 1,
  note        TEXT
);
INSERT INTO diet_rules (diet, match_words, action, replacement, ratio, note) VALUES
  ('vegan', 'egg white', 'replace', 'aquafaba', 1, 'chickpea water foams like egg white'),
  ('vegan', 'honey', 'replace', 'agave syrup', 0.75, 'agave is sweeter'),
  ('vegan', 'cream', 'replace', 'coconut cream', 1, NULL),
  ('vegan', 'milk', 'replace', 'oat milk', 1, NULL),
  ('lactose free', 'cream', 'replace', 'lactose free cream', 1, NULL),
  ('lactose free', 'milk', 'replace', 'lactose free milk', 1, NULL),
  ('nut allergy', 'orgeat', 'exclude', NULL, 1, 'almond syrup'),
  ('nut allergy', 'amaretto', 'exclude', NULL, 1, 'almond liqueur'),
  ('nut allergy', 'frangelico', 'exclude', NULL, 1, 'hazelnut liqueur'),
  ('egg allergy', 'egg white', 'replace', 'aquafaba', 1, NULL),
  ('alcohol free', 'spirit', 'exclude', NULL, 1, NULL);

INSERT INTO settings (key, value) VALUES ('currency', '"EUR"') ON CONFLICT (key) DO NOTHING;
