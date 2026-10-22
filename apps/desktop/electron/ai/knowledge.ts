import type Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { browseGlobalKnowledge, relevanceScore, searchGlobalKnowledge, searchTerms } from '../repository/index.js'
import { searchRecordingKnowledge } from '../recording/documents.js'
import { InvalidModelOutput } from './generate.js'

export type CitationKind = 'source' | 'global_document' | 'recording' | 'supplement' | 'global_note'
export interface CitationSnapshot {
  ref: string; id: string; title: string; url?: string
  // Optional for older saved chat references, which already have id/title/ref.
  kind?: CitationKind; excerpt?: string; content_hash?: string; retrieved_at?: string
  provenance?: Array<Omit<CitationSnapshot, 'provenance'>>
}

export function createCitationSnapshot(source: { id: string; title: string; kind: CitationKind; content: string; url?: string }, ref: string): CitationSnapshot {
  const excerpt = source.content.slice(0, 2400)
  return { ref, id: source.id, title: source.title, kind: source.kind,
    ...(source.url && /^https?:\/\//i.test(source.url) ? { url: source.url } : {}),
    excerpt, content_hash: createHash('sha256').update(excerpt).digest('hex'), retrieved_at: new Date().toISOString() }
}

export function readCitationSnapshots(value: string | null | undefined): CitationSnapshot[] {
  try {
    const parsed: unknown = JSON.parse(value || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is CitationSnapshot => Boolean(entry && typeof entry === 'object'
      && typeof entry.ref === 'string' && /^来源\[\d+\]$/.test(entry.ref)
      && typeof entry.id === 'string' && typeof entry.title === 'string'))
  } catch { return [] }
}

export function selectCitations(text: string, citations: readonly CitationSnapshot[], explicitRefs: readonly string[] = []): CitationSnapshot[] {
  const refs = new Set([...explicitRefs, ...text.matchAll(/来源\[\d+\]/g)].map(ref => typeof ref === 'string' ? ref : ref[0]))
  if ([...refs].some(ref => !citations.some(citation => citation.ref === ref))) throw new InvalidModelOutput('回答引用了不存在的参考资料，请重新生成有效来源编号')
  return citations.filter(citation => refs.has(citation.ref))
}

export function citationMarkdown(citations: readonly CitationSnapshot[]): string {
  if (!citations.length) return ''
  const format = (citation: CitationSnapshot, label: string) => `- ${label}${citation.title}${citation.url ? `（${citation.url}）` : ''}\n  资料 ID：${citation.id}${citation.content_hash ? `；片段 SHA256：${citation.content_hash}` : ''}${citation.retrieved_at ? `；检索时间：${citation.retrieved_at}` : ''}${citation.excerpt ? `\n\n${citation.excerpt.split('\n').map(line => `  > ${line}`).join('\n')}` : ''}`
  return `\n\n### 参考资料快照\n${citations.map(citation => `${format(citation, `${citation.ref}：`)}${citation.provenance?.length ? `\n\n该学习记录保存的原始参考：\n${citation.provenance.map(source => format(source, '')).join('\n\n')}` : ''}`).join('\n\n')}`
}

/** Historical numbering belongs to its saved answer, never to the new prompt. */
export function historicalCitationText(content: string, citations: readonly CitationSnapshot[]): string {
  return content.replace(/来源\[\d+\]/g, ref => {
    const citation = citations.find(item => item.ref === ref)
    return citation ? `历史参考《${citation.title}》（资料 ID：${citation.id}${citation.url ? `，${citation.url}` : ''}）` : '历史参考（旧记录未保存来源映射，需核实）'
  })
}

function provenance(citations: readonly CitationSnapshot[]) {
  const unique = new Map<string, Omit<CitationSnapshot, 'provenance'>>()
  for (const citation of citations) {
    const { provenance: inherited, ...direct } = citation
    for (const item of inherited?.length ? inherited : [direct]) {
      const { provenance: _nested, ...leaf } = item as CitationSnapshot
      unique.set(`${leaf.kind || ''}:${leaf.id}:${leaf.content_hash || ''}`, leaf)
    }
  }
  // Bounded, flat ancestry prevents five generations of auto-saved notes expanding exponentially.
  return [...unique.values()].slice(0, 24)
}

function passages<T extends { id: string; title: string; content: string }>(documents: T[], terms: string[], limit: number, browse: boolean) {
  const candidates = documents.flatMap(document => {
    const result = []
    for (let offset = 0; offset < (document.content || '').length; offset += 1600) {
      const content = document.content.slice(offset, offset + 1800)
      const score = relevanceScore(`${document.title} ${content}`, terms)
      if (browse || score > 0) result.push({ ...document, content, score })
      if (browse) break
    }
    return result
  }).sort((a, b) => b.score - a.score)
  const perDocument = new Map<string, number>()
  return candidates.filter(candidate => {
    const count = perDocument.get(candidate.id) || 0
    perDocument.set(candidate.id, count + 1)
    return count < (browse ? 1 : 2)
  }).slice(0, limit)
}

export function knowledgeContext(db: Database.Database, notebookId: string | null, query: string, excludeRecordingId = '', options: { browse?: boolean } = {}) {
  const terms = searchTerms(query)
  const browse = Boolean(options.browse)
  if (!terms.length && !browse) return { citations: [] as CitationSnapshot[], context: '' }
  // 全局问答会检索所有笔记本；笔记本内问答仍然只取当前笔记本的原始资料和补充。
  const sources = (notebookId
    ? db.prepare("SELECT id, title, url, content_text AS content FROM source WHERE notebook_id = ? AND status = 'ready' ORDER BY rowid DESC").all(notebookId)
    : db.prepare("SELECT s.id, n.title || ' · ' || s.title AS title, s.url, s.content_text AS content FROM source s JOIN notebook n ON n.id=s.notebook_id WHERE s.status='ready' ORDER BY s.rowid DESC").all()) as Array<{ id: string; title: string; url: string | null; content: string }>
  // Search all saved learning notes; age is not a reason to forget relevant knowledge.
  const supplements = (notebookId
    ? db.prepare('SELECT id, title, content, source_type, citations_json FROM supplement WHERE notebook_id = ? ORDER BY rowid DESC').all(notebookId)
    : db.prepare("SELECT sp.id, n.title || ' · ' || sp.title AS title, sp.content, sp.source_type, sp.citations_json FROM supplement sp JOIN notebook n ON n.id=sp.notebook_id ORDER BY sp.rowid DESC").all()) as Array<{ id: string; title: string; content: string; source_type: string; citations_json: string }>
  const qaNotes = notebookId ? [] : (db.prepare(`SELECT m.id, s.title AS session_title, m.content, m.citations_json
      FROM qa_message m JOIN qa_session s ON s.id=m.session_id
      WHERE m.role='assistant' ORDER BY m.rowid DESC`).all() as Array<{ id: string; session_title: string; content: string; citations_json: string }>)
    .map(note => ({
      id: note.id, title: `问答会话 · ${note.session_title}`,
      content: historicalCitationText(note.content, readCitationSnapshots(note.citations_json)).slice(0, 2400),
      citations_json: note.citations_json,
    }))
  const sourcePassages = passages(sources, terms, 6, browse)
  const learned = passages(supplements, terms, 5, browse)
  const globalNotes = passages(qaNotes, terms, 4, browse)
  const globalPassages = browse ? browseGlobalKnowledge(db) : searchGlobalKnowledge(db, query)
  const recordings = searchRecordingKnowledge(db, query, excludeRecordingId).filter(p => relevanceScore(`${p.title} ${p.content}`, terms) > 0)
  const entries = [
    ...sourcePassages.map(p => ({ ...p, url: p.url || undefined, kind: 'source' as const, label: '原始资料，个人经历应核对原文' })),
    ...globalPassages.map(p => ({ ...p, title: `${p.repository_name} · ${p.title}`, kind: 'global_document' as const, label: '全局仓库，通用知识不代表用户经历' })),
    ...recordings.map(p => ({ ...p, content: historicalCitationText(p.content, []), kind: 'recording' as const, label: '全局面试录音：转写可校对，AI 复盘待核实' })),
    ...globalNotes.map(p => ({ ...p, kind: 'global_note' as const, label: '全局问答记录，AI 生成，需核实；不代表用户已完成的经历' })),
    ...learned.map(p => ({ ...p, content: historicalCitationText(p.content, readCitationSnapshots(p.citations_json)).slice(0, 2400), kind: 'supplement' as const,
      label: p.source_type === 'manual' ? '用户补充，由用户提供、未独立核实' : 'AI 学习笔记，需结合原始资料核实；建议不代表用户已完成的经历',
      provenance: provenance(readCitationSnapshots(p.citations_json)) }))
  ]
  const citations = entries.map((entry, i) => ({
    ...createCitationSnapshot({ id: entry.id, title: entry.title, content: entry.content, kind: entry.kind,
      ...('url' in entry && typeof entry.url === 'string' ? { url: entry.url } : {}) }, `来源[${i + 1}]`),
    ...('provenance' in entry && entry.provenance.length ? { provenance: entry.provenance } : {}) }))
  return {
    citations,
    context: entries.map((p, i) => `## ${citations[i].ref}: ${p.title} (${p.label})${'url' in p && p.url ? `\n原文：${p.url}` : ''}\n${p.content}`).join('\n\n')
  }
}

export function saveToDisk(db: Database.Database, notebookId: string, title: string, content: string, sourceType: string, entryId?: string): string {
  const setting = db.prepare("SELECT value_json FROM settings WHERE key = 'outputDir'").get() as { value_json: string } | undefined
  const configured: unknown = setting ? JSON.parse(setting.value_json) : null
    const dir = typeof configured === 'string' && configured.trim() ? configured : path.join(os.homedir(), 'Mybook输出')
  fs.mkdirSync(dir, { recursive: true })
  const notebook = db.prepare('SELECT title FROM notebook WHERE id = ?').get(notebookId) as { title: string }
  const safe = (name: string) => name.replace(/[\/\\:*?"<>|\x00-\x1f]/g, '_').slice(0, 40)
  const nbName = `${safe(notebook.title)}_${notebookId.slice(0, 8)}`
  const entry = `## ${title}\n> ${sourceType} | ${new Date().toISOString()}\n\n${content}\n`
  const file = path.join(dir, `${nbName}_${entryId || randomUUID()}.md`)
  fs.writeFileSync(file, entry, 'utf8')
  if (!entryId) fs.appendFileSync(path.join(dir, `${nbName}_补充汇总.md`), `\n---\n${entry}`, 'utf8')
  return file
}

/** Remove the deterministic Markdown export for an entry when its database
 * record is deleted. This only targets files named with the supplied entry
 * UUID, so unrelated user-authored files in the output directory are left
 * untouched. */
export function removeSavedEntry(db: Database.Database, notebookId: string, entryId: string): boolean {
  if (!entryId) return false
  let configured: unknown = null
  try {
    const setting = db.prepare("SELECT value_json FROM settings WHERE key = 'outputDir'").get() as { value_json: string } | undefined
    configured = setting ? JSON.parse(setting.value_json) : null
  } catch { configured = null }
  const dir = typeof configured === 'string' && configured.trim() ? configured : path.join(os.homedir(), 'Mybook输出')
  const notebook = db.prepare('SELECT title FROM notebook WHERE id = ?').get(notebookId) as { title: string } | undefined
  if (!notebook) return false
  const safe = (name: string) => name.replace(/[\/\\:*?"<>|\x00-\x1f]/g, '_').slice(0, 40)
  const file = path.join(dir, `${safe(notebook.title)}_${notebookId.slice(0, 8)}_${entryId}.md`)
  try { fs.rmSync(file, { force: true }); return true } catch { return false }
}
