import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { memoryDb } from '../test-utils/memory-db.js'
import { citationMarkdown, createCitationSnapshot, historicalCitationText, knowledgeContext, readCitationSnapshots, selectCitations } from './knowledge.js'
import { InvalidModelOutput } from './generate.js'
import { matchQuery, replaceIndex, searchGlobalKnowledge } from '../repository/index.js'
import { searchRecordingKnowledge } from '../recording/documents.js'

let db: Database.Database
beforeEach(() => {
  db = memoryDb()
  db.prepare("INSERT INTO notebook(id,title) VALUES ('book','Synthetic notebook')").run()
})
afterEach(() => db.close())
function source(id: string, title: string, content: string) {
  db.prepare("INSERT INTO source(id,notebook_id,type,title,content_text,status) VALUES (?,'book','text',?,?,'ready')").run(id, title, content)
}
function note(id: string, title: string, content: string, citations = '[]') {
  db.prepare("INSERT INTO supplement(id,notebook_id,title,content,source_type,citations_json) VALUES (?,'book',?,?,'qa',?)").run(id, title, content, citations)
}

describe('knowledge retrieval coverage', () => {
  it('finds relevant old notes after 250 unrelated newer notes, including the note tail', () => {
    note('older', '历史追问', '背景资料。'.repeat(1500) + ' EXACTTAILFACT 保留的关键解释。')
    for (let i = 0; i < 250; i++) note(`noise-${i}`, `ordinary-${i}`, `unrelated content ${i}`)
    const result = knowledgeContext(db, 'book', 'EXACTTAILFACT')
    expect(result.citations.map(c => c.id)).toEqual(['older'])
    expect(result.context).toContain('EXACTTAILFACT')
    expect(result.context).toContain('AI 学习笔记，需结合原始资料核实')
  })
  it('does not fill an unrelated query with recent notes or raw sources', () => {
    source('source', '账户登录', '用户名与密码验证')
    note('note', '购物流程', '订单状态说明')
    expect(knowledgeContext(db, 'book', '量子纠缠')).toEqual({ context: '', citations: [] })
    expect(knowledgeContext(db, 'book', '请问如何')).toEqual({ context: '', citations: [] })
  })
  it('uses an explicit diverse browse mode for broad card generation', () => {
    source('a', 'Alpha topic', '甲'.repeat(12000))
    source('b', 'Beta topic', '乙'.repeat(12000))
    source('c', 'Gamma topic', '丙'.repeat(12000))
    expect(knowledgeContext(db, 'book', '面试问答').citations).toHaveLength(0)
    expect(new Set(knowledgeContext(db, 'book', '面试问答', '', { browse: true }).citations.map(c => c.id))).toEqual(new Set(['a', 'b', 'c']))
  })
  it('preserves C++ in local retrieval and distinguishes C#', () => {
    source('cpp', 'C++', 'RAII lifetime ownership')
    source('csharp', 'C#', 'Garbage collection')
    expect(matchQuery('C++')).not.toBe('')
    expect(knowledgeContext(db, 'book', 'C++').citations.map(c => c.id)).toEqual(['cpp'])
    expect(knowledgeContext(db, 'book', '请解释C++').citations.map(c => c.id)).toEqual(['cpp'])
    expect(knowledgeContext(db, 'book', 'C#').citations.map(c => c.id)).toEqual(['csharp'])
  })
  it('finds C++ with pre-upgrade FTS tokens without returning C# documents', () => {
    db.prepare("INSERT INTO global_repository(id,name,base_url) VALUES ('repo','Synthetic','https://example.test/repo')").run()
    replaceIndex(db, 'repo', [
      { path: 'cpp.md', title: 'C++', content: 'C++ RAII lifetime ownership', url: 'https://example.test/cpp' },
      { path: 'csharp.md', title: 'C#', content: 'C# managed memory', url: 'https://example.test/csharp' },
    ], 'test-revision', null)
    db.prepare("UPDATE global_search SET title_tokens='c',body_tokens='c memory'").run()
    expect(searchGlobalKnowledge(db, 'C++').map(p => p.title)).toEqual(['C++'])
    expect(searchGlobalKnowledge(db, '请解释C++').map(p => p.title)).toEqual(['C++'])
    expect(searchGlobalKnowledge(db, 'C#').map(p => p.title)).toEqual(['C#'])
  })
  it('filters legacy recording candidates before the limit and keeps sharing/exclusion effective', () => {
    const addRecording = (id: string, content: string, shared = 1) => {
      db.prepare('INSERT INTO recording(id,title,shared) VALUES (?,?,?)').run(id, id, shared)
      const rowid = db.prepare('INSERT INTO recording_chunk(recording_id,content) VALUES (?,?)').run(id, content).lastInsertRowid
      db.prepare("INSERT INTO recording_search(rowid,title_tokens,body_tokens) VALUES (?,'c','c memory')").run(rowid)
    }
    for (let i = 0; i < 30; i++) addRecording(`csharp-${i}`, 'C# managed memory')
    addRecording('cpp', 'C++ RAII memory')
    addRecording('private-cpp', 'C++ private knowledge', 0)
    expect(searchRecordingKnowledge(db, 'C++').map(p => p.id)).toEqual(['cpp'])
    expect(searchRecordingKnowledge(db, 'C++', 'cpp')).toEqual([])
  })
})

