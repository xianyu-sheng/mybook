/** Data exchanged with the Android client. Kept structural so the desktop
 * doesn't need to import the mobile renderer. */
export const MOBILE_NOTEBOOK_ID = 'mobile-sync'

export interface MobileCard {
  id: string; title: string; brief_answer: string; detail_answer: string; tags_json: string
  created_at: string; updated_at: string
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
  qaSessions: MobileQaSession[]
  qaMessages: MobileQaMessage[]
  interviewSessions: MobileInterviewSession[]
  interviewTurns: MobileInterviewTurn[]
  providers: MobileProvider[]
}
