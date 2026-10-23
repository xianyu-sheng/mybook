import { app, session } from 'electron'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import net from 'node:net'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { getDb } from '../db/connection.js'
import { mergeIndex, type IndexedDocument } from './index.js'
import type { GlobalRepository, RepositoryInput } from '../../src/types/repository.js'

const exec = promisify(execFile)
const active = new Map<string, { controller: AbortController; progress: string }>()
let stopping = false
let proxyOverride: { args: string[]; expires: number } | null = null

function proxyEndpoint(value: string): { host: string; port: number } | null {
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`)
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
    if (!url.hostname || !Number.isInteger(port) || port <= 0 || port > 65535) return null
    return { host: url.hostname, port }
  } catch {
    return null
  }
}

function portOpen(host: string, port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.connect({ host, port })
    const finish = (open: boolean) => { socket.destroy(); resolve(open) }
    socket.setTimeout(1200)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

async function configuredGitProxy(): Promise<string | null> {
  for (const key of ['http.proxy', 'https.proxy']) {
    try {
      const { stdout } = await exec('git', ['config', '--global', '--get', key], { timeout: 5000, maxBuffer: 64 * 1024 })
      const value = stdout.trim()
      if (value) return value
    } catch { /* key not configured */ }
  }
  return null
}

/** Use the Windows/macOS system proxy when Git's global config points at a
 * dead local port. This keeps GitHub working after a proxy client changes
 * ports without hardcoding a port. */
async function systemProxy(): Promise<string | null> {
  try {
    const resolved = await session.defaultSession.resolveProxy('https://github.com')
    const match = resolved.match(/(?:^|;)\s*(PROXY|SOCKS5?|HTTPS?)\s+([^;\s]+)/i)
    if (!match) return null
    const scheme = /^SOCKS/i.test(match[1]) ? 'socks5h://' : 'http://'
    return `${scheme}${match[2]}`
  } catch {
    return null
  }
}

/** A global Git proxy often survives after the proxy client changes ports.
 * Keep a reachable proxy, use the system proxy when the configured one is
 * dead, and only fall back to a direct connection if both are unreachable. */
async function gitProxyArgs(): Promise<string[]> {
  if (proxyOverride && Date.now() < proxyOverride.expires) return proxyOverride.args
  let args: string[] = []
  const proxy = await configuredGitProxy()
  const endpoint = proxy ? proxyEndpoint(proxy) : null
  if (!endpoint || !(await portOpen(endpoint.host, endpoint.port))) {
    const fallback = await systemProxy()
    const fallbackEndpoint = fallback ? proxyEndpoint(fallback) : null
    if (fallback && fallbackEndpoint && await portOpen(fallbackEndpoint.host, fallbackEndpoint.port)) {
      args = ['-c', `http.proxy=${fallback}`, '-c', `https.proxy=${fallback}`]
    } else if (endpoint) {
      args = ['-c', 'http.proxy=', '-c', 'https.proxy=']
    }
  }
  proxyOverride = { args, expires: Date.now() + 60_000 }
  return args
}

export function normalizeRepositoryUrl(value: string): string {
  const url = new URL(value)
  const parts = url.pathname.replace(/\.git\/?$/, '').split('/').filter(Boolean)
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.port || parts.length !== 2 || parts.some(p => !/^[\w.-]+$/.test(p))) {
    throw new Error('请填写公开 GitHub 仓库地址，例如 https://github.com/作者/仓库')
  }
  return `https://github.com/${parts[0]}/${parts[1]}`
}

export function listRepositories(): GlobalRepository[] {
  return getDb().prepare(`SELECT r.*, COUNT(d.id) AS document_count FROM global_repository r
    LEFT JOIN global_document d ON d.repository_id=r.id GROUP BY r.id ORDER BY r.rowid`).all().map((row: any) => ({
      ...row, enabled: Boolean(row.enabled), progress: active.get(row.id)?.progress || null
    }))
}

export function recoverInterruptedSyncs() {
  getDb().prepare("UPDATE global_repository SET status='error',last_error='上次同步中断，可重新同步；已完成的资料仍可使用' WHERE status='syncing'").run()
}

function isTransientGitError(error: any): boolean {
  return /TLS|gnutls|RPC failed|connection|resolve host|timed?\s*out|early EOF|HTTP (?:429|5\d\d)|error: (?:429|5\d\d)/i.test(error?.message || '')
}