describe('durable knowledge citations', () => {
  it('keeps a snapshot and its original evidence when a saved note is searched again', () => {
    source('original', 'Redis original', 'Redis 持久化需要权衡可靠性。')
    const original = knowledgeContext(db, 'book', 'Redis').citations[0]
    note('saved-note', 'Redis memory', 'Redis memory 参考 来源[1] 的持久化权衡。', JSON.stringify([original]))
    source('newer', 'Redis memory', 'Redis memory 新增资料。')
    db.prepare("UPDATE source SET content_text='Redis 原文已更新。' WHERE id='original'").run()
    const result = knowledgeContext(db, 'book', 'Redis memory')
    expect(result.citations[0].id).toBe('newer')
    expect(result.context).toContain('历史参考《Redis original》（资料 ID：original）')
    expect(result.context.match(/来源\[1\]/g)).toHaveLength(1)
    const saved = result.citations.find(c => c.id === 'saved-note')!
    expect(saved.provenance?.[0].id).toBe('original')
    expect(saved.provenance?.[0].excerpt).toBe('Redis 持久化需要权衡可靠性。')
    expect(saved.provenance?.[0].content_hash).toBe(original.content_hash)
    expect(citationMarkdown([saved])).toContain('该学习记录保存的原始参考')
    expect(citationMarkdown([saved])).toContain(original.content_hash)
  })
  it('does not reinterpret legacy unresolvable reference numbers as new sources', () => {
    note('legacy', 'Legacytopic', 'Legacytopic 见来源[1]和来源[99]。')
    const result = knowledgeContext(db, 'book', 'Legacytopic')
    expect(result.context).toContain('旧记录未保存来源映射')
    expect(result.context.match(/来源\[1\]/g)).toHaveLength(1)
    expect(result.context).not.toContain('来源[99]')
  })
  it('rejects invented references and preserves only explicitly used snapshots', () => {
    const one = createCitationSnapshot({ id: 'one', title: 'One', kind: 'source', content: 'original' }, '来源[1]')
    const ten = createCitationSnapshot({ id: 'ten', title: 'Ten', kind: 'global_document', content: 'reference' }, '来源[10]')
    expect(selectCitations('回答引用 来源[10]', [one, ten])).toEqual([ten])
    expect(selectCitations('无引用通用解释', [one, ten], ['来源[1]', '来源[1]'])).toEqual([one])
    expect(() => selectCitations('来源[999]', [one])).toThrow(InvalidModelOutput)
    expect(() => selectCitations('回答', [one], ['made-up-id'])).toThrow(InvalidModelOutput)
  })
  it('exports self-contained snapshots and supports legacy chat reference labels', () => {
    const snapshot = createCitationSnapshot({ id: 'source', title: 'Project source', kind: 'source', content: '原始项目证据。', url: 'https://example.test/project' }, '来源[1]')
    expect(citationMarkdown([snapshot])).toContain('原始项目证据。')
    expect(citationMarkdown([snapshot])).toContain(snapshot.content_hash)
    const legacy = readCitationSnapshots(JSON.stringify([{ id: 'old', title: 'Older source', ref: '来源[1]' }]))
    expect(historicalCitationText('见来源[1]', legacy)).toContain('Older source')
    expect(readCitationSnapshots('not json')).toEqual([])
  })
})
