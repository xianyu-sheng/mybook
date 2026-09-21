import { useState, useEffect, useRef } from 'react'
import { Sparkles, ChevronDown, Loader2, BookOpen, Trash2, ChevronsDownUp, ChevronsUpDown, Search } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import PracticeButton from '@/components/PracticeButton'
import CitationList, { parseCitations } from '@/components/CitationList'
import type { Card } from '@/types/db'

const modes = [
  { key: 'interview-qa', label: '面试问答' },
  { key: 'study-guide', label: '学习指南' },
  { key: 'key-concepts', label: '关键概念' },
  { key: 'project-highlights', label: '项目亮点' },
]
const iconButton = 'inline-flex items-center justify-center w-8 h-8 shrink-0 rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40'
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
function metadata(json: string) {
  try {
    const value = JSON.parse(json)
    return { tags: strings(Array.isArray(value) ? value : value?.tags), sources: strings(value?.sources) }
  } catch { return { tags: [], sources: [] } }
}

export default function CardList({ notebookId }: { notebookId: string }) {
  const [cards, setCards] = useState<Card[]>([])
  const [mode, setMode] = useState('interview-qa')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [removing, setRemoving] = useState<Card | null>(null)
  const [pending, setPending] = useState<'generate' | 'delete' | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const mounted = useRef(true)
  const locked = useRef(false)

  useEffect(() => {
    mounted.current = true
    window.knowmind.cards.list(notebookId).then(list => {
      if (mounted.current) setCards(list)
    }).catch(err => { if (mounted.current) setError(errorMessage(err)) })
      .finally(() => { if (mounted.current) setLoading(false) })
    return () => { mounted.current = false }
  }, [notebookId])

  useEffect(() => window.knowmind.cards.onProgress(event => {
    if (event.notebookId !== notebookId) return
    const detail = event.phase === 'fallback' ? `${event.model}：${event.reason}，正在切换候选模型` : `当前模型 ${event.model}`
    setProgress(`已生成 ${event.completed}/${event.requested} 张 · ${detail}`)
  }), [notebookId])

  useEffect(() => {
    if (removing) dialog.current?.showModal()
    else dialog.current?.close()
  }, [removing])

  const changed = () => window.dispatchEvent(new CustomEvent('knowmind:knowledge-changed', { detail: notebookId }))
  const generate = async () => {
    if (locked.current) return
    locked.current = true
    setPending('generate')
    setProgress('正在准备模型候选队列...')
    setError('')
    try {
      const next = await window.knowmind.cards.generate(notebookId, 10, mode)
      if (mounted.current) setCards(current => [...current, ...next])
      changed()
    } catch (err) {
      if (!mounted.current) return
      setError(errorMessage(err))
      // The main process commits each completed batch. Reload after an
      // interrupted run so cards saved before the failure are visible without
      // asking the user to leave and reopen the notebook.
      try { setCards(await window.knowmind.cards.list(notebookId)) } catch { /* keep the original generation error */ }
    }
    finally { locked.current = false; if (mounted.current) setPending(null) }
  }

  const remove = async () => {
    if (!removing || locked.current) return
    const id = removing.id
    locked.current = true
    setPending('delete')
    setError('')
    try {
      await window.knowmind.cards.delete(id)
      if (mounted.current) {
        setCards(current => current.filter(card => card.id !== id))
        setOpen(current => { const next = new Set(current); next.delete(id); return next })
        setRemoving(null)
      }
      changed()
    } catch (err) { if (mounted.current) setError(errorMessage(err)) }
    finally { locked.current = false; if (mounted.current) setPending(null) }
  }

  const visible = cards.filter(card => `${card.title} ${card.brief_answer} ${metadata(card.tags_json).tags.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()))
  const toggle = (id: string) => setOpen(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  return <section aria-label="知识卡片" className="min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
      <h2 className="text-sm font-semibold flex items-center gap-2"><Sparkles size={16} className="text-emerald-600" />知识卡片<span className="text-xs font-normal text-zinc-500">{cards.length}</span></h2>
      <div className="flex items-center gap-2">
        <select aria-label="卡片生成模式" value={mode} disabled={Boolean(pending)} onChange={event => setMode(event.target.value)} className="min-w-0 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-xs">
          {modes.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select>
        <button onClick={generate} disabled={Boolean(pending)} className="flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary-600 hover:bg-primary-700 text-white text-xs font-medium disabled:opacity-50 whitespace-nowrap">
          {pending === 'generate' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}{pending === 'generate' ? '生成中...' : 'AI 生成卡片'}
        </button>
      </div>
    </div>
    {error && !removing && <p role="alert" className="mb-3 border-l-2 border-red-500 pl-3 text-sm text-red-600 break-words">{error}</p>}
    {pending === 'generate' && <p role="status" className="flex items-center gap-2 py-3 text-xs text-primary-600"><Loader2 size={15} className="animate-spin" />{progress}</p>}
    {cards.length > 0 && <div className="flex items-center gap-2 mb-3">
      <label className="relative flex-1 min-w-0"><Search size={14} className="absolute left-2.5 top-2.5 text-zinc-400" /><input aria-label="搜索卡片" placeholder="搜索卡片、知识点或标签" value={query} onChange={event => setQuery(event.target.value)} className="w-full h-9 pl-8 pr-3 border border-zinc-200 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-900 text-xs" /></label>
      <button className={iconButton} title={open.size ? '折叠全部卡片' : '展开全部卡片'} aria-label={open.size ? '折叠全部卡片' : '展开全部卡片'} onClick={() => setOpen(open.size ? new Set() : new Set(visible.map(card => card.id)))}>{open.size ? <ChevronsDownUp size={16} /> : <ChevronsUpDown size={16} />}</button>
    </div>}
    {loading ? <Loader2 className="w-5 h-5 animate-spin mx-auto my-8 text-zinc-400" /> : visible.length === 0 ? <div className="border-y border-zinc-200 dark:border-zinc-800 py-10 text-center"><BookOpen size={26} className="mx-auto mb-3 text-zinc-400" /><p className="text-sm text-zinc-500">{cards.length ? '没有匹配的卡片' : '暂无知识卡片'}</p></div> : <div className="space-y-2">
      {visible.map((card, index) => {
        const expanded = open.has(card.id)
        const info = metadata(card.tags_json)
        return <article key={card.id} className={`rounded-lg border bg-white dark:bg-zinc-900 overflow-hidden ${expanded ? 'border-primary-300 dark:border-primary-700' : 'border-zinc-200 dark:border-zinc-700'}`}>
          <div className="flex items-start pr-2">
            <button aria-expanded={expanded} aria-controls={`card-${card.id}`} onClick={() => toggle(card.id)} className="flex flex-1 min-w-0 gap-3 p-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800">
              <span className="text-xs text-zinc-400 w-5 shrink-0 pt-0.5 tabular-nums">{String(index + 1).padStart(2, '0')}</span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-medium break-words">{card.title}</span>
                {info.tags.length > 0 && <span className="flex flex-wrap gap-1 mt-2">{info.tags.map((tag, i) => <span key={i} className="max-w-full break-words px-1.5 py-0.5 text-[11px] rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">{tag}</span>)}</span>}
              </span>
              <ChevronDown size={15} className={`shrink-0 mt-0.5 text-zinc-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </button>
            {!expanded && <div className="mb-3 mr-2"><PracticeButton source="card" id={card.id} /></div>}
            <button title="删除卡片" aria-label={`删除卡片 ${card.title}`} disabled={Boolean(pending)} className={`${iconButton} mt-1.5 hover:text-red-600`} onClick={() => { setError(''); setRemoving(card) }}><Trash2 size={15} /></button>
          </div>
          {expanded && <div id={`card-${card.id}`} className="px-4 pb-4 pt-3 border-t border-zinc-100 dark:border-zinc-800 text-sm">
            <p className="text-xs text-zinc-500 mb-2">回答要点</p>
            <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]}>{card.brief_answer}</ReactMarkdown></div>
            {card.detail_answer && card.detail_answer !== card.brief_answer && <><p className="text-xs text-zinc-500 mt-4 mb-2">详细解析</p><div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]}>{card.detail_answer}</ReactMarkdown></div></>}
            <PracticeButton source="card" id={card.id} />
            <CitationList citations={parseCitations(card.citations_json)} />
            {!parseCitations(card.citations_json).length && info.sources.length > 0 && <div className="flex flex-wrap gap-1.5 mt-3 text-[11px] text-zinc-500"><BookOpen size={13} />{info.sources.map((source, i) => <span key={i} className="break-all">{source}</span>)}<span>旧卡片未保存来源映射</span></div>}
          </div>}
        </article>
      })}
    </div>}
    <dialog ref={dialog} aria-labelledby="delete-card-title" onCancel={event => { if (pending === 'delete') event.preventDefault() }} onClose={() => setRemoving(null)} onClick={event => { if (event.target === event.currentTarget && pending !== 'delete') dialog.current?.close() }} className="m-auto w-[calc(100%-40px)] max-w-sm rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 p-5 shadow-xl backdrop:bg-black/40">
      <h3 id="delete-card-title" className="font-semibold">删除这张卡片？</h3>
      <p className="mt-2 text-sm text-zinc-500 break-words">“{removing?.title}”及关联的卡片补充内容会一并删除。</p>
      {error && <p role="alert" className="mt-3 text-sm text-red-600 break-words">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button autoFocus disabled={pending === 'delete'} className="px-3 py-2 text-sm rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50" onClick={() => dialog.current?.close()}>取消</button>
        <button disabled={pending === 'delete'} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50" onClick={remove}>{pending === 'delete' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}确认删除</button>
      </div>
    </dialog>
  </section>
}
