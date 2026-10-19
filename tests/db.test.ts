import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { loadMigrations, migrate } from '../src/db/migrate.js';
import { freshDb } from './helpers.js';

describe('migrations', () => {
  it('creates the schema with default locations and category defaults', () => {
    const db = freshDb();
    const locs = db.prepare('SELECT key FROM locations ORDER BY sort').all() as { key: string }[];
    expect(locs.map((l) => l.key)).toEqual(['shelf', 'fridge', 'freezer', 'pantry']);
    const cats = db.prepare('SELECT COUNT(*) AS n FROM category_defaults').get() as { n: number };
    expect(cats.n).toBe(11);
  });

  it('is idempotent', () => {
    const db = freshDb();
    expect(migrate(db)).toEqual([]);
  });

  it('refuses a migration that changed after it was applied', () => {
    const db = new Database(':memory:');
    const ms = loadMigrations();
    migrate(db, ms);
    const tampered = ms.map((m, i) => (i === 0 ? { ...m, checksum: 'x' } : m));
    expect(() => migrate(db, tampered)).toThrow(/changed after it was applied/);
  });
});
