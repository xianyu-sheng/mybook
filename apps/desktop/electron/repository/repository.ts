import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { mkdir, mkdtemp, readdir, readFile, stat, rm } from 'node:fs/promises'
import path from 'node:path'
import { getDb } from '../db/connection.js'
import { replaceIndex, type IndexedDocument } from './index.js'
import type { GlobalRepository, RepositoryInput } from '../../src/types/repository.js'

const exec = promisify(execFile)
const active = new Map<string, { controller: AbortController; progress: string }>()
let stopping = false

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

async function git(args: string[], signal: AbortSignal) {
  return (await exec('git', ['-c', 'credential.helper=', '-c', 'core.hooksPath=/dev/null', '-c', 'protocol.file.allow=never',
    '-c', 'protocol.ext.allow=never', ...args], { signal, timeout: 300_000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })).stdout.trim()
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
    for (let attempt = 1; attempt <= 3; attempt++) {
      signal.throwIfAborted()
      try {
        await git(['clone', '--depth=1', '--filter=blob:none', '--no-checkout', `${remote}.git`, checkout], signal)
        state.progress = '下载 Markdown 正文'
        await git(['-C', checkout, 'sparse-checkout', 'set', '--no-cone', '*.md', '*.mdx', 'LICENSE*', 'COPYING*'], signal)
        await git(['-C', checkout, 'checkout', '--detach', 'HEAD'], signal)
        break
      } catch (error: any) {
        const transient = /TLS|gnutls|RPC failed|connection|resolve host|timed?\s*out|early EOF|HTTP (?:429|5\d\d)|error: (?:429|5\d\d)/i.test(error.message || '')
        if (signal.aborted || attempt === 3 || !transient) throw error
        state.progress = `网络中断，准备第 ${attempt + 1}/3 次下载`
        await rm(checkout, { recursive: true, force: true })
        await delay(attempt * 2000, undefined, { signal })
      }
    }
    const revision = await git(['-C', checkout, 'rev-parse', 'HEAD'], signal)
    const documents: IndexedDocument[] = []
    let skipped = 0, totalBytes = 0
    async function walk(dir: string) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        signal.throwIfAborted()
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) { await walk(full); continue }
        if (!entry.isFile() || !(/\.(md|mdx)$/i.test(entry.name) || /^(LICENSE|COPYING)/i.test(entry.name))) continue
        if ((await stat(full)).size > 2 * 1024 * 1024) { skipped++; continue }
        const content = await readFile(full, 'utf8')
        if (!content.trim() || content.includes('\0')) continue
        totalBytes += Buffer.byteLength(content)
        if (totalBytes > 150 * 1024 * 1024 || documents.length >= 10000) throw new Error('仓库文档超过本地索引容量，请选择较小的仓库')
        const relative = path.relative(checkout, full).split(path.sep).join('/')
        const title = content.match(/^#\s+(.+)$/m)?.[1].replace(/[*`]/g, '').trim() || path.basename(full, path.extname(full))
        documents.push({ path: relative, title, content, url: `${remote}/blob/${revision}/${relative.split('/').map(encodeURIComponent).join('/')}` })
        state.progress = `读取文档 ${documents.length} 篇`
      }
    }
    await walk(checkout)
    if (!documents.length) throw new Error('仓库中没有可导入的 Markdown 文档')
    signal.throwIfAborted()
    state.progress = `建立索引 ${documents.length} 篇`
    await new Promise(resolve => setTimeout(resolve, 0))
    signal.throwIfAborted()
    // Publish one complete snapshot; failed downloads never replace the previous index.
    replaceIndex(getDb(), id, documents, revision, skipped ? `${skipped} 个超过 2 MB 的文档未导入` : null)
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