async function gitRaw(args: string[], signal: AbortSignal) {
  return (await exec('git', ['-c', 'credential.helper=', '-c', 'core.hooksPath=/dev/null', '-c', 'protocol.file.allow=never',
    '-c', 'protocol.ext.allow=never', ...(await gitProxyArgs()), ...args], { signal, timeout: 300_000, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })).stdout
}

async function git(args: string[], signal: AbortSignal) {
  return (await gitRaw(args, signal)).trim()
}

async function cloneRepository(remote: string, checkout: string, state: { progress: string }, signal: AbortSignal) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    signal.throwIfAborted()
    try {
      await git(['clone', '--depth=1', '--filter=blob:none', '--no-checkout', `${remote}.git`, checkout], signal)
      return
    } catch (error: any) {
      if (signal.aborted || attempt === 3 || !isTransientGitError(error)) throw error
      state.progress = `网络中断，准备第 ${attempt + 1}/3 次下载`
      await rm(checkout, { recursive: true, force: true })
      await delay(attempt * 2000, undefined, { signal })
    }
  }
}

async function fetchBlob(checkout: string, blobSha: string, signal: AbortSignal): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await gitRaw(['-C', checkout, 'cat-file', 'blob', blobSha], signal)
    } catch (error: any) {
      if (signal.aborted || attempt === 3 || !isTransientGitError(error)) throw error
      await delay(attempt * 1500, undefined, { signal })
    }
  }
}

interface TreeDocument { path: string; blobSha: string }

function isDocumentPath(filePath: string): boolean {
  const parts = filePath.split('/')
  if (parts.some(part => part.startsWith('.') || part === 'node_modules')) return false
  const name = parts[parts.length - 1]
  return /\.(md|mdx)$/i.test(name) || /^(LICENSE|COPYING)/i.test(name)
}

function treeDocuments(output: string): TreeDocument[] {
  const documents: TreeDocument[] = []
  for (const line of output.split('\0')) {
    if (!line) continue
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    const meta = line.slice(0, tab).split(' ')
    if (meta[1] !== 'blob') continue
    const filePath = line.slice(tab + 1)
    if (!isDocumentPath(filePath)) continue
    documents.push({ path: filePath, blobSha: meta[2] })
  }
  return documents
}

