import { app, ipcMain, protocol } from 'electron'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Desktop wallpaper as an opt-in window backdrop.
 *
 * Only the wallpaper image is read. Desktop icons, open windows and other
 * screen content are never captured; the renderer displays the file with a
 * blur and a contrast veil, so the app keeps a normal opaque surface.
 */
const SEP = String.fromCharCode(92)
let cachedPath: { file: string | null; checkedAt: number } | null = null

function windowsWallpaper(): string | null {
  // `reg.exe` returns the OEM code page and mangles Chinese paths; PowerShell
  // with an explicit UTF-8 output encoding preserves them.
  try {
    const key = `HKCU:${SEP}Control Panel${SEP}Desktop`
    const script = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; (Get-ItemProperty '${key}' -Name WallPaper).WallPaper`
    const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8', windowsHide: true, timeout: 5000,
    }).trim()
    const value = output.replace(/^"|"$/g, '')
    if (value && existsSync(value)) return value
  } catch { /* fall through to the transcoded copy */ }

  const themes = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Themes')
  const transcoded = path.join(themes, 'TranscodedWallpaper')
  if (existsSync(transcoded)) return transcoded
  try {
    const cached = path.join(themes, 'CachedFiles')
    const file = readdirSync(cached).find(name => /\.(jpe?g|png|bmp|webp)$/i.test(name))
    if (file) return path.join(cached, file)
  } catch { /* no cached wallpaper */ }
  return null
}

function linuxWallpaper(): string | null {
  const candidates: Array<[string, string]> = [
    ['org.gnome.desktop.background', 'picture-uri-dark'],
    ['org.gnome.desktop.background', 'picture-uri'],
    ['org.cinnamon.desktop.background', 'picture-uri'],
    ['org.mate.background', 'picture-filename'],
  ]
  for (const [schema, key] of candidates) {
    try {
      const raw = execFileSync('gsettings', ['get', schema, key], { encoding: 'utf8', windowsHide: true, timeout: 4000 }).trim()
      const value = raw.replace(/^'|'$/g, '')
      const file = value.startsWith('file://') ? fileURLToPath(value) : value
      if (file && existsSync(file)) return file
    } catch { /* try the next desktop environment */ }
  }
  return null
}

export function wallpaperPath(): string | null {
  const now = Date.now()
  if (cachedPath && now - cachedPath.checkedAt < 30000) return cachedPath.file
  const file = process.platform === 'win32' ? windowsWallpaper() : process.platform === 'linux' ? linuxWallpaper() : null
  cachedPath = { file, checkedAt: now }
  return file
}

function contentType(data: Buffer, file: string) {
  if (data[0] === 0x89 && data[1] === 0x50) return 'image/png'
  if (data[0] === 0x42 && data[1] === 0x4d) return 'image/bmp'
  if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46) return 'image/webp'
  const ext = path.extname(file).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.bmp') return 'image/bmp'
  if (ext === '.webp') return 'image/webp'
  return 'image/jpeg'
}

export function registerWallpaperProtocol(): void {
  protocol.handle('mybook-wallpaper', async () => {
    const file = wallpaperPath()
    if (!file) return new Response('', { status: 404 })
    try {
      const data = await readFile(file)
      return new Response(data, {
        headers: { 'content-type': contentType(data, file), 'cache-control': 'no-store' },
      })
    } catch {
      return new Response('', { status: 404 })
    }
  })
}

export function registerAppearanceIpc(): void {
  ipcMain.handle('knowmind:appearance:wallpaper', () => {
    const file = wallpaperPath()
    return { url: file ? 'mybook-wallpaper://current' : null }
  })
}
