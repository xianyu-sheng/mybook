import { beforeEach, describe, expect, it, vi } from 'vitest'
import { analyzeRecording, parseRecordingAnalysis } from './analysis.js'
import { recordingMarkdown, transcriptBatches } from './documents.js'
import { getActiveModel } from '../ai/provider.js'
import { generateTextWithFallback } from '../ai/generate.js'
import { knowledgeContext } from '../ai/knowledge.js'
import { matchQuery } from '../repository/index.js'
import type Database from 'better-sqlite3'
import type { Recording, RecordingReport, TranscriptSegment } from '../../src/types/recording.js'
vi.mock('../ai/provider.js', () => ({ getActiveModel: vi.fn(), getAllModelsFromCCSwitch: vi.fn(), createModelClient: vi.fn() }))
vi.mock('../ai/generate.js', () => ({ generateTextWithFallback: vi.fn(), InvalidModelOutput: class extends Error {} }))
vi.mock('../ai/knowledge.js', () => ({ knowledgeContext: vi.fn() }))
const valid = { summary: '需要补充原理', questions: [{ question: '如何去重？', answer: '重试', evidence: [2], score: 42, strengths: [], gaps: ['重试不等于幂等，需使用唯一键'], reference_answer: '以业务唯一键配合数据库唯一约束保证幂等。', followups: [] }] }
const segment = (id: number, text: string): TranscriptSegment => ({ id, text, speaker: '本人', track: 'microphone', start: id, end: id + 1 })
describe('interview evidence and windowing', () => {
  it('accepts scores grounded in actual segment IDs', () => {
    expect(parseRecordingAnalysis(JSON.stringify(valid), [2]).questions[0].score).toBe(42)
    expect(parseRecordingAnalysis(JSON.stringify(valid), [0, 1]).questions).toEqual([])
  })
  it('permits no score when there is no answer', () => {
    expect(parseRecordingAnalysis(JSON.stringify({ summary: '只有提问，尚无回答', questions: [] }), [1]).questions).toEqual([])
  })
  it.each([[-1, 0], [101, 100], [1.5, 2]])('clamps invalid score %s to %s', (score, expected) => {
    expect(parseRecordingAnalysis(JSON.stringify({ ...valid, questions: [{ ...valid.questions[0], score }] }), [2]).questions[0].score).toBe(expected)
  })
  it('fills missing feedback and rejects unparseable JSON', () => {
    expect(parseRecordingAnalysis(JSON.stringify({ ...valid, questions: [{ ...valid.questions[0], gaps: [] }] }), [2]).questions[0].gaps.length).toBeGreaterThan(0)
    expect(() => parseRecordingAnalysis('{"summary":', [2])).toThrow()
  })
  it('salvages complete questions from a truncated response', () => {
    const full = JSON.stringify({ ...valid, questions: [valid.questions[0], { ...valid.questions[0], question: '第二题' }] })
    const result = parseRecordingAnalysis(full.slice(0, full.length - 30), [2])
    expect(result.summary).toBe('需要补充原理')
    expect(result.questions.map(question => question.question)).toEqual(['如何去重？'])
  })
  it('bounds long utterances and retains evidence IDs and tail', () => {
    const input = [segment(0, '甲'.repeat(10000)), segment(1, '乙'.repeat(18000)), segment(2, '末尾答案')]
    const batches = transcriptBatches(input)
    expect(batches.every(b => b.reduce((sum, s) => sum + s.text.length, 0) <= 7000)).toBe(true)
    expect(batches.flat().every(s => [0, 1, 2].includes(s.id))).toBe(true)
    expect(batches.at(-1)!.some(s => s.text === '末尾答案')).toBe(true)
    expect(transcriptBatches([segment(7, '序'.repeat(10001))]).flat().reduce((sum, s) => sum + s.text.length, 0)).toBeGreaterThanOrEqual(10001)
  })
  it('bounds overhead of thousands of short utterances without losing them', () => {
    const input = Array.from({ length: 500 }, (_, i) => segment(i, `短句${i}`))
    const batches = transcriptBatches(input)
    expect(batches.every(b => b.length <= 60)).toBe(true)
    expect(new Set(batches.flat().map(s => s.id)).size).toBe(input.length)
  })
})