export async function syncRepository(id: string): Promise<void> {
  const row = getDb().prepare('SELECT * FROM global_repository WHERE id=?').get(id) as GlobalRepository | undefined
  if (!row) throw new Error('知识仓库不存在')
  if (active.has(id)) throw new Error('该知识仓库正在同步')
  const remote = normalizeRepositoryUrl(row.base_url)
  const state = { controller: new AbortController(), progress: '下载文档目录' }
  active.set(id, state)
  getDb().prepare("UPDATE global_repository SET status='syncing',last_error=NULL WHERE id=?").run(id)
  let temporary: string | undefined
  try {
    const cache = path.join(app.getPath('userData'), 'repository-cache')
    await mkdir(cache, { recursive: true })
    temporary = await mkdtemp(path.join(cache, 'sync-'))
    const checkout = path.join(temporary, 'repo')
    const signal = state.controller.signal
    await cloneRepository(remote, checkout, state, signal)
    const revision = await git(['-C', checkout, 'rev-parse', 'HEAD'], signal)
    state.progress = '检查仓库目录'
    const tree = treeDocuments(await gitRaw(['-C', checkout, 'ls-tree', '-r', '-z', 'HEAD'], signal))
    const existingRows = getDb().prepare('SELECT path,blob_sha FROM global_document WHERE repository_id=?').all(id) as Array<{ path: string; blob_sha: string | null }>
    const existing = new Map(existingRows.map(entry => [entry.path, entry.blob_sha]))
    if (!tree.length && !existing.size) throw new Error('仓库中没有可导入的 Markdown 文档')
    const treePaths = new Set(tree.map(entry => entry.path))
    const newFiles = tree.filter(entry => !existing.has(entry.path))
    const changedFiles = tree.filter(entry => {
      const oldBlob = existing.get(entry.path)
      return Boolean(oldBlob && oldBlob !== entry.blobSha)
    })
    const removedPaths = [...existing.keys()].filter(filePath => !treePaths.has(filePath))
    // Legacy rows have no blob fingerprint. The merge only fills one when the
    // row was indexed at the current revision, so content from an older commit
    // is never mistaken for the latest one.
    const backfill = tree.filter(entry => existing.has(entry.path) && !existing.get(entry.path)).map(entry => ({ path: entry.path, blobSha: entry.blobSha }))
    if (!newFiles.length && !changedFiles.length && !removedPaths.length) {
      signal.throwIfAborted()
      state.progress = '已是最新，无新增文档'
      mergeIndex(getDb(), id, [], revision, null, { backfill })
      return
    }
    const pending = [...newFiles, ...changedFiles]
    const documents: IndexedDocument[] = []
    let skipped = 0, totalBytes = 0
    for (let index = 0; index < pending.length; index++) {
      signal.throwIfAborted()
      const entry = pending[index]
      state.progress = `增量下载 ${index + 1}/${pending.length} 篇`
      const content = await fetchBlob(checkout, entry.blobSha, signal)
      if (Buffer.byteLength(content) > 2 * 1024 * 1024) { skipped++; continue }
      if (!content.trim() || content.includes('\0')) continue
      totalBytes += Buffer.byteLength(content)
      if (totalBytes > 150 * 1024 * 1024 || documents.length >= 10000) throw new Error('仓库文档超过本地索引容量，请选择较小的仓库')
      const title = content.match(/^#\s+(.+)$/m)?.[1].replace(/[*`]/g, '').trim() || path.basename(entry.path, path.extname(entry.path))
      documents.push({
        path: entry.path, title, content, blobSha: entry.blobSha,
        url: `${remote}/blob/${revision}/${entry.path.split('/').map(encodeURIComponent).join('/')}`,
      })
    }
    if (!documents.length && !existing.size) throw new Error('仓库中没有可导入的 Markdown 文档')
    signal.throwIfAborted()
    state.progress = documents.length ? `建立索引 ${documents.length} 篇（新增 ${newFiles.length} / 更新 ${changedFiles.length}）` : '更新仓库状态'
    await new Promise(resolve => setTimeout(resolve, 0))
    signal.throwIfAborted()
    mergeIndex(getDb(), id, documents, revision, skipped ? `${skipped} 个超过 2 MB 的文档未导入` : null, { removedPaths, backfill })
  } catch (error: any) {
    const message = state.controller.signal.aborted ? '同步已取消，保留上次完整资料' : error.code === 'ENOENT' ? '未找到 Git，请先安装 Git 后再同步' : (error.message || String(error)).slice(0, 1200)
    if (!stopping) getDb().prepare("UPDATE global_repository SET status='error',last_error=? WHERE id=?").run(message, id)
  } finally {
    active.delete(id)
    if (temporary) await rm(temporary, { recursive: true, force: true }).catch(() => {})
  }
}

export function startSync(id: string) {
  if (active.has(id)) throw new Error('该知识仓库正在同步')
  if (active.size) throw new Error('请等待当前仓库同步完成，或取消当前同步')
  if (!getDb().prepare('SELECT id FROM global_repository WHERE id=?').get(id)) throw new Error('知识仓库不存在')
  void syncRepository(id).catch(error => console.error('仓库同步失败:', error.message))
}
export function cancelSync(id: string) { active.get(id)?.controller.abort() }
export function cancelAllSyncs() { stopping = true; for (const state of active.values()) state.controller.abort() }

export function createRepository(input: RepositoryInput): GlobalRepository {
  const url = normalizeRepositoryUrl(input.base_url)
  if (getDb().prepare('SELECT id FROM global_repository WHERE lower(base_url)=lower(?)').get(url)) throw new Error('该仓库已经添加')
  const id = randomUUID()
  getDb().prepare('INSERT INTO global_repository(id,name,base_url,homepage,description,enabled) VALUES (?,?,?,?,?,?)')
    .run(id, input.name, url, input.homepage || '', input.description || '', Number(input.enabled ?? true))
  return listRepositories().find(repo => repo.id === id)!
}
export function updateRepository(id: string, patch: Partial<Omit<RepositoryInput, 'base_url'>>): GlobalRepository {
  const current = getDb().prepare('SELECT * FROM global_repository WHERE id=?').get(id) as GlobalRepository | undefined
  if (!current) throw new Error('知识仓库不存在')
  getDb().prepare("UPDATE global_repository SET name=?,homepage=?,description=?,enabled=?,updated_at=datetime('now') WHERE id=?")
    .run(patch.name ?? current.name, patch.homepage ?? current.homepage, patch.description ?? current.description, Number(patch.enabled ?? current.enabled), id)
  return listRepositories().find(repo => repo.id === id)!
}
export function deleteRepository(id: string) {
  if (active.has(id)) throw new Error('请先取消同步，再移除仓库')
  getDb().prepare('DELETE FROM global_repository WHERE id=?').run(id)
}
