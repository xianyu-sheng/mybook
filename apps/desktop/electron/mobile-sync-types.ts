/** Data exchanged with the Android client. Kept structural so the desktop
 * doesn't need to import the mobile renderer. */
export const MOBILE_NOTEBOOK_ID = 'mobile-sync'

export interface MobileCard {
  id: string; title: string; brief_answer: string; detail_answer: string; tags_json: string
  created_at: string; updated_at: string
}

export interface MobileNotebook {
  id: string; title: string; description: string; settings_json: string
  created_at: string; updated_at: string
}

/** 资料正文会一起同步到手机；手机端只读展示，不在手机里修改。 */
export interface MobileSource {
  id: string; notebook_id: string; type: string; title: string; url: string | null
  content_text: string; metadata_json: string; status: string
  created_at: string; updated_at: string
}

export interface MobileRepository {
  id: string; name: string; base_url: string; homepage: string; description: string
  revision: string | null; warning: string | null; enabled: number; status: string
  last_synced_at: string | null; created_at: string; updated_at: string
}

export interface MobileDocument {
  id: string; repository_id: string; path: string; url: string; title: string
  content_text: string; checksum: string; created_at: string; updated_at: string
}

export interface MobileQaSession { id: string; title: string; created_at: string; updated_at: string }
export interface MobileQaMessage {
  id: string; session_id: string; role: 'user' | 'assistant'; content: string; citations_json: string; created_at: string
}
export interface MobileInterviewSession {
  id: string; title: string; company: string; role: string; jd: string; status: string
  created_at: string; updated_at: string
}
export interface MobileInterviewTurn {
  id: string; session_id: string; question: string; answer: string; feedback: string; score: number | null
  reference_answer: string; knowledge: string; created_at: string
}
export interface MobileProvider {
  id: string; name: string; provider: 'openai' | 'anthropic'; baseURL: string; apiKey: string
  models: string[]; wireApi?: string
}

export interface MobileSyncPayload {
  version: 1
  deviceId: string
  generatedAt: string
  cards: MobileCard[]
  notebooks?: MobileNotebook[]
  sources?: MobileSource[]
  repositories?: MobileRepository[]
  documents?: MobileDocument[]
  qaSessions: MobileQaSession[]
  qaMessages: MobileQaMessage[]
  interviewSessions: MobileInterviewSession[]
  interviewTurns: MobileInterviewTurn[]
  providers: MobileProvider[]
  activeProviderId?: string | null
  activeModelName?: string | null
}
