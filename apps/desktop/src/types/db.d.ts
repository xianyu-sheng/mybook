// ---- 数据库类型 ----
import type { InterviewInput, InterviewSession } from './interview'
import type { RepositoryApi } from './repository'
import type { RecordingApi } from './recording'
import type { PracticeApi } from './practice'
import type { TargetApi } from './target'
import type { CodingApi } from './coding'
export interface Notebook {
  id: string
  title: string
  description: string
  settings_json: string
  archived_at?: string | null
  created_at: string
  updated_at: string
}

export type SourceType = 'pdf' | 'docx' | 'url' | 'github' | 'markdown' | 'text'
export type SourceStatus = 'pending' | 'processing' | 'ready' | 'error'

export interface Source {
  id: string
  notebook_id: string
  type: SourceType
  title: string
  file_path: string | null
  url: string | null
  content_text: string | null
  metadata_json: string
  status: SourceStatus
  error_message: string | null
  created_at: string
  updated_at: string
}

export interface SourceSummary {
  summary: string
  keyTopics: string[]
  suggestedQuestions: string[]
}

export interface Chunk {
  id: string
  source_id: string
  chunk_index: number
  content: string
  token_count: number
  created_at: string
}

export type CardStatus = 'draft' | 'brief_ready' | 'detail_ready'

export type GenerateMode = 'interview-qa' | 'study-guide' | 'key-concepts' | 'project-highlights'

export interface GenerateModeDef {
  key: GenerateMode
  label: string
  description: string
  icon: string
}

export interface Card {
  id: string
  notebook_id: string
  title: string
  brief_answer: string
  detail_answer: string | null
  source_ids: string   // JSON array
  citations_json?: string
  tags_json: string    // JSON array
  status: CardStatus
  created_at: string
  updated_at: string
}

export interface CardAnswer {
  id: string
  card_id: string
  question: string
  answer: string
  model_name: string
  created_at: string
}

export type SupplementSourceType = 'card_brief' | 'card_detail' | 'qa' | 'manual'

export interface Supplement {
  id: string
  notebook_id: string
  title: string
  content: string
  source_type: SupplementSourceType
  reference_id: string | null
  embedding_text: string | null
  citations_json?: string
  created_at: string
}

// ---- AI 类型 ----
export interface ModelDef {
  id: string
  name: string
  provider: 'anthropic' | 'openai' | 'ollama'
  modelId: string
  isEmbedding?: boolean
}

export interface AiAnswer {
  answer: string
  fromSupplement: boolean
  supplementId?: string
  citations?: Array<{ ref: string; title: string }>
  followUpQuestions?: string[]
  warning?: string
  error?: boolean
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations_json: string
}


// ---- IPC 类型 ----
export interface KnowMindApi {
  ping: () => Promise<string>

  notebooks: {
    create: (title: string, description?: string, template?: string) => Promise<Notebook>
    list: () => Promise<Notebook[]>
    listArchived: () => Promise<Notebook[]>
    archive: (id: string) => Promise<void>
    restore: (id: string) => Promise<Notebook>
    get: (id: string) => Promise<Notebook | null>
    update: (id: string, patch: Record<string, unknown>) => Promise<Notebook>
    delete: (id: string) => Promise<void>
  }

  sources: {
    upload: (notebookId: string, filePath: string) => Promise<Source>
    addUrl: (notebookId: string, url: string) => Promise<Source>
    list: (notebookId: string) => Promise<Source[]>
    get: (id: string) => Promise<Source | null>
    delete: (id: string) => Promise<void>
    getContent: (id: string) => Promise<string>
    getSummary: (id: string) => Promise<SourceSummary | null>
  }

  cards: {
    onProgress: (callback: (progress: { notebookId: string; phase: 'attempt' | 'fallback' | 'success'; model: string; completed: number; requested: number; reason?: string }) => void) => () => void
    generate: (notebookId: string, count?: number, mode?: string) => Promise<Card[]>
    list: (notebookId: string) => Promise<Card[]>
    get: (id: string) => Promise<Card | null>
    expandDetail: (cardId: string) => Promise<Card>
    update: (cardId: string, patch: Record<string, unknown>) => Promise<Card>
    delete: (cardId: string) => Promise<void>
  }

