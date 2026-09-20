import { describe, expect, it } from 'vitest'
import { parseCodingReview } from './review.js'

const valid = JSON.stringify({ score: 82, verdict: 'mostly_correct', summary: '思路基本正确', thought_feedback: '能识别模式', code_feedback: '需要补边界判断', complexity: { time: 'O(n)，单次扫描', space: 'O(n)，哈希表', correctness: '空数组和重复值需要验证' }, better_approaches: ['排序加双指针适用于不要求下标的场景'], advanced_followups: ['数据流场景如何处理'], missed_concepts: ['循环不变量'], corrected_solution: '伪代码', next_steps: ['补充边界测试'] })

describe('coding review parser', () => {
  it('accepts JSON fences and adds a safety notice', () => {
    const review = parseCodingReview(`\`\`\`json\n${valid}\n\`\`\``)
    expect(review.score).toBe(82)
    expect(review.notice).toContain('不等同于在线评测')
  })
  it('rejects incomplete or out-of-range model output', () => {
    expect(() => parseCodingReview('{"score":101}')).toThrow('结构化')
  })
})
