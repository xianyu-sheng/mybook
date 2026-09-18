import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type Database from 'better-sqlite3'
import type { GenerationOptions } from '../ai/generate.js'
import { memoryDb } from '../test-utils/memory-db.js'
import { replaceIndex } from '../repository/index.js'

const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  handlers: new Map<string, (...args: any[]) => any>(),
  outputs: [] as string[], prompts: [] as string[],
}))
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => state.handlers.set(name, handler) } }))
vi.mock('../db/connection.js', () => ({ getDb: () => state.db! }))
vi.mock('../ai/provider.js', () => ({
  getActiveModel: async () => ({ model: {}, def: {} }), getAllModelsFromCCSwitch: () => [],
  createModelClient: vi.fn(), resolveModelDefinition: vi.fn(),
}))
vi.mock('../ai/generate.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../ai/generate.js')>()
  return { ...actual, generateTextWithFallback: async (_model: unknown, _def: unknown, options: GenerationOptions) => {
    state.prompts.push(options.prompt)
    const text = state.outputs.shift()
    if (text === undefined) throw new Error('Unexpected model call in offline test')
    options.validate?.(text)
    return { text, usedModel: 'offline-fixture' }
  } }
})
import './ai.ipc.js'

let outputDir: string
beforeEach(() => {
  state.db = memoryDb()
  state.outputs = []; state.prompts = []
  state.db.prepare("INSERT INTO notebook(id,title) VALUES ('book','Synthetic')").run()
  outputDir = mkdtempSync(path.join(os.tmpdir(), 'mybook-citation-ipc-'))
  state.db.prepare("INSERT INTO settings(key,value_json) VALUES ('outputDir',?)").run(JSON.stringify(outputDir))
})
afterEach(() => { state.db?.close(); rmSync(outputDir, { recursive: true, force: true }) })
const event = { sender: { isDestroyed: () => false, send: vi.fn() } }
const invoke = (name: string, ...args: unknown[]) => state.handlers.get(name)!(event, ...args)
const source = (id: string, title: string, content: string) => state.db!.prepare("INSERT INTO source(id,notebook_id,type,title,content_text,status) VALUES (?,'book','text',?,?,'ready')").run(id, title, content)
const card = (title: string, ref: string) => ({ title, brief_answer: `简答 ${ref}`, detail_answer: `详细内容 ${ref}`, tags: [], sources: [ref] })

describe('AI knowledge citation persistence through actual IPC and SQLite', () => {
  it('saves the same actual citation snapshot to the chat, auto note, and Markdown export', async () => {
    source('redis', 'Redis original', 'Redis 持久化需要可靠性权衡。')
    state.outputs.push('依据 来源[1]，Redis 持久化需要权衡。')
    const response = await invoke('knowmind:ai:query', 'book', 'Redis')
    expect(response.error).toBeUndefined()
    const chat = state.db!.prepare("SELECT id,citations_json FROM chat_message WHERE role='assistant'").get() as any
    const note = state.db!.prepare('SELECT reference_id,citations_json FROM supplement WHERE id=?').get(response.supplementId) as any
    expect(note.reference_id).toBe(chat.id)
    expect(JSON.parse(note.citations_json)).toEqual(response.citations)
    expect(note.citations_json).toBe(chat.citations_json)
    expect(response.citations[0]).toMatchObject({ id: 'redis', kind: 'source', excerpt: 'Redis 持久化需要可靠性权衡。' })
    const exported = await invoke('knowmind:supplement:export', 'book')
    expect(exported).toContain(response.citations[0].content_hash)
    expect(exported).toContain('Redis original')
    const files = readdirSync(outputDir).map(file => readFileSync(path.join(outputDir, file), 'utf8')).join('\n')
    expect(files).toContain(response.citations[0].content_hash)
  })
  it('validates unknown QA references before saving an assistant answer or auto note', async () => {
    source('redis', 'Redis original', 'Redis 持久化。')
    state.outputs.push('依据 来源[999]，得出回答。')
    const response = await invoke('knowmind:ai:query', 'book', 'Redis')
    expect(response.error).toBe(true)
    expect((state.db!.prepare('SELECT COUNT(*) AS n FROM supplement').get() as any).n).toBe(0)
    expect((state.db!.prepare("SELECT COUNT(*) AS n FROM chat_message WHERE role='assistant'").get() as any).n).toBe(0)
  })
  it('stores only used local source IDs while retaining global references and matching auto notes', async () => {
    source('unused', 'Unused local', 'Unused local original text')
    source('used', 'Used local', 'Used local original text')
    state.db!.prepare("INSERT INTO global_repository(id,name,base_url) VALUES ('repo','Global','https://example.test/repo')").run()
    replaceIndex(state.db!, 'repo', [{ path: 'global.md', title: 'Global topic', content: 'Global original text', url: 'https://example.test/global' }], 'revision', null)
    state.outputs.push(JSON.stringify([card('Local card', '来源[1]'), card('Global card', '来源[3]')]))
    const result = await invoke('knowmind:card:generate', 'book', 2)
    expect(JSON.parse(result[0].source_ids)).toEqual(['used'])
    expect(JSON.parse(result[1].source_ids)).toEqual([])
    expect(JSON.parse(result[0].citations_json)[0]).toMatchObject({ id: 'used', kind: 'source', excerpt: 'Used local original text' })
    expect(JSON.parse(result[1].citations_json)[0]).toMatchObject({ kind: 'global_document', excerpt: 'Global original text', url: 'https://example.test/global' })
    for (const saved of result) {
      const note = state.db!.prepare('SELECT citations_json FROM supplement WHERE reference_id=?').get(saved.id) as any
      expect(note.citations_json).toBe(saved.citations_json)
    }
  })
  it('rejects a card batch with unknown citations without partial card or knowledge writes', async () => {
    source('source', 'Source', 'Source original text')
    state.outputs.push(JSON.stringify([card('Valid first', '来源[1]'), card('Invalid second', '来源[999]')]))
    await expect(invoke('knowmind:card:generate', 'book', 2)).rejects.toThrow('卡片生成失败')
    expect((state.db!.prepare('SELECT COUNT(*) AS n FROM card').get() as any).n).toBe(0)
    expect((state.db!.prepare('SELECT COUNT(*) AS n FROM supplement').get() as any).n).toBe(0)
  })
})
