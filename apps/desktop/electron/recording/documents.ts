import type Database from 'better-sqlite3'
import type { Recording, TranscriptSegment } from '../../src/types/recording.js'
import { matchQuery, technicalQueryLiterals, tokenize } from '../repository/index.js'
import * as OpenCC from 'opencc-js'

export function timeLabel(seconds: number) {
  const value = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}
const CJK_BOUNDARY = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/
// Whisper's Chinese output often uses Traditional Chinese vocabulary. Convert
// deterministically before saving/exporting so the rest of the app is consistent.
const toSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' })
export function toSimplifiedChinese(text: string) {
  return toSimplified(text)
}
function joinTranscriptText(left: string, right: string) {
  if (!left) return right
  if (!right) return left
  return CJK_BOUNDARY.test(left[left.length - 1]) || CJK_BOUNDARY.test(right[0])
    ? `${left}${right}`
    : `${left} ${right}`
}
/** Whisper emits one segment per short pause; merge them into readable turns.
 * Ids are reassigned, so call this before persisting a new transcript. */
export function mergeTranscriptSegments(segments: TranscriptSegment[], maxGap = 2.2, maxChars = 360): TranscriptSegment[] {
  const result: TranscriptSegment[] = []
  for (const original of [...segments].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const segment = { ...original, text: toSimplifiedChinese(original.text) }
    const previous = result.at(-1)
    if (previous && previous.track === segment.track && previous.speaker === segment.speaker
      && segment.start - previous.end <= maxGap
      && previous.text.length + segment.text.length <= maxChars) {
      previous.text = joinTranscriptText(previous.text, segment.text)
      previous.end = Math.max(previous.end, segment.end)
      continue
    }
    result.push(segment)
  }
  return result.map((segment, id) => ({ ...segment, id }))
}
function questionSources(record: Recording, index: number) {
  const citations = record.report?.questions[index]?.citations
  if (!citations?.length) return ''
  return `\n\n本题检索参考资料：\n${citations.map(c => `- ${c.ref}：${c.title}${c.url ? `（${c.url}）` : ''}`).join('\n')}`
}
export function recordingMarkdown(record: Recording) {
  const transcript = mergeTranscriptSegments(record.segments).map(s => `[${timeLabel(s.start)}] ${s.speaker}：${s.text}`).join('\n\n')
  const report = record.report
  return `# ${record.title}\n\n企业：${record.company || '未指定'}\n岗位：${record.role || '未指定'}\n标签：${record.tags.join('、')}\n\n## 岗位要求\n${record.jd}\n\n## 录音转写（可校对）\n${transcript}\n\n${report ? `## AI 面试复盘（待核实）\n综合评分：${report.score ?? '暂无可评分回答'}/100\n\n${report.summaries.join('\n\n')}\n\n${report.questions.map((q, i) => `### ${i + 1}. ${q.question}\n\n我的回答：${q.answer}\n\n评分：${q.score}/100\n\n优点：${q.strengths.join('；')}\n\n答题缺陷：${q.gaps.join('；')}\n\n参考答案：\n${q.reference_answer}${questionSources(record, i)}\n\n建议追问：${q.followups.join('；')}\n\n生成模型：${q.model}`).join('\n\n')}` : ''}`
}

export function indexRecording(db: Database.Database, record: Recording) {
  db.transaction(() => {
    db.prepare('DELETE FROM recording_chunk WHERE recording_id=?').run(record.id)
    if (!record.segments.length) return
    const content = recordingMarkdown(record)
    const title = tokenize(`${record.title} ${record.company} ${record.role} ${record.tags.join(' ')}`).join(' ')
    for (let offset = 0; offset < content.length; offset += 1400) {
      const passage = content.slice(offset, offset + 1800)
      const id = db.prepare('INSERT INTO recording_chunk(recording_id,content) VALUES (?,?)').run(record.id, passage).lastInsertRowid
      db.prepare('INSERT INTO recording_search(rowid,title_tokens,body_tokens) VALUES (?,?,?)').run(id, title, tokenize(passage).join(' '))
    }
  })()
}

export function searchRecordingKnowledge(db: Database.Database, query: string, excludeId = '') {
  const match = matchQuery(query)
  if (!match) return []
  const literals = technicalQueryLiterals(query)
  const literalFilter = literals.length ? ` AND (${literals.map(() => "instr(lower(r.title || ' ' || c.content), ?) > 0").join(' OR ')})` : ''
  const rows = db.prepare(`SELECT r.id,r.title,c.content,bm25(recording_search,3,1) AS score FROM recording_search
    JOIN recording_chunk c ON c.id=recording_search.rowid JOIN recording r ON r.id=c.recording_id
    WHERE recording_search MATCH ? AND r.shared=1 AND r.id<>?${literalFilter} ORDER BY score LIMIT 20`).all(match, excludeId, ...literals) as Array<{ id: string; title: string; content: string; score: number }>
  const counts = new Map<string, number>()
  return rows.filter(row => { const n = counts.get(row.id) || 0; counts.set(row.id, n + 1); return n < 2 }).slice(0, 4)
}

// Keep all utterances in bounded windows, carrying a small overlap across question boundaries.
export function transcriptBatches(segments: TranscriptSegment[], maxChars = 7000) {
  if (!Number.isInteger(maxChars) || maxChars < 100) throw new Error('Invalid transcript window size')
  const batches: TranscriptSegment[][] = []
  let batch: TranscriptSegment[] = [], chars = 0
  const sliceSize = Math.floor(maxChars / 2)
  for (const original of segments) {
    for (let offset = 0; offset < original.text.length; offset += sliceSize) {
      const segment = { ...original, text: original.text.slice(offset, offset + sliceSize) }
      if (batch.length && (chars + segment.text.length > maxChars || batch.length >= 60)) {
        batches.push(batch)
        batch = batch.slice(-2)
        chars = batch.reduce((sum, s) => sum + s.text.length, 0)
        while (batch.length && chars + segment.text.length > maxChars) chars -= batch.shift()!.text.length
      }
      batch.push(segment); chars += segment.text.length
    }
  }
  if (batch.length) batches.push(batch)
  return batches
}
