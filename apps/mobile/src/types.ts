export interface Card {
  id: string
  title: string
  brief_answer: string
  detail_answer: string
  tags_json: string
  created_at: string
  updated_at: string
}

export interface QaSession {
  id: string
  title: string
  created_at: string
  updated_at: string
}

export interface QaMessage {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  content: string
  citations_json: string
  created_at: string
}

export interface InterviewSession {
  id: string
  title: string
  company: string
  role: string
  jd: string
  status: 'active' | 'completed'
  created_at: string
  updated_at: string
}

export interface InterviewTurn {
  id: string
  session_id: string
  question: string
  answer: string
  feedback: string
  score: number | null
  reference_answer: string
  knowledge: string
  created_at: string
}

export interface Provider {
  id: string
  name: string
  provider: 'openai' | 'anthropic'
  baseURL: string
  apiKey: string
  models: string[]
  wireApi?: 'chat' | 'responses'
}

export interface SyncPayload {
  version: 1
  deviceId: string
  generatedAt: string
  cards: Card[]
  qaSessions: QaSession[]
  qaMessages: QaMessage[]
  interviewSessions: InterviewSession[]
  interviewTurns: InterviewTurn[]
  providers: Provider[]
}

export interface SyncSettings {
  endpoint: string
  code: string
  deviceId: string
}

export type Tab = 'cards' | 'qa' | 'interview' | 'settings'

export interface DiscoveredDevice {
  name: string
  address: string
  port: number
  endpoint: string
  fingerprint: string
}
