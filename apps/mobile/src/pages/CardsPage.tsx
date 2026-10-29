import { useEffect, useState } from 'react'
import { Loader2, Sparkles, Trash2 } from 'lucide-react'
import type { AiConfig } from '../App'
import type { Card } from '../types'
import { deleteCard, listCards, normalizeCard, saveCard } from '../db'
import { chat, parseJson } from '../ai'
import { cardsPrompt } from '../prompts'
import Markdown from '../components/Markdown'

function safeTags(value: string): string[] { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : [] } catch { return [] } }

export default function CardsPage({ config }: { config: AiConfig }) {
  const [cards, setCards] = useState<Card[]>([])
  const [topic, setTopic] = useState('')
  const [count, setCount] = useState(3)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState('')

  const refresh = () => setCards(listCards())
  useEffect(refresh, [])

  const generate = async () => {
    if (!config.provider) { setError('请先到设置里同步或填写 AI 供应商'); return }
    if (!topic.trim()) { setError('先写一个主题、岗位或项目'); return }
    setBusy(true); setError('')
    try {
      const text = await chat(config.provider, config.model, [
        { role: 'user', content: cardsPrompt(topic.trim(), count) },
      ], 7000)
      const parsed = parseJson<unknown>(text)
      const list = Array.isArray(parsed) ? parsed : (parsed as { cards?: unknown[] }).cards
      if (!Array.isArray(list) || !list.length) throw new Error('AI 没有返回卡片，请换个主题重试')
      for (const raw of list.slice(0, count)) saveCard(normalizeCard(raw as Record<string, unknown>))
      refresh()
      setTopic('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally { setBusy(false) }
  }

  const remove = (card: Card) => {
    if (!confirm(`删除「${card.title}」？当前版本删除只影响手机本地。`)) return
    deleteCard(card.id)
    refresh()
  }

  return <div className="page">
    <section className="hero">
      <div><span className="eyebrow">离线知识库</span><h2>知识卡片</h2><p>本地保存，随时复习；生成时直连你配置的 AI。</p></div>
      <span className="count-pill">{cards.length} 张</span>
    </section>

    <section className="panel compose">
      <label>主题 / 岗位 / 项目</label>
      <textarea value={topic} onChange={event => setTopic(event.target.value)} rows={3} placeholder="例如：字节 Agent 开发岗，重点复习 RAG、工具调用、评测和 Python 工程" />
      <div className="row">
        <select value={count} onChange={event => setCount(Number(event.target.value))} aria-label="生成数量">
          {[2, 3, 4, 5, 6].map(value => <option key={value} value={value}>{value} 张</option>)}
        </select>
        <button className="primary" disabled={busy} onClick={() => void generate()}>
          {busy ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />} {busy ? '生成中…' : '生成卡片'}
        </button>
      </div>
      {error && <p className="alert error">{error}</p>}
    </section>

    <section className="stack">
      {cards.map(card => <article className="panel card" key={card.id}>
        <button className="card-summary" onClick={() => setOpenId(openId === card.id ? '' : card.id)}>
          <span>{card.title}</span><small>{openId === card.id ? '收起' : '展开'}</small>
        </button>
        <p className="brief">{card.brief_answer}</p>
        {openId === card.id && <>
          <Markdown>{card.detail_answer}</Markdown>
          <div className="card-footer">
            <div className="tags">{safeTags(card.tags_json).map(tag => <span key={tag}>{tag}</span>)}</div>
            <button className="icon danger" title="删除卡片" onClick={() => remove(card)}><Trash2 size={15} /></button>
          </div>
        </>}
      </article>)}
      {!cards.length && <div className="empty">还没有卡片。写一个主题，让 AI 生成第一批。</div>}
    </section>
  </div>
}
