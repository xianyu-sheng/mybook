import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, Check, ChevronDown, Headphones, History, Loader2, LockKeyhole, RotateCcw, Search, Send, Target, Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import CitationList from '@/components/CitationList'
import { readPracticeDraft, writePracticeDraft, clearPracticeDraft } from '@/lib/practiceDraft'
import type { PracticeAttempt, PracticeItem, PracticeStatus, PracticeSummary } from '@/types/practice'

const labels = { active: '待练习', mastered: '已掌握', archived: '已归档' }
const sourceLabels = { recording: '面试录音', interview: '模拟面试', card: '知识卡片' }
const statusLabels = { covered: '已覆盖', partial: '待补充', missing: '未体现' }
const statusColor = { covered: 'text-emerald-700 dark:text-emerald-400', partial: 'text-amber-700 dark:text-amber-400', missing: 'text-rose-600 dark:text-rose-400' }
const field = 'w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2.5 text-sm'
const button = 'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm disabled:opacity-40'
const clean = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
const date = (v: string) => new Date(v.includes('T') ? v : `${v.replace(' ', 'T')}Z`).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function PracticePage() {
  const [params, setParams] = useSearchParams()
  const [items, setItems] = useState<PracticeSummary[]>([])
  const [item, setItem] = useState<PracticeItem | null>(null)
  const [filter, setFilter] = useState<PracticeStatus>('active')
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const visible = items.filter(i => i.status === filter && `${i.question} ${i.company} ${i.role} ${i.source_label}`.toLowerCase().includes(query.toLowerCase().trim()))
  const id = params.get('item') || visible[0]?.id
  const selected = useRef(id); selected.current = id
  const mounted = useRef(true)
  const refresh = useCallback(async () => {
    const list = await window.knowmind.practice.list()
    if (mounted.current) setItems(list)
  }, [])
  useEffect(() => {
    mounted.current = true
    refresh().catch(e => setError(clean(e))).finally(() => setLoading(false))
    return () => { mounted.current = false }
  }, [refresh])
  useEffect(() => {
    let live = true
    setItem(null); setError('')
    if (!id) { setDetailLoading(false); return }
    setDetailLoading(true)
    window.knowmind.practice.get(id).then(value => { if (live) { setItem(value); setFilter(value.status) } }).catch(e => { if (live) setError(clean(e)) }).finally(() => { if (live) setDetailLoading(false) })
    return () => { live = false }
  }, [id])
  const changed = useCallback((value: PracticeItem) => {
    if (mounted.current && selected.current === value.id) { setItem(value); setFilter(value.status) }
    void refresh().catch(e => { if (mounted.current) setError(clean(e)) })
    window.dispatchEvent(new Event('knowmind:practice-changed'))
  }, [refresh])
  useEffect(() => {
    if (!item?.attempts.some(a => a.status === 'evaluating')) return
    const itemId = item.id
    const timer = setInterval(() => { window.knowmind.practice.get(itemId).then(changed).catch(e => setError(clean(e))) }, 2500)
    return () => clearInterval(timer)
  }, [item?.id, item?.attempts.some(a => a.status === 'evaluating'), changed])

  return <div className="mx-auto max-w-[1440px] p-6 lg:p-8">
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-medium text-primary-600 dark:text-primary-400 mb-2">从复盘到掌握</p><h1 className="text-2xl font-semibold">专项练习</h1><p className="text-sm text-zinc-500 dark:text-zinc-400 mt-2">先独立回答，再对照证据，补齐上次没讲清的地方。</p></div>
      <Link to="/recordings" className={`${button} border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900`}><Headphones size={15} />从录音复盘选题<ArrowRight size={14} /></Link>
    </div>
    {error && <p role="alert" className="rounded-lg bg-red-50 dark:bg-red-950 p-3 mb-4 text-sm text-red-600 break-words">{error}</p>}
    {loading ? <p role="status" className="py-16 text-center text-zinc-500 dark:text-zinc-400">正在加载练习…</p> : items.length === 0 ? <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-10 text-center">
      <Target size={32} className="mx-auto text-primary-500 mb-4" /><h2 className="text-lg font-semibold">把薄弱点变成下一次练习</h2><p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-lg mx-auto mt-2 leading-relaxed">在录音复盘、模拟面试点评或知识卡片中点击「加入专项练习」。题目和参考资料会一起保留，之后可以反复作答。</p><Link to="/" className={`${button} mt-6 bg-primary-600 text-white`}>回工作台选题<ArrowRight size={15} /></Link>
    </div> : <div className="grid grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)] gap-5 items-start">
      <aside aria-label="练习列表" className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
        <div className="flex gap-1 mb-3">{(Object.keys(labels) as PracticeStatus[]).map(status => <button key={status} aria-pressed={filter === status} onClick={() => { setFilter(status); setParams({}) }} className={`flex-1 text-xs rounded-md py-2 ${filter === status ? 'bg-primary-50 dark:bg-primary-950 text-primary-700 dark:text-primary-300 font-semibold' : 'text-zinc-500 dark:text-zinc-400'}`}>{labels[status]} {items.filter(i => i.status === status).length}</button>)}</div>
        <label className="block relative mb-3"><Search size={14} className="absolute left-2.5 top-3 text-zinc-400" /><input className={`${field} !pl-8 !text-xs`} aria-label="搜索专项练习" placeholder="搜索题目、企业、岗位" value={query} onChange={e => setQuery(e.target.value)} /></label>
        <div className="max-h-56 xl:max-h-[65vh] overflow-y-auto space-y-1">{visible.map(i => <button key={i.id} onClick={() => setParams({ item: i.id })} className={`w-full text-left rounded-lg p-3 border ${i.id === id ? 'border-primary-200 dark:border-primary-800 bg-primary-50/60 dark:bg-primary-950/40' : 'border-transparent hover:bg-zinc-50 dark:hover:bg-zinc-800'}`}>
          <span className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1.5">{sourceLabels[i.source_type]} · 已练 {i.attempt_count} 次</span><span className="text-sm font-medium line-clamp-2 break-words">{i.question}</span>{(i.company || i.role) && <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400 mt-2">{[i.company, i.role].filter(Boolean).join(' · ')}</span>}
        </button>)}{!visible.length && <p className="text-xs text-zinc-500 dark:text-zinc-400 text-center py-6">这个分类下没有匹配的题目</p>}</div>
      </aside>
      {detailLoading ? <p role="status" className="p-8 text-sm text-zinc-500 dark:text-zinc-400">加载题目…</p> : item ? <PracticeDetail key={item.id} item={item} onChange={changed} onDelete={async () => { setItem(null); setParams({}); await refresh() }} /> : <p className="p-8 text-sm text-zinc-500 dark:text-zinc-400">选择一道题开始练习</p>}
    </div>}
  </div>
}

