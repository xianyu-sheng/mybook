import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import os from 'node:os'
import type Database from 'better-sqlite3'
import { getDb } from './db/connection.js'
import { MOBILE_NOTEBOOK_ID, type MobileSyncPayload } from './mobile-sync-types.js'

const PORT = 47821
const ITERATIONS = 120000

interface Envelope { v: 1; salt: string; iv: string; data: string }
interface MobileSyncState {
  server: Server | null
  enabled: boolean
}

const state: MobileSyncState = { server: null, enabled: false }

function setting(key: string): unknown {
  const row = getDb().prepare('SELECT value_json FROM settings WHERE key=?').get(key) as { value_json: string } | undefined
  if (!row) return null
  try { return JSON.parse(row.value_json) } catch { return null }
}

function saveSetting(key: string, value: unknown) {
  getDb().prepare(`INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`).run(key, JSON.stringify(value))
}

function makeCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from(randomBytes(12), byte => alphabet[byte % alphabet.length]).join('')
}

function code(): string {
  const existing = setting('mobileSyncCode')
  if (typeof existing === 'string' && existing.length >= 8) return existing
  const next = makeCode()
  saveSetting('mobileSyncCode', next)
  return next
}

function deriveKey(pairing: string, salt: Buffer): Buffer {
  return pbkdf2Sync(pairing, salt, ITERATIONS, 32, 'sha256')
}

function encrypt(value: unknown, pairing: string): Envelope {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(pairing, salt), iv)
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  const data = Buffer.concat([body, cipher.getAuthTag()])
  return { v: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), data: data.toString('base64') }
}

function decrypt(envelope: Envelope, pairing: string): unknown {
  if (envelope?.v !== 1 || !envelope.salt || !envelope.iv || !envelope.data) throw new Error('同步包格式不正确')
  const salt = Buffer.from(envelope.salt, 'base64')
  const iv = Buffer.from(envelope.iv, 'base64')
  const data = Buffer.from(envelope.data, 'base64')
  if (salt.length !== 16 || iv.length !== 12 || data.length < 16) throw new Error('同步包字段长度不正确')
  const ciphertext = data.subarray(0, data.length - 16)
  const tag = data.subarray(data.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(pairing, salt), iv)
  decipher.setAuthTag(tag)
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  return JSON.parse(plain)
}

function text(value: unknown, fallback = '') { return typeof value === 'string' ? value : fallback }
function list(value: unknown): any[] { return Array.isArray(value) ? value : [] }

function ensureMobileNotebook(db: Database.Database) {
  db.prepare(`INSERT OR IGNORE INTO notebook(id,title,description,settings_json) VALUES(?,?,?,?)`)
    .run(MOBILE_NOTEBOOK_ID, '手机同步', '手机端创建和同步的内容', '{}')
}

function merge(db: Database.Database, payload: MobileSyncPayload) {
  ensureMobileNotebook(db)
  const cardStmt = db.prepare(`INSERT INTO card(id,notebook_id,title,brief_answer,detail_answer,source_ids,tags_json,status,citations_json,created_at,updated_at)
    VALUES(?,?,?,?,?,'[]',?,'detail_ready','[]',?,?)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title,brief_answer=excluded.brief_answer,detail_answer=excluded.detail_answer,
    tags_json=excluded.tags_json,updated_at=excluded.updated_at
    WHERE excluded.updated_at>=card.updated_at`)
  for (const card of list(payload.cards)) {
    cardStmt.run(text(card.id), MOBILE_NOTEBOOK_ID, text(card.title, '未命名卡片'), text(card.brief_answer),
      text(card.detail_answer), text(card.tags_json, '[]'), text(card.created_at), text(card.updated_at))
  }

  const sessionStmt = db.prepare(`INSERT INTO qa_session(id,title,created_at,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET title=CASE WHEN excluded.updated_at>qa_session.updated_at THEN excluded.title ELSE qa_session.title END,
    updated_at=MAX(qa_session.updated_at,excluded.updated_at)`)
  for (const session of list(payload.qaSessions)) {
    sessionStmt.run(text(session.id), text(session.title, '手机问答'), text(session.created_at), text(session.updated_at))
  }
  const messageStmt = db.prepare(`INSERT OR IGNORE INTO qa_message(id,session_id,role,content,citations_json,created_at)
    VALUES(?,?,?,?,?,?)`)
  for (const message of list(payload.qaMessages)) {
    const role = message.role === 'assistant' ? 'assistant' : 'user'
    messageStmt.run(text(message.id), text(message.session_id), role, text(message.content), text(message.citations_json, '[]'), text(message.created_at))
  }

  const interviewStmt = db.prepare(`INSERT INTO interview_session(id,notebook_id,title,company,department,role,jd,tags_json,search_web,question_count,status,research_json,created_at,updated_at)
    VALUES(?,?,?,?, '',?,'','[]',1,5,?,'[]',?,?)
    ON CONFLICT(id) DO UPDATE SET
    title=CASE WHEN excluded.updated_at>interview_session.updated_at THEN excluded.title ELSE interview_session.title END,
    company=CASE WHEN excluded.updated_at>interview_session.updated_at THEN excluded.company ELSE interview_session.company END,
    role=CASE WHEN excluded.updated_at>interview_session.updated_at THEN excluded.role ELSE interview_session.role END,
    jd=CASE WHEN excluded.updated_at>interview_session.updated_at THEN excluded.jd ELSE interview_session.jd END,
    status=CASE WHEN excluded.updated_at>interview_session.updated_at THEN excluded.status ELSE interview_session.status END,
    updated_at=MAX(interview_session.updated_at,excluded.updated_at)`)
  for (const session of list(payload.interviewSessions)) {
    const status = session.status === 'completed' ? 'completed' : 'active'
    interviewStmt.run(text(session.id), MOBILE_NOTEBOOK_ID, text(session.title, '手机模拟面试'), text(session.company),
      text(session.role), text(session.jd), status, text(session.created_at), text(session.updated_at))
  }
  const turnStmt = db.prepare(`INSERT INTO interview_turn(id,session_id,question,answer,feedback,score,reference_answer,knowledge,created_at)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
    answer=CASE WHEN interview_turn.answer='' THEN excluded.answer ELSE interview_turn.answer END,
    feedback=CASE WHEN interview_turn.feedback='' THEN excluded.feedback ELSE interview_turn.feedback END,
    score=COALESCE(interview_turn.score,excluded.score),
    reference_answer=CASE WHEN interview_turn.reference_answer='' THEN excluded.reference_answer ELSE interview_turn.reference_answer END,
    knowledge=CASE WHEN interview_turn.knowledge='' THEN excluded.knowledge ELSE interview_turn.knowledge END`)
  for (const turn of list(payload.interviewTurns)) {
    turnStmt.run(text(turn.id), text(turn.session_id), text(turn.question), text(turn.answer), text(turn.feedback),
      turn.score === null || turn.score === undefined || turn.score === '' || !Number.isFinite(Number(turn.score)) ? null : Math.round(Number(turn.score)), text(turn.reference_answer),
      text(turn.knowledge), text(turn.created_at))
  }
}

