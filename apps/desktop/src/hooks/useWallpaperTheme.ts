import { useEffect, useState } from 'react'

export type WallpaperMode = 'off' | 'soft' | 'vivid'

const isMode = (value: unknown): value is WallpaperMode => value === 'off' || value === 'soft' || value === 'vivid'

/** Desktop wallpaper theme. Reads only the wallpaper image; the renderer
 * never captures the screen, desktop icons or other windows. */
export function useWallpaperTheme() {
  const [wallpaperUrl, setWallpaperUrl] = useState<string | null>(null)
  const [mode, setMode] = useState<WallpaperMode>('soft')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const [info, saved] = await Promise.all([
          window.knowmind.appearance.wallpaper(),
          window.knowmind.settings.get('wallpaperTheme'),
        ])
        if (!active) return
        setWallpaperUrl(info.url)
        if (isMode(saved)) setMode(saved)
      } catch {
        // Keep the existing solid theme when the platform cannot expose a wallpaper.
      } finally {
        if (active) setReady(true)
      }
    })()
    const changed = (event: Event) => {
      const next = (event as CustomEvent).detail
      if (isMode(next)) setMode(next)
    }
    window.addEventListener('knowmind:appearance-changed', changed)
    return () => {
      active = false
      window.removeEventListener('knowmind:appearance-changed', changed)
    }
  }, [])

  return { wallpaperUrl, mode, enabled: ready && Boolean(wallpaperUrl) && mode !== 'off' }
}
