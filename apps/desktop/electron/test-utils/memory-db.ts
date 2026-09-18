import { DatabaseSync } from 'node:sqlite'
import type Database from 'better-sqlite3'
import { runMigrations } from '../db/migrate.js'

/** Run production SQL against a real, disposable SQLite database without Electron ABI coupling. */
export function memoryDb(): Database.Database {
  const raw = new DatabaseSync(':memory:')
  raw.exec('PRAGMA foreign_keys=ON')
  let sequence = 0
  const db = {
    exec: (sql: string) => raw.exec(sql),
    prepare: (sql: string) => raw.prepare(sql),
    transaction: (fn: (...args: unknown[]) => unknown) => (...args: unknown[]) => {
      const name = `test_transaction_${sequence++}`
      raw.exec(`SAVEPOINT ${name}`)
      try { const result = fn(...args); raw.exec(`RELEASE ${name}`); return result }
      catch (error) { raw.exec(`ROLLBACK TO ${name}; RELEASE ${name}`); throw error }
    },
    close: () => raw.close(),
  } as unknown as Database.Database
  runMigrations(db)
  return db
}
