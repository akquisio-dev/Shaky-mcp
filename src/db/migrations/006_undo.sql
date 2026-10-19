-- Undo journal. Every mutation is one group; triggers (created at startup from
-- the current columns, see src/db/journal.ts) log each row before and after.
CREATE TABLE undo_groups (
  id         INTEGER PRIMARY KEY,
  at         TEXT NOT NULL,
  source     TEXT NOT NULL,
  label      TEXT,
  undone_by  INTEGER,
  undoes     INTEGER
);

CREATE TABLE undo_log (
  id       INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL,
  tbl      TEXT NOT NULL,
  op       TEXT NOT NULL CHECK (op IN ('insert', 'update', 'delete')),
  row_id   INTEGER NOT NULL,
  old      TEXT,
  new      TEXT
);
CREATE INDEX undo_log_group ON undo_log (group_id);

-- The group the current transaction writes to; one row, read by the triggers.
CREATE TABLE undo_state (id INTEGER PRIMARY KEY CHECK (id = 1), group_id INTEGER);
INSERT INTO undo_state (id, group_id) VALUES (1, NULL);

ALTER TABLE activity ADD COLUMN group_id INTEGER;
