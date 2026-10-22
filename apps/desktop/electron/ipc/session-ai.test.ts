import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import type { GenerationOptions } from '../ai/generate.js'
import { memoryDb } from '../test-utils/memory-db.js'

const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  handlers: new Map<string, (...args: any[]) => any>(),
  outputs: [] as string[],
  prompts: [] as string[],
}))
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => state.handlers.set(name, handler) } }))
vi.mock('../db/connection.js', () => ({ getDb: () => state.db! }))
vi.mock('../ai/provider.js', () => ({
  getActiveModel: async () => ({ model: {}, def: {} }), getAllModelsFromCCSwitch: () => [], getAvailableModelsFromCCSwitch: async () => [],
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

beforeEach(() => {
  state.db = memoryDb()
  state.outputs = []; state.prompts = []
  state.db.prepare("INSERT INTO notebook(id,title) VALUES ('book','Synthetic')").run()
  state.db.prepare("INSERT INTO notebook(id,title) VALUES ('book2','Second')").run()
  state.db.prepare("INSERT INTO source(id,notebook_id,type,title,content_text,status) VALUES ('s1','book','text','Redis note','Redis 持久化需要权衡可靠性。','ready')").run()
  state.db.prepare("INSERT INTO source(id,notebook_id,type,title,content_text,status) VALUES ('s2','book2','text','Vector note','向量检索需要 top-k 与召回评估。','ready')").run()
})
afterEach(() => state.db?.close())
const event = { sender: { isDestroyed: () => false, send: vi.fn() } }
const invoke = (name: string, ...args: unknown[]) => state.handlers.get(name)!(event, ...args)

describe('global knowledge Q&A sessions', () => {
  it('creates a session, auto-titles it, persists both messages and deletes it', async () => {
    const session = await invoke('knowmind:ai:sessions:create')
    expect(session).toMatchObject({ title: '新对话' })
    state.outputs.push('依据 来源[1]，Redis 持久化需要权衡。')
    const result = await invoke('knowmind:ai:session-query', session.id, 'Redis 持久化怎么做？')
    expect(result.error).toBeUndefined()
    expect(result.citations[0]).toMatchObject({ id: 's1', kind: 'source' })

    const messages = await invoke('knowmind:ai:session-history', session.id)
    expect(messages.map((message: any) => message.role)).toEqual(['user', 'assistant'])
    expect(messages[1].citations_json).toContain('s1')
    const list = await invoke('knowmind:ai:sessions:list')
    expect(list[0]).toMatchObject({ id: session.id, title: 'Redis 持久化怎么做？', messages: 2 })
    expect(list[0].preview).toBe('Redis 持久化怎么做？')

    await invoke('knowmind:ai:sessions:rename', session.id, '持久化追问')
    expect((await invoke('knowmind:ai:sessions:list'))[0].title).toBe('持久化追问')
    await invoke('knowmind:ai:sessions:delete', session.id)
    expect(await invoke('knowmind:ai:sessions:list')).toEqual([])
    expect(await invoke('knowmind:ai:session-history', session.id)).toEqual([])
  })

  it('retrieves sources from every notebook and keeps session history in the prompt', async () => {
    state.outputs.push('依据 来源[1]，先回答 Redis。')
    const session = await invoke('knowmind:ai:sessions:create')
    await invoke('knowmind:ai:session-query', session.id, 'Redis 和向量检索怎么配合？')
    expect(state.prompts[0]).toContain('Redis 持久化需要权衡可靠性')
    expect(state.prompts[0]).toContain('向量检索需要 top-k')

    state.outputs.push('结合上一轮，补充向量检索。')
    await invoke('knowmind:ai:session-query', session.id, '那向量检索呢？')
    expect(state.prompts[1]).toContain('先回答 Redis')
    expect(state.prompts[1]).toContain('那向量检索呢')
  })

  it('does not persist an assistant message when the answer cites an unknown source', async () => {
    state.outputs.push('依据 来源[99]，得出回答。')
    const session = await invoke('knowmind:ai:sessions:create')
    const result = await invoke('knowmind:ai:session-query', session.id, 'Redis')
    expect(result.error).toBe(true)
    const messages = await invoke('knowmind:ai:session-history', session.id)
    expect(messages.map((message: any) => message.role)).toEqual(['user'])
  })
})
