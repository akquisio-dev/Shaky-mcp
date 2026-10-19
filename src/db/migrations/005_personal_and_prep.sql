-- Variants of one product under one entry (Red Bull: Original, Sugarfree ...),
-- each with its own count. The entry's quantity is their sum.
ALTER TABLE ingredients ADD COLUMN variants TEXT NOT NULL DEFAULT '[]';
-- Best before date while still unopened (juice, soda).
ALTER TABLE ingredients ADD COLUMN best_before TEXT;
-- Typical strength per category, for drinks whose bottle has no ABV.
ALTER TABLE category_defaults ADD COLUMN abv REAL;
UPDATE category_defaults SET abv = CASE category
  WHEN 'spirit' THEN 40 WHEN 'liqueur' THEN 25 WHEN 'wine_aperitif' THEN 16 WHEN 'bitters' THEN 44
  ELSE 0 END;
-- Extra numbers for equipment, e.g. a slush machine's minimum and maximum fill.
ALTER TABLE equipment ADD COLUMN specs TEXT NOT NULL DEFAULT '{}';

-- Personal taste: adjust amounts ("0.5 cl less lemon in sours") or avoid
-- ingredients ("no tequila"). Applied when recipes are shown, mixed and trained.
CREATE TABLE preferences (
  id         INTEGER PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('adjust', 'avoid')),
  ingredient TEXT NOT NULL,
  recipe_tag TEXT,
  recipe     TEXT,
  delta      REAL,
  unit       TEXT,
  factor     REAL,
  note       TEXT,
  created_at TEXT NOT NULL
);

-- Homemade ingredients: inputs from stock turn into a new bottle with its own shelf life.
CREATE TABLE prep_templates (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL COLLATE NOCASE UNIQUE,
  inputs     TEXT NOT NULL,
  output     TEXT NOT NULL,
  notes      TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO prep_templates (name, inputs, output, notes, created_at) VALUES
  ('Simple syrup 1:1',
   '[{"name":"Sugar","match":"sugar","amount":500,"unit":"g"},{"name":"Water","amount":500,"unit":"ml","from_stock":false}]',
   '{"name":"Simple syrup","category":"syrup","subcategory":"simple syrup","tags":["sugar syrup","sugar"],"ml":800,"shelf_life_days":30,"location":"fridge","container":"syrup_bottle","color":"#f4ecd2"}',
   'Stir sugar into hot water until clear, let cool, bottle. Keeps about a month in the fridge.',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('Rich syrup 2:1',
   '[{"name":"Sugar","match":"sugar","amount":1000,"unit":"g"},{"name":"Water","amount":500,"unit":"ml","from_stock":false}]',
   '{"name":"Rich syrup","category":"syrup","subcategory":"rich simple syrup","tags":["sugar syrup","sugar","rich syrup"],"ml":1100,"shelf_life_days":180,"location":"fridge","container":"syrup_bottle","color":"#eadcae"}',
   'Twice the sugar keeps much longer: about six months in the fridge.',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('Honey syrup',
   '[{"name":"Honey","match":"honey","amount":300,"unit":"ml"},{"name":"Water","amount":150,"unit":"ml","from_stock":false}]',
   '{"name":"Honey syrup","category":"syrup","subcategory":"honey syrup","tags":["honey"],"ml":450,"shelf_life_days":30,"location":"fridge","container":"syrup_bottle","color":"#e3a21a"}',
   'Warm water, stir in honey, cool.',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT INTO settings (key, value) VALUES ('slush_max_abv', '8') ON CONFLICT (key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('standard_drink_g', '10') ON CONFLICT (key) DO NOTHING;
