import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import type { PracticeRequirement, PracticeSnapshot } from '../../src/types/practice.js'
import { getActiveModel } from '../ai/provider.js'
import { generateTextWithFallback } from '../ai/generate.js'
import { parsePracticeReview, reviewPractice } from './review.js'

vi.mock('../ai/provider.js', () => ({ getActiveModel: vi.fn() }))
vi.mock('../ai/generate.js', () => ({ generateTextWithFallback: vi.fn(), InvalidModelOutput: class extends Error {} }))
const requirements: PracticeRequirement[] = [
  { id: 'r1', text: '说明约束', source_quote: '说明约束', origin: 'source_gap', unverified: true },
  { id: 'r2', text: '说明冲突', source_quote: '说明冲突', origin: 'source_gap', unverified: true },
]
const snapshot = { question: '如何保证幂等？', original_answer: '这是以前的回答，不应当作本轮证据', reference_answer: '使用唯一约束', knowledge: '', citations: [{ ref: '来源[1]', title: '项目说明' }], notice: '待核实', context: '', role: '后端', company: '' } as PracticeSnapshot
const answer = '我使用唯一约束，冲突时返回此前处理结果。'
const result = { summary: '已说明主要手段', criteria: [
  { requirement_id: 'r1', status: 'covered', quotes: ['唯一约束'], feedback: '明确说明约束', improvement: '继续核对实现' },
  { requirement_id: 'r2', status: 'partial', quotes: ['冲突时返回此前处理结果'], feedback: '来源[1]：还缺失败分支', improvement: '补充失败分支' },
], next_action: '补充故障路径' }

describe('practice feedback is grounded in the new answer and frozen requirements', () => {
  beforeEach(() => vi.resetAllMocks())
  it('accepts verbatim evidence and restores requirement order without adding a score', () => {
    const parsed = parsePracticeReview(JSON.stringify({ ...result, criteria: [...result.criteria].reverse() }), answer, requirements, snapshot)
    expect(parsed.criteria.map(item => item.requirement_id)).toEqual(['r1', 'r2'])
    expect(parsed.notice).toContain('未核实')
    expect(parsed).not.toHaveProperty('score')
  })
  it('rejects invented or historical evidence, quotes that were paraphrased, and empty evidence for partial coverage', () => {
    for (const quotes of [['数据库唯一索引'], [snapshot.original_answer], [], [' ']]) {
      const invalid = { ...result, criteria: [{ ...result.criteria[0], quotes }, result.criteria[1]] }
      expect(() => parsePracticeReview(JSON.stringify(invalid), answer, requirements, snapshot)).toThrow('不存在')
    }
  })
  it('allows missing criteria without pretending there is evidence', () => {
    const missing = { ...result, criteria: [result.criteria[0], { ...result.criteria[1], status: 'missing', quotes: [] }] }
    expect(parsePracticeReview(JSON.stringify(missing), answer, requirements, snapshot).criteria[1].quotes).toEqual([])
  })
  it('rejects omitted, duplicated and invented requirements and citations', () => {
    const invalid = [
      { ...result, criteria: [result.criteria[0]] },
      { ...result, criteria: [result.criteria[0], result.criteria[0]] },
      { ...result, criteria: [result.criteria[0], { ...result.criteria[1], requirement_id: 'new-rubric' }] },
      { ...result, next_action: '来源[999]：项目产出' },
    ]
    for (const value of invalid) expect(() => parsePracticeReview(JSON.stringify(value), answer, requirements, snapshot)).toThrow()
  })
  it('validates inside the common fallback boundary and reports the actual used model', async () => {
    vi.mocked(getActiveModel).mockResolvedValue({ model: {}, def: {} } as Awaited<ReturnType<typeof getActiveModel>>)
    vi.mocked(generateTextWithFallback).mockImplementation(async (_model, _def, options) => {
      expect(() => options.validate?.(JSON.stringify({ ...result, criteria: [] }))).toThrow()
      const payload = JSON.stringify(result)
      options.validate?.(payload)
      expect(options.prompt).not.toContain(snapshot.original_answer)
      expect(options.system).toContain('不得补造')
      return { text: payload, usedModel: 'actual-fallback-model' }
    })
    const reviewed = await reviewPractice({} as Database.Database, snapshot, requirements, answer)
    expect(reviewed.model_name).toBe('actual-fallback-model')
    expect(reviewed.review.criteria).toHaveLength(2)
  })
})
