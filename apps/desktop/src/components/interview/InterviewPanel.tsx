import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, ChevronDown, ChevronUp, Search, Loader2, Play, Send, Pencil, Download, Check, X, ExternalLink, Building2, Tag, Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import PracticeButton from '@/components/PracticeButton'
import CitationList, { parseCitations } from '@/components/CitationList'
import TargetPicker from '@/components/TargetPicker'
import type { InterviewInput, InterviewSession } from '@/types/interview'

const field = 'w-full min-w-0 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-blue-500'
const command = 'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed'
const iconButton = 'p-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40'
const tagsFrom = (value: string) => [...new Set(value.split(/[,，、\n]/).map(s => s.trim()).filter(Boolean))]
const initial: InterviewInput = { company: '', department: '', role: '', jd: '', tags: [], search_web: true, question_count: 5 }
const statusLabel = { draft: '待开始', active: '进行中', completed: '已完成' }

export default function InterviewPanel({ notebookId }: { notebookId: string }) {
  const [sessions, setSessions] = useState<InterviewSession[]>([])
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState(initial)
  const [tags, setTags] = useState('')
  const [filter, setFilter] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const lock = useRef(false)
  const mounted = useRef(true)
  const autoResearchAttempted = useRef(new Set<string>())

  const replace = useCallback((session: InterviewSession) => {
    if (!mounted.current) return
    setSessions(current => current.some(s => s.id === session.id) ? current.map(s => s.id === session.id ? session : s) : [session, ...current])
    window.dispatchEvent(new CustomEvent('knowmind:knowledge-changed', { detail: notebookId }))
  }, [notebookId])

  useEffect(() => {
    mounted.current = true
    window.knowmind.interviews.list(notebookId).then(list => {
      if (mounted.current) setSessions(list)
    }).catch(err => { if (mounted.current) setError(err.message) }).finally(() => {
      if (mounted.current) setLoading(false)
    })
    return () => { mounted.current = false }
  }, [notebookId])

  const action = async (id: string, task: () => Promise<InterviewSession>) => {
    if (lock.current) return
    lock.current = true
    setPending(id)
    setError('')
    try { replace(await task()) }
    catch (err: any) {
      if (mounted.current) setError(err.message || String(err))
      if (id !== 'new') {
        try { replace(await window.knowmind.interviews.get(id)) } catch { /* Keep the original request error visible. */ }
      }
    } finally { lock.current = false; if (mounted.current) setPending(null) }
  }

  const create = (e: React.FormEvent) => {
    e.preventDefault()
    action('new', async () => {
      let session = await window.knowmind.interviews.create(notebookId, { ...form, tags: tagsFrom(tags) })
      replace(session)
      if (mounted.current) { setOpen(session.id); setCreating(false); setForm(initial); setTags('') }
      if (session.search_web) {
        session = await window.knowmind.interviews.research(session.id)
        replace(session)
      }
      return window.knowmind.interviews.start(session.id)
    })
  }

  const remove = async (id: string) => {
    if (lock.current || !window.confirm('删除这场模拟面试？面试问答、点评和已加入知识库的复习内容都会删除。')) return
    lock.current = true
    setPending(id)
    setError('')
    try {
      await window.knowmind.interviews.delete(id)
      if (mounted.current) {
        setSessions(current => current.filter(session => session.id !== id))
        if (open === id) setOpen(null)
      }
      window.dispatchEvent(new CustomEvent('knowmind:knowledge-changed', { detail: notebookId }))
    } catch (err: any) {
      if (mounted.current) setError(err.message || String(err))
    } finally {
      lock.current = false
      if (mounted.current) setPending(null)
    }
  }

  const allTags = [...new Set(sessions.flatMap(s => s.tags))]
  const visible = sessions.filter(s => `${s.title} ${s.company} ${s.department} ${s.role} ${s.tags.join(' ')}`.toLowerCase().includes(filter.toLowerCase()) && (!tagFilter || s.tags.includes(tagFilter)))

  return <section aria-label="模拟面试" className="max-w-5xl mx-auto p-5 sm:p-6">
    <div className="flex flex-wrap gap-3 items-center justify-between mb-5">
      <div><h1 className="text-xl font-semibold">模拟面试</h1><p className="mt-1 text-xs text-zinc-500">{sessions.length} 场面试 · {sessions.filter(s => s.status === 'completed').length} 场已完成</p></div>
      <button className={`${command} bg-blue-600 text-white hover:bg-blue-700`} onClick={() => setCreating(!creating)} disabled={Boolean(pending)}><Plus size={16} />新建模拟面试</button>
    </div>
    {error && <div role="alert" className="mb-4 border-l-2 border-red-500 pl-3 text-sm text-red-600 whitespace-pre-wrap break-words">{error}</div>}
    {creating && <form onSubmit={create} className="border-y border-zinc-200 dark:border-zinc-800 py-5 mb-5 space-y-4">
      <TargetPicker value={form} onApply={target => setForm({ ...form, ...target })} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="text-sm space-y-1 block">企业名称<input className={field} required maxLength={120} value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} placeholder="例如：字节跳动" /></label>
        <label className="text-sm space-y-1 block">面试部门<input className={field} maxLength={200} value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} placeholder="例如：基础架构" /></label>
        <label className="text-sm space-y-1 block">目标岗位<input className={field} required maxLength={200} value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} placeholder="例如：后端开发工程师" /></label>
      </div>
      <label className="text-sm space-y-1 block">岗位 JD<textarea aria-label="岗位 JD" className={`${field} resize-y`} rows={5} maxLength={18000} value={form.jd} onChange={e => setForm({ ...form, jd: e.target.value })} placeholder="岗位职责、任职要求、技术栈" /></label>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_120px] gap-3">
        <label className="text-sm space-y-1 block">自定义标签<input className={field} value={tags} onChange={e => setTags(e.target.value)} placeholder="秋招，一面，系统设计" /></label>
        <label className="text-sm space-y-1 block">面试题数<input className={field} type="number" min={1} max={15} value={form.question_count} onChange={e => setForm({ ...form, question_count: Number(e.target.value) })} /></label>
      </div>
      <div className="flex flex-wrap justify-between items-center gap-3">
        <label className="inline-flex gap-2 items-center text-sm"><input type="checkbox" checked={form.search_web} onChange={e => setForm({ ...form, search_web: e.target.checked })} />搜索公开面经</label>
        <div className="flex gap-2"><button type="button" className={`${command} hover:bg-zinc-100 dark:hover:bg-zinc-800`} onClick={() => setCreating(false)}>取消</button><button disabled={Boolean(pending)} className={`${command} bg-blue-600 text-white`}><Play size={15} />创建并开始</button></div>
      </div>
    </form>}
    {pending === 'new' && <p role="status" className="flex items-center gap-2 text-sm text-blue-600 mb-4"><Loader2 size={16} className="animate-spin" />正在准备面试...</p>}
    {sessions.length > 0 && <div className="flex gap-2 mb-4">
      <label className="relative flex-1"><Search size={15} className="absolute left-3 top-3 text-zinc-400" /><input aria-label="搜索面试" className={`${field} pl-9`} value={filter} onChange={e => setFilter(e.target.value)} placeholder="搜索企业、岗位或面试名称" /></label>
      <select aria-label="筛选标签" className={`${field} max-w-40`} value={tagFilter} onChange={e => setTagFilter(e.target.value)}><option value="">全部标签</option>{allTags.map(tag => <option key={tag}>{tag}</option>)}</select>
    </div>}
    {loading ? <Loader2 className="animate-spin mx-auto my-10 text-zinc-400" /> : visible.length === 0 ? <p className="py-10 text-sm text-zinc-500 text-center">{sessions.length ? '没有匹配的面试' : '暂无模拟面试'}</p> : <div className="space-y-3">{visible.map(session => <Session key={session.id} session={session} expanded={open === session.id} onToggle={() => {
      const next = open === session.id ? null : session.id
      setOpen(next)
      // Sessions created before the live-search fix may have an empty cached
      // result (and an old "not found" error). Refresh once when opened; the
      // explicit search button remains available for another retry.
      if (next && !lock.current && session.search_web && !session.research.length && !autoResearchAttempted.current.has(session.id)) {
        autoResearchAttempted.current.add(session.id)
        void action(session.id, () => window.knowmind.interviews.research(session.id))
      }
    }} disabled={Boolean(pending)} busy={pending === session.id || pending === 'new' && open === session.id} run={task => action(session.id, task)} onDelete={() => void remove(session.id)} />)}</div>}
  </section>
}

