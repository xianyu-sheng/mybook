import { app, BrowserWindow } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { mkdir, writeFile, rm, stat } from 'node:fs/promises'
import { z } from 'zod'
import { getDb } from '../db/connection.js'
import type { AudioTrack, Recording, RecordingInput, RecordingReport, RecordingState, TranscriptSegment } from '../../src/types/recording.js'
import { audioDevices, captureArgs, duration, recoverDuration, runProcess } from './audio.js'
import { ffmpegCommand, windowsAudioCommand } from './media.js'
import { checkSpeech, prepareSpeech, speechReady, transcribeAudio } from './speech.js'
import { analyzeRecording } from './analysis.js'
import { indexRecording, mergeTranscriptSegments, recordingMarkdown, toSimplifiedChinese } from './documents.js'

export const recordingInput = z.object({
  title: z.string().trim().min(1).max(160), notebook_id: z.string().uuid().nullable(),
  company: z.string().trim().max(120), role: z.string().trim().max(200), jd: z.string().max(18000),
  tags: z.array(z.string().trim().min(1).max(30)).max(12),
})
const segmentSchema = z.object({
  id: z.number().int().min(0), track: z.enum(['microphone', 'system', 'imported']),
  speaker: z.string().trim().min(1).max(50), start: z.number().finite().min(0), end: z.number().finite().min(0),
  text: z.string().trim().min(1).max(10000),
}).refine(s => s.end >= s.start)
let active: { child: ChildProcessWithoutNullStreams; id: string; title: string; started: string; done: Promise<void>; stopping: boolean; timer: ReturnType<typeof setTimeout> } | null = null
let job: { id: string; stage: string; percent: number; abort: AbortController } | null = null
let setup: { running: boolean; message: string; abort?: AbortController } = { running: false, message: '' }
let starting = false
let startingId: string | null = null
let importing = false
let closing = false
const mutations = new Set<string>()
function assertOpen() { if (closing) throw new Error('应用正在退出，请稍后重试') }
async function mutate<T>(id: string, task: () => Promise<T>): Promise<T> {
  assertOpen(); ensureIdle(id); mutations.add(id)
  try { return await task() } finally { mutations.delete(id) }
}
export async function initializeSpeech() { await checkSpeech(); notify() }

/** One-time in-place conversion for recordings made before the OpenCC pass.
 * Keep segment ids untouched because report evidence references them. */
export function simplifyLegacyTranscripts() {
  const db = getDb()
  if (db.prepare("SELECT 1 FROM settings WHERE key='transcriptSimplifiedV1'").get()) return
  const rows = db.prepare("SELECT id,transcript_json FROM recording WHERE length(transcript_json)>2").all() as Array<{ id: string; transcript_json: string }>
  for (const row of rows) {
    try {
      const segments = JSON.parse(row.transcript_json) as TranscriptSegment[]
      let changed = false
      const simplified = segments.map(segment => {
        const text = toSimplifiedChinese(segment.text)
        if (text !== segment.text) changed = true
        return { ...segment, text }
      })
      if (!changed) continue
      db.prepare("UPDATE recording SET transcript_json=?,updated_at=datetime('now') WHERE id=?").run(JSON.stringify(simplified), row.id)
      indexRecording(db, getRecording(row.id))
    } catch (error) {
      console.error('旧转写繁简转换失败:', row.id, error instanceof Error ? error.message : error)
    }
  }
  db.prepare("INSERT INTO settings(key,value_json,updated_at) VALUES('transcriptSimplifiedV1','true',datetime('now')) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at").run()
}

