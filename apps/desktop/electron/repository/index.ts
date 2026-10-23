import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'

const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
const stopWords = new Set(['的', '了', '是', '在', '和', '与', '或', '请', '请问', '如何', '什么', '为什么', '怎么', '怎样', '哪些', '是否', '一个', '这个', '那个', '可以', '进行', '以及', '我们', '你们', '我', '你', 'the', 'a', 'an', 'is', 'are', 'of', 'to', 'and', 'or', 'how', 'what', 'why', 'please'])
// Preserve language names whose punctuation otherwise disappears during tokenization.
const technicalAliases: Record<string, string> = { cplusplus: 'c', csharp: 'c', dotnet: 'net' }
export function technicalQueryLiterals(query: string): string[] {
  return [...new Set([...query.toLowerCase().matchAll(/(?<![a-z0-9_])(?:c\+\+|c#|\.net\b)/gu)].map(match => match[0]))]
}
export function tokenize(text: string): string[] {
  const normalized = text.toLowerCase()
    .replace(/(?<![a-z0-9_])c\+\+/gu, ' cplusplus ')
    .replace(/(?<![a-z0-9_])c#/gu, ' csharp ')
    .replace(/(?<![a-z0-9_])\.net\b/gu, ' dotnet ')
  return [...segmenter.segment(normalized)].filter(p => p.isWordLike).map(p => p.segment)
}
export function searchTerms(text: string): string[] {
  return [...new Set(tokenize(text))].filter(term => !stopWords.has(term) && (term.length > 1 || /^[cr]$/.test(term)))
}
export function relevanceScore(text: string, terms: readonly string[]): number {
  const body = new Set(searchTerms(text))
  return terms.reduce((sum, term) => sum + Number(body.has(term)), 0)
}
export function matchQuery(query: string): string {
  const terms = [...new Set(searchTerms(query).slice(0, 40).flatMap(term => [term, ...(technicalAliases[term] ? [technicalAliases[term]] : [])]))]
  // The alias also matches pre-0.5 indices. Callers recheck original text to avoid
  // interpreting a legacy C# token as C++; new syncs write the distinct tokens.
  return terms.map(term => `"${term.replace(/"/g, '""')}"`).join(' OR ')
}
export interface IndexedDocument { path: string; title: string; content: string; url: string; blobSha?: string }
export interface IndexMergeOptions {
  removedPaths?: string[]
  backfill?: Array<{ path: string; blobSha: string }>
}
/** Merge only new/changed documents into the repository index. Existing rows
 * are kept, so an incremental sync never re-tokenizes the whole repository. */
export function mergeIndex(db: Database.Database, repositoryId: string, documents: IndexedDocument[], revision: string, warning: string | null, options: IndexMergeOptions = {}) {
  const insertDoc = db.prepare('INSERT INTO global_document(id,repository_id,path,url,title,content_text,checksum,blob_sha) VALUES (?,?,?,?,?,?,?,?)')
  const insertChunk = db.prepare('INSERT INTO global_chunk(document_id,content) VALUES (?,?)')
  const insertFts = db.prepare('INSERT INTO global_search(rowid,title_tokens,body_tokens) VALUES (?,?,?)')
  const deleteDoc = db.prepare('DELETE FROM global_document WHERE id=?')
  const deletePath = db.prepare('DELETE FROM global_document WHERE repository_id=? AND path=?')
  const backfill = db.prepare('UPDATE global_document SET blob_sha=? WHERE repository_id=? AND path=? AND blob_sha IS NULL')
  db.transaction(() => {
    for (const path of options.removedPaths || []) deletePath.run(repositoryId, path)
    for (const doc of documents) {
      const id = createHash('sha256').update(`${repositoryId}:${doc.path}`).digest('hex')
      // A changed document keeps its stable id; replace its content and chunks.
      deleteDoc.run(id)
      insertDoc.run(id, repositoryId, doc.path, doc.url, doc.title, doc.content, createHash('sha256').update(doc.content).digest('hex'), doc.blobSha || null)
      const titleTokens = tokenize(`${doc.title} ${doc.path}`).join(' ')
      for (let offset = 0; offset < doc.content.length; offset += 1400) {
        const content = doc.content.slice(offset, offset + 1800)
        const chunkId = insertChunk.run(id, content).lastInsertRowid
        insertFts.run(chunkId, titleTokens, tokenize(content).join(' '))
      }
    }
    for (const entry of options.backfill || []) backfill.run(entry.blobSha, repositoryId, entry.path)
    db.prepare("UPDATE global_repository SET status='ready', revision=?, warning=?, last_error=NULL, last_synced_at=datetime('now'), updated_at=datetime('now') WHERE id=?").run(revision, warning, repositoryId)
  })()
}
/** Rebuild a repository snapshot (used by tests and maintenance tools). */
export function replaceIndex(db: Database.Database, repositoryId: string, documents: IndexedDocument[], revision: string, warning: string | null) {
  db.prepare('DELETE FROM global_document WHERE repository_id=?').run(repositoryId)
  mergeIndex(db, repositoryId, documents, revision, warning)
}

export function searchGlobalKnowledge(db: Database.Database, query: string, limit = 6) {
  const match = matchQuery(query)
  if (!match) return []
  const terms = searchTerms(query)
  const literals = technicalQueryLiterals(query)
  const literalFilter = literals.length ? ` AND (${literals.map(() => "instr(lower(d.title || ' ' || c.content), ?) > 0").join(' OR ')})` : ''
  const rows = db.prepare(`SELECT d.id,d.title,d.url,r.name AS repository_name,c.content, bm25(global_search,3,1) AS score
    FROM global_search JOIN global_chunk c ON c.id=global_search.rowid
    JOIN global_document d ON d.id=c.document_id JOIN global_repository r ON r.id=d.repository_id
    WHERE global_search MATCH ? AND r.enabled=1${literalFilter} ORDER BY score LIMIT 40`).all(match, ...literals) as Array<{ id: string; title: string; url: string; repository_name: string; content: string; score: number }>
  const perDocument = new Map<string, number>()
  return rows.filter(row => {
    if (!relevanceScore(`${row.title} ${row.content}`, terms)) return false
    const count = perDocument.get(row.id) || 0
    perDocument.set(row.id, count + 1)
    return count < 2
  }).slice(0, limit)
}

/** Explicit discovery for card generation, separate from relevance-based question answering. */
export function browseGlobalKnowledge(db: Database.Database, limit = 6) {
  return db.prepare(`WITH candidates AS (SELECT d.id,d.title,d.url,d.repository_id,r.name AS repository_name,c.content,
    row_number() OVER (PARTITION BY d.repository_id ORDER BY d.path) AS document_order FROM global_document d
    JOIN global_repository r ON r.id=d.repository_id JOIN global_chunk c ON c.id=(SELECT MIN(id) FROM global_chunk WHERE document_id=d.id)
    WHERE r.enabled=1) SELECT id,title,url,repository_name,content FROM candidates
    ORDER BY document_order,repository_id LIMIT ?`).all(limit) as Array<{ id: string; title: string; url: string; repository_name: string; content: string }>
}
