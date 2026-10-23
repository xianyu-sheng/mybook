import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { memoryDb } from '../test-utils/memory-db.js'
import { mergeIndex } from './index.js'

let db: Database.Database
beforeEach(() => {
  db = memoryDb()
  db.prepare("INSERT INTO global_repository(id,name,base_url) VALUES ('repo','Repo','https://github.com/example/repo')").run()
})
afterEach(() => db.close())

const searchable = (term: string) => (db.prepare('SELECT COUNT(*) AS n FROM global_search WHERE global_search MATCH ?').get(term) as { n: number }).n

describe('incremental repository index', () => {
  it('keeps existing documents when only new documents are merged', () => {
    mergeIndex(db, 'repo', [{ path: 'a.md', title: 'A', content: 'ALPHA old', url: 'u/a', blobSha: 'sha-a1' }], 'r1', null)
    expect(db.prepare('SELECT COUNT(*) AS n FROM global_document').get()).toMatchObject({ n: 1 })

    mergeIndex(db, 'repo', [{ path: 'b.md', title: 'B', content: 'BETA new', url: 'u/b', blobSha: 'sha-b1' }], 'r2', null)
    expect(db.prepare('SELECT path,content_text FROM global_document ORDER BY path').all()).toEqual([
      { path: 'a.md', content_text: 'ALPHA old' },
      { path: 'b.md', content_text: 'BETA new' },
    ])
    expect(searchable('alpha')).toBe(1)
    expect(searchable('beta')).toBe(1)
  })

  it('replaces only the changed document and cleans old chunks', () => {
    mergeIndex(db, 'repo', [
      { path: 'a.md', title: 'A', content: 'ALPHA old', url: 'u/a', blobSha: 'sha-a1' },
      { path: 'b.md', title: 'B', content: 'BETA stable', url: 'u/b', blobSha: 'sha-b1' },
    ], 'r1', null)

    mergeIndex(db, 'repo', [{ path: 'a.md', title: 'A', content: 'GAMMA new', url: 'u/a2', blobSha: 'sha-a2' }], 'r2', null)
    expect(db.prepare('SELECT path,content_text,blob_sha FROM global_document ORDER BY path').all()).toEqual([
      { path: 'a.md', content_text: 'GAMMA new', blob_sha: 'sha-a2' },
      { path: 'b.md', content_text: 'BETA stable', blob_sha: 'sha-b1' },
    ])
    expect(searchable('alpha')).toBe(0)
    expect(searchable('gamma')).toBe(1)
    expect(searchable('beta')).toBe(1)
  })

  it('removes disappeared paths and backfills legacy fingerprints only at the same revision', () => {
    mergeIndex(db, 'repo', [{ path: 'a.md', title: 'A', content: 'ALPHA', url: 'u/a' }], 'r1', null)
    expect(db.prepare("SELECT blob_sha,indexed_revision FROM global_document WHERE path='a.md'").get()).toMatchObject({ blob_sha: null, indexed_revision: 'r1' })

    // A fingerprint from a newer commit must not be applied to older content.
    mergeIndex(db, 'repo', [], 'r2', null, { backfill: [{ path: 'a.md', blobSha: 'sha-a1' }] })
    expect(db.prepare("SELECT blob_sha FROM global_document WHERE path='a.md'").get()).toMatchObject({ blob_sha: null })

    mergeIndex(db, 'repo', [], 'r1', null, { backfill: [{ path: 'a.md', blobSha: 'sha-a1' }] })
    expect(db.prepare("SELECT blob_sha FROM global_document WHERE path='a.md'").get()).toMatchObject({ blob_sha: 'sha-a1' })

    mergeIndex(db, 'repo', [], 'r2', null, { removedPaths: ['a.md'] })
    expect(db.prepare('SELECT COUNT(*) AS n FROM global_document').get()).toMatchObject({ n: 0 })
    expect(searchable('alpha')).toBe(0)
  })
})
