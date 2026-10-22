import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Archive, ArrowRight, ArrowUpRight, BookOpen, Check, ChevronRight, Code2, Cpu, Headphones, LibraryBig, Loader2, Plus, Search, Sparkles, Target, Users, X } from 'lucide-react'
import type { Notebook } from '@/types/db'
import { NOTEBOOKS_CHANGED, OPEN_ARCHIVE } from '@/components/layout/NotebookDialogs'

type PracticeSummary = Awaited<ReturnType<typeof window.knowmind.practice.list>>[number]
const templates = [
  { key: 'tech-interview', label: '技术面试', description: '算法、数据结构与技术基础', icon: Code2 },
  { key: 'behavioral', label: '行为面试', description: '团队协作、沟通与个人经历', icon: Users },
  { key: 'system-design', label: '系统设计', description: '架构设计、分布式与扩展性', icon: Cpu },
  { key: 'general', label: '综合面试', description: '技术、项目与求职表达', icon: Sparkles },
]
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
const dateLabel = (value: string) => {
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z')
  return Number.isNaN(date.getTime()) ? '最近更新' : `${date.getMonth() + 1} 月 ${date.getDate()} 日更新`
}

export default function NotebookListPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [notebooks, setNotebooks] = useState<Notebook[]>([])
  const [practice, setPractice] = useState<PracticeSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [notebookError, setNotebookError] = useState('')
  const [practiceError, setPracticeError] = useState('')
  const [query, setQuery] = useState('')
  const alive = useRef(true)
  const request = useRef(0)
  const refresh = useCallback(async () => {
    const version = ++request.current
    const results = await Promise.allSettled([window.knowmind.notebooks.list(), window.knowmind.practice.list()])
    if (!alive.current || request.current !== version) return
    const [notebookResult, practiceResult] = results
    if (notebookResult.status === 'fulfilled') { setNotebooks(notebookResult.value); setNotebookError('') }
    else setNotebookError(errorMessage(notebookResult.reason))
    if (practiceResult.status === 'fulfilled') { setPractice(practiceResult.value); setPracticeError('') }
    else setPracticeError(errorMessage(practiceResult.reason))
    setLoading(false)
  }, [])
  useEffect(() => {
    alive.current = true
    void refresh()
    const update = () => { void refresh() }
    window.addEventListener(NOTEBOOKS_CHANGED, update)
    window.addEventListener('knowmind:practice-changed', update)
    window.addEventListener('knowmind:knowledge-changed', update)
    return () => {
      alive.current = false
      request.current++
      window.removeEventListener(NOTEBOOKS_CHANGED, update)
      window.removeEventListener('knowmind:practice-changed', update)
      window.removeEventListener('knowmind:knowledge-changed', update)
    }
  }, [refresh])
  const activePractice = practice.filter(item => item.status === 'active').sort((a, b) => a.attempt_count - b.attempt_count || b.updated_at.localeCompare(a.updated_at))
  const today = activePractice.slice(0, 3)
  const visibleNotebooks = notebooks.filter(notebook => `${notebook.title} ${notebook.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const latest = notebooks[0]
  const createOpen = params.get('create') === '1'
  const openCreate = () => setParams(current => { const next = new URLSearchParams(current); next.set('create', '1'); return next })
  const closeCreate = () => setParams(current => { const next = new URLSearchParams(current); next.delete('create'); return next }, { replace: true })

  return <div className="workspace-home">
    <header className="workspace-page-heading">
      <div><p className="workspace-eyebrow">{new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</p><h1>工作台</h1><p className="workspace-muted text-sm mt-2">继续练习薄弱点，或打开正在准备的笔记本。</p></div>
      <button className="workspace-button is-primary" onClick={openCreate}><Plus size={16} />新建笔记本</button>
    </header>

    <div className="dashboard-top-grid">
      <section className="dashboard-panel practice-overview" aria-labelledby="today-practice-heading">
        <div className="dashboard-panel-heading"><div className="flex items-center gap-2.5"><span className="section-symbol is-green"><Target size={18} /></span><h2 id="today-practice-heading">今日练习</h2>{!loading && !practiceError && <span className="workspace-count">{activePractice.length} 待练</span>}</div><Link to="/practice" className="workspace-text-link">全部练习<ChevronRight size={14} /></Link></div>
        <p className="workspace-muted text-xs px-5 pb-4">从已加入的薄弱点中，先完成这几道题。</p>
        {loading ? <div role="status" className="dashboard-empty"><Loader2 size={19} className="animate-spin" /><p>正在整理练习...</p></div> : practiceError ? <div className="dashboard-empty items-start"><p role="alert" className="workspace-error">练习加载失败：{practiceError}</p><button className="workspace-text-link" onClick={() => void refresh()}>重新加载<ArrowRight size={14} /></button></div> : today.length ? <div className="practice-overview-list">{today.map((item, index) => <Link key={item.id} to={`/practice?item=${encodeURIComponent(item.id)}`} className="practice-overview-row"><span className="practice-row-index">{String(index + 1).padStart(2, '0')}</span><div className="min-w-0 flex-1"><h3 className="line-clamp-2">{item.question}</h3><p className="mt-2 truncate text-xs workspace-muted">{[item.company, item.role].filter(Boolean).join(' · ') || item.source_label || ({ interview: '模拟面试', recording: '面试录音', card: '知识卡片' }[item.source_type])}<span className="mx-2 opacity-40">/</span>{item.attempt_count ? `已练 ${item.attempt_count} 次` : '尚未作答'}</p></div><ArrowUpRight size={17} className="workspace-muted shrink-0" /></Link>)}</div> : <div className="dashboard-empty practice-empty"><span className="empty-symbol"><Target size={27} strokeWidth={1.4} /></span><div><h3>{practice.length ? '当前没有待练题目' : '把一次复盘，变成下一次练习'}</h3><p>从模拟面试、录音复盘或知识卡片加入练习，<br className="hidden xl:block" />在这里独立重答，再对照遗漏的要点。</p></div><Link className="workspace-button is-small" to={latest ? `/notebook/${latest.id}` : '/practice'}>{latest ? '打开笔记本' : '查看专项练习'}<ArrowRight size={14} /></Link></div>}
      </section>

      <section className="dashboard-panel next-actions" aria-labelledby="next-actions-heading">
        <div className="dashboard-panel-heading"><h2 id="next-actions-heading">下一步</h2><span className="workspace-eyebrow">按需开始</span></div>
        <button className="next-action-row" onClick={() => latest ? navigate(`/notebook/${latest.id}?tab=study`) : openCreate()}><span className="action-symbol is-blue"><BookOpen size={18} strokeWidth={1.7} /></span><span className="min-w-0 flex-1"><strong>{latest ? '完善项目资料' : '整理项目与岗位'}</strong><span>{latest ? '补充简历、项目文档与复习笔记' : '创建笔记本，放入自己的项目材料'}</span></span><ChevronRight size={15} /></button>
        <Link className="next-action-row" to="/recordings"><span className="action-symbol is-orange"><Headphones size={18} strokeWidth={1.7} /></span><span className="min-w-0 flex-1"><strong>复盘一场真实面试</strong><span>录音、校对文字，找到具体缺口</span></span><ChevronRight size={15} /></Link>
        <Link className="next-action-row" to="/repositories"><span className="action-symbol is-violet"><LibraryBig size={18} strokeWidth={1.7} /></span><span className="min-w-0 flex-1"><strong>查阅全局知识</strong><span>基础知识与参考资料，所有笔记本共用</span></span><ChevronRight size={15} /></Link>
      </section>
    </div>

    <section className="notebook-overview" aria-labelledby="notebook-overview-heading">
      <div className="notebook-overview-heading"><div className="flex flex-wrap gap-2 items-center"><h2 id="notebook-overview-heading">我的笔记本</h2>{!loading && !notebookError && <span className="workspace-count">{notebooks.length}</span>}<span className="workspace-muted text-xs ml-1">按最近更新排序</span></div><div className="flex gap-2 items-center"><label className="workspace-search"><Search size={14} /><input aria-label="搜索笔记本" placeholder="搜索笔记本" value={query} onChange={event => setQuery(event.target.value)} /></label><button className="shell-icon-button" title="已归档笔记本" aria-label="查看已归档笔记本" onClick={() => window.dispatchEvent(new Event(OPEN_ARCHIVE))}><Archive size={16} /></button></div></div>
      {notebookError && <p role="alert" className="workspace-error mb-4">笔记本加载失败：{notebookError}<button className="underline ml-2" onClick={() => void refresh()}>重新加载</button></p>}
      {loading ? <div role="status" className="dashboard-empty"><Loader2 size={18} className="animate-spin" /><p>正在加载笔记本...</p></div> : !notebookError && !notebooks.length ? <div className="notebook-first-step"><span className="empty-symbol"><BookOpen size={28} strokeWidth={1.4} /></span><div className="min-w-0"><h3>给下一场面试，建立一本笔记本</h3><p>放入简历和项目资料，按目标岗位模拟问答。基础知识可直接使用全局仓库。</p></div><button className="workspace-button is-primary" onClick={openCreate}><Plus size={15} />创建笔记本</button></div> : !visibleNotebooks.length && !notebookError ? <p className="workspace-muted text-sm py-10 text-center">没有匹配的笔记本，试试其他关键词。</p> : <div className="notebook-card-grid">{visibleNotebooks.map((notebook, index) => <Link className={`notebook-overview-card tone-${index % 3}`} key={notebook.id} to={`/notebook/${notebook.id}`}><div className="flex items-center justify-between mb-5"><span className="notebook-card-symbol"><BookOpen size={21} strokeWidth={1.5} /></span><ArrowUpRight size={17} className="workspace-muted" /></div><h3 className="break-words">{notebook.title}</h3><p className="workspace-muted notebook-card-description">{notebook.description || '项目资料 · 模拟面试 · 知识卡片'}</p><div className="notebook-card-footer"><span>{dateLabel(notebook.updated_at)}</span><span>继续准备<ChevronRight size={13} /></span></div></Link>)}</div>}
    </section>
    <CreateNotebookDialog open={createOpen} onClose={closeCreate} onCreated={notebook => navigate(`/notebook/${notebook.id}?tab=study`, { replace: true })} />
  </div>
}

function CreateNotebookDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (notebook: Notebook) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const lock = useRef(false)
  const [title, setTitle] = useState('')
  const [template, setTemplate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (open && !dialog.current?.open) { setTitle(''); setTemplate(''); setError(''); dialog.current?.showModal() }
    else if (!open) dialog.current?.close()
  }, [open])
  const create = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!title.trim() || lock.current) return
    lock.current = true; setBusy(true); setError('')
    try {
      const notebook = await window.knowmind.notebooks.create(title.trim(), undefined, template || undefined)
      window.dispatchEvent(new Event(NOTEBOOKS_CHANGED))
      onCreated(notebook)
    } catch (error) { setError(errorMessage(error)) }
    finally { lock.current = false; setBusy(false) }
  }
  return <dialog ref={dialog} className="workspace-dialog max-w-2xl" aria-labelledby="create-notebook-heading" onClose={onClose} onCancel={event => { if (busy) event.preventDefault() }} onClick={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <div className="flex items-start justify-between gap-3"><div><h2 id="create-notebook-heading" className="text-lg font-semibold">新建笔记本</h2><p className="workspace-muted text-sm mt-2">围绕一个项目、岗位或复习主题整理资料。</p></div><button className="shell-icon-button" aria-label="关闭新建笔记本" disabled={busy} onClick={onClose}><X size={18} /></button></div>
    <form onSubmit={event => void create(event)} className="mt-5">
      <label className="block text-sm font-medium" htmlFor="notebook-title">笔记本名称</label><input id="notebook-title" autoFocus maxLength={160} required disabled={busy} value={title} onChange={event => setTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault() }} placeholder="例如：字节跳动后端面试、我的 Agent 项目" className="workspace-input mt-2" />
      <fieldset disabled={busy} className="mt-5"><legend className="text-sm font-medium mb-2">起步模板<span className="workspace-muted text-xs font-normal ml-2">可选，包含 5 张基础卡片</span></legend><div className="notebook-template-grid"><button type="button" aria-pressed={!template} className={`notebook-template ${!template ? 'is-selected' : ''}`} onClick={() => setTemplate('')}><span className="flex items-center gap-2"><BookOpen size={16} /><strong>空白笔记本</strong>{!template && <Check size={14} className="ml-auto" />}</span><span className="workspace-muted text-xs mt-2 block">从自己的资料开始</span></button>{templates.map(item => <button type="button" key={item.key} aria-pressed={template === item.key} className={`notebook-template ${template === item.key ? 'is-selected' : ''}`} onClick={() => setTemplate(item.key)}><span className="flex items-center gap-2"><item.icon size={16} /><strong>{item.label}</strong>{template === item.key && <Check size={14} className="ml-auto" />}</span><span className="workspace-muted text-xs mt-2 block">{item.description}</span></button>)}</div></fieldset>
      {error && <p role="alert" className="workspace-error mt-4">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2 mt-6"><button type="button" className="workspace-button" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="workspace-button is-primary" disabled={busy || !title.trim()}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}{busy ? '正在创建...' : template ? '创建并添加 5 张初始卡片' : '创建笔记本'}</button></div>
    </form>
  </dialog>
}
