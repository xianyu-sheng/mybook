import { Link, useParams, useSearchParams } from 'react-router-dom'
import SourcePanel from '@/components/notebook/SourcePanel'
import SupplementPanel from '@/components/notebook/SupplementPanel'
import CardList from '@/components/card/CardList'
import InterviewPanel from '@/components/interview/InterviewPanel'
import { useState, useEffect } from 'react'
import { BookOpen, BriefcaseBusiness, ArrowLeft, Target, Loader2, Archive } from 'lucide-react'
import type { Notebook } from '@/types/db'
import { NOTEBOOKS_CHANGED, OPEN_ARCHIVE } from '@/components/layout/NotebookDialogs'

export default function NotebookPage() {
  const { id } = useParams<{ id: string }>()
  return <NotebookWorkspace key={id} notebookId={id!} />
}

function NotebookWorkspace({ notebookId }: { notebookId: string }) {
  const [notebook, setNotebook] = useState<Notebook | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [params, setParams] = useSearchParams()
  const tab = ['interview', 'study'].includes(params.get('tab') || '') ? params.get('tab')! : 'interview'
  const setTab = (value: string) => setParams(current => { const next = new URLSearchParams(current); next.set('tab', value); return next }, { replace: true })
  useEffect(() => {
    let active = true
    let request = 0
    const load = async () => {
      const version = ++request
      try { const value = await window.knowmind.notebooks.get(notebookId); if (active && version === request) { setNotebook(value); setError('') } }
      catch { if (active && version === request) setError('笔记本加载失败，请返回工作台重试。') }
      finally { if (active && version === request) setLoading(false) }
    }
    const refresh = () => { void load() }
    refresh()
    window.addEventListener(NOTEBOOKS_CHANGED, refresh)
    return () => { active = false; window.removeEventListener(NOTEBOOKS_CHANGED, refresh) }
  }, [notebookId])
  const tabs = [{ id: 'interview', label: '模拟面试', icon: BriefcaseBusiness }, { id: 'study', label: '复习资料', icon: BookOpen }]

  if (loading) return <div role="status" className="dashboard-empty mt-12"><Loader2 size={20} className="animate-spin" /><p>正在打开笔记本...</p></div>
  if (!notebook || error || notebook.archived_at) return <div className="workspace-home"><Link to="/" className="workspace-text-link"><ArrowLeft size={15} />返回工作台</Link><div className="dashboard-panel dashboard-empty mt-6">{notebook?.archived_at ? <><Archive size={28} /><h1 className="text-lg font-semibold">这本笔记本已归档</h1><p className="workspace-muted text-sm">内容仍然保留，恢复后可以继续准备。</p><button className="workspace-button" onClick={() => window.dispatchEvent(new Event(OPEN_ARCHIVE))}>查看归档笔记本</button></> : <p role="alert" className="workspace-muted text-sm">{error || '找不到这本笔记本，请返回工作台打开其他资料。'}</p>}</div></div>

  return (
    <div className="notebook-workspace flex flex-col h-full min-w-0">
      <div className="notebook-workspace-heading shrink-0"><div className="min-w-0"><Link to="/" className="workspace-text-link text-xs mb-3"><ArrowLeft size={13} />我的笔记本</Link><h1 className="text-xl font-semibold break-words">{notebook.title}</h1>{notebook.description && <p className="text-xs workspace-muted mt-2 break-words">{notebook.description}</p>}</div><Link to="/practice" className="workspace-button is-small"><Target size={15} />专项练习</Link></div>
      <div role="tablist" aria-label="笔记本视图" className="notebook-tabs">{tabs.map(({ id, label, icon: Icon }) => <button role="tab" id={`notebook-tab-${id}`} aria-controls={`notebook-panel-${id}`} aria-selected={tab === id} key={id} onClick={() => setTab(id)} className={`notebook-tab ${tab === id ? 'is-active' : ''}`}><Icon size={16} strokeWidth={1.8} />{label}</button>)}</div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div role="tabpanel" id="notebook-panel-interview" aria-labelledby="notebook-tab-interview" hidden={tab !== 'interview'}><InterviewPanel notebookId={notebookId} /></div>
        <div role="tabpanel" id="notebook-panel-study" aria-labelledby="notebook-tab-study" hidden={tab !== 'study'}><div className="study-layout"><div className="study-sources space-y-6"><SourcePanel notebookId={notebookId} /><SupplementPanel notebookId={notebookId} /></div><CardList notebookId={notebookId} /></div></div>
      </div>
    </div>
  )
}
