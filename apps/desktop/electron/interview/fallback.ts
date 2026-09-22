/**
 * A deterministic review keeps an interview usable when every configured AI
 * route is unavailable. It is deliberately framed as a draft: it must never
 * pretend to know a company answer or a candidate's project history.
 */
export const LOCAL_FALLBACK_MODEL = 'local-fallback'

export interface OfflineInterviewFeedback {
  score: number
  feedback: string
  reference_answer: string
  knowledge: string
  next_question: string
}

const dimensions = [
  { label: '结论与原理', terms: ['结论', '原理', '机制', '原因', '因为', '因此'] },
  { label: '方案与取舍', terms: ['方案', '步骤', '取舍', '权衡', '优点', '缺点'] },
  { label: '边界与异常', terms: ['边界', '异常', '失败', '降级', '并发', '一致性'] },
  { label: '验证与结果', terms: ['测试', '验证', '监控', '指标', '结果', '复杂度', '性能'] },
]

function clip(value: string, limit: number) {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`
}

function answerScore(answer: string, covered: number) {
  const lengthScore = answer.length < 50 ? 35 : answer.length < 120 ? 48 : answer.length < 260 ? 58 : 65
  return Math.min(85, lengthScore + covered * 5)
}

export function isInterviewGenerationFailure(error: unknown) {
  const message = error instanceof Error ? `${error.message} ${error.cause instanceof Error ? error.cause.message : ''}` : String(error)
  return /时间上限|候选渠道均未成功|响应超时|无可用渠道|额度不足|凭据或权限不可用|连接中断|服务暂时不可用|模型调用发生非临时错误|未发现可用的 AI 模型|未通过实时目录检查/i.test(message)
}

export function createOfflineInterviewFeedback(question: string, answer: string, role: string, last: boolean): OfflineInterviewFeedback {
  const normalized = answer.toLowerCase()
  const coveredLabels = dimensions.filter(dimension => dimension.terms.some(term => normalized.includes(term))).map(dimension => dimension.label)
  const missing = dimensions.filter(dimension => !coveredLabels.includes(dimension.label)).map(dimension => dimension.label)
  const score = answerScore(answer, coveredLabels.length)
  const focus = missing.length ? `建议补齐：${missing.join('、')}。` : '四个维度都有涉及，下一步应补充真实约束、数据和取舍。'
  const nextQuestion = last ? '' : `请进一步说明你刚才方案的边界条件、失败场景和验证方式，并结合${clip(role || '目标岗位', 40)}的真实项目经历说明一次取舍。`

  return {
    score,
    feedback: `本次 AI 渠道暂时不可用，以下是本地保底点评，仅用于保持练习连续性；恢复 AI 后可点击“重试 AI 点评”替换。\n\n` +
      `回答长度约 ${answer.length} 字，当前覆盖：${coveredLabels.length ? coveredLabels.join('、') : '尚未识别到完整答题结构'}。${focus}\n` +
      '作答时可按“先给结论 → 解释原理 → 说明方案与取舍 → 补充边界和验证”的顺序组织，避免只列名词或只描述结果。',
    reference_answer: `参考答题框架（本地草稿，待 AI 核实）\n1. 先用一句话回答问题并限定适用范围。\n2. 解释关键原理、执行步骤以及主要取舍。\n3. 补充异常、并发、容量或安全边界。\n4. 说明如何测试、监控和验证结果。\n\n本题：${clip(question, 180)}`,
    knowledge: `复习重点（本地草稿，待 AI 核实）\n- 用结论、原理、取舍、边界、验证五个角度检查答案。\n- 涉及个人项目时只填写自己能核实的技术细节和结果，不要套用未经确认的数字。\n- 下一次练习优先补齐：${missing.length ? missing.join('、') : '边界条件和可观测性'}。`,
    next_question: nextQuestion,
  }
}