export function recordingDirectory(id: string) {
  return path.join(app.getPath('userData'), 'recordings', z.string().uuid().parse(id))
}
function trackFilePath(directory: string, kind: AudioTrack) {
  const names = process.platform === 'win32' ? [`${kind}.wav`, `${kind}.flac`] : [`${kind}.flac`, `${kind}.wav`]
  return names.map(name => path.join(directory, name)).find(existsSync) || path.join(directory, names[0])
}
export function getRecording(id: string): Recording {
  const row = getDb().prepare('SELECT * FROM recording WHERE id=?').get(z.string().uuid().parse(id)) as any
  if (!row) throw new Error('录音不存在')
  const { tags_json, tracks_json, transcript_json, report_json, ...record } = row
  return { ...record, tags: JSON.parse(tags_json), tracks: JSON.parse(tracks_json), segments: JSON.parse(transcript_json), report: report_json ? JSON.parse(report_json) : null, shared: Boolean(row.shared) }
}
export function listRecordings() {
  return (getDb().prepare('SELECT id FROM recording ORDER BY rowid DESC').all() as { id: string }[]).map(row => getRecording(row.id))
}
export function recordingState(): RecordingState {
  return {
    active: active ? { id: active.id, title: active.title, started_at: active.started, stopping: active.stopping } : null,
    job: job ? { id: job.id, stage: job.stage, percent: job.percent } : null,
    setup: { running: setup.running, message: setup.message, ready: speechReady() },
  }
}
function notify() {
  for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('knowmind:recordings:state', recordingState())
}
function progress(percent: number, stage: string) {
  if (job) { job.percent = percent; job.stage = stage; notify() }
}
function ensureIdle(id: string) {
  if (startingId === id || active?.id === id || job?.id === id || mutations.has(id)) throw new Error('录音正在处理中，请先停止或取消任务')
}
function commitRecording(id: string, change: () => void) {
  const db = getDb()
  db.transaction(() => {
    change()
    indexRecording(db, getRecording(id))
  })()
}
async function saveDocument(id: string) {
  const record = getRecording(id)
  try {
    const dir = recordingDirectory(id)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'interview.md'), recordingMarkdown(record), 'utf8')
    getDb().prepare('UPDATE recording SET export_error=NULL WHERE id=?').run(id)
  } catch { getDb().prepare('UPDATE recording SET export_error=? WHERE id=?').run('文档已保存在知识库，本地 Markdown 写入失败，可重试导出。', id) }
}
function createRecord(value: unknown, tracks: Recording['tracks']) {
  const input = recordingInput.parse(value)
  if (input.notebook_id && !getDb().prepare('SELECT id FROM notebook WHERE id=?').get(input.notebook_id)) throw new Error('关联笔记本不存在')
  const id = randomUUID()
  getDb().prepare('INSERT INTO recording(id,title,notebook_id,company,role,jd,tags_json,tracks_json) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, input.title, input.notebook_id, input.company, input.role, input.jd, JSON.stringify(input.tags), JSON.stringify(tracks))
  return id
}

export async function startRecording(value: unknown) {
  assertOpen()
  if (active || starting) throw new Error('已有录音正在进行')
  starting = true
  let id: string | undefined
  try {
    const input = recordingInput.extend({ microphone: z.string().max(500), system: z.string().max(500) }).parse(value)
    const { devices, error } = await audioDevices()
    if (error) throw new Error(error)
    assertOpen()
    const mic = devices.find(d => d.name === input.microphone && !d.monitor)
    const system = devices.find(d => d.name === input.system && d.monitor)
    if (!mic && !system) throw new Error('至少选择一个有效录音设备')
    if (input.microphone && !mic || input.system && !system) throw new Error('选择的设备已离线，请刷新设备')
    if (mic?.muted || system?.muted) throw new Error('所选录音设备已静音，请先在系统中取消静音')
    const tracks: Recording['tracks'] = []
    if (mic) tracks.push({ kind: 'microphone', label: '麦克风 · 本人', source: mic.name })
    if (system) tracks.push({ kind: 'system', label: '系统声音 · 对方', source: system.name })
    id = createRecord(input, tracks)
    startingId = id
    const dir = recordingDirectory(id)
    await mkdir(dir, { recursive: true })
    assertOpen()
    const started = new Date().toISOString()
    const files = tracks.map(track => ({ track, file: trackFilePath(dir, track.kind) }))
    const child = process.platform === 'win32'
      ? spawn(windowsAudioCommand(), ['capture', '--inputs', JSON.stringify(files.map(({ track, file }) => ({ source: track.source!, kind: track.kind, file })))], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      : spawn(ffmpegCommand(), captureArgs(files.map(({ track, file }) => ({ kind: track.kind, source: track.source!, file }))), { stdio: ['pipe', 'pipe', 'pipe'] })
    let stderr = '', processError = ''
    let ready = process.platform !== 'win32'
    let readyResolve!: () => void
    const readySignal = new Promise<void>(resolve => { readyResolve = resolve })
    let pendingOutput = ''
    child.stdout.on('data', data => {
      pendingOutput += data.toString()
      const lines = pendingOutput.split(/\r?\n/)
      pendingOutput = (lines.pop() || '').slice(-4096)
      for (const line of lines) if (line.trim() === 'ready') { ready = true; readyResolve() }
    })
    child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-2000) })
    child.on('error', error => { processError = error.message })
    child.stdin.on('error', () => {})
    const recordId = id
    const done = new Promise<void>(resolve => child.once('close', code => {
      void (async () => {
        const expected = active?.id === recordId && active.stopping
        // Keep the lock until audio headers, duration, document and index are saved.
        if (active?.id === recordId) { clearTimeout(active.timer); active.stopping = true; notify() }
        try {
          const lengths = await Promise.allSettled(tracks.map(t => recoverDuration(trackFilePath(dir, t.kind))))
          const seconds = Math.max(0, ...lengths.flatMap(r => r.status === 'fulfilled' ? [r.value] : []))
          const incomplete = lengths.some(r => r.status === 'rejected')
          const failure = processError || (!expected || code !== 0 || incomplete ? '录音意外中断或音轨不完整，已保留音频；请检查设备并试听。' : seconds ? null : '未录到有效音频，请检查录音设备。')
          commitRecording(recordId, () => { getDb().prepare("UPDATE recording SET status=?,duration=?,error=?,updated_at=datetime('now') WHERE id=?").run(seconds ? 'recorded' : 'error', seconds, failure, recordId) })
          if (stderr && !seconds) console.error('[Mybook recording]', stderr)
          await saveDocument(recordId)
        } catch (error) {
          console.error('[Mybook recording] finalize failed', error)
          getDb().prepare("UPDATE recording SET status='error',error='音频已保留，保存录音信息失败，请重启后重试。' WHERE id=?").run(recordId)
        } finally {
          if (active?.id === recordId) active = null
          notify(); resolve()
        }
      })()
    }))
    active = { id, title: input.title, child, started, done, stopping: false, timer: setTimeout(() => { void stopRecording().catch(error => console.error('[Mybook recording] automatic stop failed', error)) }, 4 * 60 * 60 * 1000) }
    getDb().prepare("UPDATE recording SET status='recording',started_at=? WHERE id=?").run(started, id)
    // The Windows helper emits ready only after both WASAPI clients are
    // capturing. FFmpeg on Linux has no equivalent handshake, so retain the
    // short open-failure grace period there.
    if (process.platform === 'win32') {
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([readySignal, done, new Promise(resolve => { timeout = setTimeout(resolve, 15000) })])
      } finally { clearTimeout(timeout) }
    } else await new Promise(resolve => setTimeout(resolve, 700))
    if (!active || active.stopping || processError || !ready) {
      processError ||= !ready && active && !active.stopping ? '录音设备启动超时，请检查麦克风权限和所选设备。' : '无法启动所选录音设备'
      throw new Error(processError)
    }
    notify()
    return getRecording(id)
  } catch (error) {
    if (id) {
      if (active?.id === id) await stopRecording()
      commitRecording(id, () => {
        getDb().prepare("UPDATE recording SET status=CASE WHEN duration>0 THEN 'recorded' ELSE 'error' END,error=?,updated_at=datetime('now') WHERE id=?")
          .run(String(error instanceof Error ? error.message : error).slice(0, 2500), id)
      })
      await saveDocument(id)
    }
    throw error
  } finally { starting = false; startingId = null }
}

