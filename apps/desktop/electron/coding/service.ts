import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type {
  CodingAttempt, CodingAttemptInput, CodingProblem, CodingProblemStatus, CodingResearchItem,
  CodingStrategy, CodingStrategyInput, CodingStrategyProblem, CodingStrategyStatus, CodingStrategySummary,
  CodingSyncRecord, CodingSyncResult,
} from '../../src/types/coding.js'
import { CODING_SOURCES, BUILTIN_PROBLEMS, searchCodingResearch, skillTerms } from './research.js'
import { reviewCodingAttempt } from './review.js'

const DEFAULT_SOURCES = CODING_SOURCES.map(source => source.id)
const DIFFICULTY_ORDER: Record<string, number> = { easy: 0, medium: 1, hard: 2, unknown: 1 }
const PHASES = ['foundation', 'pattern', 'company', 'stretch'] as const
type Row = Record<string, any>

function json<T>(value: unknown, fallback: T): T {
  try { const parsed = JSON.parse(String(value ?? '')); return parsed as T } catch { return fallback }
}
function asText(value: unknown): string { return typeof value === 'string' ? value : value == null ? '' : String(value) }
function uniqueStrings(value: unknown, max = 30): string[] {
  const values = Array.isArray(value) ? value : []
  return [...new Set(values.map(asText).map(item => item.trim()).filter(Boolean))].slice(0, max)
}
function dateAfter(days: number): string { return new Date(Date.now() + days * 86400000).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '') }

function problemFromRow(row: Row): CodingProblem {
  return { ...row, tags: json(row.tags_json, []), knowledge: json(row.knowledge_json, []), examples: json(row.examples_json, []), metadata: json(row.metadata_json, {}) } as unknown as CodingProblem
}
function attemptFromRow(row: Row): CodingAttempt {
  return { ...row, review: row.review_json ? json(row.review_json, null) : null } as CodingAttempt
}
function syncFromRow(row: Row): CodingSyncRecord {
  return { ...row, metadata: json(row.metadata_json, {}) } as CodingSyncRecord
}

function problemStatus(status: string): CodingProblemStatus {
  return (['planned', 'learning', 'attempted', 'mastered', 'skipped'] as const).includes(status as CodingProblemStatus) ? status as CodingProblemStatus : 'planned'
}
function phase(value: string): CodingStrategyProblem['phase'] {
  return (PHASES as readonly string[]).includes(value) ? value as CodingStrategyProblem['phase'] : 'pattern'
}

