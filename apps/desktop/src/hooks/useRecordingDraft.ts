import { useCallback, useSyncExternalStore } from 'react'
import type { Recording, RecordingInput, TranscriptSegment } from '@/types/recording'

type Draft = { base: string } & (
  { kind: 'metadata'; value: RecordingInput } |
  { kind: 'transcript'; value: TranscriptSegment[] }
)
const cache = new Map<string, Draft | null>()
const warnings = new Map<string, string>()
const listeners = new Map<string, Set<() => void>>()
const key = (id: string) => 'mybook:recording-draft:1:' + id
export const RECORDING_SAVED_EVENT = 'mybook:recording-saved'
export const recordingMetadata = (record: RecordingInput): RecordingInput => ({
  title: record.title, notebook_id: record.notebook_id, company: record.company,
  role: record.role, jd: record.jd, tags: [...record.tags],
})
export const normalizeRecordingInput = (value: RecordingInput): RecordingInput => ({
  ...value, tags: [...new Set(value.tags.map(tag => tag.trim()).filter(Boolean))],
})
export function clearRecordingDraft(id: string) {
  persistDraft(id, null)
}
function readDraft(id: string): Draft | null {
  if (cache.has(id)) return cache.get(id) || null
  try {
    const draft = JSON.parse(localStorage.getItem(key(id)) || 'null')
    if (draft && typeof draft.base === 'string' && (
      draft.kind === 'transcript' && Array.isArray(draft.value) && draft.value.every((s: TranscriptSegment) => typeof s?.text === 'string' && typeof s.id === 'number') ||
      draft.kind === 'metadata' && typeof draft.value?.title === 'string' && Array.isArray(draft.value?.tags)
    )) { cache.set(id, draft); return draft }
  } catch { /* A damaged draft must not prevent opening a recording. */ }
  cache.set(id, null)
  return null
}

function subscribe(id: string, listener: () => void) {
  const subscribers = listeners.get(id) || new Set<() => void>()
  listeners.set(id, subscribers)
  subscribers.add(listener)
  return () => {
    subscribers.delete(listener)
    if (!subscribers.size) listeners.delete(id)
  }
}
function persistDraft(id: string, next: Draft | null) {
  cache.set(id, next)
  try {
    if (next) localStorage.setItem(key(id), JSON.stringify(next))
    else localStorage.removeItem(key(id))
    warnings.delete(id)
  } catch {
    warnings.set(id, next
      ? '草稿暂存于本次运行中，本地存储空间不足或不可用。请保存修改后再退出或刷新应用。'
      : '本地草稿清理失败，已保存的文档不受影响。重新打开时请检查是否恢复了旧草稿。')
  }
  listeners.get(id)?.forEach(listener => listener())
}
const fingerprint = (record: Recording, kind: Draft['kind']) => JSON.stringify(kind === 'transcript' ? record.segments : recordingMetadata(record))

export function useRecordingDraft(record: Recording) {
  const observe = useCallback((listener: () => void) => subscribe(record.id, listener), [record.id])
  const draft = useSyncExternalStore(observe, () => readDraft(record.id))
  const warning = useSyncExternalStore(observe, () => warnings.get(record.id) || '')
  const base = (kind: Draft['kind']) => fingerprint(record, kind)
  const persist = (next: Draft | null) => persistDraft(record.id, next)
  return {
    draft, warning, conflict: Boolean(draft && draft.base !== base(draft.kind)),
    metadata: draft?.kind === 'metadata' ? draft.value : null,
    segments: draft?.kind === 'transcript' ? draft.value : null,
    setMetadata: (value: RecordingInput) => persist({ kind: 'metadata', base: draft?.kind === 'metadata' ? draft.base : base('metadata'), value: recordingMetadata(value) }),
    setSegments: (value: TranscriptSegment[]) => persist({ kind: 'transcript', base: draft?.kind === 'transcript' ? draft.base : base('transcript'), value }),
    clear: () => persist(null),
    saved: (savedRecord: Recording) => {
      // The original page may have unmounted while IPC was saving.
      window.dispatchEvent(new CustomEvent(RECORDING_SAVED_EVENT, { detail: savedRecord }))
      const latest = readDraft(record.id)
      if (!draft || !latest) return
      if (latest === draft) persist(null)
      // A save can finish after navigation, when another mounted editor has newer edits.
      // Preserve those edits and rebase them on the record this save actually wrote.
      else if (latest.kind === draft.kind && latest.base === draft.base) {
        persist({ ...latest, base: fingerprint(savedRecord, latest.kind) })
      }
    },
  }
}
