import { describe, expect, it } from 'vitest'
import { InvalidModelOutput } from './generate.js'
import { parseInterviewFeedback, parseSourceSummary } from './structured.js'

describe('structured task outputs are validated inside model fallback', () => {
  const feedback = { score: 75, feedback: '遗漏失败重试。', reference_answer: '先说明适用条件，再给出实现。', knowledge: '幂等性需要稳定的业务键。', next_question: '如何处理并发？' }
  it('preserves complete Chinese summary text', () => {
    const summary = { summary: '“重试”，需要幂等。', keyTopics: ['幂等性'], suggestedQuestions: ['如何选择业务键？'] }
    expect(parseSourceSummary('```json\n' + JSON.stringify(summary) + '\n```')).toEqual(summary)
  })
  it.each(['{}', 'not json', '{"summary":"","keyTopics":[],"suggestedQuestions":[]}', '{"summary":"a","keyTopics":"b","suggestedQuestions":[]}'])('rejects broken summaries so another model can be tried: %s', value => {
    expect(() => parseSourceSummary(value)).toThrow(InvalidModelOutput)
  })
  it('requires the next question until the final turn', () => {
    expect(parseInterviewFeedback(JSON.stringify(feedback), false)).toEqual(feedback)
    expect(() => parseInterviewFeedback(JSON.stringify({ ...feedback, next_question: '' }), false)).toThrow(InvalidModelOutput)
    expect(() => parseInterviewFeedback(JSON.stringify({ ...feedback, score: 101 }), false)).toThrow(InvalidModelOutput)
    expect(() => parseInterviewFeedback(JSON.stringify({ score: 90 }), false)).toThrow(InvalidModelOutput)
  })
  it('requires a complete final evaluation without a new question', () => {
    expect(parseInterviewFeedback(JSON.stringify({ ...feedback, next_question: '' }), true).score).toBe(75)
    expect(() => parseInterviewFeedback(JSON.stringify(feedback), true)).toThrow(InvalidModelOutput)
  })
})
