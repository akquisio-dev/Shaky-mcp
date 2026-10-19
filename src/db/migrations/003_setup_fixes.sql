-- Things an ingredient supplies besides itself, e.g. limes provide "lime juice"
-- and "lime zest". A provided phrase overrides the recipe line's category.
ALTER TABLE ingredients ADD COLUMN provides TEXT NOT NULL DEFAULT '[]';

-- Rows loaded from examples/seed.json, so they can be removed in one go.
ALTER TABLE ingredients ADD COLUMN origin TEXT;
ALTER TABLE equipment ADD COLUMN origin TEXT;
ALTER TABLE glassware ADD COLUMN origin TEXT;
ALTER TABLE recipes ADD COLUMN origin TEXT;
ALTER TABLE shopping_list ADD COLUMN origin TEXT;

-- Household items that stand in for bar tools when the real tool is missing.
INSERT INTO settings (key, value) VALUES ('household_substitutes', '{"bar_spoon":"spoon"}')
  ON CONFLICT (key) DO NOTHING;