export function createCodingService(db: Database.Database) {
  const busyAttempts = new Set<string>()
  const joinedColumns = `sp.id AS strategy_problem_id, sp.strategy_id, sp.problem_id, sp.sort_order, sp.phase, sp.reason,
    sp.prerequisites_json, sp.status, sp.due_at, sp.last_attempted_at, sp.created_at AS strategy_created_at,
    sp.updated_at AS strategy_updated_at, p.id, p.canonical_key, p.source, p.source_id, p.source_url, p.title,
    p.difficulty, p.tags_json, p.knowledge_json, p.statement, p.constraints, p.examples_json, p.metadata_json,
    p.created_at, p.updated_at`

  function rowStrategy(id: string): Row {
    const row = db.prepare('SELECT * FROM coding_strategy WHERE id=?').get(id) as Row | undefined
    if (!row) throw new Error('刷题策略不存在')
    return row
  }
  function rowStrategyProblem(id: string): Row {
    const row = db.prepare('SELECT * FROM coding_strategy_problem WHERE id=?').get(id) as Row | undefined
    if (!row) throw new Error('策略中的题目不存在')
    return row
  }
  function mapSummary(row: Row): CodingStrategySummary {
    const next = db.prepare(`SELECT ${joinedColumns} FROM coding_strategy_problem sp JOIN coding_problem p ON p.id=sp.problem_id
      WHERE sp.strategy_id=? AND sp.status IN ('planned','learning','attempted') ORDER BY sp.sort_order LIMIT 1`).get(row.id) as Row | undefined
    return {
      id: row.id, target_role_id: row.target_role_id || null, title: row.title, company: row.company, department: row.department,
      role: row.role, jd: row.jd, tags: json(row.tags_json, []), sources: json(row.sources_json, DEFAULT_SOURCES), status: row.status,
      research: json(row.research_json, []), research_error: row.research_error || null, last_researched_at: row.last_researched_at || null,
      last_synced_at: row.last_synced_at || null, sync: json(row.sync_json, {}), sync_error: row.sync_error || null,
      problem_count: Number((db.prepare('SELECT COUNT(*) AS n FROM coding_strategy_problem WHERE strategy_id=?').get(row.id) as { n: number } | undefined)?.n || 0),
      completed_count: Number((db.prepare("SELECT COUNT(*) AS n FROM coding_strategy_problem WHERE strategy_id=? AND status='mastered'").get(row.id) as { n: number } | undefined)?.n || 0),
      reviewed_count: Number((db.prepare('SELECT COUNT(DISTINCT a.id) AS n FROM coding_attempt a JOIN coding_strategy_problem sp ON sp.id=a.strategy_problem_id WHERE sp.strategy_id=? AND a.status=\'reviewed\'').get(row.id) as { n: number } | undefined)?.n || 0),
      next_problem: next ? mapStrategyProblem(next, false) : null,
      created_at: row.created_at, updated_at: row.updated_at,
    }
  }
  function mapStrategyProblem(row: Row, withAttempts = true): CodingStrategyProblem {
    const problem = problemFromRow(row)
    const strategyProblemId = row.strategy_problem_id || row.id
    const attempts = withAttempts ? (db.prepare('SELECT * FROM coding_attempt WHERE strategy_problem_id=? ORDER BY created_at').all(strategyProblemId) as Row[]).map(attemptFromRow) : []
    const sync = (db.prepare('SELECT * FROM coding_sync_record WHERE strategy_problem_id=? ORDER BY synced_at DESC').all(strategyProblemId) as Row[]).map(syncFromRow)
    return {
      id: row.strategy_problem_id || row.id, strategy_id: row.strategy_id, problem_id: row.problem_id, sort_order: Number(row.sort_order), phase: phase(row.phase),
      reason: row.reason, prerequisites: json(row.prerequisites_json, []), status: problemStatus(row.status), due_at: row.due_at || null,
      last_attempted_at: row.last_attempted_at || null, problem, attempts, sync, created_at: row.strategy_created_at || row.created_at, updated_at: row.strategy_updated_at || row.updated_at,
    }
  }
  function getStrategy(id: string): CodingStrategy {
    const row = rowStrategy(id)
    const problems = (db.prepare(`SELECT ${joinedColumns} FROM coding_strategy_problem sp JOIN coding_problem p ON p.id=sp.problem_id
      WHERE sp.strategy_id=? ORDER BY sp.sort_order, sp.created_at`).all(id) as Row[]).map(item => mapStrategyProblem(item))
    return { ...mapSummary(row), problems }
  }
  function getAttempt(id: string): CodingAttempt {
    const row = db.prepare('SELECT * FROM coding_attempt WHERE id=?').get(id) as Row | undefined
    if (!row) throw new Error('作答记录不存在')
    return attemptFromRow(row)
  }

  function validateInput(input: CodingStrategyInput): Required<Omit<CodingStrategyInput, 'target_role_id'>> & Pick<CodingStrategyInput, 'target_role_id'> {
    const company = asText(input.company).trim(); const role = asText(input.role).trim()
    if (!company) throw new Error('请填写目标企业')
    if (!role) throw new Error('请填写目标岗位')
    if (company.length > 120 || role.length > 200) throw new Error('企业或岗位名称过长')
    const department = asText(input.department).trim().slice(0, 200)
    const jd = asText(input.jd).trim().slice(0, 18000)
    const title = asText(input.title).trim().slice(0, 160) || `${company} · ${role} 刷题策略`
    const tags = uniqueStrings(input.tags, 12).map(tag => tag.slice(0, 30))
    const sources = uniqueStrings(input.sources?.length ? input.sources : DEFAULT_SOURCES, 12).filter((source): source is typeof DEFAULT_SOURCES[number] => DEFAULT_SOURCES.includes(source as typeof DEFAULT_SOURCES[number]))
    return { title, company, department, role, jd, tags, sources: sources.length ? sources : DEFAULT_SOURCES, target_role_id: input.target_role_id || null }
  }

  function ensureTargetRole(input: ReturnType<typeof validateInput>): string | null {
    if (input.target_role_id) {
      if (!db.prepare('SELECT id FROM target_role WHERE id=?').get(input.target_role_id)) throw new Error('关联的目标岗位不存在')
      return input.target_role_id
    }
    const existing = db.prepare('SELECT id FROM target_role WHERE company=? AND department=? AND role=? AND jd=?').get(input.company, input.department, input.role, input.jd) as { id: string } | undefined
    if (existing) return existing.id
    const id = randomUUID()
    db.prepare('INSERT INTO target_role(id,company,department,role,jd) VALUES(?,?,?,?,?)').run(id, input.company, input.department, input.role, input.jd)
    return id
  }

  function listStrategies(): CodingStrategySummary[] {
    return (db.prepare("SELECT * FROM coding_strategy WHERE status != 'archived' ORDER BY updated_at DESC, created_at DESC").all() as Row[]).map(mapSummary)
  }

  function createStrategy(raw: CodingStrategyInput): CodingStrategy {
    const input = validateInput(raw)
    const id = randomUUID()
    db.transaction(() => {
      const target = ensureTargetRole(input)
      db.prepare(`INSERT INTO coding_strategy(id,target_role_id,title,company,department,role,jd,tags_json,sources_json)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(id, target, input.title, input.company, input.department, input.role, input.jd, JSON.stringify(input.tags), JSON.stringify(input.sources))
    })()
    return getStrategy(id)
  }

  function updateStrategy(id: string, raw: Partial<CodingStrategyInput> & { status?: CodingStrategyStatus }): CodingStrategy {
    const current = rowStrategy(id)
    const input = validateInput({
      title: raw.title ?? current.title, company: raw.company ?? current.company, department: raw.department ?? current.department,
      role: raw.role ?? current.role, jd: raw.jd ?? current.jd, tags: raw.tags ?? json(current.tags_json, []), sources: raw.sources ?? json(current.sources_json, []),
      target_role_id: raw.target_role_id === undefined ? current.target_role_id : raw.target_role_id,
    })
    const statuses = ['draft', 'active', 'completed', 'archived']
    const status = raw.status && statuses.includes(raw.status) ? raw.status : current.status
    db.prepare(`UPDATE coding_strategy SET target_role_id=?,title=?,company=?,department=?,role=?,jd=?,tags_json=?,sources_json=?,status=?,updated_at=datetime('now') WHERE id=?`)
      .run(input.target_role_id || null, input.title, input.company, input.department, input.role, input.jd, JSON.stringify(input.tags), JSON.stringify(input.sources), status, id)
    return getStrategy(id)
  }
  function deleteStrategy(id: string): void { rowStrategy(id); db.prepare('DELETE FROM coding_strategy WHERE id=?').run(id) }

  async function search(id: string): Promise<CodingStrategy> {
    const row = rowStrategy(id)
    try {
      const results = await searchCodingResearch({ company: row.company, department: row.department, role: row.role, jd: row.jd, sources: json(row.sources_json, DEFAULT_SOURCES) })
      const insertProblem = db.prepare(`INSERT OR IGNORE INTO coding_problem(id,canonical_key,source,source_id,source_url,title,difficulty,tags_json,knowledge_json,statement,metadata_json)
        VALUES(?,?,?,?,?,'', 'unknown','[]','[]',?,'{}')`)
      // Only direct LeetCode problem paths become catalogue entries. Articles and forum pages stay research leads.
      for (const item of results) {
        const match = (() => { try { return new URL(item.url).pathname.match(/\/problems\/([a-z0-9-]+)\/?$/i) } catch { return null } })()
        if (!match) continue
        const slug = match[1].toLowerCase()
        insertProblem.run(randomUUID(), `leetcode:${slug}`, item.source, slug, item.url, item.snippet.slice(0, 1800))
        db.prepare('UPDATE coding_problem SET title=CASE WHEN title=\'\' THEN ? ELSE title END,metadata_json=? WHERE canonical_key=?')
          .run(item.title || slug, JSON.stringify({ research_url: item.url, warning: item.warning }), `leetcode:${slug}`)
      }
      db.prepare("UPDATE coding_strategy SET research_json=?,research_error=NULL,last_researched_at=datetime('now'),updated_at=datetime('now') WHERE id=?").run(JSON.stringify(results), id)
    } catch (error) {
      db.prepare("UPDATE coding_strategy SET research_error=?,updated_at=datetime('now') WHERE id=?").run(String(error instanceof Error ? error.message : error).slice(0, 2000), id)
    }
    return getStrategy(id)
  }

  function ensureBuiltinProblems(): void {
    const insert = db.prepare(`INSERT INTO coding_problem(id,canonical_key,source,source_id,source_url,title,difficulty,tags_json,knowledge_json,statement)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(canonical_key) DO UPDATE SET source_url=excluded.source_url,title=excluded.title,difficulty=excluded.difficulty,tags_json=excluded.tags_json,knowledge_json=excluded.knowledge_json,statement=excluded.statement,updated_at=datetime('now')`)
    const tx = db.transaction(() => { for (const problem of BUILTIN_PROBLEMS) insert.run(randomUUID(), problem.canonical_key, problem.source, problem.source_id, problem.source_url, problem.title, problem.difficulty, JSON.stringify(problem.tags), JSON.stringify(problem.knowledge), problem.statement) })
    tx()
  }

  function plan(id: string): CodingStrategy {
    const row = rowStrategy(id)
    ensureBuiltinProblems()
    const terms = skillTerms(row.jd).map(term => term.toLowerCase())
    const problems = db.prepare('SELECT * FROM coding_problem ORDER BY rowid').all() as Row[]
    const scored = problems.map(problem => {
      const tags = json<string[]>(problem.tags_json, [])
      const knowledge = json<string[]>(problem.knowledge_json, [])
      const matches = [...tags, ...knowledge].filter(tag => terms.some(term => tag.toLowerCase().includes(term) || term.includes(tag.toLowerCase())))
      const difficulty = DIFFICULTY_ORDER[problem.difficulty] ?? 1
      const phaseName = difficulty === 0 ? 'foundation' : difficulty === 1 ? 'pattern' : 'stretch'
      const sourceResults = json<CodingResearchItem[]>(row.research_json, [])
      const sourceMatch = sourceResults.some(item => item.url.includes(problem.source_url.split('/problems/')[1]?.split('/')[0] || '__none__'))
      const reason = matches.length ? `覆盖岗位关键词：${[...new Set(matches)].slice(0, 3).join('、')}；先掌握该模式再进入更复杂变体。` : `${phaseName === 'foundation' ? '先建立基础模式' : phaseName === 'pattern' ? '练习高频解题模式' : '作为进阶挑战'}；题源仅作公开参考。`
      return { problem, matches, difficulty, phase: sourceMatch ? 'company' : phaseName, reason, sourceMatch }
    }).sort((a, b) => Number(b.sourceMatch) - Number(a.sourceMatch) || b.matches.length - a.matches.length || a.difficulty - b.difficulty || String(a.problem.title).localeCompare(String(b.problem.title), 'zh-CN'))
    const upsert = db.prepare(`INSERT INTO coding_strategy_problem(id,strategy_id,problem_id,sort_order,phase,reason,prerequisites_json,due_at)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(strategy_id,problem_id) DO UPDATE SET sort_order=excluded.sort_order,phase=excluded.phase,reason=excluded.reason,prerequisites_json=excluded.prerequisites_json,updated_at=datetime('now')`)
    db.transaction(() => {
      scored.forEach((item, index) => {
        const prerequisites = item.difficulty === 0 ? [] : scored.slice(0, index).filter(prev => prev.difficulty < item.difficulty && prev.problem.tags_json).slice(-3).map(prev => prev.problem.title)
        upsert.run(randomUUID(), id, item.problem.id, index + 1, item.phase, item.reason, JSON.stringify(prerequisites), dateAfter(Math.min(index, 14)))
      })
      db.prepare("UPDATE coding_strategy SET status=CASE WHEN status='draft' THEN 'active' ELSE status END,updated_at=datetime('now') WHERE id=?").run(id)
    })()
    return getStrategy(id)
  }

  function updateProblemStatus(id: string, status: CodingProblemStatus): CodingStrategyProblem {
    rowStrategyProblem(id)
    if (!['planned', 'learning', 'attempted', 'mastered', 'skipped'].includes(status)) throw new Error('无效的题目状态')
    db.prepare("UPDATE coding_strategy_problem SET status=?,updated_at=datetime('now') WHERE id=?").run(status, id)
    const row = db.prepare(`SELECT ${joinedColumns} FROM coding_strategy_problem sp JOIN coding_problem p ON p.id=sp.problem_id WHERE sp.id=?`).get(id) as Row
    return mapStrategyProblem(row)
  }

  function saveAttempt(raw: CodingAttemptInput): CodingAttempt {
    const strategyProblem = rowStrategyProblem(asText(raw.strategy_problem_id))
    const language = asText(raw.language).trim().slice(0, 40) || 'text'
    const thought = asText(raw.thought).trim().slice(0, 16000)
    const code = asText(raw.code).trim().slice(0, 30000)
    if (!thought && !code) throw new Error('请先填写解题思路或代码')
    const id = randomUUID()
    db.transaction(() => {
      db.prepare(`INSERT INTO coding_attempt(id,strategy_problem_id,language,thought,code,time_complexity,space_complexity,notes,status)
        VALUES(?,?,?,?,?,?,?,?, 'draft')`).run(id, strategyProblem.id, language, thought, code, asText(raw.time_complexity).trim().slice(0, 300), asText(raw.space_complexity).trim().slice(0, 300), asText(raw.notes).trim().slice(0, 5000))
      db.prepare("UPDATE coding_strategy_problem SET status=CASE WHEN status IN ('planned','learning') THEN 'attempted' ELSE status END,last_attempted_at=datetime('now'),updated_at=datetime('now') WHERE id=?").run(strategyProblem.id)
    })()
    return getAttempt(id)
  }

  async function review(id: string): Promise<CodingAttempt> {
    if (busyAttempts.has(id)) throw new Error('本次作答正在点评，请稍候')
    const attempt = db.prepare('SELECT * FROM coding_attempt WHERE id=?').get(id) as Row | undefined
    if (!attempt) throw new Error('作答记录不存在')
    const relation = db.prepare(`SELECT ${joinedColumns} FROM coding_strategy_problem sp JOIN coding_problem p ON p.id=sp.problem_id WHERE sp.id=?`).get(attempt.strategy_problem_id) as Row | undefined
    if (!relation) throw new Error('策略题目已不存在')
    busyAttempts.add(id)
    db.prepare("UPDATE coding_attempt SET status='reviewing',error=NULL,updated_at=datetime('now') WHERE id=?").run(id)
    try {
      const result = await reviewCodingAttempt(db, {
        problem: { title: relation.title, statement: relation.statement, constraints: relation.constraints, difficulty: relation.difficulty, tags: json(relation.tags_json, []), source_url: relation.source_url },
        attempt: { language: attempt.language, thought: attempt.thought, code: attempt.code, time_complexity: attempt.time_complexity, space_complexity: attempt.space_complexity, notes: attempt.notes },
      })
      db.transaction(() => {
        db.prepare("UPDATE coding_attempt SET status='reviewed',review_json=?,model_name=?,error=NULL,updated_at=datetime('now') WHERE id=?").run(JSON.stringify(result.review), result.model_name, id)
        db.prepare("UPDATE coding_strategy_problem SET status=CASE WHEN status='attempted' THEN 'attempted' ELSE status END,updated_at=datetime('now') WHERE id=?").run(attempt.strategy_problem_id)
      })()
    } catch (error) {
      db.prepare("UPDATE coding_attempt SET status='error',error=?,updated_at=datetime('now') WHERE id=?").run(String(error instanceof Error ? error.message : error).slice(0, 2500), id)
      throw error
    } finally { busyAttempts.delete(id) }
    return getAttempt(id)
  }

  function auth(platform: 'leetcode' | 'nowcoder'): { token: string; username?: string } | null {
    const row = db.prepare('SELECT value_json FROM settings WHERE key=?').get(`platform_${platform}`) as { value_json: string } | undefined
    if (!row) return null
    try { const value = JSON.parse(row.value_json); return typeof value?.token === 'string' && value.token ? value : null } catch { return null }
  }
  function matchProblem(strategyId: string, title: string, slug?: string): Row | undefined {
    const candidates = db.prepare('SELECT sp.id AS strategy_problem_id, p.title, p.source_id FROM coding_strategy_problem sp JOIN coding_problem p ON p.id=sp.problem_id WHERE sp.strategy_id=?').all(strategyId) as Row[]
    const normalized = title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
    return candidates.find(row => (slug && row.source_id === slug) || row.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '') === normalized)
  }
  async function sync(id: string, platform: 'leetcode' | 'nowcoder'): Promise<CodingSyncResult> {
    const strategy = rowStrategy(id)
    const syncedAt = new Date().toISOString()
    const credentials = auth(platform)
    if (!credentials) return { strategy_id: id, platform, success: false, imported: 0, matched: 0, error: `尚未连接${platform === 'leetcode' ? '力扣' : '牛客'}，请先在设置中连接账号`, synced_at: syncedAt, records: [] }
    try {
      let records: Array<{ external_id: string; title: string; status: string; url: string; metadata: Record<string, unknown>; slug?: string }> = []
      let warning = ''
      if (platform === 'leetcode') {
        const response = await fetch('https://leetcode.cn/graphql/', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: credentials.token, Referer: 'https://leetcode.cn/' }, body: JSON.stringify({ query: `query($username:String!){ recentSubmissionList(username:$username,limit:100){ id title titleSlug statusDisplay timestamp } }`, variables: { username: credentials.username || '' } }), signal: AbortSignal.timeout(15000) })
        if (!response.ok) throw new Error(`力扣同步失败：HTTP ${response.status}`)
        const payload: any = await response.json(); if (payload.errors) throw new Error(`力扣同步失败：${payload.errors[0]?.message || 'GraphQL 错误'}`)
        records = (payload.data?.recentSubmissionList || []).map((item: any, index: number) => ({ external_id: String(item.id || `${item.titleSlug}-${item.timestamp || index}`), title: asText(item.title), status: asText(item.statusDisplay) || 'unknown', url: `https://leetcode.cn/problems/${item.titleSlug}/`, slug: asText(item.titleSlug), metadata: { timestamp: item.timestamp } }))
      } else {
        const response = await fetch('https://www.nowcoder.com/api/nk/user/ac-statistics', { headers: { Cookie: credentials.token, Referer: 'https://www.nowcoder.com/', 'User-Agent': 'Mybook/0.7' }, signal: AbortSignal.timeout(12000) })
        if (!response.ok) throw new Error(`牛客同步失败：HTTP ${response.status}`)
        const payload: any = await response.json(); if (payload.code !== 0) throw new Error(`牛客同步失败：${payload.msg || '接口返回错误'}`)
        records = [{ external_id: `stats-${new Date().toISOString().slice(0, 10)}`, title: '牛客刷题统计', status: '统计已同步', url: 'https://www.nowcoder.com/profile', metadata: payload.data || {} }]
        warning = '牛客公开接口目前只返回统计快照，完整历史题目仍需在牛客导出后导入；没有伪造题目级记录。'
      }
      const upsert = db.prepare(`INSERT INTO coding_sync_record(id,strategy_id,strategy_problem_id,platform,external_id,external_title,external_status,external_url,metadata_json,synced_at)
        VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(strategy_id,platform,external_id) DO UPDATE SET strategy_problem_id=excluded.strategy_problem_id,external_title=excluded.external_title,external_status=excluded.external_status,external_url=excluded.external_url,metadata_json=excluded.metadata_json,synced_at=excluded.synced_at`)
      const matchedCount = records.filter(item => Boolean(matchProblem(id, item.title, item.slug))).length
      db.transaction(() => {
        for (const item of records) {
          const match = matchProblem(id, item.title, item.slug)
          upsert.run(randomUUID(), id, match?.strategy_problem_id || null, platform, item.external_id, item.title, item.status, item.url, JSON.stringify(item.metadata), syncedAt)
        }
        db.prepare("UPDATE coding_strategy SET last_synced_at=?,sync_error=NULL,sync_json=?,updated_at=datetime('now') WHERE id=?").run(syncedAt, JSON.stringify({ [platform]: { imported: records.length, matched: matchedCount, warning } }), id)
      })()
      const saved = (db.prepare('SELECT * FROM coding_sync_record WHERE strategy_id=? AND platform=? ORDER BY synced_at DESC').all(id, platform) as Row[]).map(syncFromRow)
      const platformWarning = platform === 'leetcode' ? '力扣接口返回的是近期提交快照，未覆盖账号的全部历史；本地作答和 AI 复盘不会被覆盖。' : warning
      return { strategy_id: id, platform, success: true, imported: records.length, matched: matchedCount, username: credentials.username, warning: platformWarning || undefined, synced_at: syncedAt, records: saved }
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error).slice(0, 2000)
      db.prepare("UPDATE coding_strategy SET sync_error=?,updated_at=datetime('now') WHERE id=?").run(message, id)
      return { strategy_id: id, platform, success: false, imported: 0, matched: 0, username: credentials.username, error: message, synced_at: syncedAt, records: [] }
    }
  }

  function canOpenSource(id: string, url: string): boolean {
    const strategy = rowStrategy(id)
    const research = json<CodingResearchItem[]>(strategy.research_json, [])
    const problem = db.prepare(`SELECT p.source_url FROM coding_strategy_problem sp JOIN coding_problem p ON p.id=sp.problem_id WHERE sp.strategy_id=? AND p.source_url=?`).get(id, url)
    return Boolean(research.some(item => item.url === url) || problem)
  }

  return { listStrategies, getStrategy, createStrategy, updateStrategy, deleteStrategy, search, plan, updateProblemStatus, saveAttempt, review, sync, canOpenSource, getAttempt }
}

export type CodingService = ReturnType<typeof createCodingService>
