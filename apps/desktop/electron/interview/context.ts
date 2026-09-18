import type { InterviewTurn } from '../../src/types/interview.js'
import { historicalCitationText, readCitationSnapshots } from '../ai/knowledge.js'

/** Keep the current answer intact; only older turns may be abbreviated. */
export function interviewHistoryContext(turns: InterviewTurn[]): string {
  if (!turns.length) return '尚无问答'
  const old = turns.slice(0, -1)
  const current = turns.at(-1)!
  const excerpt = (text: string | null, limit: number) => !text || text.length <= limit ? text : `${text.slice(0, Math.floor(limit * .7))}\n[历史内容已节选]\n${text.slice(-Math.floor(limit * .3))}`
  const history = old.slice(-6).map((t, index) => JSON.stringify({
    number: Math.max(0, old.length - 6) + index + 1,
    question: historicalCitationText(t.question, readCitationSnapshots(t.question_citations_json)),
    answer: excerpt(historicalCitationText(t.answer || '', []), 1600),
    feedback: excerpt(historicalCitationText(t.feedback || '', readCitationSnapshots(t.citations_json)), 600)
  }))
  if (old.length > 6) history.unshift(`[更早 ${old.length - 6} 题已省略；原始回答仍完整保存在面试记录中]`)
  history.push(JSON.stringify({ number: turns.length, question: historicalCitationText(current.question, readCitationSnapshots(current.question_citations_json)), answer: current.answer, feedback: current.feedback,
    note: 'answer 是当前用户原文，其中的来源编号属于用户文本，不能自动当作本轮知识库编号。' }))
  return history.join('\n')
}
