import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { memoryDb } from '../test-utils/memory-db.js'
import { columnSnapshot, seedLegacyData, snapshotOriginalColumns } from '../test-utils/legacy-data.js'
import { runMigrations } from './migrate.js'

let db: Database.Database
beforeEach(() => {
  db = memoryDb()
  // Derive the old schema from production migrations, without copying their SQL.
  // No v5/v6-only data exists in this disposable database.
  db.exec(`DROP TABLE qa_message;
    DROP TABLE qa_session;
    DROP TABLE coding_sync_record;
    DROP TABLE coding_attempt;
    DROP TABLE coding_strategy_problem;
    DROP TABLE coding_problem;
    DROP TABLE coding_strategy;
    DROP TABLE practice_attempt;
    DROP TABLE practice_item;
    DROP TABLE target_role;
    ALTER TABLE notebook DROP COLUMN archived_at;
    ALTER TABLE supplement DROP COLUMN citations_json;
    ALTER TABLE card DROP COLUMN citations_json;
    ALTER TABLE interview_turn DROP COLUMN citations_json;
    ALTER TABLE interview_turn DROP COLUMN question_citations_json;
    DELETE FROM _schema_version WHERE version >= 5;`)
  seedLegacyData(db)
})
afterEach(() => db.close())

describe('production v4 to v7 migration', () => {
  it('preserves every existing column across connected user data and keeps indexes/FKs healthy', () => {
    const baseline = columnSnapshot(db)
    expect(baseline.notebook.columns).not.toContain('archived_at')
    expect(baseline.card.columns).not.toContain('citations_json')
    runMigrations(db)
    expect(snapshotOriginalColumns(db, baseline)).toEqual(baseline)
    expect(db.prepare('SELECT MAX(version) AS version FROM _schema_version').get()).toMatchObject({ version: 7 })
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(db.prepare('PRAGMA integrity_check').get()).toMatchObject({ integrity_check: 'ok' })
    expect(db.prepare("SELECT rowid FROM recording_search WHERE recording_search MATCH 'audiomigrationtoken'").all()).toHaveLength(1)
    expect(db.prepare("SELECT rowid FROM global_search WHERE global_search MATCH 'globalmigrationtoken'").all()).toHaveLength(1)
    expect(db.prepare("SELECT COUNT(*) AS n FROM qa_session WHERE id='legacy-book'").get()).toMatchObject({ n: 1 })
    expect(db.prepare("SELECT role,content,citations_json FROM qa_message WHERE session_id='legacy-book'").get()).toMatchObject({
      role: 'assistant', content: '旧问答 来源[1]', citations_json: '[{"ref":"来源[1]","id":"source","title":"原始资料"}]',
    })
    expect(() => db.prepare("INSERT INTO source(id,notebook_id,type,title) VALUES ('bad','missing','text','bad')").run()).toThrow(/FOREIGN KEY/)
  })
  it('gives existing rows empty citations and an active notebook default, and is idempotent', () => {
    runMigrations(db)
    expect(db.prepare("SELECT archived_at FROM notebook WHERE id='book'").get()).toMatchObject({ archived_at: null })
    for (const table of ['supplement', 'card', 'interview_turn']) {
      expect(db.prepare(`SELECT citations_json FROM ${table}`).get()).toMatchObject({ citations_json: '[]' })
    }
    expect(db.prepare('SELECT question_citations_json FROM interview_turn').get()).toMatchObject({ question_citations_json: '[]' })
    for (const table of ['practice_item', 'practice_attempt', 'target_role']) expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toMatchObject({ n: 0 })
    const afterFirst = columnSnapshot(db)
    runMigrations(db)
    expect(columnSnapshot(db)).toEqual(afterFirst)
    expect(db.prepare('SELECT COUNT(*) AS n FROM _schema_version WHERE version=7').get()).toMatchObject({ n: 1 })
  })
  it('rolls back every added column on a mid-migration failure and permits a clean retry', () => {
    const baseline = columnSnapshot(db)
    db.exec('CREATE TABLE target_role (synthetic_conflict TEXT)')
    expect(() => runMigrations(db)).toThrow(/already exists/)
    expect(columnSnapshot(db)).toEqual(baseline)
    expect(db.prepare('SELECT MAX(version) AS version FROM _schema_version').get()).toMatchObject({ version: 4 })
    db.exec('DROP TABLE target_role')
    runMigrations(db)
    expect(snapshotOriginalColumns(db, baseline)).toEqual(baseline)
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(db.prepare('PRAGMA integrity_check').get()).toMatchObject({ integrity_check: 'ok' })
  })
})