function pcSnapshot(): MobileSyncPayload {
  const db = getDb()
  const cards = db.prepare(`SELECT id,title,brief_answer,detail_answer,tags_json,created_at,updated_at FROM card ORDER BY updated_at DESC`).all()
  const qaSessions = db.prepare(`SELECT id,title,created_at,updated_at FROM qa_session ORDER BY updated_at DESC`).all()
  const qaMessages = db.prepare(`SELECT id,session_id,role,content,citations_json,created_at FROM qa_message ORDER BY created_at`).all()
  const interviewSessions = db.prepare(`SELECT id,title,company,role,jd,status,created_at,updated_at FROM interview_session ORDER BY updated_at DESC`).all()
  const interviewTurns = db.prepare(`SELECT id,session_id,question,answer,feedback,score,reference_answer,knowledge,created_at FROM interview_turn ORDER BY created_at`).all()
  const providers = setting('customProviders')
  return {
    version: 1, deviceId: 'pc', generatedAt: new Date().toISOString(),
    cards, qaSessions, qaMessages, interviewSessions, interviewTurns,
    providers: Array.isArray(providers) ? providers : [],
  } as MobileSyncPayload
}

function endpoints(): string[] {
  const result = new Set<string>([`http://127.0.0.1:${PORT}`])
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) result.add(`http://${entry.address}:${PORT}`)
    }
  }
  return [...result]
}

function readBody(request: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    request.on('data', chunk => {
      size += chunk.length
      if (size > 16 * 1024 * 1024) { reject(new Error('同步包超过 16 MB')); request.destroy(); return }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function cors(response: import('node:http').ServerResponse) {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')
}

export function mobileSyncStatus() {
  const current = code()
  return {
    enabled: Boolean(setting('mobileSyncEnabled')) || state.enabled,
    running: Boolean(state.server),
    port: PORT,
    code: current,
    endpoints: endpoints(),
  }
}

export async function startMobileSync() {
  if (state.server) return mobileSyncStatus()
  if (!state.enabled) {
    state.enabled = true
    saveSetting('mobileSyncEnabled', true)
  }
  const db = getDb()
  const server = createServer(async (request, response) => {
    cors(response)
    if (request.method === 'OPTIONS') { response.writeHead(204).end(); return }
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ app: 'mybook', version: 1, name: 'Mybook' }))
      return
    }
    if (request.method === 'POST' && request.url === '/sync') {
      try {
        const body = JSON.parse(await readBody(request)) as Envelope
        const pairing = code()
        const incoming = decrypt(body, pairing) as MobileSyncPayload
        if (!incoming || incoming.version !== 1) throw new Error('同步数据版本不兼容')
        db.transaction(() => merge(db, incoming))()
        const reply = encrypt(pcSnapshot(), pairing)
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        response.end(JSON.stringify(reply))
      } catch (error) {
        response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
        response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
      }
      return
    }
    response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({ error: 'not found' }))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(PORT, '0.0.0.0', () => resolve())
  })
  state.server = server
  return mobileSyncStatus()
}

export async function stopMobileSync() {
  if (state.server) {
    await new Promise<void>(resolve => state.server!.close(() => resolve()))
    state.server = null
  }
  state.enabled = false
  saveSetting('mobileSyncEnabled', false)
  return mobileSyncStatus()
}

export function regenerateMobileSyncCode() {
  saveSetting('mobileSyncCode', makeCode())
  return mobileSyncStatus()
}

export async function restoreMobileSync() {
  if (setting('mobileSyncEnabled') === true) await startMobileSync()
}

export function shutdownMobileSync() {
  if (state.server) { state.server.close(); state.server = null }
}
