import initSqlJs, { type Database } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import type { Card, InterviewSession, InterviewTurn, Provider, QaMessage, QaSession, SyncPayload } from './types'

const DB_NAME = 'mybook-mobile'
const STORE = 'sqlite'
const DB_KEY = 'main'
const MOBILE_NOTEBOOK = 'mobile-sync'

let db: Database
let persistQueue: Promise<void> = Promise.resolve()
let saveTimer: ReturnType<typeof setTimeout> | null = null

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function loadBytes(): Promise<Uint8Array | null> {
  const store = await openStore()
  return new Promise((resolve, reject) => {
    const request = store.transaction(STORE, 'readonly').objectStore(STORE).get(DB_KEY)
    request.onsuccess = () => resolve(request.result instanceof Uint8Array ? request.result : null)
    request.onerror = () => reject(request.error)
  })
}

async function writeBytes(bytes: Uint8Array): Promise<void> {
  const store = await openStore()
  await new Promise<void>((resolve, reject) => {
    const request = store.transaction(STORE, 'readwrite').objectStore(STORE).put(bytes, DB_KEY)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

function schedulePersist() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    persistQueue = persistQueue.then(() => writeBytes(db.export())).catch(error => console.error('保存本地数据库失败', error))
  }, 250)
}

function run(sql: string, params: unknown[] = []) {
  db.run(sql, params as never[])
  schedulePersist()
}

function all<T>(sql: string, params: unknown[] = []): T[] {
  const statement = db.prepare(sql)
  try {
    statement.bind(params as never[])
    const rows: T[] = []
    while (statement.step()) rows.push(statement.getAsObject() as T)
    return rows
  } finally {
    statement.free()
  }
}

function text(value: unknown) { return typeof value === 'string' ? value : '' }
export function nowSql(): string { return new Date().toISOString().slice(0, 19).replace('T', ' ') }
function now() { return nowSql() }

export async function initDb() {
  if (db) return
  const SQL = await initSqlJs({ locateFile: () => wasmUrl })
  const stored = await loadBytes()
  db = stored ? new SQL.Database(stored) : new SQL.Database()
  db.run(`
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, brief_answer TEXT NOT NULL, detail_answer TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS qa_sessions (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS qa_messages (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
      citations_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS interview_sessions (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, company TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT '',
      jd TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS interview_turns (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL DEFAULT '',
      feedback TEXT NOT NULL DEFAULT '', score INTEGER, reference_answer TEXT NOT NULL DEFAULT '',
      knowledge TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);
  `)
  if (!stored) schedulePersist()
}

export function listCards(): Card[] {
  return all<Card>('SELECT * FROM cards ORDER BY updated_at DESC')
}

export function saveCard(card: Card) {
  run(`INSERT INTO cards(id,title,brief_answer,detail_answer,tags_json,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,brief_answer=excluded.brief_answer,
    detail_answer=excluded.detail_answer,tags_json=excluded.tags_json,updated_at=excluded.updated_at`,
    [card.id, card.title, card.brief_answer, card.detail_answer, card.tags_json, card.created_at, card.updated_at])
}

export function deleteCard(id: string) {
  run('DELETE FROM cards WHERE id=?', [id])
}

export function createQaSession(title = '手机问答'): QaSession {
  const time = now()
  const session: QaSession = { id: crypto.randomUUID(), title, created_at: time, updated_at: time }
  run('INSERT INTO qa_sessions(id,title,created_at,updated_at) VALUES(?,?,?,?)', [session.id, session.title, time, time])
  return session
}

export function listQaSessions(): QaSession[] {
  return all<QaSession>('SELECT * FROM qa_sessions ORDER BY updated_at DESC')
}

export function listQaMessages(sessionId: string): QaMessage[] {
  return all<QaMessage>('SELECT * FROM qa_messages WHERE session_id=? ORDER BY created_at,rowid', [sessionId])
}