function PracticeDetail({ item, onChange, onDelete }: { item: PracticeItem; onChange: (item: PracticeItem) => void; onDelete: () => Promise<void> }) {
  const [initialDraft] = useState(() => readPracticeDraft(item.id))
  const [answer, setAnswer] = useState(initialDraft.answer)
  const [draftWarning, setDraftWarning] = useState(initialDraft.warning)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState(false)
  const [tab, setTab] = useState<'answer' | 'history'>('answer')
  const dialog = useRef<HTMLDialogElement>(null)
  const lock = useRef(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => { if (removing) dialog.current?.showModal(); else dialog.current?.close() }, [removing])
  const evaluating = item.attempts.some(a => a.status === 'evaluating')
  const updateAnswer = (value: string) => {
    setAnswer(value)
    setDraftWarning(writePracticeDraft(item.id, value))
  }
  const run = async (task: () => Promise<PracticeItem>) => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try { onChange(await task()) } catch (e) { if (alive.current) setError(clean(e)) }
    finally { lock.current = false; if (alive.current) setBusy(false) }
  }
  const submit = () => run(async () => {
    const submitted = answer
    const result = await window.knowmind.practice.attempt(item.id, submitted)
    clearPracticeDraft(item.id, submitted)
    if (alive.current) { setAnswer(''); setTab('history') }
    return result
  })
  const latest = item.attempts.at(-1)
  return <section aria-label="练习详情" className="min-w-0 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
    <div className="p-5 lg:p-6 border-b border-zinc-100 dark:border-zinc-800">
      <div className="flex justify-between items-center gap-3 mb-3"><span className="text-xs text-primary-600 dark:text-primary-400 font-medium">{sourceLabels[item.source_type]} · {labels[item.status]}</span><button disabled={busy || evaluating} aria-label="删除专项练习" onClick={() => setRemoving(true)} className="p-2 rounded-lg text-zinc-400 hover:text-red-600 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40"><Trash2 size={15} /></button></div>
      <h2 className="text-lg font-semibold leading-relaxed break-words whitespace-pre-wrap">{item.question}</h2><p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400 break-words">{item.source_label}{item.company && ` · ${item.company}`}{item.role && ` · ${item.role}`}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs"><span className="inline-flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400"><History size={13} />已保存 {item.attempt_count} 次作答</span><span className="text-zinc-400">按同一份练习要求逐次对照</span></div>
    </div>
    <div className="flex border-b border-zinc-100 dark:border-zinc-800 px-5 gap-5" role="tablist" aria-label="练习内容">{[{ id: 'answer', title: '独立作答' }, { id: 'history', title: `作答与点评 ${item.attempt_count}` }].map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id as typeof tab)} className={`py-3 text-sm border-b-2 ${tab === t.id ? 'text-primary-600 border-primary-600 font-medium' : 'text-zinc-500 dark:text-zinc-400 border-transparent'}`}>{t.title}</button>)}</div>
    <div className="p-5 lg:p-6">
      {error && <p role="alert" className="mb-4 text-sm text-red-600 break-words">{error}</p>}
      {item.status === 'archived' && <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">这道题已归档。点击下方「重新加入待练」后可以继续作答。</p>}
      {evaluating && <p role="status" className="mb-4 flex items-center gap-2 text-sm text-primary-600"><Loader2 size={16} className="animate-spin" />答案已保存，正在逐项点评，可稍后回来查看。</p>}
      {tab === 'answer' ? <form onSubmit={e => { e.preventDefault(); void submit() }}>
        <label htmlFor="practice-answer" className="block text-sm font-medium mb-2">这一次，你会怎么回答？</label><textarea id="practice-answer" rows={9} maxLength={12000} required disabled={busy || evaluating || item.status === 'archived'} className={`${field} resize-y leading-relaxed`} value={answer} onChange={e => updateAnswer(e.target.value)} placeholder="先写下自己的判断、方案、取舍与依据。提交后再看参考答案。" />
        <div className="flex flex-wrap justify-between items-center gap-3 mt-3"><span className="text-xs text-zinc-400">{answer.length} / 12000{answer && !draftWarning ? ' · 草稿已保存在本机' : ''}</span><button disabled={busy || evaluating || item.status === 'archived' || !answer.trim()} className={`${button} bg-primary-600 hover:bg-primary-700 text-white`}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}保存回答并点评</button></div>
        {draftWarning && <p role="alert" className="mt-2 text-xs text-amber-700">{draftWarning}</p>}
      </form> : item.attempts.length ? <div className="space-y-3">{[...item.attempts].reverse().map((attempt, i) => <Attempt key={attempt.id} attempt={attempt} item={item} number={item.attempts.length - i} expanded={attempt.id === latest?.id} previous={item.attempts.filter(a => a.status === 'ready' && a.created_at <= attempt.created_at && a.id !== attempt.id).filter(a => item.attempts.indexOf(a) < item.attempts.indexOf(attempt)).at(-1)} busy={busy || evaluating} retry={() => run(() => window.knowmind.practice.retry(attempt.id))} />)}</div> : <p className="text-sm text-zinc-500 dark:text-zinc-400 py-6 text-center">还没有作答，先试着独立回答这道题。</p>}
      <div className="mt-6 border-t border-zinc-100 dark:border-zinc-800 pt-5">
        {item.reference_locked ? <div className="flex gap-2 text-sm text-zinc-500 dark:text-zinc-400"><LockKeyhole size={16} className="shrink-0 mt-0.5" /><p>提交一次自己的回答后，解锁上次回答、参考答案和练习要求。</p></div> : <details><summary className="cursor-pointer text-sm font-medium flex items-center gap-2"><ChevronDown size={15} />查看原始复盘与参考答案</summary>
          <p className="mt-3 text-xs text-amber-700 dark:text-amber-400 leading-relaxed">{item.snapshot?.notice || 'AI 参考内容尚未独立核实，请结合原始资料判断。'}</p>
          <h3 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mt-4 mb-2">固定的练习要求</h3><ul className="list-decimal pl-5 space-y-2 text-sm">{item.requirements.map(r => <li key={r.id} className="break-words">{r.text}</li>)}</ul>
          {item.snapshot?.original_answer && <><h3 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mt-4 mb-2">上次的原始回答</h3><p className="whitespace-pre-wrap text-sm break-words">{item.snapshot.original_answer}</p></>}
          <h3 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mt-4 mb-2">参考答案</h3><div className="markdown-body text-sm"><ReactMarkdown remarkPlugins={[remarkGfm]}>{item.snapshot?.reference_answer || '来源中没有独立的参考答案，请结合练习要求复习。'}</ReactMarkdown></div><CitationList citations={item.snapshot?.citations || []} />
        </details>}
      </div>
      <div className="mt-5 flex flex-wrap gap-2 justify-end">{item.status !== 'active' ? <button disabled={busy || evaluating} onClick={() => run(() => window.knowmind.practice.setStatus(item.id, 'active'))} className={`${button} text-primary-600`}><RotateCcw size={14} />重新加入待练</button> : <><button disabled={busy || evaluating} className={`${button} text-zinc-500 dark:text-zinc-400`} onClick={() => run(() => window.knowmind.practice.setStatus(item.id, 'archived'))}>暂时归档</button><button disabled={busy || evaluating || !item.attempt_count} title="由你判断是否已经能够独立回答" className={`${button} text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950`} onClick={() => run(() => window.knowmind.practice.setStatus(item.id, 'mastered'))}><Check size={15} />我已掌握</button></>}</div>
    </div>
    <dialog ref={dialog} onClose={() => setRemoving(false)} onCancel={e => { if (busy) e.preventDefault() }} aria-label="删除练习确认" className="m-auto max-w-sm p-5 rounded-xl bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 backdrop:bg-black/40">
      <h3 className="font-semibold">删除这道练习？</h3><p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">本题的历次作答和点评会一并删除。也可以取消后选择「暂时归档」。</p>
      {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-5 flex justify-end gap-2"><button className={button} autoFocus disabled={busy} onClick={() => setRemoving(false)}>取消</button><button disabled={busy} className={`${button} bg-red-600 text-white`} onClick={async () => {
        if (lock.current) return
        lock.current = true; setBusy(true)
        try { await window.knowmind.practice.delete(item.id); clearPracticeDraft(item.id); window.dispatchEvent(new Event('knowmind:practice-changed')); await onDelete() }
        catch (e) { setError(clean(e)) }
        finally { lock.current = false; if (alive.current) setBusy(false) }
      }}>确认删除练习</button></div>
    </dialog>
  </section>
}

