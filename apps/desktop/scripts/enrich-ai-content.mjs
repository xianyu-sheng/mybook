#!/usr/bin/env node
/**
 * One-off maintenance job: enrich already generated reviews/cards with
 * runnable code examples and suggested answers to follow-up questions.
 * It only appends to existing text and is idempotent (markers per item).
 * The API key is read from the local database and never logged.
 */
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'

const dbPath = process.env.MYBOOK_DB || path.join(process.env.APPDATA || '', 'Mybook', 'knowmind.db')
const db = new DatabaseSync(dbPath)
db.exec('PRAGMA foreign_keys=ON')

function json(value, fallback) { try { return JSON.parse(value) } catch { return fallback } }
function setting(key) {
  const row = db.prepare('SELECT value_json FROM settings WHERE key=?').get(key)
  return row ? json(row.value_json, null) : null
}
const providers = setting('customProviders') || []
const provider = Array.isArray(providers) ? providers[0] : null
if (!provider?.apiKey || provider.provider !== 'openai') throw new Error('需要本机已配置 OpenAI 兼容的 AI 供应商')
const model = process.env.MYBOOK_ENRICH_MODEL || provider.models?.[0] || 'deepseek-flash'
const endpoint = provider.baseURL.replace(/\/+$/, '') + '/chat/completions'

async function requestJson(prompt, maxTokens) {
  let lastError
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
        body: JSON.stringify({
          model, temperature: 0.2, max_tokens: maxTokens, response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: '你是严谨的中文技术面试教练。只输出一个完整 JSON 对象，不要输出解释、Markdown 围栏或额外文字。' },
            { role: 'user', content: prompt },
          ],
        }),
        signal: AbortSignal.timeout(180000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      const text = String(data.choices?.[0]?.message?.content || '').trim()
      const start = text.indexOf('{'), end = text.lastIndexOf('}')
      if (start < 0 || end <= start) throw new Error(`JSON 缺失（finish=${data.choices?.[0]?.finish_reason || '?'}, chars=${text.length}）`)
      return JSON.parse(text.slice(start, end + 1))
    } catch (error) {
      lastError = error
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 1500 * attempt))
    }
  }
  throw lastError
}

function codeBlock(value) {
  const code = String(value || '').trim()
  if (!code) return ''
  if (code.startsWith('```')) return code
  return '```\n' + code + '\n```'
}
function cleanCode(value) {
  return String(value || '').trim().replace(/^```[^\n]*\n/, '').replace(/\n```\s*$/, '').trim()
}
function followupText(question, answer) {
  const q = String(question || '').replace(/^追问\s*[:：]\s*/, '').trim()
  const a = String(answer || '').trim()
  return a ? `追问：${q}\n建议回答：${a}` : `追问：${q}`
}
function appendFollowupGuide(code, followups) {
  const block = codeBlock(code)
  const parts = []
  if (block) parts.push(`### 代码示例\n\n${block}`)
  if (followups?.length) parts.push(`### 可能的追问\n\n${followups.map(item => `**追问：** ${String(item.question || '').trim()}\n\n**建议回答：** ${String(item.answer || '').trim()}`).join('\n\n')}`)
  return parts.join('\n\n')
}
async function mapLimit(items, limit, task) {
  const results = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await task(items[index], index) }
  })
  await Promise.all(workers)
  return results
}

