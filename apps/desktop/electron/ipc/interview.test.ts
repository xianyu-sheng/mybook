import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type Database from 'better-sqlite3'
import { memoryDb } from '../test-utils/memory-db.js'

const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  handlers: new Map<string, (...args: any[]) => any>(),
  fail: true,
  outputs: [] as string[],
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => state.handlers.set(name, handler) },
  shell: { openExternal: vi.fn() },
}))
vi.mock('../db/connection.js', () => ({ getDb: () => state.db! }))
vi.mock('../ai/provider.js', () => ({ getActiveModel: async () => ({ model: {}, def: {} }) }))
vi.mock('../ai/generate.js', () => ({
  generateTextWithFallback: async (_model: unknown, _def: unknown, options: any) => {
    if (state.fail) throw new Error('已到本次任务的时间上限，当前候选渠道均未成功')
    const text = state.outputs.shift()
    if (!text) throw new Error('fixture output missing')
    options.validate?.(text)
    return { text, usedModel: 'fixture-model' }
  },
}))
vi.mock('../interview/research.js', () => ({ searchResearch: vi.fn() }))
vi.mock('../interview/service.js', () => ({ deleteInterviewSession: vi.fn() }))
import './interview.ipc.js'
import { registerInterviewIpc } from './interview.ipc.js'

registerInterviewIpc()

const event = { sender: { isDestroyed: () => false, send: vi.fn() } }
const invoke = (name: string, ...args: unknown[]) => state.handlers.get(name)!(event, ...args)

let outputDir: string
beforeEach(() => {
  state.db = memoryDb()
  state.fail = true
  state.outputs = []
  outputDir = mkdtempSync(path.join(os.tmpdir(), 'mybook-interview-ipc-'))
  state.db.prepare("INSERT INTO settings(key,value_json) VALUES ('outputDir',?)").run(JSON.stringify(outputDir))
  state.db.prepare("INSERT INTO notebook(id,title) VALUES ('book','面试笔记')").run()
  state.db.prepare("INSERT INTO interview_session(id,notebook_id,title,company,department,role,jd,question_count,status) VALUES ('session','book','模拟面试','测试企业','研发','后端','高并发服务',2,'active')").run()
  state.db.prepare("INSERT INTO interview_turn(id,session_id,question) VALUES ('turn','session','如何设计高并发服务？')").run()
})
afterEach(() => { state.db?.close(); rmSync(outputDir, { recursive: true, force: true }) })

describe('interview feedback fallback', () => {
  it('saves a local provisional review and keeps the interview moving when AI routes fail', async () => {
    const session = await invoke('knowmind:interviews:answer', 'session', 'turn', '我会先给出方案，再说明并发、异常和测试。')
    const turn = session.turns[0]
    expect(turn.model_name).toBe('local-fallback')
    expect(turn.feedback).toContain('AI 渠道暂时不可用')
    expect(session.status).toBe('active')
    expect(session.turns).toHaveLength(2)
    expect((state.db!.prepare("SELECT COUNT(*) AS n FROM supplement WHERE source_type='qa'").get() as any).n).toBe(1)
  })

  it('can roll back an unstarted follow-up and replace only the local review with AI feedback', async () => {
    await invoke('knowmind:interviews:answer', 'session', 'turn', '先给结论，再说明原理、取舍、边界和验证。')
    state.fail = false
    state.outputs.push(JSON.stringify({ score: 88, feedback: '结构清晰，补充异常边界。', reference_answer: '先给结论，再解释原理和取舍。', knowledge: '关注并发边界与验证。', next_question: '如何验证这个方案？' }))
    const session = await invoke('knowmind:interviews:retry-answer', 'session', 'turn')
    expect(session.turns[0].model_name).toBe('fixture-model')
    expect(session.turns[0].score).toBe(88)
    expect(session.turns[0].feedback).toBe('结构清晰，补充异常边界。')
    expect(session.turns).toHaveLength(2)
    expect((state.db!.prepare("SELECT COUNT(*) AS n FROM supplement WHERE source_type='qa'").get() as any).n).toBe(1)
  })
})
