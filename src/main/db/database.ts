import Database from 'better-sqlite3'
import { MIGRATIONS } from './migrations'

export type Db = Database.Database

/**
 * Open (or create) the SQLite database at `path`, set pragmas, and run
 * pending migrations. Pass ':memory:' or a temp file in tests.
 * No Electron dependency — the caller supplies the path.
 */
export function openDatabase(path: string): Db {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

function migrate(db: Db): void {
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)')
  const appliedRows = db.prepare('SELECT name FROM _migrations').all() as { name: string }[]
  const applied = new Set(appliedRows.map((r) => r.name))
  const insert = db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)')
  const run = db.transaction(() => {
    for (const m of MIGRATIONS) {
      if (applied.has(m.name)) continue
      db.exec(m.sql)
      insert.run(m.name, Date.now())
    }
  })
  run()
}