export function appendQaMessage(message: QaMessage) {
  run('INSERT OR IGNORE INTO qa_messages(id,session_id,role,content,citations_json,created_at) VALUES(?,?,?,?,?,?)',
    [message.id, message.session_id, message.role, message.content, message.citations_json, message.created_at])
  run('UPDATE qa_sessions SET updated_at=? WHERE id=?', [message.created_at, message.session_id])
}

export function renameQaSession(id: string, title: string) {
  run('UPDATE qa_sessions SET title=?,updated_at=? WHERE id=?', [title, now(), id])
}

export function createInterviewSession(company: string, role: string, jd: string): InterviewSession {
  const time = now()
  const session: InterviewSession = {
    id: crypto.randomUUID(), title: `${company || '模拟'} · ${role || '面试'}`, company, role, jd,
    status: 'active', created_at: time, updated_at: time,
  }
  run('INSERT INTO interview_sessions(id,title,company,role,jd,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
    [session.id, session.title, session.company, session.role, session.jd, session.status, time, time])
  return session
}

export function listInterviewSessions(): InterviewSession[] {
  return all<InterviewSession>('SELECT * FROM interview_sessions ORDER BY updated_at DESC')
}

export function listInterviewTurns(sessionId: string): InterviewTurn[] {
  return all<InterviewTurn>('SELECT * FROM interview_turns WHERE session_id=? ORDER BY created_at,rowid', [sessionId])
}

export function addInterviewTurn(turn: InterviewTurn) {
  run(`INSERT OR IGNORE INTO interview_turns(id,session_id,question,answer,feedback,score,reference_answer,knowledge,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`,
    [turn.id, turn.session_id, turn.question, turn.answer, turn.feedback, turn.score, turn.reference_answer, turn.knowledge, turn.created_at])
  run('UPDATE interview_sessions SET updated_at=? WHERE id=?', [turn.created_at, turn.session_id])
}

export function updateInterviewTurn(turn: InterviewTurn) {
  run(`UPDATE interview_turns SET answer=?,feedback=?,score=?,reference_answer=?,knowledge=? WHERE id=?`,
    [turn.answer, turn.feedback, turn.score, turn.reference_answer, turn.knowledge, turn.id])
}

export function completeInterviewSession(id: string) {
  run("UPDATE interview_sessions SET status='completed',updated_at=? WHERE id=?", [now(), id])
}

export function getSetting<T>(key: string, fallback: T): T {
  const row = all<{ value_json: string }>('SELECT value_json FROM settings WHERE key=?', [key])[0]
  if (!row) return fallback
  try { return JSON.parse(row.value_json) as T } catch { return fallback }
}

export function setSetting(key: string, value: unknown) {
  run(`INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`,
    [key, JSON.stringify(value), now()])
}

export function getProviders(): Provider[] {
  return getSetting<Provider[]>('providers', [])
}

export function setProviders(providers: Provider[]) { setSetting('providers', providers) }

export function deviceId(): string {
  let id = getSetting<string>('deviceId', '')
  if (!id) { id = crypto.randomUUID(); setSetting('deviceId', id) }
  return id
}

export function exportPayload(): SyncPayload {
  return {
    version: 1,
    deviceId: deviceId(),
    generatedAt: now(),
    cards: listCards(),
    qaSessions: listQaSessions(),
    qaMessages: all<QaMessage>('SELECT * FROM qa_messages ORDER BY created_at'),
    interviewSessions: listInterviewSessions(),
    interviewTurns: all<InterviewTurn>('SELECT * FROM interview_turns ORDER BY created_at'),
    providers: getProviders(),
  }
}

