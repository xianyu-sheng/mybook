import { createRequire } from 'node:module'
import path from 'node:path'

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
  // The npm static build is intentionally used on Windows so the installer
  // is self-contained. Its Linux build does not include the PulseAudio input
  // device, so Linux must use the distribution FFmpeg for PipeWire/PulseAudio.
  return process.platform === 'win32' ? packageBinary('ffmpeg-static') || 'ffmpeg' : 'ffmpeg'
}

export function ffprobeCommand() {
  return process.platform === 'win32' ? packageBinary('ffprobe-static') || 'ffprobe' : 'ffprobe'
}
