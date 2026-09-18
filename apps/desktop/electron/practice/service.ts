import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import type { PracticeAttempt, PracticeCitation, PracticeItem, PracticeRequirement, PracticeSnapshot, PracticeSourceType, PracticeStatus, PracticeSummary } from '../../src/types/practice.js'
import { PRACTICE_REVIEW_VERSION, reviewPractice } from './review.js'
import { historicalCitationText } from '../ai/knowledge.js'

const identifier = z.string().trim().min(1).max(250)
const text = (value: unknown) => typeof value === 'string' ? value : ''
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
function json<T>(value: unknown, fallback: T): T {
  try { return typeof value === 'string' ? JSON.parse(value) : fallback } catch { return fallback }
}
function citations(value: unknown, includeProvenance = true): PracticeCitation[] {
  const rows = typeof value === 'string' ? json<unknown>(value, []) : value
  if (!Array.isArray(rows)) return []
  return rows.filter(row => row && typeof row.ref === 'string' && typeof row.title === 'string').map((row): PracticeCitation => ({
    ref: row.ref, title: row.title, ...(typeof row.id === 'string' ? { id: row.id } : {}),
    ...(typeof row.url === 'string' ? { url: row.url } : {}),
    ...(['source', 'global_document', 'recording', 'supplement'].includes(row.kind) ? { kind: row.kind as PracticeCitation['kind'] } : {}),
    ...(typeof row.excerpt === 'string' ? { excerpt: row.excerpt } : {}),
    ...(typeof row.content_hash === 'string' ? { content_hash: row.content_hash } : {}),
    ...(typeof row.retrieved_at === 'string' ? { retrieved_at: row.retrieved_at } : {}),
    ...(includeProvenance && Array.isArray(row.provenance) ? { provenance: citations(row.provenance, false) } : {}),
  }))
}
function points(value: string): string[] {
  return value.split(/(?:\r?\n)+|(?<=[。！？])\s*/u).map(part => part.trim().replace(/^\s*(?:[-*•]|\d+[.、)])\s*/, '')).filter(Boolean)
}
/** Freeze the source's explicit scope once; no network-generated rubric drift between attempts. */
export function freezeRequirements(snapshot: PracticeSnapshot): PracticeRequirement[] {
  let origin: PracticeRequirement['origin'] = 'source_gap'
  let values = snapshot.gaps.filter(value => value.trim())
  if (!values.length) { origin = 'source_knowledge'; values = points(snapshot.knowledge) }
  if (!values.length) { origin = 'source_reference'; values = points(snapshot.reference_answer) }
  if (!values.length) { origin = 'question'; values = ['直接回应题目，说明关键理由；涉及个人经历时只使用本人真实做过的事实，缺信息时明确说明。'] }
  return [...new Set(values)].slice(0, 8).map((value, index) => ({
    id: `r${index + 1}`, origin, source_quote: value,
    text: `${origin === 'source_gap' ? '补齐来源点评指出的不足' : origin === 'question' ? '作答要求' : '解释来源要点及其适用条件'}：${value.slice(0, 1000)}${value.length > 1000 ? '（要求节选，完整内容保存在来源快照）' : ''}`,
    unverified: true,
  }))
}

interface ItemRow {
  id: string; source_key: string; source_type: PracticeSourceType; source_id: string; source_label: string
  question: string; company: string; role: string; snapshot_json: string; requirements_json: string
  input_version: string; status: PracticeStatus; created_at: string; updated_at: string
}
type AttemptRow = Omit<PracticeAttempt, 'review'> & { review_json: string | null }
const summaryColumns = 'p.id,p.source_type,p.source_id,p.source_label,p.question,p.company,p.role,p.status,p.created_at,p.updated_at'
type Evaluator = typeof reviewPractice