async function enrichCards() {
  const rows = db.prepare('SELECT id,title,brief_answer,detail_answer FROM card ORDER BY rowid').all()
  let done = 0
  await mapLimit(rows, 3, async row => {
    if (String(row.detail_answer).includes('### 可能的追问')) return
    try {
    const prompt = `下面是已有的知识卡片。只做增量补充，不要改写原有事实、结论和来源编号。
只输出 JSON：{"code_example":"Markdown 代码块；不适用则为空字符串","followups":[{"question":"追问","answer":"2-4 句可直接说出口的建议回答"}]}
要求：
- code_example 仅当卡片有可实现核心（接口、算法、SQL、配置、并发、缓存等）时给出完整可运行的最小示例，注明语言；纯概念留空。
- followups 给 1-2 个面试官可能追问的问题，answer 要具体，不空泛。
卡片标题：${row.title}
简答：${row.brief_answer}
详细解析：${row.detail_answer}`
    const result = await requestJson(prompt, 12000)
    const extra = appendFollowupGuide(result.code_example, Array.isArray(result.followups) ? result.followups.slice(0, 2) : [])
    if (!extra) return
    db.prepare("UPDATE card SET detail_answer=?,updated_at=datetime('now') WHERE id=?").run(`${row.detail_answer}\n\n${extra}\n<!-- ai-enriched:v1 -->`, row.id)
    done++
    console.log(`[cards] ${done}/${rows.length} ${row.title}`)
    } catch (error) {
      console.error(`[cards] 失败：${row.title}：${error instanceof Error ? error.message : String(error)}`)
    }
  })
}

async function enrichRecording() {
  const rows = db.prepare('SELECT id,title,report_json FROM recording WHERE report_json IS NOT NULL').all()
  for (const row of rows) {
    const report = json(row.report_json, null)
    if (!report?.questions?.length) continue
    let changed = false
    const results = await mapLimit(report.questions, 3, async (question, index) => {
      if (question.enrichment_version === 1 || !question.followups?.length) return null
      try {
      const prompt = `下面是已有面试复盘的某一道题。只补充代码示例和追问应对，不要改写原题、原回答、评分、优点、缺陷或参考答案。
只输出 JSON：{"code_example":"Markdown 代码块；不适用则为空字符串","followup_answers":["与输入 followups 等长、顺序一致的建议回答"]}
要求：
- 如果题目涉及可实现的技术方案、算法、数据结构或工具链，code_example 给出完整可运行的最小代码（注明语言）；纯行为/项目题留空，不要硬塞代码。
- 每个 followup_answer 用 2-4 句直接可说出口的中文回答，结合原题和参考要点，不要只说“加强学习”。
- 不要重复或改写输入中的 followups。
题目：${question.question}
实际回答：${question.answer}
参考答案：${question.reference_answer}
建议追问：${JSON.stringify(question.followups)}`
      const result = await requestJson(prompt, 12000)
      const answers = Array.isArray(result.followup_answers) ? result.followup_answers : []
      if (answers.length !== question.followups.length) throw new Error(`追问答案数量不匹配 (${answers.length}/${question.followups.length})`)
      return { index, code: result.code_example, answers }
      } catch (error) {
        console.error(`[recording] 第 ${index + 1} 题失败：${error instanceof Error ? error.message : String(error)}`)
        return null
      }
    })
    for (const result of results) {
      if (!result) continue
      const question = report.questions[result.index]
      const block = codeBlock(result.code)
      if (block) question.reference_answer = `${String(question.reference_answer).trim()}\n\n### 可运行代码示例\n\n${block}`
      question.followups = question.followups.map((item, i) => followupText(item, result.answers[i]))
      question.enrichment_version = 1
      changed = true
      console.log(`[recording] ${row.title} 第 ${result.index + 1}/${report.questions.length} 题`)
    }
    if (changed) db.prepare("UPDATE recording SET report_json=?,updated_at=datetime('now') WHERE id=?").run(JSON.stringify(report), row.id)
  }
}

