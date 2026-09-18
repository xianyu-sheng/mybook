import Database from 'better-sqlite3'
import path from 'node:path'
import { app } from 'electron'
import { runMigrations } from './migrate.js'

let db: Database.Database | null = null
let dbPath: string | null = null

export function getDbPath(): string {
  if (dbPath) return dbPath
  dbPath = path.join(app.getPath('userData'), 'knowmind.db')
  return dbPath
}

export function getDb(): Database.Database {
  if (db) return db
  db = new Database(getDbPath())
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}