export function createPracticeService(db: Database.Database, evaluate: Evaluator = reviewPractice) {
  const busy = new Set<string>()
  function row(id: string): ItemRow {
    const found = db.prepare('SELECT * FROM practice_item WHERE id=?').get(identifier.parse(id)) as ItemRow | undefined
    if (!found) throw new Error('专项练习不存在')
    return found
  }
  function assertIdle(id: string) { if (busy.has(id)) throw new Error('本题正在点评，请等待完成后再操作') }
  function list(): PracticeSummary[] {
    return db.prepare(`SELECT ${summaryColumns}, (SELECT COUNT(*) FROM practice_attempt a WHERE a.item_id=p.id) AS attempt_count
      FROM practice_item p ORDER BY p.rowid DESC`).all() as PracticeSummary[]
  }
  function get(id: string): PracticeItem {
    const item = row(id)
    const attempts = (db.prepare('SELECT * FROM practice_attempt WHERE item_id=? ORDER BY rowid ASC').all(item.id) as AttemptRow[])
      .map(({ review_json, ...attempt }) => ({ ...attempt, review: review_json ? json(review_json, null) : null }))
    const { snapshot_json, requirements_json, source_key: _key, ...summary } = item
    const locked = !attempts.length
    return { ...summary, attempt_count: attempts.length, attempts, reference_locked: locked,
      snapshot: locked ? null : json<PracticeSnapshot | null>(snapshot_json, null),
      requirements: locked ? [] : json<PracticeRequirement[]>(requirements_json, []) }
  }
  function add(sourceKey: string, snapshot: PracticeSnapshot): PracticeItem {
    const existing = db.prepare('SELECT id FROM practice_item WHERE source_key=?').get(sourceKey) as { id: string } | undefined
    if (existing) return get(existing.id)
    if (!snapshot.question.trim()) throw new Error('来源题目为空，无法加入专项练习')
    const requirements = freezeRequirements(snapshot)
    const version = digest({ snapshot, requirements, reviewer: PRACTICE_REVIEW_VERSION })
    const id = randomUUID()
    db.prepare(`INSERT INTO practice_item(id,source_key,source_type,source_id,source_label,question,company,role,snapshot_json,requirements_json,input_version)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, sourceKey, snapshot.source_type, snapshot.source_id, snapshot.source_label, snapshot.question,
      snapshot.company, snapshot.role, JSON.stringify(snapshot), JSON.stringify(requirements), version)
    return get(id)
  }
  const base = (source_type: PracticeSourceType, source_id: string, source_label: string): PracticeSnapshot => ({
    source_type, source_id, source_label, question: '', original_answer: '', reference_answer: '', knowledge: '', gaps: [], citations: [], question_citations: [],
    company: '', role: '', context: '', source_model: null, captured_at: new Date().toISOString(), source_text: '', evidence: [],
    notice: '来源与要求已冻结，仅选取最多 8 项来源要点；来源中的 AI 点评及参考答案待核实，不代表用户亲身经历。来源之后修改或删除不改变本题历史。',
  })
  function fromRecording(recordingId: string, questionIndex: number): PracticeItem {
    identifier.parse(recordingId); z.number().int().min(0).max(100000).parse(questionIndex)
    const source = db.prepare('SELECT * FROM recording WHERE id=?').get(recordingId) as Record<string, any> | undefined
    if (!source) throw new Error('录音不存在')
    const report = json<Record<string, any> | null>(source.report_json, null)
    const question = Array.isArray(report?.questions) ? report.questions[questionIndex] : null
    if (!question || !text(question.question).trim()) throw new Error('录音题目不存在，请先完成复盘并刷新')
    const snapshot = base('recording', recordingId, text(source.title))
    Object.assign(snapshot, { question: question.question, original_answer: text(question.answer), reference_answer: text(question.reference_answer),
      gaps: Array.isArray(question.gaps) ? question.gaps.filter((value: unknown) => typeof value === 'string') : [],
      company: text(source.company), role: text(source.role), context: text(source.jd), source_model: text(question.model) || null,
      citations: citations(question.citations), source_text: JSON.stringify(question) })
    const evidence = new Set(Array.isArray(question.evidence) ? question.evidence : [])
    const segments = json<unknown>(source.transcript_json, [])
    snapshot.evidence = Array.isArray(segments) ? segments.filter(segment => segment && evidence.has(segment.id))
      .map(segment => ({ id: segment.id, speaker: text(segment.speaker), start: segment.start, end: segment.end, text: text(segment.text) })) : []
    // The content suffix distinguishes a different question after re-analysis at the same index.
    return add(`recording:${recordingId}:${questionIndex}:${digest(snapshot.question)}`, snapshot)
  }
  function fromInterview(turnId: string): PracticeItem {
    identifier.parse(turnId)
    const turn = db.prepare('SELECT * FROM interview_turn WHERE id=?').get(turnId) as Record<string, any> | undefined
    if (!turn) throw new Error('模拟面试题目不存在')
    const session = db.prepare('SELECT * FROM interview_session WHERE id=?').get(turn.session_id) as Record<string, any> | undefined
    if (!session) throw new Error('模拟面试不存在')
    const snapshot = base('interview', turnId, text(session.title))
    const questionCitations = citations(turn.question_citations_json)
    const question = historicalCitationText(text(turn.question), questionCitations.map(({ ref, id, title, url }) => ({ ref, id: id || '', title, url })))
    Object.assign(snapshot, { question, question_citations: questionCitations, original_answer: text(turn.answer), reference_answer: text(turn.reference_answer),
      knowledge: text(turn.knowledge), company: text(session.company), role: text(session.role), context: text(session.jd),
      source_model: text(turn.model_name) || null, citations: citations(turn.citations_json),
      source_text: JSON.stringify({ question: turn.question, answer: turn.answer, feedback: turn.feedback, reference_answer: turn.reference_answer,
        knowledge: turn.knowledge, citations_json: turn.citations_json ?? '[]', question_citations_json: turn.question_citations_json ?? '[]' }) })
    return add(`interview:${turnId}`, snapshot)
  }
  function fromCard(cardId: string): PracticeItem {
    identifier.parse(cardId)
    const source = db.prepare('SELECT * FROM card WHERE id=?').get(cardId) as Record<string, any> | undefined
    if (!source) throw new Error('卡片不存在')
    const snapshot = base('card', cardId, text(source.title))
    const tags = json<Record<string, unknown>>(source.tags_json, {})
    Object.assign(snapshot, { question: text(source.title), reference_answer: text(source.detail_answer) || text(source.brief_answer),
      knowledge: text(source.brief_answer), source_model: text(tags?.generatedModel) || null, citations: citations(source.citations_json),
      source_text: JSON.stringify({ title: source.title, brief_answer: source.brief_answer, detail_answer: source.detail_answer,
        source_ids: source.source_ids, citations_json: source.citations_json ?? '[]' }) })
    if (!snapshot.citations.length) {
      const sourceIds = json<unknown>(source.source_ids, [])
      if (Array.isArray(sourceIds)) for (const id of [...new Set(sourceIds.filter((id): id is string => typeof id === 'string'))]) {
        const citation = db.prepare('SELECT * FROM source WHERE id=?').get(id) as { id: string; title: string; url: string | null; content_text?: string } | undefined
        if (citation) {
          const excerpt = text(citation.content_text).slice(0, 2400)
          snapshot.citations.push({ ref: `原始资料[${snapshot.citations.length + 1}]`, title: citation.title, id: citation.id, kind: 'source',
            ...(citation.url ? { url: citation.url } : {}), ...(excerpt ? { excerpt, content_hash: createHash('sha256').update(excerpt).digest('hex'), retrieved_at: snapshot.captured_at } : {}) })
        }
      }
      snapshot.notice += ' 旧卡片未保留引用编号映射，关联原始资料不代表参考答案中的同号来源。'
    }
    return add(`card:${cardId}`, snapshot)
  }
  async function evaluateAttempt(item: ItemRow, attemptId: string) {
    const attempt = db.prepare('SELECT * FROM practice_attempt WHERE id=?').get(attemptId) as AttemptRow
    try {
      if (attempt.input_version !== item.input_version) throw new Error('题目要求版本不一致，原回答已保留，请创建新的作答')
      const snapshot = json<PracticeSnapshot | null>(item.snapshot_json, null)
      const requirements = json<PracticeRequirement[]>(item.requirements_json, [])
      if (!snapshot || !requirements.length) throw new Error('来源快照或固定要求不可用，原回答已保留')
      const result = await evaluate(db, snapshot, requirements, attempt.answer)
      db.prepare("UPDATE practice_attempt SET status='ready',review_json=?,model_name=?,error=NULL,updated_at=datetime('now') WHERE id=?")
        .run(JSON.stringify(result.review), result.model_name, attemptId)
    } catch (error) {
      db.prepare("UPDATE practice_attempt SET status='error',error=?,updated_at=datetime('now') WHERE id=?")
        .run(String(error instanceof Error ? error.message : error).slice(0, 2500), attemptId)
    } finally { busy.delete(item.id) }
    return get(item.id)
  }
  async function attempt(itemId: string, value: unknown): Promise<PracticeItem> {
    const answer = z.string().trim().min(1, '请先独立填写回答').max(12000, '单次回答最多 12000 字').parse(value)
    const item = row(itemId); assertIdle(item.id)
    if (item.status === 'archived') throw new Error('请先将本题恢复为待练习')
    const attemptId = randomUUID()
    // This synchronous transaction commits the answer before any provider discovery or network await.
    db.transaction(() => {
      db.prepare("INSERT INTO practice_attempt(id,item_id,answer,input_version,status) VALUES (?,?,?,?,'evaluating')").run(attemptId, item.id, answer, item.input_version)
      db.prepare("UPDATE practice_item SET status='active',updated_at=datetime('now') WHERE id=?").run(item.id)
    })()
    busy.add(item.id)
    return evaluateAttempt(item, attemptId)
  }
  async function retry(attemptId: string): Promise<PracticeItem> {
    identifier.parse(attemptId)
    const saved = db.prepare('SELECT * FROM practice_attempt WHERE id=?').get(attemptId) as AttemptRow | undefined
    if (!saved) throw new Error('历史作答不存在')
    const item = row(saved.item_id); assertIdle(item.id)
    if (saved.status !== 'error') throw new Error('只有点评失败的作答需要重试；新答案请创建一次新的作答')
    if (item.status === 'archived') throw new Error('请先将本题恢复为待练习')
    db.prepare("UPDATE practice_attempt SET status='evaluating',error=NULL,updated_at=datetime('now') WHERE id=?").run(attemptId)
    busy.add(item.id)
    return evaluateAttempt(item, attemptId)
  }
  function setStatus(id: string, value: unknown): PracticeItem {
    const status = z.enum(['active', 'mastered', 'archived']).parse(value)
    const item = row(id); assertIdle(item.id)
    db.prepare("UPDATE practice_item SET status=?,updated_at=datetime('now') WHERE id=?").run(status, item.id)
    return get(item.id)
  }
  function remove(id: string) { const item = row(id); assertIdle(item.id); db.prepare('DELETE FROM practice_item WHERE id=?').run(item.id) }
  function recover() {
    db.prepare("UPDATE practice_attempt SET status='error',error='上次点评被中断，原回答已保存，可重试点评。',updated_at=datetime('now') WHERE status='evaluating'").run()
  }
  return { list, get, fromRecording, fromInterview, fromCard, attempt, retry, setStatus, delete: remove, recover }
}
