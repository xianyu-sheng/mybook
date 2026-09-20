export type CodingStrategyStatus = 'draft' | 'active' | 'completed' | 'archived'
export type CodingProblemDifficulty = 'easy' | 'medium' | 'hard' | 'unknown'
export type CodingProblemStatus = 'planned' | 'learning' | 'attempted' | 'mastered' | 'skipped'
export type CodingPhase = 'foundation' | 'pattern' | 'company' | 'stretch'
export type CodingAttemptStatus = 'draft' | 'reviewing' | 'reviewed' | 'error'
export type CodingPlatform = 'leetcode' | 'nowcoder'

export interface CodingResearchItem {
  source: string
  title: string
  url: string
  snippet: string
  retrieved_at: string
  warning?: string
}

export interface CodingStrategyInput {
  title?: string
  company: string
  department?: string
  role: string
  jd?: string
  tags?: string[]
  sources?: string[]
  target_role_id?: string | null
}

export interface CodingStrategySummary {
  id: string
  target_role_id: string | null
  title: string
  company: string
  department: string
  role: string
  jd: string
  tags: string[]
  sources: string[]
  status: CodingStrategyStatus
  research: CodingResearchItem[]
  research_error: string | null
  last_researched_at: string | null
  last_synced_at: string | null
  sync: Record<string, unknown>
  sync_error: string | null
  problem_count: number
  completed_count: number
  reviewed_count: number
  next_problem: CodingStrategyProblem | null
  created_at: string
  updated_at: string
}

export interface CodingProblem {
  id: string
  canonical_key: string
  source: string
  source_id: string | null
  source_url: string
  title: string
  difficulty: CodingProblemDifficulty
  tags: string[]
  knowledge: string[]
  statement: string
  constraints: string
  examples: Array<Record<string, unknown> | string>
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface CodingAttempt {
  id: string
  strategy_problem_id: string
  language: string
  thought: string
  code: string
  time_complexity: string
  space_complexity: string
  notes: string
  status: CodingAttemptStatus
  review: CodingReview | null
  model_name: string | null
  error: string | null
  created_at: string
  updated_at: string
}

export interface CodingStrategyProblem {
  id: string
  strategy_id: string
  problem_id: string
  sort_order: number
  phase: CodingPhase
  reason: string
  prerequisites: string[]
  status: CodingProblemStatus
  due_at: string | null
  last_attempted_at: string | null
  problem: CodingProblem
  attempts: CodingAttempt[]
  sync: CodingSyncRecord[]
  created_at: string
  updated_at: string
}

export interface CodingStrategy extends CodingStrategySummary {
  problems: CodingStrategyProblem[]
}

export interface CodingReview {
  score: number
  verdict: 'correct' | 'mostly_correct' | 'incorrect' | 'incomplete'
  summary: string
  thought_feedback: string
  code_feedback: string
  complexity: { time: string; space: string; correctness: string }
  better_approaches: string[]
  advanced_followups: string[]
  missed_concepts: string[]
  corrected_solution: string
  next_steps: string[]
  notice?: string
}

export interface CodingAttemptInput {
  strategy_problem_id: string
  language?: string
  thought?: string
  code?: string
  time_complexity?: string
  space_complexity?: string
  notes?: string
}

export interface CodingSyncRecord {
  id: string
  strategy_id: string
  strategy_problem_id: string | null
  platform: CodingPlatform
  external_id: string
  external_title: string
  external_status: string
  external_url: string
  metadata: Record<string, unknown>
  synced_at: string
}

export interface CodingSyncResult {
  strategy_id: string
  platform: CodingPlatform
  success: boolean
  imported: number
  matched: number
  username?: string
  warning?: string
  error?: string
  synced_at: string
  records: CodingSyncRecord[]
}

export interface CodingApi {
  listStrategies: () => Promise<CodingStrategySummary[]>
  getStrategy: (id: string) => Promise<CodingStrategy>
  createStrategy: (input: CodingStrategyInput) => Promise<CodingStrategy>
  updateStrategy: (id: string, patch: Partial<CodingStrategyInput> & { status?: CodingStrategyStatus }) => Promise<CodingStrategy>
  deleteStrategy: (id: string) => Promise<void>
  search: (id: string) => Promise<CodingStrategy>
  plan: (id: string) => Promise<CodingStrategy>
  updateProblemStatus: (id: string, status: CodingProblemStatus) => Promise<CodingStrategyProblem>
  saveAttempt: (input: CodingAttemptInput) => Promise<CodingAttempt>
  reviewAttempt: (id: string) => Promise<CodingAttempt>
  sync: (id: string, platform: CodingPlatform) => Promise<CodingSyncResult>
  openSource: (id: string, url: string) => Promise<void>
}
