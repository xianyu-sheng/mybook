import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { memoryDb } from '../test-utils/memory-db.js'
import { columnSnapshot, legacyTables, seedLegacyData } from '../test-utils/legacy-data.js'
import { searchRecordingKnowledge } from '../recording/documents.js'

const state = vi.hoisted(() => ({ db: null as Database.Database | null, handlers: new Map<string, (...args: any[]) => any>() }))
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => state.handlers.set(name, handler) }, dialog: {} }))
vi.mock('../db/connection.js', () => ({ getDb: () => state.db! }))
import { registerDbIpc } from './db.ipc.js'

beforeEach(() => { state.db = memoryDb(); seedLegacyData(state.db); state.handlers.clear(); registerDbIpc() })
afterEach(() => state.db?.close())
const invoke = (name: string, ...args: unknown[]) => state.handlers.get(name)!({}, ...args)
const children = legacyTables.filter(table => table !== 'notebook')

describe('reversible notebook archive through production IPC', () => {
  it('archives and restores visibility without deleting any linked knowledge, interview, or recording', () => {
    const before = columnSnapshot(state.db!, children)
    expect(invoke('knowmind:notebook:list').map((row: any) => row.id)).toEqual(['book'])
    invoke('knowmind:notebook:archive', 'book')
    expect(invoke('knowmind:notebook:list')).toEqual([])
    expect(invoke('knowmind:notebook:list-archived').map((row: any) => row.id)).toEqual(['book'])
    expect(columnSnapshot(state.db!, children)).toEqual(before)
    expect(searchRecordingKnowledge(state.db!, 'AUDIOMIGRATIONTOKEN').map(row => row.id)).toEqual(['recording'])
    const restored = invoke('knowmind:notebook:restore', 'book')
    expect(restored).toMatchObject({ id: 'book', title: '原有项目笔记', description: '不可丢失的描述', archived_at: null, created_at: '2026-01-02 03:04:05' })
    expect(invoke('knowmind:notebook:list').map((row: any) => row.id)).toEqual(['book'])
    expect(invoke('knowmind:notebook:list-archived')).toEqual([])
    expect(columnSnapshot(state.db!, children)).toEqual(before)
    expect(state.db!.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(state.db!.prepare('PRAGMA integrity_check').get()).toMatchObject({ integrity_check: 'ok' })
  })
  it('makes the old delete channel reversible and does not rewrite an existing archive timestamp', () => {
    const before = columnSnapshot(state.db!, children)
    invoke('knowmind:notebook:delete', 'book')
    state.db!.prepare("UPDATE notebook SET archived_at='2020-01-02 03:04:05' WHERE id='book'").run()
    invoke('knowmind:notebook:archive', 'book')
    expect(invoke('knowmind:notebook:get', 'book').archived_at).toBe('2020-01-02 03:04:05')
    expect(columnSnapshot(state.db!, children)).toEqual(before)
    expect(invoke('knowmind:notebook:restore', 'book').archived_at).toBeNull()
    expect(columnSnapshot(state.db!, children)).toEqual(before)
  })
  it('rejects nonexistent archive/restore targets without changing existing data', () => {
    const before = columnSnapshot(state.db!)
    expect(() => invoke('knowmind:notebook:archive', 'missing')).toThrow('笔记本不存在')
    expect(() => invoke('knowmind:notebook:restore', 'missing')).toThrow('笔记本不存在')
    expect(columnSnapshot(state.db!)).toEqual(before)
  })
})
