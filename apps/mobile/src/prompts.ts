import type { Card, InterviewTurn, QaMessage } from './types'

export function cardsPrompt(topic: string, count: number): string {
  return `你是中文面试复习教练。根据下面的主题/岗位/项目，生成 ${count} 张知识卡片，输出 JSON 数组，不要 Markdown 围栏或其他文字。
每项字段：title、brief_answer（一句话结论）、detail_answer（原理与例子）、tags（字符串数组）。
要求：
- 卡片要能直接用于面试复习，不要空泛。
- 如果知识点有可实现核心，detail_answer 追加一个最小可运行代码示例；如果代码是 Python，再追加「### Python 语法讲解」，逐点解释真实用到的语法、标准库、常见坑和 Java/刷题写法对照。
- 不要编造用户没有提供的项目经历。
主题/岗位：
${topic}`
}

export function qaPrompt(cards: Card[], messages: QaMessage[], question: string): string {
  const context = cards.slice(0, 8).map(card => `【${card.title}】\n${card.brief_answer}\n${card.detail_answer}`).join('\n\n').slice(0, 12000)
  const history = messages.slice(-8).map(message => `${message.role === 'user' ? '用户' : '助手'}：${message.content}`).join('\n\n').slice(-12000)
  return `你是中文技术面试复习助手。优先结合下面的本地知识卡片回答；资料不足时明确说明是通用知识，不要编造用户经历。
本地卡片：
${context || '（暂无卡片）'}

最近对话：
${history || '（新会话）'}

用户问题：
${question}

请直接回答，必要时给可运行代码；如果代码是 Python，附一小段 Python 语法讲解。`
}

export function mockStartPrompt(company: string, role: string, jd: string): string {
  return `你是严谨的中文技术面试官。根据以下岗位信息，提出第一道面试题。
输出 JSON：{"question":"问题"}
要求：只问一个具体问题；优先岗位核心能力；不要自我介绍式寒暄，不要输出其他字段。
企业：${company || '未指定'}
岗位：${role || '未指定'}
JD：${jd || '未提供'}`
}

export function mockEvaluatePrompt(company: string, role: string, jd: string, turns: InterviewTurn[], question: string, answer: string): string {
  const history = turns.slice(-6).map(turn => `问：${turn.question}\n答：${turn.answer}`).join('\n\n')
  return `你是严谨的中文技术面试教练。评价本轮回答，并给出下一题。
输出 JSON：{"score":0到100的整数,"feedback":"具体点评","reference_answer":"参考答案","knowledge":"可复习知识","next_question":"下一题"}
要求：
- 按准确性 40%、原理深度 30%、表达结构 20%、岗位契合 10% 评分。
- feedback 指出具体缺陷和改法，不要泛泛鼓励。
- reference_answer 涉及可实现方案时附最小可运行代码；如果代码是 Python，再附「### Python 语法讲解」。
- next_question 只问一个问题，基于薄弱点或 JD 未覆盖能力；不要重复上一题。
企业：${company}
岗位：${role}
JD：${jd || '未提供'}
此前对话：
${history || '（这是第一轮回答）'}
当前问题：${question}
用户回答：${answer}`
}
