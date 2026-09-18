import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

function unpacked(candidate: string) {
  // electron-builder places executable assets outside the asar archive. The
  // static packages report their original app.asar path, so point them at the
  // unpacked copy only when the app is packaged.
  return candidate.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
}

function packageBinary(packageName: string, key?: string) {
  try {
    const value = require(packageName)
    const candidate = typeof value === 'string' ? value : key ? value?.[key] : value?.path
    return typeof candidate === 'string' && candidate ? unpacked(candidate) : null
  } catch {
    return null
  }
}

export function ffmpegCommand() {
  // Linux needs the distribution build because the npm static binary does not
  // include the PulseAudio input device. Windows capture uses the native
  // helper below; the static binary remains useful for imports and probing.
  return process.platform === 'win32' ? packageBinary('ffmpeg-static') || 'ffmpeg' : 'ffmpeg'
}

export function ffprobeCommand() {
  return process.platform === 'win32' ? packageBinary('ffprobe-static') || 'ffprobe' : 'ffprobe'
}

export function windowsAudioCommand() {
  const name = process.platform === 'win32' ? 'mybook-windows-audio.exe' : 'mybook-windows-audio'
  const candidates = [
    path.join(process.resourcesPath || '', 'windows-audio', name),
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../native/windows-audio/publish', name),
    path.join(process.cwd(), 'native/windows-audio/publish', name),
    path.join(process.cwd(), 'apps/desktop/native/windows-audio/publish', name),
  ]
  return candidates.find(existsSync) || candidates[0]
}
