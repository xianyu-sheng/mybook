export interface ResearchItem {
  title: string
  url: string
  snippet: string
  retrieved_at: string
}

export interface InterviewInput {
  company: string
  department: string
  role: string
  jd: string
  tags: string[]
  search_web: boolean
  question_count: number
}

export interface InterviewTurn {
  id: string
  session_id: string
  question: string
  answer: string | null
  feedback: string | null
  score: number | null
  reference_answer: string | null
  knowledge: string | null
  model_name: string | null
  citations_json?: string
  question_citations_json?: string
  created_at: string
}

export interface InterviewSession extends InterviewInput {
  id: string
  notebook_id: string
  title: string
  status: 'draft' | 'active' | 'completed'
  research: ResearchItem[]
  research_error: string | null
  export_error: string | null
  created_at: string
  updated_at: string
  turns: InterviewTurn[]
}
