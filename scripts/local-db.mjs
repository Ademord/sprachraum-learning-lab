import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// Local-only D1 adapter. Production always uses the platform's DB binding.
export function localDB(filename = ':memory:') {
  const sqlite = new DatabaseSync(filename);
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec('CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)');
  for (const name of fs.readdirSync('drizzle').filter(n => n.endsWith('.sql')).sort()) {
    if (!sqlite.prepare('SELECT name FROM local_migrations WHERE name = ?').get(name)) {
      sqlite.exec(fs.readFileSync(`drizzle/${name}`, 'utf8'));
      sqlite.prepare('INSERT INTO local_migrations (name) VALUES (?)').run(name);
    }
  }
  const wrap = (sql, values = []) => ({
    bind: (...next) => wrap(sql, next),
    async first() { return sqlite.prepare(sql).get(...values) || null; },
    async all() { return { results: sqlite.prepare(sql).all(...values) }; },
    _run() { const result = sqlite.prepare(sql).run(...values); return { success: true, meta: { changes: Number(result.changes) } }; },
    async run() { return this._run(); }
  });
  return { prepare: sql => wrap(sql), async batch(statements) { sqlite.exec('BEGIN IMMEDIATE'); try { const result = statements.map(statement => statement._run()); sqlite.exec('COMMIT'); return result; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } }, close: () => sqlite.close() };
}