  ai: {
    history: (notebookId: string) => Promise<ChatMessage[]>
    query: (notebookId: string, question: string) => Promise<AiAnswer>
    listModels: () => Promise<Array<{
      key: string; name: string; provider: 'openai' | 'anthropic'
      modelName: string; appType: string; isCCSwitchActive: boolean; isCustom: boolean; isActive: boolean
    }>>
    listProviders: () => Promise<AiProviderInfo[]>
    saveProvider: (input: AiProviderInput) => Promise<AiProviderInfo[]>
    deleteProvider: (id: string) => Promise<AiProviderInfo[]>
    setActiveModel: (modelKey: string) => Promise<boolean>
    testConnection: (modelKey: string) => Promise<boolean>
  }

  supplement: {
    list: (notebookId: string) => Promise<Supplement[]>
    export: (notebookId: string) => Promise<string>
    getContent: (id: string) => Promise<string>
    delete: (id: string) => Promise<void>
  }

  interviews: {
    list: (notebookId: string) => Promise<InterviewSession[]>
    get: (id: string) => Promise<InterviewSession>
    create: (notebookId: string, input: InterviewInput) => Promise<InterviewSession>
    update: (id: string, patch: { title: string; tags: string[] }) => Promise<InterviewSession>
    delete: (id: string) => Promise<void>
    research: (id: string) => Promise<InterviewSession>
    start: (id: string) => Promise<InterviewSession>
    answer: (id: string, turnId: string, answer: string) => Promise<InterviewSession>
    retryAnswer: (id: string, turnId: string) => Promise<InterviewSession>
    finish: (id: string) => Promise<InterviewSession>
    export: (id: string) => Promise<{ markdown: string; error: string | null }>
    openSource: (id: string, url: string) => Promise<void>
  }

  settings: {
    get: (key: string) => Promise<unknown>
    set: (key: string, value: unknown) => Promise<void>
    getAll: () => Promise<Record<string, unknown>>
  }

  repositories: RepositoryApi
  recordings: RecordingApi
  practice: PracticeApi
  targets: TargetApi
  coding: CodingApi

  dialog: {
    openFile: (filters?: Array<{ name: string; extensions: string[] }>) => Promise<string | null>
    openFiles: (filters?: Array<{ name: string; extensions: string[] }>) => Promise<string[]>
    openDirectory: () => Promise<string | null>
  }

  auth: {
    save: (auth: PlatformAuth) => Promise<boolean>
    get: (platform: string) => Promise<PlatformAuth | null>
    status: () => Promise<PlatformStatus>
    disconnect: (platform: string) => Promise<boolean>
    githubConnect: () => Promise<AuthResult>
    leetcodeLogin: () => Promise<AuthResult>
    nowcoderLogin: () => Promise<AuthResult>
    saveCookie: (platform: string, cookieStr: string) => Promise<AuthResult>
    importData: (notebookId: string, platform: string) => Promise<ImportResult>
  }
}

export interface PlatformAuth {
  platform: 'github' | 'leetcode' | 'nowcoder'
  token: string
  csrfToken?: string
  username?: string
  avatarUrl?: string
  connectedAt: string
}

export interface PlatformStatus {
  github: { connected: boolean; username?: string }
  leetcode: { connected: boolean; username?: string }
  nowcoder: { connected: boolean; username?: string }
}

export interface AiProviderInfo {
  id: string
  name: string
  provider: 'openai' | 'anthropic'
  baseURL: string
  models: string[]
  wireApi: 'chat' | 'responses'
  keyHint: string
  createdAt: string
}

export interface AiProviderInput {
  id?: string
  name: string
  provider: 'openai' | 'anthropic'
  baseURL: string
  apiKey?: string
  models: string
  wireApi?: 'chat' | 'responses'
}

export interface AuthResult {
  success: boolean
  error?: string
  username?: string
  repos?: Array<{ name: string; description: string; language: string; stars: number; topics: string[] }>
  auth?: PlatformAuth
  alreadyConnected?: boolean
  needCookie?: boolean
}

export interface ImportResult {
  success: boolean
  error?: string
  cardsGenerated?: number
  cardGenerationError?: string
  warning?: string
  platformData?: { username: string; description: string }
}

declare global {
  interface Window {
    knowmind: KnowMindApi
  }
}
