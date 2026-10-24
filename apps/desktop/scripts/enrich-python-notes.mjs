#!/usr/bin/env node
/**
 * One-off maintenance job: add Python syntax/engineering explanations next to
 * already generated Python examples. Idempotent per item. The API key is read
 * from the local database and never logged.
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

async function requestNotes(prompt) {
  let lastError
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
        body: JSON.stringify({
          model, temperature: 0.2, max_tokens: 12000, response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: '你是严谨的中文 Python 工程教练。只输出一个完整 JSON 对象，不要输出解释、Markdown 围栏或额外文字。' },
            { role: 'user', content: prompt },
          ],
        }),
        signal: AbortSignal.timeout(180000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      const text = String(data.choices?.[0]?.message?.content || '').trim()
      const start = text.indexOf('{'), end = text.lastIndexOf('}')
      if (start < 0 || end <= start) throw new Error(`JSON 缺失（finish=${data.choices?.[0]?.finish_reason || '?'}）`)
      const parsed = JSON.parse(text.slice(start, end + 1))
      if (!parsed.python_notes || typeof parsed.python_notes !== 'string') throw new Error('python_notes 为空')
      return parsed.python_notes.trim()
    } catch (error) {
      lastError = error
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 1500 * attempt))
    }
  }
  throw lastError
}

function hasNotes(text) { return String(text || '').includes('### Python 语法讲解') }
function contextPrompt(kind, title, question, code, language = 'Python') {
  return `你是中文 Python 工程教练。读者会刷题，但不熟 Python 工程。请为下面这段已经给出的代码补一份讲解。
只输出 JSON：{"python_notes":"Markdown 格式的 Python 语法与工程讲解"}
要求：
- 只讲代码中真实出现的语法、标准库和写法，先列 4–8 个关键点；例如 heapq、Counter、defaultdict、typing、list comprehension、with、生成器、异常、if __name__ 等于 “__main__”、输入解析、class/__init__、sorted key、切片、可变默认参数。
- 每个关键点说明：在代码里的作用、为什么这样写、和 Java/刷题写法的对照（可选）、常见坑或工程建议。
- 再给一段“从刷题代码走向工程代码”：类型标注、边界测试、异常/日志、模块化、复杂度；要具体到本题，不要空泛。
- 不要改写原代码，不要编造未出现的库或语法；代码片段用 Markdown 代码围栏。
- 参考代码语言：${language}。${language === 'Python' ? '逐个解释 Python 写法。' : '先用一小段 Python 等价实现对照，再解释 Python 语法。'}
类型：${kind}
标题/题目：${title}
${question ? `上下文：${question}\n` : ''}代码：
${code}`
}

async function enrichCards() {
  const rows = db.prepare('SELECT id,title,brief_answer,detail_answer FROM card ORDER BY rowid').all()
  let done = 0
  for (const row of rows) {
    if (!String(row.detail_answer).includes('```python') || hasNotes(row.detail_answer)) continue
    try {
      const notes = await requestNotes(contextPrompt('知识卡片', row.title, row.brief_answer, row.detail_answer))
      db.prepare("UPDATE card SET detail_answer=?,updated_at=datetime('now') WHERE id=?").run(
        `${row.detail_answer}\n\n### Python 语法讲解\n\n${notes}`, row.id)
      done++
      console.log(`[cards] ${done} ${row.title}`)
    } catch (error) { console.error(`[cards] 失败：${row.title}：${error instanceof Error ? error.message : String(error)}`) }
  }
}

async function enrichRecording() {
  const rows = db.prepare('SELECT id,title,report_json FROM recording WHERE report_json IS NOT NULL').all()
  for (const row of rows) {
    const report = json(row.report_json, null)
    if (!report?.questions?.length) continue
    let changed = false
    for (let index = 0; index < report.questions.length; index++) {
      const question = report.questions[index]
      if (!String(question.reference_answer).includes('```python') || hasNotes(question.reference_answer)) continue
      try {
        const notes = await requestNotes(contextPrompt('面试复盘', question.question, question.answer, question.reference_answer))
        question.reference_answer = `${String(question.reference_answer).trim()}\n\n### Python 语法讲解\n\n${notes}`
        changed = true
        console.log(`[recording] ${row.title} 第 ${index + 1}/${report.questions.length} 题`)
      } catch (error) { console.error(`[recording] 第 ${index + 1} 题失败：${error instanceof Error ? error.message : String(error)}`) }
    }
    if (changed) db.prepare("UPDATE recording SET report_json=?,updated_at=datetime('now') WHERE id=?").run(JSON.stringify(report), row.id)
  }
}

async function enrichCoding() {
  const rows = db.prepare(`SELECT a.id,a.language,a.thought,a.code,a.review_json,p.title,p.statement,p.constraints
    FROM coding_attempt a JOIN coding_strategy_problem sp ON sp.id=a.strategy_problem_id
    JOIN coding_problem p ON p.id=sp.problem_id WHERE a.review_json IS NOT NULL ORDER BY a.rowid`).all()
  let done = 0
  for (const row of rows) {
    const review = json(row.review_json, null)
    if (!review || String(review.python_notes || '').trim()) continue
    try {
      const notes = await requestNotes(contextPrompt('刷题复盘', row.title,
        `题面：${row.statement}\n约束：${row.constraints}\n用户思路：${row.thought}\n用户代码：${row.code}`,
        review.corrected_solution || row.code, row.language || 'Python'))
      review.python_notes = notes
      db.prepare("UPDATE coding_attempt SET review_json=?,updated_at=datetime('now') WHERE id=?").run(JSON.stringify(review), row.id)
      done++
      console.log(`[coding] ${done}/${rows.length} ${row.title} (${row.language})`)
    } catch (error) { console.error(`[coding] 失败：${row.title}：${error instanceof Error ? error.message : String(error)}`) }
  }
}

async function enrichPractice() {
  const rows = db.prepare('SELECT id,question,snapshot_json FROM practice_item WHERE snapshot_json IS NOT NULL').all()
  let done = 0
  for (const row of rows) {
    const snapshot = json(row.snapshot_json, null)
    if (!snapshot || !String(snapshot.reference_answer).includes('```python') || hasNotes(snapshot.reference_answer)) continue
    try {
      const notes = await requestNotes(contextPrompt('专项练习', row.question, snapshot.original_answer, snapshot.reference_answer))
      snapshot.reference_answer = `${String(snapshot.reference_answer).trim()}\n\n### Python 语法讲解\n\n${notes}`
      db.prepare("UPDATE practice_item SET snapshot_json=?,updated_at=datetime('now') WHERE id=?").run(JSON.stringify(snapshot), row.id)
      done++
      console.log(`[practice] ${done} ${row.question.slice(0, 50)}`)
    } catch (error) { console.error(`[practice] 失败：${error instanceof Error ? error.message : String(error)}`) }
  }
}

const only = new Set((process.env.MYBOOK_PYTHON_ONLY || 'cards,recording,coding,practice').split(',').map(item => item.trim()))
console.log(`[python-notes] db=${dbPath} model=${model} tasks=${[...only].join(',')}`)
const started = Date.now()
if (only.has('cards')) await enrichCards()
if (only.has('recording')) await enrichRecording()
if (only.has('coding')) await enrichCoding()
if (only.has('practice')) await enrichPractice()
console.log(`[python-notes] done in ${Math.round((Date.now() - started) / 1000)}s`)
db.close()
