import { app } from 'electron'
import path from 'node:path'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { runProcess } from './audio.js'
import type { AudioTrack, TranscriptSegment } from '../../src/types/recording.js'

function speechRoots() {
  const legacy = process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || homedir(), 'Mybook', 'speech')
    : path.join(homedir(), '.local', 'share', 'mybook', 'speech')
  try {
    const preferred = path.join(app.getPath('userData'), 'speech')
    return [...new Set([preferred, legacy])]
  } catch { return [legacy] }
}

function hasSpeechModel(root: string) {
  return ['model.bin', 'config.json', 'tokenizer.json', 'vocabulary.txt']
    .every(file => existsSync(path.join(root, 'whisper-small', file)))
}

// 0.5 and earlier stored the optional ASR environment below the Linux data
// directory. Keep using that installation when it exists so an upgrade does
// not trigger another Python environment and ~500 MB model download.
function speechRoot() {
  const roots = speechRoots()
  return roots.find(root => hasSpeechModel(root) && existsSync(path.join(root, 'venv')))
    || roots.find(hasSpeechModel)
    || roots.find(root => existsSync(path.join(root, 'venv')))
    || roots[0]
}

function pythonPath() {
  return path.join(speechRoot(), 'venv', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python')
}

function modelPath() { return path.join(speechRoot(), 'whisper-small') }
const worker = () => app.isPackaged ? path.join(process.resourcesPath, 'speech', 'transcribe.py') : path.join(app.getAppPath(), 'assets', 'speech', 'transcribe.py')
let runtimeReady = false

export function speechReady() {
  return runtimeReady && ['model.bin', 'config.json', 'tokenizer.json', 'vocabulary.txt'].every(file => existsSync(path.join(modelPath(), file)))
}

export async function checkSpeech(signal?: AbortSignal) {
  try {
    await runProcess(pythonPath(), ['-c', 'import faster_whisper, ctranslate2, av'], { signal, timeout: 30000 })
    runtimeReady = existsSync(worker())
  } catch { runtimeReady = false }
  return speechReady()
}

async function createVirtualenv(uv: string, python: string, venv: string, signal: AbortSignal) {
  const bootstrap = process.platform === 'win32' ? 'python' : '/usr/bin/python3'
  try {
    await runProcess(uv, ['venv', '--python', bootstrap, venv], { signal })
    return
  } catch (error) {
    if (signal.aborted) throw error
    const candidates: Array<[string, string[]]> = process.platform === 'win32'
      ? [['python', ['-m', 'venv', venv]], ['py', ['-3', '-m', 'venv', venv]]]
      : [['python3', ['-m', 'venv', venv]]]
    for (const [command, args] of candidates) {
      try { await runProcess(command, args, { signal }); return } catch (fallbackError) { if (signal.aborted) throw fallbackError }
    }
    throw error
  }
}

async function installWhisper(uv: string, python: string, signal: AbortSignal) {
  for (const index of ['https://pypi.org/simple', 'https://mirrors.aliyun.com/pypi/simple']) {
    try {
      await runProcess(uv, ['pip', 'install', '--python', python, '--index-url', index, 'faster-whisper==1.2.1', 'av==15.1.0'], { signal, timeout: 180000 })
      return
    } catch (error) {
      signal.throwIfAborted()
      try {
        await runProcess(python, ['-m', 'ensurepip'], { signal })
        await runProcess(python, ['-m', 'pip', 'install', '--index-url', index, 'faster-whisper==1.2.1', 'av==15.1.0'], { signal, timeout: 180000 })
        return
      } catch (fallbackError) { if (signal.aborted) throw fallbackError }
    }
  }
  throw new Error('转写依赖下载失败，已尝试两个下载源，请检查网络后重试')
}

export async function prepareSpeech(onProgress: (message: string) => void, signal: AbortSignal) {
  const root = speechRoot()
  const python = pythonPath()
  const modelDir = modelPath()
  const venv = path.join(root, 'venv')
  await mkdir(root, { recursive: true })
  const uvCandidates = process.platform === 'win32'
    ? [path.join(process.env.LOCALAPPDATA || homedir(), 'uv', 'uv.exe'), path.join(homedir(), '.local', 'bin', 'uv.exe')]
    : [path.join(homedir(), '.local', 'bin', 'uv')]
  const uv = uvCandidates.find(existsSync) || 'uv'
  onProgress('安装本地转写依赖...')
  if (!existsSync(python)) await createVirtualenv(uv, python, venv, signal)
  await checkSpeech(signal)
  signal.throwIfAborted()
  if (!runtimeReady) await installWhisper(uv, python, signal)
  onProgress('下载 Whisper small 多语言模型（首次约 500 MB）...')
  await runProcess(python, [worker(), '--prepare', '--model-dir', modelDir], { signal, onLine: line => {
    const item = JSON.parse(line); if (item.message) onProgress(item.message)
  } })
  await checkSpeech(signal)
  if (!speechReady()) throw new Error('转写模型文件不完整，请重试安装')
}

export async function transcribeAudio(directory: string, tracks: Array<{ kind: AudioTrack; path: string }>, language: string,
  signal: AbortSignal, progress: (percent: number, stage: string) => void) {
  if (!speechReady()) throw new Error('请先安装本地转写引擎')
  const manifest = path.join(directory, 'transcribe-input.json')
  await writeFile(manifest, JSON.stringify(tracks), 'utf8')
  const segments: TranscriptSegment[] = []
  let complete = false
  await runProcess(pythonPath(), [worker(), '--model-dir', modelPath(), '--manifest', manifest, '--language', language], {
    signal, timeout: 4 * 60 * 60 * 1000,
    onLine: line => {
      if (!line.trim()) return
      const result = JSON.parse(line)
      if (result.phase === 'track') progress(Math.round(result.index / result.total * 100), `正在转写${result.track === 'microphone' ? '麦克风' : result.track === 'system' ? '系统声音' : '导入音频'}`)
      if (result.phase === 'segment') {
        const track = tracks.find(t => t.kind === result.track)
        if (!track || typeof result.text !== 'string' || !Number.isFinite(result.start) || !Number.isFinite(result.end)) throw new Error('转写结果格式错误')
        segments.push({ id: 0, track: track.kind, speaker: track.kind === 'microphone' ? '本人' : track.kind === 'system' ? '对方' : '未区分', start: result.start, end: result.end, text: result.text })
        progress(result.percent, '本地转写中')
      }
      if (result.phase === 'complete') complete = true
    },
  })
  if (!complete) throw new Error('转写程序意外中断，原始音频已保留')
  if (!segments.length) throw new Error('没有检测到可识别的人声，请试听音频后重试')
  return segments.sort((a, b) => a.start - b.start).map((segment, id) => ({ ...segment, id }))
}
