import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Settings, Mic, Square, ChevronRight, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useRecordingState } from '@/hooks/useRecordingState'
import brandIcon from '@/assets/icon.png'

export default function TopBar() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = useRecordingState()
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  useEffect(() => {
    const tick = () => setElapsed(state.active ? Math.max(0, Math.floor((Date.now() - Date.parse(state.active.started_at)) / 1000)) : 0)
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [state.active?.started_at])
  const page = location.pathname.startsWith('/notebook/') ? '笔记本'
    : ({ '/': '工作台', '/practice': '专项练习', '/coding': '刷题计划', '/recordings': '面试录音', '/repositories': '全局知识库', '/settings': '设置' }[location.pathname] || '工作空间')

  return (
    <header className="app-topbar shrink-0">
      <Link to="/" className="brand-link" aria-label="Mybook 工作台">
        <img src={brandIcon} alt="" className="w-9 h-9 shrink-0" />
        <span>Mybook<span className="brand-subtitle">面试准备空间</span></span>
      </Link>
      <div className="topbar-location min-w-0"><span>个人工作区</span><ChevronRight size={13} /><span className="truncate">{page}</span></div>
      <div className="flex items-center gap-2 ml-auto min-w-0">
        {error && <span role="alert" className="text-xs text-red-600 dark:text-red-400 max-w-40 truncate" title={error}>{error}</span>}
        {state.active && <div className="recording-status-pill">
          <button className="inline-flex items-center gap-2 text-xs px-2 py-1.5 rounded-md" onClick={() => navigate(`/recordings?recording=${state.active!.id}`)}><Mic size={14} /><span className="tabular-nums whitespace-nowrap">录音中 {String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}</span></button>
          <button title="停止并保存录音" aria-label="停止并保存录音" disabled={state.active.stopping} className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-red-100 dark:hover:bg-red-950 disabled:opacity-40" onClick={() => { setError(''); void window.knowmind.recordings.stop().catch(e => setError(e.message)) }}>{state.active.stopping ? <Loader2 size={14} className="animate-spin" /> : <Square size={13} />}</button>
        </div>}
        {!state.active && state.job && <button onClick={() => navigate(`/recordings?recording=${state.job!.id}`)} className="flex min-w-0 items-center gap-2 text-xs text-blue-600 dark:text-blue-400 max-w-56 rounded-md px-2 py-1.5" title={state.job.stage}><Loader2 size={14} className="animate-spin shrink-0" /><span className="truncate">{state.job.stage}</span></button>}
      <button
        onClick={() => navigate('/settings')}
        className={`shell-icon-button ${location.pathname === '/settings' ? 'is-active' : ''}`}
        title="设置"
        aria-label="设置"
      >
        <Settings className="w-4 h-4" />
      </button>
      </div>
    </header>
  )
}
