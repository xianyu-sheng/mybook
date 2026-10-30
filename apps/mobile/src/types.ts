export interface Card {
  id: string
  title: string
  brief_answer: string
  detail_answer: string
  tags_json: string
  created_at: string
  updated_at: string
}

export interface Notebook {
  id: string
  title: string
  description: string
  settings_json: string
  created_at: string
  updated_at: string
}

export interface ResourceSource {
  id: string
  notebook_id: string
  type: string
  title: string
  url: string | null
  content_text: string
  metadata_json: string
  status: string
  created_at: string
  updated_at: string
}

export interface Repository {
  id: string
  name: string
  base_url: string
  homepage: string
  description: string
  revision: string | null
  warning: string | null
  enabled: number
  status: string
  last_synced_at: string | null
  created_at: string
  updated_at: string
}

export interface KnowledgeDocument {
  id: string
  repository_id: string
  path: string
  url: string
  title: string
  content_text: string
  checksum: string
  created_at: string
  updated_at: string
}

export interface ResourceSnippet {
  label: string
  title: string
  content: string
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
  notebooks?: Notebook[]
  sources?: ResourceSource[]
  repositories?: Repository[]
  documents?: KnowledgeDocument[]
  qaSessions: QaSession[]
  qaMessages: QaMessage[]
  interviewSessions: InterviewSession[]
  interviewTurns: InterviewTurn[]
  providers: Provider[]
  activeProviderId?: string | null
  activeModelName?: string | null
}

export interface SyncSettings {
  endpoint: string
  code: string
  deviceId: string
}

export type Tab = 'cards' | 'resources' | 'qa' | 'interview' | 'settings'

export interface DiscoveredDevice {
  name: string
  address: string
  port: number
  endpoint: string
  endpoints?: string[]
  fingerprint: string
  reachable?: boolean
}
