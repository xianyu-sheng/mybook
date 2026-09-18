import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type Database from 'better-sqlite3'
import { practiceMigration } from './schema.js'
import { createPracticeService, freezeRequirements } from './service.js'
import type { PracticeSnapshot } from '../../src/types/practice.js'

vi.mock('../ai/provider.js', () => ({ getActiveModel: vi.fn() }))
vi.mock('../ai/generate.js', () => ({ generateTextWithFallback: vi.fn(), InvalidModelOutput: class extends Error {} }))

function database() {
  const native = new DatabaseSync(':memory:')
  native.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE recording(id TEXT PRIMARY KEY,title TEXT,company TEXT,role TEXT,jd TEXT,report_json TEXT,transcript_json TEXT);
    CREATE TABLE interview_session(id TEXT PRIMARY KEY,title TEXT,company TEXT,role TEXT,jd TEXT);
    CREATE TABLE interview_turn(id TEXT PRIMARY KEY,session_id TEXT,question TEXT,answer TEXT,feedback TEXT,reference_answer TEXT,knowledge TEXT,model_name TEXT,citations_json TEXT);
    CREATE TABLE source(id TEXT PRIMARY KEY,title TEXT,url TEXT);
    CREATE TABLE card(id TEXT PRIMARY KEY,title TEXT,brief_answer TEXT,detail_answer TEXT,tags_json TEXT,source_ids TEXT,citations_json TEXT);`)
  for (const sql of practiceMigration) native.exec(sql)
  const db = { prepare: native.prepare.bind(native), transaction: (fn: () => unknown) => () => {
    native.exec('BEGIN')
    try { const result = fn(); native.exec('COMMIT'); return result } catch (error) { native.exec('ROLLBACK'); throw error }
  } } as unknown as Database.Database
  return { db, native }
}
const citation = { ref: '来源[1]', id: 'source-1', title: '项目说明', url: 'https://example.test/source' }
const sourceQuestion = { question: '如何保证幂等？', answer: '只重试。', reference_answer: '使用数据库唯一约束，并处理冲突。',
  gaps: ['补充唯一约束及冲突处理'], citations: [citation], evidence: [2], model: 'source-model' }
const review = { summary: '需要说明边界', criteria: [{ requirement_id: 'r1', status: 'partial' as const, quotes: ['唯一约束'], feedback: '提到了约束', improvement: '补充冲突返回' }], next_action: '重答冲突场景', notice: '未核实' }
describe('practice snapshots and immutable attempts', () => {
  let fixture: ReturnType<typeof database>
  beforeEach(() => {
    fixture = database()
    fixture.native.prepare('INSERT INTO recording VALUES (?,?,?,?,?,?,?)').run('recording-1', '合成录音', '测试企业', '后端', '支付系统', JSON.stringify({ questions: [sourceQuestion] }), JSON.stringify([{ id: 2, speaker: '本人', start: 1, end: 3, text: '只重试。' }]))
    fixture.native.prepare('INSERT INTO interview_session VALUES (?,?,?,?,?)').run('session-1', '合成面试', '测试企业', '开发', '测试岗位')
    fixture.native.prepare('INSERT INTO interview_turn VALUES (?,?,?,?,?,?,?,?,?)').run('turn-1', 'session-1', '解释事务', '老回答', '需补充隔离', '隔离级别具有不同语义。', '说明不可重复读。', 'source-model', JSON.stringify([citation]))
    fixture.native.prepare('INSERT INTO source VALUES (?,?,?)').run('source-1', '项目说明', 'https://example.test/source')
    fixture.native.prepare('INSERT INTO card VALUES (?,?,?,?,?,?,?)').run('card-1', '什么是事务？', '说明原子性。', '事务具有原子性、一致性等特性。', '{}', '["source-1"]', '[]')
  })
  afterEach(() => fixture.native.close())
  it('creates idempotent sources and hides all source answers until a new answer is saved', () => {
    const service = createPracticeService(fixture.db)
    const item = service.fromRecording('recording-1', 0)
    expect(service.fromRecording('recording-1', 0).id).toBe(item.id)
    expect(item.reference_locked).toBe(true)
    expect(item.snapshot).toBeNull()
    expect(item.requirements).toEqual([])
    expect(JSON.stringify(service.list())).not.toContain('只重试')
    expect(service.list()[0]).toMatchObject({ company: '测试企业', role: '后端', attempt_count: 0, status: 'active' })
  })
  it('retains exact source answers, citations and evidence after the source is edited and deleted', async () => {
    const evaluate = vi.fn().mockResolvedValue({ review, model_name: 'actual-fallback-model' })
    const service = createPracticeService(fixture.db, evaluate)
    const item = service.fromRecording('recording-1', 0)
    fixture.native.prepare('UPDATE recording SET report_json=? WHERE id=?').run(JSON.stringify({ questions: [{ ...sourceQuestion, answer: '新历史原答' }] }), 'recording-1')
    expect(service.fromRecording('recording-1', 0).id).toBe(item.id)
    fixture.native.prepare('DELETE FROM recording WHERE id=?').run('recording-1')
    const saved = await service.attempt(item.id, '我使用唯一约束。')
    expect(saved.snapshot).toMatchObject({ original_answer: '只重试。', citations: [citation], evidence: [{ id: 2, text: '只重试。' }] })
    expect(saved.attempts[0]).toMatchObject({ answer: '我使用唯一约束。', model_name: 'actual-fallback-model', status: 'ready' })
    expect(saved.requirements.every(row => row.unverified)).toBe(true)
    expect(evaluate.mock.calls[0][1].original_answer).toBe('只重试。')
  })
  it('distinguishes a new question at a recording index after a fresh analysis', () => {
    const service = createPracticeService(fixture.db)
    const initial = service.fromRecording('recording-1', 0)
    fixture.native.prepare('UPDATE recording SET report_json=? WHERE id=?').run(JSON.stringify({ questions: [{ ...sourceQuestion, question: '如何防止幻读？' }] }), 'recording-1')
    expect(service.fromRecording('recording-1', 0).id).not.toBe(initial.id)
  })
  it('reads interview citations and card sources from the database, keeping AI reference distinct from the original answer', async () => {
    const service = createPracticeService(fixture.db, vi.fn().mockRejectedValue(new Error('网络失败')))
    const interview = service.fromInterview('turn-1')
    const card = service.fromCard('card-1')
    expect(service.fromInterview('turn-1').id).toBe(interview.id)
    expect(service.fromCard('card-1').id).toBe(card.id)
    const interviewAttempt = await service.attempt(interview.id, '新的独立回答')
    const cardAttempt = await service.attempt(card.id, '新的独立回答')
    expect(interviewAttempt.snapshot).toMatchObject({ original_answer: '老回答', citations: [citation] })
    expect(cardAttempt.snapshot).toMatchObject({ original_answer: '', citations: [{ ...citation, ref: '原始资料[1]', kind: 'source' }], reference_answer: '事务具有原子性、一致性等特性。' })
    expect(cardAttempt.snapshot?.notice).toContain('未保留引用编号映射')
  })
  it('preserves citation excerpts and provenance for interview and card snapshots', async () => {
    const rich = { ...citation, kind: 'source', excerpt: '原文片段', content_hash: 'saved-hash', retrieved_at: '2026-09-17T00:00:00Z', provenance: [{ ...citation, excerpt: '更早原文片段' }] }
    fixture.native.prepare('UPDATE interview_turn SET citations_json=? WHERE id=?').run(JSON.stringify([rich]), 'turn-1')
    fixture.native.prepare('UPDATE card SET citations_json=? WHERE id=?').run(JSON.stringify([rich]), 'card-1')
    const service = createPracticeService(fixture.db, vi.fn().mockRejectedValue(new Error('失败')))
    const interview = await service.attempt(service.fromInterview('turn-1').id, '本轮独立回答')
    const card = await service.attempt(service.fromCard('card-1').id, '本轮独立回答')
    expect(interview.snapshot?.citations[0]).toEqual(rich)
    expect(card.snapshot?.citations[0]).toEqual(rich)
  })
  it('keeps question citations separate from feedback citations that reuse the same reference number', async () => {
    fixture.native.exec("ALTER TABLE interview_turn ADD COLUMN question_citations_json TEXT NOT NULL DEFAULT '[]'")
    const questionCitation = { ...citation, id: 'question-source', title: '提问题目的资料', excerpt: '提问时看到的原文' }
    fixture.native.prepare('UPDATE interview_turn SET question=?,question_citations_json=? WHERE id=?')
      .run('结合来源[1]解释事务', JSON.stringify([questionCitation]), 'turn-1')
    const service = createPracticeService(fixture.db, vi.fn().mockRejectedValue(new Error('失败')))
    const item = service.fromInterview('turn-1')
    expect(item.question).toContain('提问题目的资料')
    expect(item.question).not.toContain('来源[1]')
    const saved = await service.attempt(item.id, '我的独立回答')
    expect(saved.snapshot?.citations).toEqual([citation])
    expect(saved.snapshot?.question_citations).toEqual([questionCitation])
    expect(saved.snapshot?.source_text).toContain('结合来源[1]解释事务')
  })
  it('commits the answer before AI starts and prevents deletion or a second concurrent attempt', async () => {
    let finish!: (value: { review: typeof review; model_name: string }) => void
    const evaluate = vi.fn(() => new Promise<{ review: typeof review; model_name: string }>(resolve => { finish = resolve }))
    const service = createPracticeService(fixture.db, evaluate)
    const item = service.fromRecording('recording-1', 0)
    const pending = service.attempt(item.id, '唯一约束')
    expect(service.get(item.id).attempts[0]).toMatchObject({ answer: '唯一约束', status: 'evaluating' })
    expect(service.get(item.id).reference_locked).toBe(false)
    expect(() => service.delete(item.id)).toThrow('正在点评')
    expect(() => service.setStatus(item.id, 'archived')).toThrow('正在点评')
    await expect(service.attempt(item.id, '第二次')).rejects.toThrow('正在点评')
    finish({ review, model_name: 'test-model' })
    expect((await pending).attempts).toHaveLength(1)
  })
  it('keeps a failed answer for retry without duplicating it and retains every later independent answer', async () => {
    const evaluate = vi.fn().mockRejectedValueOnce(new Error('模型超时')).mockResolvedValue({ review, model_name: 'fallback-model' })
    const service = createPracticeService(fixture.db, evaluate)
    const item = service.fromCard('card-1')
    const failed = await service.attempt(item.id, '我的第一次回答')
    expect(failed.reference_locked).toBe(false)
    expect(failed.attempts[0]).toMatchObject({ status: 'error', answer: '我的第一次回答', error: '模型超时' })
    const retried = await service.retry(failed.attempts[0].id)
    expect(retried.attempts).toHaveLength(1)
    expect(retried.attempts[0]).toMatchObject({ status: 'ready', answer: '我的第一次回答', model_name: 'fallback-model', error: null })
    const second = await service.attempt(item.id, '我的第二次回答')
    expect(second.attempts.map(attempt => attempt.answer)).toEqual(['我的第一次回答', '我的第二次回答'])
    expect(new Set(second.attempts.map(attempt => attempt.input_version)).size).toBe(1)
    expect(evaluate.mock.calls[1][2]).toEqual(evaluate.mock.calls[2][2])
    await expect(service.retry(second.attempts[0].id)).rejects.toThrow('只有点评失败')
  })
  it('recovers interrupted reviews without changing answers, then deletes only the chosen practice history', async () => {
    const service = createPracticeService(fixture.db, vi.fn().mockRejectedValue(new Error('失败')))
    const item = service.fromInterview('turn-1')
    const failed = await service.attempt(item.id, '原答案完整保留')
    fixture.native.prepare("UPDATE practice_attempt SET status='evaluating',error=NULL WHERE id=?").run(failed.attempts[0].id)
    service.recover()
    expect(service.get(item.id).attempts[0]).toMatchObject({ status: 'error', answer: '原答案完整保留' })
    service.delete(item.id)
    expect(fixture.native.prepare('SELECT COUNT(*) AS n FROM practice_attempt').get()?.n).toBe(0)
    expect(fixture.native.prepare('SELECT id FROM interview_turn WHERE id=?').get('turn-1')?.id).toBe('turn-1')
  })
  it('rejects invalid sources, empty answers, unsupported status and attempts on archived items', async () => {
    const service = createPracticeService(fixture.db)
    expect(() => service.fromRecording('recording-1', -1)).toThrow()
    expect(() => service.fromRecording('recording-1', 100)).toThrow('不存在')
    expect(() => service.fromCard('missing')).toThrow('不存在')
    const item = service.fromCard('card-1')
    await expect(service.attempt(item.id, '  ')).rejects.toThrow('独立填写')
    expect(() => service.setStatus(item.id, 'fake')).toThrow()
    service.setStatus(item.id, 'archived')
    await expect(service.attempt(item.id, '新的回答')).rejects.toThrow('恢复')
    service.setStatus(item.id, 'active')
    expect(service.get(item.id).attempt_count).toBe(0)
  })
  it('freezes at most eight explicit source requirements instead of generating a fresh rubric for every answer', () => {
    const snapshot = { gaps: Array.from({ length: 10 }, (_, index) => `薄弱点 ${index}`), knowledge: '知识摘要', reference_answer: '参考回答' } as PracticeSnapshot
    const requirements = freezeRequirements(snapshot)
    expect(requirements).toHaveLength(8)
    expect(requirements[0]).toMatchObject({ id: 'r1', origin: 'source_gap', source_quote: '薄弱点 0', unverified: true })
    expect(freezeRequirements({ ...snapshot, gaps: [] })[0].origin).toBe('source_knowledge')
  })
})
