import { useCallback, useEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Plus, BookOpen, Archive, LibraryBig, Headphones, LayoutDashboard, Target, RefreshCw, Code2 } from 'lucide-react'
import type { Notebook } from '@/types/db'
import { ArchiveNotebookDialog, ArchivedNotebooksDialog, NOTEBOOKS_CHANGED, OPEN_ARCHIVE } from './NotebookDialogs'

const destinations = [
  { path: '/', label: '工作台', icon: LayoutDashboard },
  { path: '/practice', label: '专项练习', icon: Target },
  { path: '/coding', label: '刷题计划', icon: Code2 },
  { path: '/recordings', label: '面试录音', icon: Headphones },
  { path: '/repositories', label: '全局知识库', icon: LibraryBig },
]

export default function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const currentNotebook = location.pathname.match(/^\/notebook\/([^/]+)/)?.[1]
  const [notebooks, setNotebooks] = useState<Notebook[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [archiving, setArchiving] = useState<Notebook | null>(null)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const alive = useRef(true)
  const request = useRef(0)

  const refresh = useCallback(async () => {
    const version = ++request.current
    try {
      const list = await window.knowmind.notebooks.list()
      if (alive.current && request.current === version) { setNotebooks(list); setError('') }
    } catch {
      if (alive.current && request.current === version) setError('笔记本列表加载失败')
    } finally {
      if (alive.current && request.current === version) setLoading(false)
    }
  }, [])

  useEffect(() => {
    alive.current = true
    const update = () => { void refresh() }
    const openArchive = () => setArchiveOpen(true)
    window.addEventListener(NOTEBOOKS_CHANGED, update)
    window.addEventListener('knowmind:knowledge-changed', update)
    window.addEventListener(OPEN_ARCHIVE, openArchive)
    return () => {
      alive.current = false
      window.removeEventListener(NOTEBOOKS_CHANGED, update)
      window.removeEventListener('knowmind:knowledge-changed', update)
      window.removeEventListener(OPEN_ARCHIVE, openArchive)
    }
  }, [refresh])
  useEffect(() => { void refresh() }, [refresh, location.pathname])

  return <>
    <aside className="app-sidebar" aria-label="工作空间导航">
      <nav className="sidebar-primary" aria-label="主要导航">
        {destinations.map(({ path, label, icon: Icon }) => <NavLink key={path} to={path} end={path === '/'} className={({ isActive }) => `sidebar-nav-item ${isActive ? 'is-active' : ''}`}>
          <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
        </NavLink>)}
      </nav>
      <div className="sidebar-section-heading"><span>我的笔记本</span><button className="shell-icon-button" title="新建笔记本" aria-label="新建笔记本" onClick={() => navigate('/?create=1')}><Plus size={16} /></button></div>
      <nav className="sidebar-notebooks" aria-label="我的笔记本">
        {loading ? <p className="sidebar-empty" role="status">正在加载...</p> : error ? <div className="sidebar-empty text-red-600 dark:text-red-400"><p>{error}</p><button className="inline-flex items-center gap-1 mt-2" onClick={() => void refresh()}><RefreshCw size={12} />重试</button></div> : !notebooks.length ? <div className="sidebar-empty"><BookOpen size={22} className="mb-2 opacity-50" /><p>为一个岗位或项目<br />建立专属准备空间。</p><button className="mt-3 text-blue-600 dark:text-blue-400" onClick={() => navigate('/?create=1')}>创建第一本笔记本</button></div> : notebooks.map(notebook => <div key={notebook.id} className={`sidebar-notebook group ${currentNotebook === notebook.id ? 'is-active' : ''}`}>
          <NavLink to={`/notebook/${notebook.id}`} className="sidebar-notebook-link" title={notebook.title}><BookOpen size={15} strokeWidth={1.7} /><span className="truncate">{notebook.title}</span></NavLink>
          <button className="sidebar-archive-button" title={`归档 ${notebook.title}`} aria-label={`归档笔记本 ${notebook.title}`} onClick={() => setArchiving(notebook)}><Archive size={13} /></button>
        </div>)}
      </nav>
      <div className="sidebar-footer">
        <button className="sidebar-nav-item w-full" onClick={() => setArchiveOpen(true)}><Archive size={16} strokeWidth={1.7} /><span>已归档笔记本</span></button>
        <div className="sidebar-footnote"><span className="status-dot" />每一次练习，都有迹可循</div>
      </div>
    </aside>
    <ArchiveNotebookDialog notebook={archiving} onClose={() => setArchiving(null)} onArchived={notebook => { if (currentNotebook === notebook.id) navigate('/') }} />
    <ArchivedNotebooksDialog open={archiveOpen} onClose={() => setArchiveOpen(false)} />
  </>
}
