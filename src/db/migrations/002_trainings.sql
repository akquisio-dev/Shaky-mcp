-- Trainings: the AI (or the user) loads a recipe into the mixing game; the
-- browser plays it and submits the action log; the server replays and scores it.
CREATE TABLE trainings (
  id          INTEGER PRIMARY KEY,
  recipe_id   INTEGER REFERENCES recipes (id) ON DELETE SET NULL,
  recipe_name TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'active', 'done', 'cancelled')),
  note        TEXT,
  show_steps  INTEGER NOT NULL DEFAULT 1,
  sandbox     INTEGER NOT NULL DEFAULT 0,
  source      TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  started_at  TEXT,
  finished_at TEXT,
  actions     TEXT,
  result      TEXT
);
CREATE INDEX trainings_status ON trainings (status);