function Attempt({ attempt, item, number, expanded, previous, busy, retry }: { attempt: PracticeAttempt; item: PracticeItem; number: number; expanded: boolean; previous?: PracticeAttempt; busy: boolean; retry: () => void }) {
  return <details open={expanded} className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
    <summary className="cursor-pointer text-sm font-medium">第 {number} 次作答 <span className="font-normal text-xs text-zinc-500 dark:text-zinc-400 ml-2">{date(attempt.created_at)} · {attempt.status === 'ready' ? '已点评' : attempt.status === 'evaluating' ? '点评中' : '待重试'}</span></summary>
    <p className="mt-4 text-sm whitespace-pre-wrap break-words leading-relaxed">{attempt.answer}</p>
    {attempt.error && <div className="mt-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 p-3"><p className="text-xs text-amber-800 dark:text-amber-300 break-words">答案已保留。{attempt.error}</p><button disabled={busy} onClick={retry} className={`${button} text-primary-600 mt-1`}><RotateCcw size={14} />重新点评这次回答</button></div>}
    {attempt.review && <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-800">
      <p className="text-sm leading-relaxed break-words">{attempt.review.summary}</p><p className="text-xs text-zinc-400 mt-2">点评模型：{attempt.model_name || '未记录'} · 要求版本 {attempt.input_version.slice(0, 8)}</p>
      <div className="space-y-3 mt-4">{attempt.review.criteria.map(criterion => {
        const requirement = item.requirements.find(r => r.id === criterion.requirement_id)
        const before = previous?.input_version === attempt.input_version ? previous.review?.criteria.find(c => c.requirement_id === criterion.requirement_id) : undefined
        return <div key={criterion.requirement_id} className="rounded-lg bg-zinc-50 dark:bg-zinc-950 p-3">
          <div className="flex flex-wrap gap-2 items-baseline"><h4 className="flex-1 text-sm font-medium break-words min-w-0">{requirement?.text}</h4><span className={`text-xs font-medium ${statusColor[criterion.status]}`}>{statusLabels[criterion.status]}</span></div>
          {before && <p className="text-xs text-zinc-400 mt-1">上次：{statusLabels[before.status]} → 本次：{statusLabels[criterion.status]}</p>}
          {criterion.quotes.map((quote, i) => <blockquote key={i} className="border-l-2 border-primary-300 pl-3 mt-2 text-xs text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap break-words">「{quote}」</blockquote>)}
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2 leading-relaxed break-words">{criterion.feedback}</p>{criterion.improvement && <p className="text-xs text-primary-700 dark:text-primary-300 mt-2 break-words">下一次：{criterion.improvement}</p>}
        </div>
      })}</div>
      <p className="mt-4 text-sm font-medium text-primary-700 dark:text-primary-300 break-words">{attempt.review.next_action}</p><p className="mt-2 text-xs text-zinc-400 break-words">{attempt.review.notice}</p>
    </div>}
  </details>
}
