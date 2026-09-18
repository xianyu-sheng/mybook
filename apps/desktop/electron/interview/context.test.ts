import { describe, it, expect } from 'vitest'
import { interviewHistoryContext } from './context.js'
import type { InterviewTurn } from '../../src/types/interview.js'
const turn = (answer: string): InterviewTurn => ({ id: 't', session_id: 's', question: '如何取舍？', answer, feedback: null, score: null, reference_answer: null, knowledge: null, model_name: null, created_at: '' })
describe('interview context retention', () => {
  it('includes all 12000 characters of the current answer and bounds historical answers', () => {
    const current = 'A'.repeat(11980) + '最后结论：采用幂等去重'
    const history = interviewHistoryContext([...Array.from({ length: 14 }, () => turn('B'.repeat(12000))), turn(current)])
    expect(JSON.parse(history.split('\n').at(-1)!).answer).toBe(current)
    expect(history).toContain('历史内容已节选')
    expect(history).toContain('更早 8 题已省略')
    expect(history.length).toBeLessThan(24000)
  })
  it('marks previous question refs as historical rather than remapping them to the current retrieval', () => {
    expect(interviewHistoryContext([{ ...turn('test'), question: '来源[1] 中的方案？' }])).toContain('历史参考（旧记录未保存来源映射')
  })
})
