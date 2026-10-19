import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Db } from './connection.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

export interface Migration {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

export function loadMigrations(dir = MIGRATIONS_DIR): Migration[] {
  return readdirSync(dir)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort()
    .map((name) => {
      const sql = readFileSync(`${dir}/${name}`, 'utf8').replace(/\r\n/g, '\n');
      return {
        version: Number(name.slice(0, 3)),
        name,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
      };
    });
}

/**
 * Applies pending migrations inside one IMMEDIATE transaction, so two
 * processes starting at the same time (stdio MCP + web) cannot race.
 * An applied migration whose file changed afterwards is a hard error.
 */
export function migrate(db: Db, migrations = loadMigrations()): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    checksum   TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const run = db.transaction(() => {
    const applied = new Map(
      (
        db.prepare('SELECT version, name, checksum FROM schema_migrations').all() as {
          version: number;
          name: string;
          checksum: string;
        }[]
      ).map((r) => [r.version, r]),
    );
    const done: number[] = [];
    for (const m of migrations) {
      const prev = applied.get(m.version);
      if (prev) {
        if (prev.checksum !== m.checksum) {
          throw new Error(
            `Migration ${m.name} was changed after it was applied. Add a new migration instead.`,
          );
        }
        continue;
      }
      db.exec(m.sql);
      db.prepare(
        'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
      ).run(m.version, m.name, m.checksum, new Date().toISOString());
      done.push(m.version);
    }
    return done;
  });
  return run.immediate();
}
