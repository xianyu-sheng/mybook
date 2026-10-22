import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import { useWallpaperTheme } from '@/hooks/useWallpaperTheme'

export default function AppShell() {
  const wallpaper = useWallpaperTheme()
  return (
    <div className={`app-shell h-screen flex flex-col overflow-hidden ${wallpaper.enabled ? `has-wallpaper wallpaper-${wallpaper.mode}` : ''}`}>
      {wallpaper.enabled && (
        <div className="wallpaper-layer" aria-hidden="true"
          style={{ backgroundImage: `url("${wallpaper.wallpaperUrl}")` }} />
      )}
      <a href="#main-workspace" className="skip-link" onClick={event => { event.preventDefault(); document.getElementById('main-workspace')?.focus() }}>跳到主要内容</a>
      <TopBar />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <Sidebar />
        <main id="main-workspace" tabIndex={-1} className="flex-1 min-w-0 overflow-y-auto app-canvas">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