function Session({ session, expanded, onToggle, disabled, busy, run, onDelete }: {
  session: InterviewSession; expanded: boolean; onToggle: () => void; disabled: boolean; busy: boolean
  run: (task: () => Promise<InterviewSession>) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(session.title)
  const [tags, setTags] = useState(session.tags.join('，'))
  const [answer, setAnswer] = useState('')
  const [exportError, setExportError] = useState('')
  const current = session.turns.at(-1)
  const graded = session.turns.filter(t => t.feedback)
  const average = graded.length ? Math.round(graded.reduce((n, t) => n + (t.score || 0), 0) / graded.length) : null
  useEffect(() => { setAnswer(current?.answer || '') }, [current?.id, current?.answer])
  const exportMd = async () => {
    try {
      const result = await window.knowmind.interviews.export(session.id)
      setExportError(result.error || '')
      const url = URL.createObjectURL(new Blob([result.markdown], { type: 'text/markdown;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `${session.title.replace(/[\/\\:*?"<>|]/g, '_')}.md`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err: any) { setExportError(err.message) }
  }
  return <article className="border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-950 overflow-hidden">
    <div className="flex items-start gap-1 pr-2">
      <button aria-expanded={expanded} onClick={onToggle} className="min-w-0 flex-1 text-left p-4 flex gap-3 items-start hover:bg-zinc-50 dark:hover:bg-zinc-900">
        {expanded ? <ChevronUp size={17} className="mt-0.5 shrink-0 text-zinc-500" /> : <ChevronDown size={17} className="mt-0.5 shrink-0 text-zinc-500" />}
        <div className="min-w-0 flex-1"><h2 className="text-sm font-semibold break-words">{session.title}</h2><p className="text-xs text-zinc-500 mt-1 break-words">{session.company} · {session.role}{session.department && ` · ${session.department}`}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs"><span className={session.status === 'completed' ? 'text-emerald-600' : 'text-blue-600'}>{statusLabel[session.status]}</span><span className="text-zinc-500">{graded.length}/{session.question_count} 题{average !== null && ` · 均分 ${average}`}</span>{session.tags.map(tag => <span key={tag} className="text-zinc-500 inline-flex gap-1 items-center"><Tag size={11} />{tag}</span>)}</div>
        </div>
      </button>
      <button title="编辑名称和标签" aria-label="编辑名称和标签" className={`${iconButton} mt-2`} disabled={disabled} onClick={() => { setTitle(session.title); setTags(session.tags.join('，')); setEditing(!editing) }}><Pencil size={15} /></button>
      <button title="导出面试记录" aria-label="导出面试记录" className={`${iconButton} mt-2`} onClick={exportMd}><Download size={15} /></button>
      <button title="删除模拟面试" aria-label="删除模拟面试" className={`${iconButton} mt-2 text-red-600`} disabled={disabled} onClick={onDelete}><Trash2 size={15} /></button>
    </div>
    {editing && <form className="px-4 pb-4 flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); run(async () => { const result = await window.knowmind.interviews.update(session.id, { title, tags: tagsFrom(tags) }); setEditing(false); return result }) }}>
      <input aria-label="面试名称" className={`${field} flex-1 basis-60`} required maxLength={160} value={title} onChange={e => setTitle(e.target.value)} />
      <input aria-label="面试标签" className={`${field} flex-1 basis-48`} value={tags} onChange={e => setTags(e.target.value)} placeholder="标签，多个用逗号分隔" />
      <button className={iconButton} title="保存名称和标签" aria-label="保存名称和标签" disabled={disabled}><Check size={16} /></button><button type="button" className={iconButton} title="取消编辑" aria-label="取消编辑" onClick={() => setEditing(false)}><X size={16} /></button>
    </form>}
    {(exportError || session.export_error) && <p role="alert" className="px-4 pb-3 text-xs text-amber-700 break-words">{exportError || session.export_error}</p>}
    {expanded && <div className="border-t border-zinc-200 dark:border-zinc-800">
      <details className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 text-sm"><summary className="cursor-pointer text-zinc-600 dark:text-zinc-400">岗位资料与公开面经 · {session.research.length} 个来源</summary>
        <p className="flex gap-2 items-center mt-3 text-sm"><Building2 size={15} />{session.company} / {session.department || '未指定部门'} / {session.role}</p>
        <p className="text-xs whitespace-pre-wrap break-words text-zinc-500 mt-2">{session.jd || '未填写岗位 JD'}</p>
        {session.search_web && <button className={`${command} text-blue-600 mt-2`} disabled={disabled} onClick={() => run(() => window.knowmind.interviews.research(session.id))}><Search size={14} />{session.research.length ? '更新公开面经' : '搜索公开面经'}</button>}
        {session.research_error && <p role="alert" className="mt-2 text-amber-700 text-xs break-words">{session.research_error}</p>}
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">{session.research.map(item => <li key={item.url} className="py-3"><button className="text-left text-blue-600 text-sm break-words" onClick={() => window.knowmind.interviews.openSource(session.id, item.url).catch(err => setExportError(err.message))}>{item.title}<ExternalLink size={12} className="inline ml-1" /></button><p className="text-xs text-zinc-500 mt-1 break-words">{item.snippet}</p><p className="text-[11px] text-zinc-400 mt-1">搜索摘要 · {new URL(item.url).hostname} · 检索于 {new Date(item.retrieved_at).toLocaleDateString('zh-CN')}</p></li>)}</ul>
      </details>
      {session.status === 'draft' && <div className="p-4"><button disabled={disabled} className={`${command} bg-blue-600 text-white`} onClick={() => run(() => window.knowmind.interviews.start(session.id))}><Play size={15} />开始面试</button></div>}
      {session.turns.map((turn, index) => <details key={turn.id} open={index === session.turns.length - 1 || turn.id === graded.at(-1)?.id} className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
        <summary className="cursor-pointer text-sm font-medium">第 {index + 1} 题{turn.score !== null && ` · ${turn.score}/100`}{turn.answer && !turn.feedback && ' · 待点评'}</summary>
        <div className="markdown-body text-sm mt-3"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children }) => <span>{children}</span> }}>{turn.question}</ReactMarkdown></div>
        <CitationList citations={parseCitations(turn.question_citations_json)} />
        {turn.answer && <div className="mt-4"><h3 className="text-xs font-medium text-zinc-500 mb-1">我的回答</h3><p className="text-sm whitespace-pre-wrap break-words">{turn.answer}</p></div>}
        {turn.feedback && <div className="mt-4 space-y-3">
          <div><h3 className="text-xs text-emerald-600 font-medium mb-1">面试点评 · {turn.score}/100</h3><div className="markdown-body text-sm"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children }) => <span>{children}</span> }}>{turn.feedback}</ReactMarkdown></div></div>
          <PracticeButton source="interview" id={turn.id} />
          <CitationList citations={parseCitations(turn.citations_json)} />
          <details><summary className="text-sm text-blue-600 cursor-pointer">参考答案与复习知识</summary><div className="markdown-body text-sm mt-2"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children }) => <span>{children}</span> }}>{`${turn.reference_answer}\n\n### 复习知识\n${turn.knowledge}`}</ReactMarkdown></div><p className="text-xs text-emerald-600 mt-2">已加入复习知识库</p></details>
        </div>}
      </details>)}
      {busy && <p role="status" className="px-4 py-3 flex items-center gap-2 text-sm text-blue-600"><Loader2 size={16} className="animate-spin" />正在处理...</p>}
      {session.status === 'active' && current && <form className="p-4" onSubmit={e => { e.preventDefault(); run(() => window.knowmind.interviews.answer(session.id, current.id, answer)) }}>
        <label className="text-sm block mb-2" htmlFor={`answer-${session.id}`}>我的面试回答</label><textarea id={`answer-${session.id}`} className={`${field} resize-y`} rows={5} maxLength={12000} required value={answer} onChange={e => setAnswer(e.target.value)} placeholder="写下你的思路、方案和取舍" />
        <div className="flex flex-wrap gap-2 justify-between items-center mt-3"><button type="button" className={`${command} text-zinc-500`} disabled={disabled || !graded.length} onClick={() => run(() => window.knowmind.interviews.finish(session.id))}><Check size={15} />结束面试</button><button disabled={disabled || !answer.trim()} className={`${command} bg-blue-600 text-white`}><Send size={15} />{current.answer ? '重新点评' : '提交回答'}</button></div>
      </form>}
      {session.status === 'completed' && <div className="p-4 text-sm flex flex-wrap items-center justify-between gap-3"><p>本场已完成 · {graded.length} 题 · 均分 {average ?? 0}/100</p><button className={`${command} text-blue-600`} onClick={exportMd}><Download size={15} />导出复盘</button></div>}
    </div>}
  </article>
}
