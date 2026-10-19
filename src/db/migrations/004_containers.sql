-- How an item is drawn, separate from the liquid color: can, tetra pak,
-- dropper bottle ... label_color paints the label or the can itself.
ALTER TABLE ingredients ADD COLUMN container TEXT;
ALTER TABLE ingredients ADD COLUMN label_color TEXT;
ALTER TABLE category_defaults ADD COLUMN container TEXT;

UPDATE category_defaults SET container = CASE category
  WHEN 'spirit' THEN 'bottle'
  WHEN 'liqueur' THEN 'bottle_round'
  WHEN 'wine_aperitif' THEN 'wine_bottle'
  WHEN 'syrup' THEN 'syrup_bottle'
  WHEN 'juice' THEN 'tetra_pak'
  WHEN 'mixer' THEN 'small_bottle'
  WHEN 'fruit' THEN 'fruit'
  WHEN 'garnish' THEN 'herb'
  WHEN 'dairy_cream' THEN 'carton'
  WHEN 'bitters' THEN 'dropper'
  ELSE 'jar'
END;