async function enrichCoding() {
  const rows = db.prepare(`SELECT a.id,a.language,a.thought,a.code,a.review_json,p.title,p.statement,p.constraints
    FROM coding_attempt a JOIN coding_strategy_problem sp ON sp.id=a.strategy_problem_id
    JOIN coding_problem p ON p.id=sp.problem_id WHERE a.review_json IS NOT NULL ORDER BY a.rowid`).all()
  let done = 0
  await mapLimit(rows, 3, async row => {
    const review = json(row.review_json, null)
    if (!review || review.enrichment_version === 1) return
    try {
    const prompt = `下面是已有的算法题复盘。只重写参考实现，并补充追问回答；不要改写评分、结论、思路点评、代码点评、复杂度或薄弱点。
只输出 JSON：{"corrected_solution":"完整可运行代码（不含 Markdown 围栏）","followup_answers":["与输入 advanced_followups 等长、顺序一致的建议回答"]}
要求：
- 使用用户作答语言：${row.language}；包含必要 import/类和输入输出，代码必须完整可运行，不要只给伪代码；若题目不适合完整实现，给最小可运行片段并注释。
- followup_answers 每项 2-4 句中文答法，与 advanced_followups 一一对应，不要改写追问。
题目：${row.title}
题面：${row.statement}
约束：${row.constraints}
用户代码：${row.code}
现有复盘：${JSON.stringify({ summary: review.summary, thought_feedback: review.thought_feedback, code_feedback: review.code_feedback, complexity: review.complexity, better_approaches: review.better_approaches, advanced_followups: review.advanced_followups, missed_concepts: review.missed_concepts, corrected_solution: review.corrected_solution })}`
    const result = await requestJson(prompt, 12000)
    const code = cleanCode(result.corrected_solution)
    if (!code) throw new Error('参考实现为空')
    const answers = Array.isArray(result.followup_answers) ? result.followup_answers : []
    if (answers.length !== (review.advanced_followups?.length || 0)) throw new Error(`追问答案数量不匹配 (${answers.length}/${review.advanced_followups?.length || 0})`)
    review.corrected_solution = code
    review.advanced_followups = review.advanced_followups.map((item, i) => followupText(item, answers[i]))
    review.enrichment_version = 1
    db.prepare("UPDATE coding_attempt SET review_json=?,updated_at=datetime('now') WHERE id=?").run(JSON.stringify(review), row.id)
    done++
    console.log(`[coding] ${done}/${rows.length} ${row.title}`)
    } catch (error) {
      console.error(`[coding] 失败：${row.title}：${error instanceof Error ? error.message : String(error)}`)
    }
  })
}

async function enrichPractice() {
  const rows = db.prepare("SELECT id,question,snapshot_json FROM practice_item WHERE snapshot_json IS NOT NULL").all()
  let done = 0
  await mapLimit(rows, 2, async row => {
    const snapshot = json(row.snapshot_json, null)
    if (!snapshot || snapshot.enrichment_version === 1) return
    try {
    const prompt = `下面是已有的专项练习题目和参考答案。只做增量补充，不要改写原题、原回答、参考答案事实或来源编号。
只输出 JSON：{"code_example":"Markdown 代码块；不适用则为空字符串","followup":{"question":"1 个面试官可能的追问","answer":"2-4 句可直接说出口的建议回答"}}
要求：只有题目有可实现核心时才给完整可运行代码；追问要具体。
题目：${row.question}
参考答案：${snapshot.reference_answer}`
    const result = await requestJson(prompt, 12000)
    const extra = appendFollowupGuide(result.code_example, result.followup?.question ? [result.followup] : [])
    if (!extra) return
    snapshot.reference_answer = `${String(snapshot.reference_answer).trim()}\n\n${extra}`
    snapshot.enrichment_version = 1
    db.prepare("UPDATE practice_item SET snapshot_json=?,updated_at=datetime('now') WHERE id=?").run(JSON.stringify(snapshot), row.id)
    done++
    console.log(`[practice] ${done}/${rows.length} ${row.question.slice(0, 50)}`)
    } catch (error) {
      console.error(`[practice] 失败：${error instanceof Error ? error.message : String(error)}`)
    }
  })
}

const only = new Set((process.env.MYBOOK_ENRICH_ONLY || 'cards,recording,coding,practice').split(',').map(item => item.trim()))
console.log(`[enrich] db=${dbPath} model=${model} tasks=${[...only].join(',')}`)
const started = Date.now()
if (only.has('cards')) await enrichCards()
if (only.has('recording')) await enrichRecording()
if (only.has('coding')) await enrichCoding()
if (only.has('practice')) await enrichPractice()
console.log(`[enrich] done in ${Math.round((Date.now() - started) / 1000)}s`)
db.close()
