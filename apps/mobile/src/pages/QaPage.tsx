import { useEffect, useState } from 'react'
import { Loader2, MessageSquarePlus, Send } from 'lucide-react'
import type { AiConfig } from '../App'
import type { QaMessage, QaSession } from '../types'
import { appendQaMessage, createQaSession, listCards, listQaMessages, listQaSessions, nowSql, renameQaSession } from '../db'
import { chat } from '../ai'
import { qaPrompt } from '../prompts'
import Markdown from '../components/Markdown'

export default function QaPage({ config }: { config: AiConfig }) {
  const [sessions, setSessions] = useState<QaSession[]>([])
  const [activeId, setActiveId] = useState('')
  const [messages, setMessages] = useState<QaMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refreshSessions = (select = '') => {
    const list = listQaSessions()
    setSessions(list)
    setActiveId(select || list[0]?.id || '')
  }
  useEffect(() => { refreshSessions() }, [])
  useEffect(() => { setMessages(activeId ? listQaMessages(activeId) : []) }, [activeId])

  const newSession = () => {
    const session = createQaSession()
    refreshSessions(session.id)
  }

  const send = async () => {
    const question = input.trim()
    if (!question || busy) return
    if (!config.provider) { setError('请先到设置里配置 AI 供应商'); return }
    let sessionId = activeId
    if (!sessionId) {
      const session = createQaSession(question.slice(0, 24))
      sessionId = session.id
      refreshSessions(session.id)
    }
    const time = nowSql()
    const prior = messages
    const userMessage: QaMessage = {
      id: crypto.randomUUID(), session_id: sessionId, role: 'user', content: question,
      citations_json: '[]', created_at: time,
    }
    appendQaMessage(userMessage)
    setMessages([...prior, userMessage])
    setInput('')
    setBusy(true); setError('')
    try {
      if (!sessions.find(session => session.id === sessionId)) refreshSessions(sessionId)
      const answer = await chat(config.provider, config.model, [
        { role: 'user', content: qaPrompt(listCards(), prior, question) },
      ], 6000)
      const assistant: QaMessage = {
        id: crypto.randomUUID(), session_id: sessionId, role: 'assistant', content: answer.trim(),
        citations_json: '[]', created_at: nowSql(),
      }
      appendQaMessage(assistant)
      setMessages(listQaMessages(sessionId))
      const session = sessions.find(item => item.id === sessionId)
      if (session && (session.title === '手机问答' || !session.title)) {
        renameQaSession(sessionId, question.slice(0, 30))
        refreshSessions(sessionId)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally { setBusy(false) }
  }

  return <div className="page">
    <section className="hero">
      <div><span className="eyebrow">跨卡片复习</span><h2>知识问答</h2><p>回答会参考手机上的卡片；没有资料时会明确说明。</p></div>
      <button className="icon" title="新会话" onClick={newSession}><MessageSquarePlus size={18} /></button>
    </section>

    <div className="session-strip">
      {sessions.map(session => <button key={session.id} className={activeId === session.id ? 'chip active' : 'chip'} onClick={() => setActiveId(session.id)}>{session.title}</button>)}
      {!sessions.length && <span className="muted">还没有会话，直接提问即可创建。</span>}
    </div>

    <section className="chat">
      {messages.map(message => <div key={message.id} className={`bubble ${message.role}`}>
        {message.role === 'assistant' ? <Markdown>{message.content}</Markdown> : <p>{message.content}</p>}
      </div>)}
      {!messages.length && <div className="empty">问一个跨卡片的问题，比如“把 RAG 评测讲成面试回答”。</div>}
      {busy && <div className="bubble assistant thinking"><Loader2 className="spin" size={16} /> 正在组织回答…</div>}
    </section>

    {error && <p className="alert error">{error}</p>}
    <div className="composer">
      <textarea value={input} onChange={event => setInput(event.target.value)} rows={2} placeholder="输入问题…" onKeyDown={event => {
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() }
      }} />
      <button className="primary send" disabled={busy || !input.trim()} onClick={() => void send()}><Send size={18} /></button>
    </div>
  </div>
}
