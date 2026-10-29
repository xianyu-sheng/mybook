import { useEffect, useState } from 'react'
import { Loader2, Play, Send, SquarePen } from 'lucide-react'
import type { AiConfig } from '../App'
import type { InterviewSession, InterviewTurn } from '../types'
import {
  addInterviewTurn, completeInterviewSession, createInterviewSession, listInterviewSessions,
  listInterviewTurns, nowSql, updateInterviewTurn,
} from '../db'
import { chat, parseJson } from '../ai'
import { mockEvaluatePrompt, mockStartPrompt } from '../prompts'
import Markdown from '../components/Markdown'

export default function InterviewPage({ config }: { config: AiConfig }) {
  const [sessions, setSessions] = useState<InterviewSession[]>([])
  const [activeId, setActiveId] = useState('')
  const [turns, setTurns] = useState<InterviewTurn[]>([])
  const [company, setCompany] = useState('')
  const [role, setRole] = useState('')
  const [jd, setJd] = useState('')
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refreshSessions = (select = '') => {
    const list = listInterviewSessions()
    setSessions(list)
    setActiveId(select || list[0]?.id || '')
  }
  useEffect(() => { refreshSessions() }, [])
  useEffect(() => { setTurns(activeId ? listInterviewTurns(activeId) : []) }, [activeId])

  const active = sessions.find(session => session.id === activeId) || null
  const current = turns.find(turn => !turn.answer) || null
  const finished = turns.length > 0 && !current

  const start = async () => {
    if (!config.provider) { setError('请先到设置里配置 AI 供应商'); return }
    if (!role.trim()) { setError('至少填写岗位，例如 Agent 开发 / 后端'); return }
    setBusy(true); setError('')
    try {
      const session = createInterviewSession(company.trim(), role.trim(), jd.trim())
      const text = await chat(config.provider, config.model, [
        { role: 'user', content: mockStartPrompt(session.company, session.role, session.jd) },
      ], 1500)
      const parsed = parseJson<{ question?: string }>(text)
      const question = String(parsed.question || '').trim()
      if (!question) throw new Error('AI 没有给出第一道题，请重试')
      addInterviewTurn({
        id: crypto.randomUUID(), session_id: session.id, question, answer: '', feedback: '', score: null,
        reference_answer: '', knowledge: '', created_at: nowSql(),
      })
      refreshSessions(session.id)
      setTurns(listInterviewTurns(session.id))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally { setBusy(false) }
  }

  const submit = async () => {
    if (!active || !current || !config.provider || !answer.trim()) return
    setBusy(true); setError('')
    const answered = { ...current, answer: answer.trim() }
    updateInterviewTurn(answered)
    setTurns(listInterviewTurns(active.id))
    setAnswer('')
    try {
      const text = await chat(config.provider, config.model, [
        { role: 'user', content: mockEvaluatePrompt(active.company, active.role, active.jd, turns.filter(turn => turn.id !== current.id), current.question, answered.answer) },
      ], 7000)
      const parsed = parseJson<{ score?: number; feedback?: string; reference_answer?: string; knowledge?: string; next_question?: string }>(text)
      const evaluated: InterviewTurn = {
        ...answered,
        score: Number.isFinite(Number(parsed.score)) ? Math.max(0, Math.min(100, Math.round(Number(parsed.score)))) : null,
        feedback: String(parsed.feedback || '').trim(),
        reference_answer: String(parsed.reference_answer || '').trim(),
        knowledge: String(parsed.knowledge || '').trim(),
      }
      updateInterviewTurn(evaluated)
      const next = String(parsed.next_question || '').trim()
      if (next) {
        addInterviewTurn({
          id: crypto.randomUUID(), session_id: active.id, question: next, answer: '', feedback: '', score: null,
          reference_answer: '', knowledge: '', created_at: nowSql(),
        })
      } else {
        completeInterviewSession(active.id)
      }
      setTurns(listInterviewTurns(active.id))
      refreshSessions(active.id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally { setBusy(false) }
  }

  return <div className="page">
    <section className="hero">
      <div><span className="eyebrow">文字模拟面试</span><h2>面试练习</h2><p>一轮一题，回答后给分、点评、参考答案和下一题。</p></div>
      {Boolean(sessions.length) && <button className="icon" title="新面试" onClick={() => { setActiveId(''); setTurns([]) }}><SquarePen size={18} /></button>}
    </section>

    {sessions.length > 0 && <div className="session-strip">
      {sessions.map(session => <button key={session.id} className={activeId === session.id ? 'chip active' : 'chip'} onClick={() => setActiveId(session.id)}>{session.title}</button>)}
    </div>}

    {!active ? <section className="panel compose">
      <label>目标企业（可选）</label>
      <input value={company} onChange={event => setCompany(event.target.value)} placeholder="例如：字节跳动" />
      <label>岗位 *</label>
      <input value={role} onChange={event => setRole(event.target.value)} placeholder="例如：Agent Harness 研发工程师" />
      <label>JD / 重点（可选）</label>
      <textarea value={jd} onChange={event => setJd(event.target.value)} rows={4} placeholder="粘贴岗位要求，或写本轮想练的重点" />
      <button className="primary" disabled={busy} onClick={() => void start()}>{busy ? <Loader2 className="spin" size={16} /> : <Play size={16} />} {busy ? '准备第一题…' : '开始面试'}</button>
    </section> : <>
      <section className="interview-head">
        <div><h3>{active.title}</h3><p>{active.company || '未指定企业'} · {active.role}</p></div>
        <span className={finished ? 'tag done' : 'tag'}>{finished ? '已结束' : '进行中'}</span>
      </section>

      <section className="stack">
        {turns.filter(turn => turn.answer).map((turn, index) => <article className="panel turn" key={turn.id}>
          <div className="turn-head"><span>第 {index + 1} 题</span>{turn.score !== null && <strong>{turn.score}</strong>}</div>
          <h4>{turn.question}</h4>
          <p className="muted">我的回答</p><p className="answer">{turn.answer}</p>
          {turn.feedback && <><p className="muted">点评</p><Markdown>{turn.feedback}</Markdown></>}
          {turn.reference_answer && <details><summary>参考答案与复习知识</summary><Markdown>{turn.reference_answer + (turn.knowledge ? String.fromCharCode(10,10) + "### 复习知识" + String.fromCharCode(10) + turn.knowledge : "")}</Markdown></details>}
        </article>)}
      </section>

      {current && <section className="panel compose current-question">
        <span className="eyebrow">当前问题</span>
        <h3>{current.question}</h3>
        <textarea value={answer} onChange={event => setAnswer(event.target.value)} rows={6} placeholder="写下你的回答，尽量给结论、原理、取舍和边界。" />
        <button className="primary" disabled={busy || !answer.trim()} onClick={() => void submit()}>{busy ? <Loader2 className="spin" size={16} /> : <Send size={16} />} {busy ? '点评中…' : '提交回答'}</button>
      </section>}
      {finished && <div className="panel empty">本轮面试结束。可以点右上角开始新的面试。</div>}
    </>}

    {error && <p className="alert error">{error}</p>}
  </div>
}
