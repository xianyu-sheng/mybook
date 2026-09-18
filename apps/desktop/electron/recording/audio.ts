import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { copyFile, rename, rm, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { AudioDevice } from '../../src/types/recording.js'

const exec = promisify(execFile)
export async function audioDevices(): Promise<{ devices: AudioDevice[]; error: string | null }> {
  if (process.platform !== 'linux') return { devices: [], error: '当前版本的双路录音支持 Linux；其他平台可导入录音文件。' }
  try {
    const [info, rows] = await Promise.all([
      exec('pactl', ['--format=json', 'info'], { timeout: 5000 }),
      exec('pactl', ['--format=json', 'list', 'sources'], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 }),
    ])
    const defaults = JSON.parse(info.stdout)
    const devices: AudioDevice[] = JSON.parse(rows.stdout).map((row: any) => ({
      name: row.name, label: row.description || row.name,
      monitor: row.properties?.['device.class'] === 'monitor' || row.name.endsWith('.monitor'),
      muted: Boolean(row.mute), isDefault: row.name === defaults.default_source_name || row.name === `${defaults.default_sink_name}.monitor`,
    }))
    await exec('ffmpeg', ['-version'], { timeout: 5000 })
    return { devices, error: null }
  } catch { return { devices: [], error: '无法连接系统音频。请确认 FFmpeg、pactl 已安装，并且 PipeWire/PulseAudio 正在运行。' } }
}

export function captureArgs(inputs: Array<{ source: string; file: string }>) {
  const args = ['-hide_banner', '-loglevel', 'warning', '-y']
  for (const input of inputs) args.push('-thread_queue_size', '2048', '-f', 'pulse', '-i', input.source)
  for (const [index, input] of inputs.entries()) args.push('-map', `${index}:a`, '-ac', '1', '-ar', '16000', '-c:a', 'flac', input.file)
  return args
}

export async function duration(file: string) {
  const result = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file], { timeout: 15000 })
  const seconds = Number(JSON.parse(result.stdout).format?.duration)
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('音频文件为空或无法读取')
  return seconds
}

// A killed FLAC encoder cannot finalize STREAMINFO, even when its complete
// frames are still decodable. Repair a copy and keep the original for recovery.
export async function recoverDuration(file: string) {
  try { return await duration(file) } catch (error) {
    if (!(await stat(file).catch(() => null))?.size) throw error
  }
  const token = randomUUID()
  const parsed = path.parse(file)
  const repaired = path.join(parsed.dir, `${parsed.name}.recovery-${token}.flac`)
  const original = path.join(parsed.dir, `${parsed.name}.interrupted-${token}.flac`)
  try {
    // A truncated final frame may produce a nonzero exit code while earlier
    // frames were recovered. The output probe is the acceptance check.
    await runProcess('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'flac', repaired], { timeout: 10 * 60 * 1000 }).catch(() => {})
    const seconds = await duration(repaired)
    await copyFile(file, original, constants.COPYFILE_EXCL)
    await rename(repaired, file)
    return seconds
  } finally { await rm(repaired, { force: true }).catch(() => {}) }
}

export function runProcess(command: string, args: string[], options: {
  signal?: AbortSignal; timeout?: number; onLine?: (line: string) => void
} = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) return reject(options.signal.reason)
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    let output = '', stderr = '', pending = '', failure: unknown
    let force: ReturnType<typeof setTimeout> | undefined
    const terminate = () => {
      failure = options.signal?.reason || new Error('操作已取消'); child.kill('SIGTERM')
      force = setTimeout(() => child.kill('SIGKILL'), 2000)
    }
    const timer = setTimeout(() => { failure = new Error('处理超时，原始音频已保留'); child.kill('SIGKILL') }, options.timeout || 30 * 60 * 1000)
    options.signal?.addEventListener('abort', terminate, { once: true })
    if (options.signal?.aborted) terminate()
    child.stdout.on('data', chunk => {
      output = (output + chunk.toString()).slice(-2_000_000)
      pending += chunk.toString()
      const lines = pending.split('\n'); pending = lines.pop() || ''
      for (const line of lines) {
        try { options.onLine?.(line) } catch (error) { failure = error; child.kill('SIGKILL') }
      }
    })
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-3000) })
    child.on('error', error => { failure = error })
    child.once('close', code => {
      clearTimeout(timer); clearTimeout(force); options.signal?.removeEventListener('abort', terminate)
      if (!failure && pending.trim()) { try { options.onLine?.(pending) } catch (error) { failure = error } }
      if (failure) reject(failure)
      else if (code !== 0) reject(new Error(stderr || `处理程序退出（${code}）`))
      else resolve(output)
    })
  })
}