describe('recording review context and continued answers', () => {
  const citations = [{ ref: '来源[1]', title: '支付项目说明', id: 'project-source', url: 'https://example.test/project' }]
  const fakeDb = {} as Database.Database
  const record = (segments: TranscriptSegment[]): Recording => ({
    id: 'recording-id', notebook_id: 'notebook-id', title: '合成面试', company: '', role: '', jd: '', tags: [],
    status: 'transcribed', duration: 200, created_at: '', started_at: null,
    tracks: [{ kind: 'microphone', label: '本人' }], segments, report: null, error: null, export_error: null, shared: true,
  })
  const reply = (patch: Partial<typeof valid.questions[0]> = {}) => ({
    summary: '复盘结果', questions: [{ ...valid.questions[0], question: '如何保证幂等？', answer: '先使用缓存。', evidence: [57, 59], score: 30,
      reference_answer: '来源[1]：使用数据库唯一键。', ...patch }],
  })
  function modelResponses(...values: Array<ReturnType<typeof reply>>) {
    vi.mocked(generateTextWithFallback).mockImplementation(async (_model, _def, options) => {
      const value = values.shift()
      if (!value) throw new Error('Unexpected model request')
      const text = JSON.stringify(value)
      options.validate?.(text)
      return { text, usedModel: 'test-model' } as Awaited<ReturnType<typeof generateTextWithFallback>>
    })
  }
  const longRecord = () => record(Array.from({ length: 61 }, (_, id) => segment(id,
    id === 57 ? '如何保证幂等？' : id === 59 ? '先使用缓存。' : id === 60 ? '并使用数据库唯一约束。' : `其他讨论${id}`)))
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getActiveModel).mockResolvedValue({ model: {}, def: {} } as Awaited<ReturnType<typeof getActiveModel>>)
    vi.mocked(knowledgeContext).mockReturnValue({ context: '来源[1]：支付项目说明，数据库唯一键。', citations })
  })
  it('keeps the current question in the 40-token search budget when the JD is long', async () => {
    const value = record([segment(0, 'QUORUMAUDITTOKEN 如何选举？')])
    value.jd = Array.from({ length: 60 }, (_, index) => `requirement${index}`).join(' ')
    modelResponses(reply({ evidence: [0] }))
    await analyzeRecording(fakeDb, value, new AbortController().signal, () => {})
    const query = vi.mocked(knowledgeContext).mock.calls[0][2]
    expect(matchQuery(query)).toContain('quorumaudittoken')
    expect(vi.mocked(knowledgeContext).mock.calls[0][3]).toBe(value.id)
  })
  it('persists and exports retrieval references for each answer and still exports old reports', async () => {
    const value = record([segment(0, '如何保证幂等？')])
    modelResponses(reply({ evidence: [0] }))
    const report = await analyzeRecording(fakeDb, value, new AbortController().signal, () => {})
    expect(report.questions[0].citations).toEqual(citations)
    const markdown = recordingMarkdown({ ...value, report })
    expect(markdown).toContain('本题检索参考资料')
    expect(markdown).toContain('来源[1]：支付项目说明')
    expect(markdown).toContain('https://example.test/project')
    delete report.questions[0].citations
    expect(() => recordingMarkdown({ ...value, report })).not.toThrow()
  })
  it('preserves the second half of an answer and updates its assessment using the preceding actual answer', async () => {
    modelResponses(reply(), reply({ answer: '并使用数据库唯一约束。', score: 90, evidence: [59, 60] }))
    const report = await analyzeRecording(fakeDb, longRecord(), new AbortController().signal, () => {})
    expect(report.questions).toHaveLength(1)
    expect(report.questions[0].evidence).toEqual([57, 59, 60])
    expect(report.questions[0].answer).toContain('先使用缓存。')
    expect(report.questions[0].answer).toContain('数据库唯一约束')
    expect(report.questions[0].score).toBe(90)
    expect(report.score).toBe(90)
    const secondPrompt = vi.mocked(generateTextWithFallback).mock.calls[1][2].prompt
    expect(secondPrompt).toContain('与本窗口衔接的此前实际回答')
    expect(secondPrompt).toContain('先使用缓存。')
  })
  it('keeps separate attempts at the same question when evidence does not overlap', async () => {
    modelResponses(reply({ evidence: [0, 1] }), reply({ answer: '第二次作答：数据库唯一约束。', score: 90, evidence: [59, 60] }))
    const report = await analyzeRecording(fakeDb, longRecord(), new AbortController().signal, () => {})
    expect(report.questions).toHaveLength(2)
    expect(report.questions.map(question => question.score)).toEqual([30, 90])
  })
  it('does not revise a score for repeated overlap without additional evidence', async () => {
    modelResponses(reply({ evidence: [59] }), reply({ score: 90, evidence: [59] }))
    const report = await analyzeRecording(fakeDb, longRecord(), new AbortController().signal, () => {})
    expect(report.questions).toHaveLength(1)
    expect(report.questions[0].score).toBe(30)
  })
  it('merges new text from a long utterance even when the evidence ID stays the same', async () => {
    const value = record([segment(0, '甲'.repeat(7000) + '末尾的数据库唯一约束')])
    modelResponses(reply({ evidence: [0] }), reply({ evidence: [0] }), reply({ evidence: [0] }), reply({ answer: '末尾的数据库唯一约束', score: 90, evidence: [0] }))
    const report = await analyzeRecording(fakeDb, value, new AbortController().signal, () => {})
    expect(report.questions).toHaveLength(1)
    expect(report.questions[0].answer).toContain('末尾的数据库唯一约束')
    expect(report.questions[0].score).toBe(90)
  })
  it('drops invented evidence but keeps the grounded answer', async () => {
    modelResponses(reply(), reply({ evidence: [59, 600] }))
    const report = await analyzeRecording(fakeDb, longRecord(), new AbortController().signal, () => {})
    expect(report.questions).toHaveLength(1)
    expect(report.questions[0].evidence).toEqual([57, 59])
    expect(report.questions[0].score).toBe(30)
  })
  it('strips reference numbers that have no corresponding retrieved source', async () => {
    modelResponses(reply({ evidence: [0], reference_answer: '根据来源[999]，使用唯一约束。' }))
    const report = await analyzeRecording(fakeDb, record([segment(0, '如何保证幂等？')]), new AbortController().signal, () => {})
    expect(report.questions[0].reference_answer).not.toContain('来源[999]')
    expect(report.questions[0].reference_answer).toContain('使用唯一约束')
  })

  it('checkpoints finished windows and resumes from the next one', async () => {
    const value = longRecord()
    const partials: RecordingReport[] = []
    const save = (report: RecordingReport) => { partials.push(JSON.parse(JSON.stringify(report))) }
    vi.mocked(generateTextWithFallback)
      .mockImplementationOnce(async (_model, _def, options) => {
        const text = JSON.stringify(reply())
        options.validate?.(text)
        return { text, usedModel: 'test-model' } as Awaited<ReturnType<typeof generateTextWithFallback>>
      })
      .mockImplementationOnce(async () => { throw new Error('network timeout') })
    await expect(analyzeRecording(fakeDb, value, new AbortController().signal, () => {}, save)).rejects.toThrow('network timeout')
    expect(partials).toHaveLength(1)
    expect(partials[0].progress).toMatchObject({ completedBatches: 1, totalBatches: 2 })
    expect(partials[0].questions).toHaveLength(1)
    expect(vi.mocked(generateTextWithFallback)).toHaveBeenCalledTimes(2)

    modelResponses(reply({ answer: '并使用数据库唯一约束。', score: 90, evidence: [59, 60] }))
    const resumed = await analyzeRecording(fakeDb, { ...value, report: partials[0] }, new AbortController().signal, () => {}, save)
    expect(vi.mocked(generateTextWithFallback)).toHaveBeenCalledTimes(3)
    expect(resumed.progress).toBeUndefined()
    expect(resumed.questions).toHaveLength(1)
    expect(resumed.questions[0].evidence).toEqual([57, 59, 60])
    expect(resumed.questions[0].answer).toContain('先使用缓存。')
    expect(resumed.questions[0].answer).toContain('数据库唯一约束')
    expect(partials).toHaveLength(2)
  })

})