export async function stopRecording() {
  const current = active
  if (!current) return null
  if (current.stopping) { await current.done; return existingRecording(current.id) }
  current.stopping = true; notify()
  if (!current.child.stdin.destroyed) current.child.stdin.write('q\n')
  const timer = setTimeout(() => current.child.kill('SIGINT'), 5000)
  const force = setTimeout(() => current.child.kill('SIGKILL'), 10000)
  try { await current.done } finally { clearTimeout(timer); clearTimeout(force) }
  return existingRecording(current.id)
}

function existingRecording(id: string) {
  return getDb().prepare('SELECT id FROM recording WHERE id=?').get(id) ? getRecording(id) : null
}

export async function importAudio(value: RecordingInput, file: string) {
  assertOpen()
  if (importing || job || setup.running) throw new Error('请先等待当前处理任务完成')
  importing = true
  try {
    recordingInput.parse(value)
    if ((await stat(file)).size > 2 * 1024 ** 3) throw new Error('音频文件不能超过 2 GB')
    const seconds = await duration(file)
    assertOpen()
    if (seconds > 4 * 3600) throw new Error('单次录音最长支持 4 小时')
    const id = createRecord(value, [{ kind: 'imported', label: '导入录音' }])
    getDb().prepare("UPDATE recording SET status='importing' WHERE id=?").run(id)
    // Reserve the processing slot before the first filesystem await.
    await runJob(id, '导入音频', async signal => {
      const dir = recordingDirectory(id)
      await mkdir(dir, { recursive: true })
      const destination = path.join(dir, 'imported.flac')
      try {
        await runProcess(ffmpegCommand(), ['-v', 'error', '-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'flac', destination], { signal })
        signal.throwIfAborted()
      } catch (error) {
        const recovered = await recoverDuration(destination).catch(() => 0)
        if (recovered) {
          commitRecording(id, () => { getDb().prepare('UPDATE recording SET duration=? WHERE id=?').run(recovered, id) })
          await saveDocument(id)
        }
        throw error
      }
      const importedDuration = await duration(destination)
      commitRecording(id, () => { getDb().prepare('UPDATE recording SET duration=?,status=? WHERE id=?').run(importedDuration, 'recorded', id) })
      await saveDocument(id)
    }, true)
    return getRecording(id)
  } finally { importing = false }
}

async function runJob(id: string, stage: string, task: (signal: AbortSignal) => Promise<void>, fromImport = false) {
  assertOpen()
  if (job || setup.running || importing && !fromImport) throw new Error('已有处理任务正在进行')
  ensureIdle(id)
  job = { id, stage, percent: 0, abort: new AbortController() }
  getDb().prepare('UPDATE recording SET error=NULL WHERE id=?').run(id)
  notify()
  try { await task(job.abort.signal) }
  catch (error: any) {
    const record = getRecording(id)
    const completeReport = record.report && !record.report.progress
    getDb().prepare('UPDATE recording SET status=?,error=? WHERE id=?').run(completeReport ? 'ready' : record.segments.length ? 'transcribed' : record.duration ? 'recorded' : 'error', String(error?.message || error).slice(0, 2500), id)
    throw error
  } finally { job = null; notify() }
}
export async function transcribeRecording(id: string, language: string) {
  z.enum(['zh', 'en', 'auto']).parse(language)
  const record = getRecording(id)
  await runJob(id, '加载本地转写模型', async signal => {
    getDb().prepare("UPDATE recording SET status='transcribing' WHERE id=?").run(id)
    const dir = recordingDirectory(id)
    const segments = mergeTranscriptSegments(await transcribeAudio(dir, record.tracks.map(t => ({ kind: t.kind, path: trackFilePath(dir, t.kind) })), language, signal, progress))
    signal.throwIfAborted()
    commitRecording(id, () => { getDb().prepare("UPDATE recording SET transcript_json=?,report_json=NULL,status='transcribed',updated_at=datetime('now') WHERE id=?").run(JSON.stringify(segments), id) })
    await saveDocument(id)
  })
}
export async function analyze(id: string) {
  await runJob(id, '准备面试复盘', async signal => {
    getDb().prepare("UPDATE recording SET status='analyzing' WHERE id=?").run(id)
    let record = getRecording(id)
    // 老版本的转写按停顿切得很碎；分析前先合并成可读段落，减少窗口数和
    // 模型调用次数。已有复盘时保持原片段，避免破坏 evidence 引用。
    if (!record.report) {
      const merged = mergeTranscriptSegments(record.segments)
      if (merged.length !== record.segments.length) {
        signal.throwIfAborted()
        commitRecording(id, () => { getDb().prepare("UPDATE recording SET transcript_json=?,updated_at=datetime('now') WHERE id=?").run(JSON.stringify(merged), id) })
        await saveDocument(id)
        notify()
        record = getRecording(id)
      }
    }
    // 每完成一个窗口就落盘；模型或网络中断时已分析好的题目不会丢。
    const savePartial = (partial: RecordingReport) => {
      getDb().prepare("UPDATE recording SET report_json=?,updated_at=datetime('now') WHERE id=?").run(JSON.stringify(partial), id)
      notify()
    }
    const report = await analyzeRecording(getDb(), record, signal, progress, savePartial)
    signal.throwIfAborted()
    commitRecording(id, () => { getDb().prepare("UPDATE recording SET report_json=?,status='ready',updated_at=datetime('now') WHERE id=?").run(JSON.stringify(report), id) })
    await saveDocument(id)
  })
}
export async function saveTranscript(id: string, value: unknown) {
  return mutate(id, async () => {
  const record = getRecording(id)
  const segments = z.array(segmentSchema).min(1).max(15000).parse(value) as TranscriptSegment[]
  if (new Set(segments.map(s => s.id)).size !== segments.length || segments.some(s => !record.tracks.some(t => t.kind === s.track) || s.end > record.duration + 5)) throw new Error('转写片段的编号、音轨或时间范围无效')
  commitRecording(id, () => { getDb().prepare("UPDATE recording SET transcript_json=?,report_json=NULL,status='transcribed',error=NULL,updated_at=datetime('now') WHERE id=?").run(JSON.stringify(segments), id) })
  await saveDocument(id); notify()
  return getRecording(id)
  })
}
export async function updateRecording(id: string, value: unknown) {
  return mutate(id, async () => {
  const previous = getRecording(id)
  const input = recordingInput.extend({ shared: z.boolean() }).parse(value)
  if (input.notebook_id && !getDb().prepare('SELECT id FROM notebook WHERE id=?').get(input.notebook_id)) throw new Error('关联笔记本不存在')
  const invalidates = input.notebook_id !== previous.notebook_id || input.company !== previous.company || input.role !== previous.role || input.jd !== previous.jd
  commitRecording(id, () => { getDb().prepare("UPDATE recording SET title=?,notebook_id=?,company=?,role=?,jd=?,tags_json=?,shared=?,report_json=?,status=?,updated_at=datetime('now') WHERE id=?")
    .run(input.title, input.notebook_id, input.company, input.role, input.jd, JSON.stringify(input.tags), Number(input.shared), !invalidates && previous.report ? JSON.stringify(previous.report) : null,
      invalidates ? previous.segments.length ? 'transcribed' : 'recorded' : previous.status, id) })
  await saveDocument(id); notify()
  return getRecording(id)
  })
}
export async function deleteRecording(id: string) {
  return mutate(id, async () => {
  getRecording(id)
  await rm(recordingDirectory(id), { recursive: true, force: true })
  getDb().prepare('DELETE FROM recording WHERE id=?').run(id)
  notify()
  })
}
export async function installSpeech() {
  assertOpen()
  if (setup.running || job || importing) throw new Error('已有处理任务正在进行')
  setup = { running: true, message: '准备安装', abort: new AbortController() }; notify()
  try { await prepareSpeech(message => { setup.message = message; notify() }, setup.abort!.signal); setup.message = '本地转写引擎已就绪' }
  catch (error: any) { setup.message = String(error.message || error); throw error }
  finally { setup.running = false; notify() }
}
export function cancelJob() { job?.abort.abort(new Error('操作已取消，原始音频和已保存的文档保留')); setup.abort?.abort(new Error('安装已取消')); }
export async function shutdownRecording() {
  closing = true
  cancelJob()
  while (starting || importing || mutations.size) await new Promise(resolve => setTimeout(resolve, 100))
  if (active) await stopRecording()
  while (job || setup.running) await new Promise(resolve => setTimeout(resolve, 100))
}
export function recordingInProgress() { return Boolean(starting || importing || mutations.size || active || job || setup.running) }
export async function recoverRecordings() {
  // Include legacy imports and recordings that an older release left with zero
  // duration after a crash; their FLAC frames may still be recoverable.
  const interrupted = getDb().prepare("SELECT id FROM recording WHERE status IN ('recording','importing','transcribing','analyzing') OR (duration=0 AND status IN ('recorded','error'))").all() as { id: string }[]
  for (const { id } of interrupted) {
    const record = getRecording(id)
    const lengths = await Promise.allSettled(record.tracks.map(t => recoverDuration(trackFilePath(recordingDirectory(id), t.kind))))
    const seconds = Math.max(record.duration, ...lengths.flatMap(r => r.status === 'fulfilled' ? [r.value] : []))
    commitRecording(id, () => { getDb().prepare("UPDATE recording SET status=?,duration=?,error=? WHERE id=?").run(record.report && !record.report.progress ? 'ready' : record.segments.length ? 'transcribed' : seconds ? 'recorded' : 'error', seconds,
      '上次处理被中断，原始音频已保留，请试听后重试。', id) })
    await saveDocument(id)
  }
}

export function audioPath(id: string, track: AudioTrack) {
  if (!getRecording(id).tracks.some(t => t.kind === track)) throw new Error('音轨不存在')
  const file = trackFilePath(recordingDirectory(id), track)
  if (!existsSync(file)) throw new Error('音频文件不存在')
  return file
}