export function mergePayload(payload: SyncPayload): { cards: number; qa: number; interviews: number; providers: number } {
  let cards = 0, qa = 0, interviews = 0
  for (const card of payload.cards || []) {
    run(`INSERT INTO cards(id,title,brief_answer,detail_answer,tags_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,brief_answer=excluded.brief_answer,
      detail_answer=excluded.detail_answer,tags_json=excluded.tags_json,updated_at=excluded.updated_at
      WHERE excluded.updated_at>=cards.updated_at`,
      [card.id, card.title, card.brief_answer, card.detail_answer, card.tags_json, card.created_at, card.updated_at])
    cards++
  }
  for (const session of payload.qaSessions || []) {
    run(`INSERT INTO qa_sessions(id,title,created_at,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=CASE WHEN excluded.updated_at>qa_sessions.updated_at THEN excluded.title ELSE qa_sessions.title END,
      updated_at=MAX(qa_sessions.updated_at,excluded.updated_at)`,
      [session.id, session.title, session.created_at, session.updated_at])
    qa++
  }
  for (const message of payload.qaMessages || []) {
    run('INSERT OR IGNORE INTO qa_messages(id,session_id,role,content,citations_json,created_at) VALUES(?,?,?,?,?,?)',
      [message.id, message.session_id, message.role, message.content, message.citations_json, message.created_at])
  }
  for (const session of payload.interviewSessions || []) {
    run(`INSERT INTO interview_sessions(id,title,company,role,jd,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=CASE WHEN excluded.updated_at>interview_sessions.updated_at THEN excluded.title ELSE interview_sessions.title END,
      company=CASE WHEN excluded.updated_at>interview_sessions.updated_at THEN excluded.company ELSE interview_sessions.company END,
      role=CASE WHEN excluded.updated_at>interview_sessions.updated_at THEN excluded.role ELSE interview_sessions.role END,
      jd=CASE WHEN excluded.updated_at>interview_sessions.updated_at THEN excluded.jd ELSE interview_sessions.jd END,
      status=CASE WHEN excluded.updated_at>interview_sessions.updated_at THEN excluded.status ELSE interview_sessions.status END,
      updated_at=MAX(interview_sessions.updated_at,excluded.updated_at)`,
      [session.id, session.title, session.company, session.role, session.jd, session.status, session.created_at, session.updated_at])
    interviews++
  }
  for (const turn of payload.interviewTurns || []) {
    run(`INSERT INTO interview_turns(id,session_id,question,answer,feedback,score,reference_answer,knowledge,created_at)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      answer=CASE WHEN interview_turns.answer='' THEN excluded.answer ELSE interview_turns.answer END,
      feedback=CASE WHEN interview_turns.feedback='' THEN excluded.feedback ELSE interview_turns.feedback END,
      score=COALESCE(interview_turns.score,excluded.score),
      reference_answer=CASE WHEN interview_turns.reference_answer='' THEN excluded.reference_answer ELSE interview_turns.reference_answer END,
      knowledge=CASE WHEN interview_turns.knowledge='' THEN excluded.knowledge ELSE interview_turns.knowledge END`,
      [turn.id, turn.session_id, turn.question, turn.answer, turn.feedback, turn.score, turn.reference_answer, turn.knowledge, turn.created_at])
  }
  if (payload.providers?.length) {
    setProviders(payload.providers)
  }
  return { cards, qa, interviews, providers: payload.providers?.length || 0 }
}

export function mobileNotebookId() { return MOBILE_NOTEBOOK }

export function normalizeTags(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(item => text(item)).filter(Boolean))
  if (typeof value === 'string') return value
  return '[]'
}

export function normalizeCard(raw: Record<string, unknown>): Card {
  const time = now()
  return {
    id: text(raw.id) || crypto.randomUUID(),
    title: text(raw.title) || '未命名卡片',
    brief_answer: text(raw.brief_answer),
    detail_answer: text(raw.detail_answer),
    tags_json: typeof raw.tags_json === 'string' ? raw.tags_json : normalizeTags(raw.tags),
    created_at: text(raw.created_at) || time,
    updated_at: text(raw.updated_at) || time,
  }
}
