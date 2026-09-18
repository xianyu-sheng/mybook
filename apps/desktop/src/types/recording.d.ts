export type RecordingStatus = 'recording' | 'importing' | 'recorded' | 'transcribing' | 'transcribed' | 'analyzing' | 'ready' | 'error'
export type AudioTrack = 'microphone' | 'system' | 'imported'
export interface TranscriptSegment { id: number; track: AudioTrack; speaker: string; start: number; end: number; text: string }
export interface RecordingQuestion {
  question: string; answer: string; evidence: number[]; score: number; strengths: string[]; gaps: string[]
  reference_answer: string; followups: string[]; model: string
  /** Retrieval references for this question; not a claim that the model used every source. */
  citations?: Array<{ ref: string; title: string; id?: string; url?: string }>
}
export interface RecordingReport { questions: RecordingQuestion[]; score: number | null; summaries: string[]; created_at: string }
export interface RecordingInput { title: string; notebook_id: string | null; company: string; role: string; jd: string; tags: string[] }
export interface Recording extends RecordingInput {
  id: string; status: RecordingStatus; duration: number; created_at: string; started_at: string | null
  tracks: Array<{ kind: AudioTrack; label: string; source?: string }>
  segments: TranscriptSegment[]; report: RecordingReport | null; error: string | null; export_error: string | null
  shared: boolean
}
export interface AudioDevice { name: string; label: string; monitor: boolean; muted: boolean; isDefault: boolean }
export interface RecordingState {
  active: { id: string; title: string; started_at: string; stopping: boolean } | null
  job: { id: string; stage: string; percent: number } | null
  setup: { running: boolean; message: string; ready: boolean }
}
export interface RecordingApi {
  devices: () => Promise<{ devices: AudioDevice[]; error: string | null }>
  state: () => Promise<RecordingState>
  setup: () => Promise<void>
  list: () => Promise<Recording[]>
  get: (id: string) => Promise<Recording>
  start: (input: RecordingInput & { microphone: string; system: string }) => Promise<Recording>
  stop: () => Promise<Recording | null>
  importAudio: (input: RecordingInput) => Promise<Recording | null>
  transcribe: (id: string, language: string) => Promise<void>
  analyze: (id: string) => Promise<void>
  cancel: () => Promise<void>
  saveTranscript: (id: string, segments: TranscriptSegment[]) => Promise<Recording>
  update: (id: string, patch: RecordingInput & { shared: boolean }) => Promise<Recording>
  delete: (id: string) => Promise<void>
  export: (id: string) => Promise<string | null>
  onState: (callback: (state: RecordingState) => void) => () => void
}
