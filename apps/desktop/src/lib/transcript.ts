import type { TranscriptSegment } from '@/types/recording'
import * as OpenCC from 'opencc-js'

export interface TranscriptGroup {
  id: number
  track: TranscriptSegment['track']
  speaker: string
  start: number
  end: number
  text: string
  segmentIds: number[]
}

const CJK_BOUNDARY = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/

const toSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' })
function joinText(left: string, right: string) {
  if (!left) return right
  if (!right) return left
  return CJK_BOUNDARY.test(left[left.length - 1]) || CJK_BOUNDARY.test(right[0])
    ? `${left}${right}`
    : `${left} ${right}`
}

/** Whisper 会按停顿切成 2-3 秒的小片段；展示时合并为同一说话人的连续段落。
 * 只影响阅读视图，校对仍按原始片段编辑。 */
export function groupTranscript(segments: TranscriptSegment[], maxGap = 3.2, maxChars = 360): TranscriptGroup[] {
  const groups: TranscriptGroup[] = []
  for (const original of [...segments].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const segment = { ...original, text: toSimplified(original.text) }
    const previous = groups[groups.length - 1]
    if (previous && previous.track === segment.track && previous.speaker === segment.speaker
      && segment.start - previous.end <= maxGap
      && previous.text.length + segment.text.length <= maxChars) {
      previous.text = joinText(previous.text, segment.text)
      previous.end = Math.max(previous.end, segment.end)
      previous.segmentIds.push(segment.id)
      continue
    }
    groups.push({
      id: segment.id, track: segment.track, speaker: segment.speaker,
      start: segment.start, end: segment.end, text: segment.text, segmentIds: [segment.id],
    })
  }
  return groups
}
