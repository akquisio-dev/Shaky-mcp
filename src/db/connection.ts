import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrate } from './migrate.js';
import { installJournal, pruneJournal } from './journal.js';

export type Db = Database.Database;

/** Opens (and migrates) a database file. Use ':memory:' for tests. */
export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  if (file !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  // Several processes share the file (Claude Desktop's stdio server + the web UI).
  db.pragma('busy_timeout = 5000');
  migrate(db);
  installJournal(db);
  pruneJournal(db);
  return db;
}
