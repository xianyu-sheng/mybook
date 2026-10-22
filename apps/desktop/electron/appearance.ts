import { app, dialog, ipcMain, protocol } from 'electron'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDb } from './db/connection.js'
import { ffmpegCommand } from './recording/media.js'

/**
 * Desktop wallpaper as an opt-in window backdrop.
 *
 * Only a still wallpaper image is read: for Wallpaper Engine the project's
 * preview image (or one extracted frame of a GIF/video) is used, otherwise
 * the system wallpaper file. Desktop icons, open windows and other screen
 * content are never captured; the renderer blurs the image and keeps normal
 * opaque surfaces underneath the text.
 */
const SEP = String.fromCharCode(92)
export type WallpaperSource = 'custom' | 'wallpaper-engine' | 'system'
export interface WallpaperInfo {
  file: string
  source: WallpaperSource
  label: string
}

function customWallpaper(): WallpaperInfo | null {
  try {
    const row = getDb().prepare("SELECT value_json FROM settings WHERE key = 'wallpaperImage'").get() as { value_json: string } | undefined
    const file = row ? JSON.parse(row.value_json) : null
    if (typeof file === 'string' && file && existsSync(file)) return { file, source: 'custom', label: '自定义图片' }
  } catch { /* no custom image */ }
  return null
}

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

function systemWallpaper(): WallpaperInfo | null {
  const file = process.platform === 'win32' ? windowsWallpaper() : process.platform === 'linux' ? linuxWallpaper() : null
  if (!file) return null
  return { file, source: 'system', label: process.platform === 'win32' ? 'Windows 壁纸' : '系统壁纸' }
}

function wallpaperEngineConfig(): string | null {
  try {
    const script = '[Console]::OutputEncoding=[Text.Encoding]::UTF8; (Get-Process wallpaper32,wallpaper64 -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path)'
    const exe = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8', windowsHide: true, timeout: 5000,
    }).trim()
    if (exe) {
      const config = path.join(path.dirname(exe), 'config.json')
      if (existsSync(config)) return config
    }
  } catch { /* Wallpaper Engine is not running */ }
  const roots = [
    path.join(process.env['ProgramFiles(x86)'] || '', 'Steam'),
    path.join(process.env['ProgramFiles'] || '', 'Steam'),
    'D:\\Program Files (x86)\\Steam', 'D:\\Steam',
    'C:\\Program Files (x86)\\Steam', 'C:\\Steam',
    'D:\\SteamLibrary', 'E:\\SteamLibrary',
  ]
  for (const root of roots) {
    const config = path.join(root, 'steamapps', 'common', 'wallpaper_engine', 'config.json')
    if (existsSync(config)) return config
  }
  return null
}

function projectTitle(file: string) {
  try {
    const project = JSON.parse(readFileSync(path.join(path.dirname(file), 'project.json'), 'utf8'))
    return typeof project?.title === 'string' && project.title.trim() ? project.title.trim() : ''
  } catch { return '' }
}

function extractFrame(source: string, id: string) {
  try {
    const dir = path.join(app.getPath('userData'), 'wallpaper-cache')
    mkdirSync(dir, { recursive: true })
    const target = path.join(dir, `${id.replace(/[^a-z0-9_-]/gi, '_')}.jpg`)
    if (!existsSync(target) || statSync(target).mtimeMs < statSync(source).mtimeMs) {
      execFileSync(ffmpegCommand(), ['-y', '-loglevel', 'error', '-i', source, '-frames:v', '1', '-q:v', '2', target], {
        timeout: 20000, windowsHide: true,
      })
    }
    return existsSync(target) ? target : null
  } catch { return null }
}

function wallpaperPreview(file: string): string | null {
  const dir = path.dirname(file)
  for (const name of ['preview.jpg', 'preview.jpeg', 'preview.png', 'preview.webp', 'thumbnail.jpg', 'thumbnail.png']) {
    const candidate = path.join(dir, name)
    if (existsSync(candidate)) return candidate
  }
  const gif = path.join(dir, 'preview.gif')
  if (existsSync(gif)) return extractFrame(gif, path.basename(dir))
  if (/\.(jpe?g|png|webp|bmp|gif)$/i.test(file) && existsSync(file)) return file
  if (/\.(mp4|webm|mov|mkv)$/i.test(file) && existsSync(file)) return extractFrame(file, path.basename(dir))
  return null
}

function wallpaperEngineWallpaper(): WallpaperInfo | null {
  const configPath = wallpaperEngineConfig()
  if (!configPath) return null
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, any>
    for (const value of Object.values(config)) {
      const general = value?.general
      const selected = general?.wallpaperconfig?.selectedwallpapers
      if (!selected || typeof selected !== 'object') continue
      const preferred = general?.browser?.lastselectedmonitor
      const keys = [...(preferred && selected[preferred] ? [preferred] : []), ...Object.keys(selected)]
      for (const key of keys) {
        const file = selected[key]?.file
        if (typeof file !== 'string') continue
        const preview = wallpaperPreview(file)
        if (!preview) continue
        const title = projectTitle(file)
        return { file: preview, source: 'wallpaper-engine', label: title ? `Wallpaper Engine · ${title}` : 'Wallpaper Engine' }
      }
    }
  } catch { /* unsupported config */ }
  return null
}

export function resolveWallpaper(): WallpaperInfo | null {
  return customWallpaper() || wallpaperEngineWallpaper() || systemWallpaper()
}

function contentType(data: Buffer, file: string) {
  if (data[0] === 0x89 && data[1] === 0x50) return 'image/png'
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return 'image/gif'
  if (data[0] === 0x42 && data[1] === 0x4d) return 'image/bmp'
  if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46) return 'image/webp'
  const ext = path.extname(file).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.bmp') return 'image/bmp'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'image/jpeg'
}

export function registerWallpaperProtocol(): void {
  protocol.handle('mybook-wallpaper', async () => {
    const info = resolveWallpaper()
    if (!info) return new Response('', { status: 404 })
    try {
      const data = await readFile(info.file)
      return new Response(data, {
        headers: { 'content-type': contentType(data, info.file), 'cache-control': 'no-store' },
      })
    } catch {
      return new Response('', { status: 404 })
    }
  })
}

export function registerAppearanceIpc(): void {
  ipcMain.handle('knowmind:appearance:wallpaper', () => {
    const info = resolveWallpaper()
    return {
      url: info ? `mybook-wallpaper://current?v=${Date.now()}` : null,
      source: info?.source || null,
      label: info?.label || null,
    }
  })

  ipcMain.handle('knowmind:appearance:choose', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择窗口背景图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] }],
    })
    return result.canceled ? null : result.filePaths[0] || null
  })
}
