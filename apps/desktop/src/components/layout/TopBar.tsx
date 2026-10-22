import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Settings, Mic, Square, ChevronRight, Loader2, Palette, Check } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useRecordingState } from '@/hooks/useRecordingState'
import brandIcon from '@/assets/icon.png'

export default function TopBar() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = useRecordingState()
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const [appearanceMode, setAppearanceMode] = useState<'off' | 'soft' | 'vivid'>('soft')
  const [wallpaperAvailable, setWallpaperAvailable] = useState(false)
  const appearanceRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const tick = () => setElapsed(state.active ? Math.max(0, Math.floor((Date.now() - Date.parse(state.active.started_at)) / 1000)) : 0)
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [state.active?.started_at])
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const [info, saved] = await Promise.all([
          window.knowmind.appearance.wallpaper(),
          window.knowmind.settings.get('wallpaperTheme'),
        ])
        if (!active) return
        setWallpaperAvailable(Boolean(info.url))
        if (saved === 'off' || saved === 'soft' || saved === 'vivid') setAppearanceMode(saved)
      } catch { /* solid theme */ }
    })()
    const changed = (event: Event) => {
      const next = (event as CustomEvent).detail
      if (next === 'off' || next === 'soft' || next === 'vivid') setAppearanceMode(next)
    }
    const wallpaperChanged = (event: Event) => {
      const next = (event as CustomEvent).detail
      if (next === null || typeof next === 'string') setWallpaperAvailable(Boolean(next))
    }
    window.addEventListener('knowmind:appearance-changed', changed)
    window.addEventListener('knowmind:wallpaper-changed', wallpaperChanged)
    return () => {
      active = false
      window.removeEventListener('knowmind:appearance-changed', changed)
      window.removeEventListener('knowmind:wallpaper-changed', wallpaperChanged)
    }
  }, [])

  useEffect(() => {
    if (!appearanceOpen) return
    const close = (event: MouseEvent) => {
      if (appearanceRef.current && !appearanceRef.current.contains(event.target as Node)) setAppearanceOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [appearanceOpen])

  const 切换外观 = async (mode: 'off' | 'soft' | 'vivid') => {
    setAppearanceMode(mode)
    setAppearanceOpen(false)
    try {
      await window.knowmind.settings.set('wallpaperTheme', mode)
      window.dispatchEvent(new CustomEvent('knowmind:appearance-changed', { detail: mode }))
    } catch { /* keep the current visual state */ }
  }

  const page = location.pathname.startsWith('/notebook/') ? '笔记本'
    : ({ '/': '工作台', '/ask': '知识问答', '/practice': '专项练习', '/coding': '刷题计划', '/recordings': '面试录音', '/repositories': '全局知识库', '/settings': '设置' }[location.pathname] || '工作空间')

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
      {wallpaperAvailable && <div className="relative" ref={appearanceRef}>
        <button
          onClick={() => setAppearanceOpen(value => !value)}
          className={`shell-icon-button ${appearanceMode !== 'off' ? 'is-active' : ''}`}
          title="外观"
          aria-label="外观"
          aria-expanded={appearanceOpen}
        ><Palette className="w-4 h-4" /></button>
        {appearanceOpen && <div role="menu" aria-label="外观" className="absolute right-0 top-10 z-50 w-44 rounded-lg border border-[color:var(--app-border)] bg-[color:var(--app-surface)] backdrop-blur-xl p-1 shadow-xl">
          {([
            ['off', '纯色', '不使用壁纸'],
            ['soft', '轻透', '模糊壁纸 + 玻璃'],
            ['vivid', '通透', '更明显的壁纸'],
          ] as const).map(([mode, label, description]) => (
            <button key={mode} role="menuitemradio" aria-checked={appearanceMode === mode}
              onClick={() => void 切换外观(mode)}
              className={`w-full flex items-start gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors ${appearanceMode === mode ? 'bg-[color:var(--app-accent-soft)]' : 'hover:bg-[color:var(--app-hover)]'}`}>
              <span className="w-3.5 shrink-0 pt-0.5">{appearanceMode === mode && <Check className="w-3.5 h-3.5 text-primary-600" />}</span>
              <span className="min-w-0">
                <span className="block text-xs font-medium">{label}</span>
                <span className="block text-[10px] text-zinc-500">{description}</span>
              </span>
            </button>
          ))}
        </div>}
      </div>}
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
