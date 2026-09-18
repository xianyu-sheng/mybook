export type PracticeSourceType = 'recording' | 'interview' | 'card'
export type PracticeStatus = 'active' | 'mastered' | 'archived'
export type PracticeAttemptStatus = 'evaluating' | 'ready' | 'error'
export interface PracticeCitation {
  ref: string; title: string; id?: string; url?: string
  kind?: 'source' | 'global_document' | 'recording' | 'supplement'
  excerpt?: string; content_hash?: string; retrieved_at?: string
  provenance?: Array<Omit<PracticeCitation, 'provenance'>>
}
export interface PracticeRequirement {
  id: string
  text: string
  origin: 'source_gap' | 'source_knowledge' | 'source_reference' | 'question'
  source_quote: string
  unverified: true
}
export interface PracticeSnapshot {
  source_type: PracticeSourceType
  source_id: string
  source_label: string
  question: string
  original_answer: string
  reference_answer: string
  knowledge: string
  gaps: string[]
  citations: PracticeCitation[]
  /** Question references have their own numbering, separate from the source feedback. */
  question_citations: PracticeCitation[]
  company: string
  role: string
  context: string
  source_model: string | null
  captured_at: string
  /** Exact source text and recording excerpts; preserved when the source is deleted. */
  source_text: string
  evidence: Array<{ id: number; speaker: string; start: number; end: number; text: string }>
  notice: string
}
export interface PracticeCriterionReview {
  requirement_id: string
  status: 'covered' | 'partial' | 'missing'
  /** Exact substrings of this attempt's answer, checked by the backend. */
  quotes: string[]
  feedback: string
  improvement: string
}
export interface PracticeReview {
  summary: string
  criteria: PracticeCriterionReview[]
  next_action: string
  notice: string
}
export interface PracticeAttempt {
  id: string
  item_id: string
  answer: string
  input_version: string
  status: PracticeAttemptStatus
  review: PracticeReview | null
  model_name: string | null
  error: string | null
  created_at: string
  updated_at: string
}
export interface PracticeSummary {
  id: string
  source_type: PracticeSourceType
  source_id: string
  source_label: string
  question: string
  company: string
  role: string
  status: PracticeStatus
  attempt_count: number
  created_at: string
  updated_at: string
}
export interface PracticeItem extends PracticeSummary {
  input_version: string
  reference_locked: boolean
  /** Empty until the first new answer is persisted, including an answer whose AI review failed. */
  requirements: PracticeRequirement[]
  snapshot: PracticeSnapshot | null
  /** Oldest first, including attempts created in the same timestamp second. */
  attempts: PracticeAttempt[]
}
export interface PracticeApi {
  fromRecording: (recordingId: string, questionIndex: number) => Promise<PracticeItem>
  fromInterview: (turnId: string) => Promise<PracticeItem>
  fromCard: (cardId: string) => Promise<PracticeItem>
  list: () => Promise<PracticeSummary[]>
  get: (id: string) => Promise<PracticeItem>
  attempt: (itemId: string, answer: string) => Promise<PracticeItem>
  retry: (attemptId: string) => Promise<PracticeItem>
  delete: (id: string) => Promise<void>
  setStatus: (id: string, status: PracticeStatus) => Promise<PracticeItem>
}
