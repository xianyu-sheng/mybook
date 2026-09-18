import { ipcMain, dialog, shell } from 'electron'
import { readFile, writeFile, stat } from 'node:fs/promises'
import { z } from 'zod'
import { getDb } from '../db/connection.js'
import { matchQuery, technicalQueryLiterals } from '../repository/index.js'
import { createRepository, deleteRepository, listRepositories, normalizeRepositoryUrl, startSync, cancelSync, updateRepository } from '../repository/repository.js'

const httpUrl = z.string().refine(value => { try { return ['https:', 'http:'].includes(new URL(value).protocol) } catch { return false } }, '请输入网页地址')
const inputSchema = z.object({ name: z.string().trim().min(1).max(100), base_url: z.string().transform(normalizeRepositoryUrl),
  homepage: z.union([httpUrl, z.literal('')]).default(''), description: z.string().trim().max(500).default(''), enabled: z.boolean().default(true) })
const packSchema = z.object({ version: z.literal(1), repositories: z.array(inputSchema).min(1).max(50) })
const patchSchema = z.object({ name: z.string().trim().min(1).max(100).optional(),
  homepage: z.union([httpUrl, z.literal('')]).optional(), description: z.string().trim().max(500).optional(), enabled: z.boolean().optional() })
export function importRepositoryPack(value: unknown) {
  const pack = packSchema.parse(value)
  getDb().transaction(() => {
    for (const entry of pack.repositories) {
      if (!getDb().prepare('SELECT id FROM global_repository WHERE lower(base_url)=lower(?)').get(entry.base_url)) createRepository(entry)
    }
  })()
  return listRepositories()
}
export function registerRepositoryIpc(): void {
  ipcMain.handle('knowmind:repositories:list', () => listRepositories())
  ipcMain.handle('knowmind:repositories:create', (_, input: unknown) => createRepository(inputSchema.parse(input)))
  ipcMain.handle('knowmind:repositories:update', (_, id: string, patch: unknown) => updateRepository(id, patchSchema.parse(patch)))
  ipcMain.handle('knowmind:repositories:delete', (_, id: string) => deleteRepository(id))
  ipcMain.handle('knowmind:repositories:sync', (_, id: string) => startSync(id))
  ipcMain.handle('knowmind:repositories:cancel', (_, id: string) => cancelSync(id))
  ipcMain.handle('knowmind:repositories:import', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: '仓库配置', extensions: ['json'] }] })
    if (result.canceled || !result.filePaths[0]) return null
    if ((await stat(result.filePaths[0])).size > 1_000_000) throw new Error('配置文件不能超过 1 MB')
    return importRepositoryPack(JSON.parse(await readFile(result.filePaths[0], 'utf8')))
  })
  ipcMain.handle('knowmind:repositories:export', async () => {
    const result = await dialog.showSaveDialog({ defaultPath: 'knowledge-repositories.json', filters: [{ name: '仓库配置', extensions: ['json'] }] })
    if (result.canceled || !result.filePath) return null
    const repositories = listRepositories().map(({ name, base_url, homepage, description, enabled }) => ({ name, base_url, homepage, description, enabled }))
    await writeFile(result.filePath, JSON.stringify({ version: 1, repositories }, null, 2), 'utf8')
    return result.filePath
  })
  ipcMain.handle('knowmind:repositories:documents', (_, query: string, repositoryId?: string, page = 0) => {
    query = z.string().max(500).parse(query)
    page = z.number().int().min(0).max(10000).parse(page)
    const filters = [], values: string[] = []
    if (repositoryId) { filters.push('d.repository_id=?'); values.push(repositoryId) }
    const match = matchQuery(query)
    if (match) { filters.push('d.id IN (SELECT c.document_id FROM global_search JOIN global_chunk c ON c.id=global_search.rowid WHERE global_search MATCH ?)'); values.push(match) }
    // Old indices represented C++ and C# by the same "c" token. Verify the
    // original document before counting/paging so neither language leaks into the other.
    const literals = technicalQueryLiterals(query)
    if (literals.length) {
      filters.push(`(${literals.map(() => "instr(lower(d.title || ' ' || d.content_text), ?) > 0").join(' OR ')})`)
      values.push(...literals)
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
    const total = (getDb().prepare(`SELECT COUNT(*) AS n FROM global_document d ${where}`).get(...values) as { n: number }).n
    const items = getDb().prepare(`SELECT d.id,d.repository_id,d.path,d.title,d.url,r.name AS repository_name,substr(d.content_text,1,160) AS snippet
      FROM global_document d JOIN global_repository r ON r.id=d.repository_id ${where} ORDER BY d.title,d.id LIMIT 30 OFFSET ?`).all(...values, page * 30)
    return { items, total }
  })
  ipcMain.handle('knowmind:repositories:document', (_, id: string) => {
    const row = getDb().prepare('SELECT d.*,r.name AS repository_name FROM global_document d JOIN global_repository r ON r.id=d.repository_id WHERE d.id=?').get(id)
    if (!row) throw new Error('文章不存在，可能已经同步更新')
    return row
  })
  ipcMain.handle('knowmind:repositories:open-document', async (_, id: string) => {
    const row = getDb().prepare('SELECT url FROM global_document WHERE id=?').get(id) as { url: string } | undefined
    if (!row || new URL(row.url).hostname !== 'github.com' || new URL(row.url).protocol !== 'https:') throw new Error('文章链接无效')
    await shell.openExternal(row.url)
  })
}
