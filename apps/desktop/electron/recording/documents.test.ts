import { describe, expect, it } from 'vitest'
import { mergeTranscriptSegments, recordingMarkdown } from './documents.js'
import type { Recording, TranscriptSegment } from '../../src/types/recording.js'

const segment = (id: number, start: number, end: number, text: string, speaker = '本人', track: TranscriptSegment['track'] = 'microphone'): TranscriptSegment =>
  ({ id, start, end, text, speaker, track })

describe('transcript paragraph merging', () => {
  it('merges nearby segments from the same speaker and reassigns ids', () => {
    const merged = mergeTranscriptSegments([
      segment(0, 0, 2, '您好'),
      segment(1, 2.4, 4, '我准备好了'),
      segment(2, 4.5, 6, '那我们开始', '对方', 'system'),
      segment(3, 6.2, 8, '好的'),
    ])
    expect(merged.map(item => item.text)).toEqual(['您好我准备好了', '那我们开始', '好的'])
    expect(merged.map(item => item.id)).toEqual([0, 1, 2])
    expect(merged[0]).toMatchObject({ start: 0, end: 4 })
  })

  it('keeps long pauses and different tracks separate', () => {
    const merged = mergeTranscriptSegments([
      segment(0, 0, 2, '上半句'),
      segment(1, 5, 6, '隔了很久'),
      segment(2, 6.2, 7, '另一轨', '本人', 'system'),
    ])
    expect(merged.map(item => item.text)).toEqual(['上半句', '隔了很久', '另一轨'])
  })

  it('groups segments in the exported markdown', () => {
    const record = {
      id: 'r', notebook_id: null, title: 't', company: '', role: '', jd: '', tags: [], status: 'transcribed',
      duration: 10, created_at: '', started_at: null, tracks: [], report: null, error: null, export_error: null, shared: true,
      segments: [segment(0, 0, 2, '您好'), segment(1, 2.2, 4, '我准备好了')],
    } as Recording
    expect(recordingMarkdown(record)).toContain('[00:00] 本人：您好我准备好了')
  })
})
