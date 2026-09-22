import { describe, expect, it } from 'vitest'
import { createOfflineInterviewFeedback, isInterviewGenerationFailure, LOCAL_FALLBACK_MODEL } from './fallback.js'

describe('offline interview review fallback', () => {
  it('creates an explicitly provisional review and a follow-up question', () => {
    const result = createOfflineInterviewFeedback('如何设计一个高并发缓存？', '我会先说明方案，再考虑并发、异常和测试。', '后端开发', false)
    expect(LOCAL_FALLBACK_MODEL).toBe('local-fallback')
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
    expect(result.feedback).toContain('AI 渠道暂时不可用')
    expect(result.reference_answer).toContain('待 AI 核实')
    expect(result.knowledge).toContain('复习重点')
    expect(result.next_question).toContain('后端开发')
  })

  it('does not pretend there is another question at the end', () => {
    expect(createOfflineInterviewFeedback('问题', '回答', '岗位', true).next_question).toBe('')
  })

  it('only treats recoverable model failures as fallback candidates', () => {
    expect(isInterviewGenerationFailure(new Error('已到本次任务的时间上限'))).toBe(true)
    expect(isInterviewGenerationFailure(new Error('deepseek 无可用渠道'))).toBe(true)
    expect(isInterviewGenerationFailure(new Error('用户取消操作'))).toBe(false)
  })
})
