import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryDb } from '../test-utils/memory-db.js'

const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  spawn: vi.fn(),
  recovered: vi.fn(),
}))
vi.mock('electron', () => ({ app: { getPath: () => '/mybook-test' }, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('node:child_process', () => ({ spawn: state.spawn }))
vi.mock('node:fs/promises', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs/promises')>(),
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../db/connection.js', () => ({ getDb: () => state.db! }))
vi.mock('./media.js', () => ({ windowsAudioCommand: () => 'native-audio', ffmpegCommand: () => 'ffmpeg' }))
vi.mock('./audio.js', () => ({
  audioDevices: async () => ({ devices: [{ name: 'mic', monitor: false, muted: false }], error: null }),
  recoverDuration: state.recovered,
  captureArgs: vi.fn(), duration: vi.fn(), runProcess: vi.fn(),
}))
vi.mock('./speech.js', () => ({ speechReady: () => false, checkSpeech: vi.fn(), prepareSpeech: vi.fn(), transcribeAudio: vi.fn() }))
vi.mock('./analysis.js', () => ({ analyzeRecording: vi.fn() }))
import { listRecordings, recordingState, startRecording, stopRecording } from './service.js'

class CaptureProcess extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  stdin = new PassThrough()
  closed = false
  ignoreStop = false
  kill = vi.fn(() => { this.close(null); return true })
  constructor() {
    super()
    this.stdin.on('data', () => { if (!this.ignoreStop) queueMicrotask(() => this.close(0)) })
  }
  close(code: number | null) {
    if (this.closed) return
    this.closed = true
    this.emit('close', code)
  }
}

let child: CaptureProcess
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
const input = { title: 'Startup regression', notebook_id: null, company: '', role: '', jd: '', tags: [], microphone: 'mic', system: '' }
beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'win32' })
  vi.useFakeTimers()
  state.db = memoryDb()
  state.recovered.mockRejectedValue(new Error('No audio'))
  state.spawn.mockImplementation(() => { child = new CaptureProcess(); return child })
})
afterEach(async () => {
  if (child) child.ignoreStop = false
  await stopRecording()
  state.db?.close()
  vi.clearAllMocks()
  vi.useRealTimers()
  Object.defineProperty(process, 'platform', platform)
})

describe('Windows recording startup lifecycle', () => {
  it('stops a helper that never reports ready and releases the recording slot', async () => {
    const start = startRecording(input).catch(error => error)
    await vi.advanceTimersByTimeAsync(15000)
    expect((await start).message).toContain('启动超时')
    expect(child.closed).toBe(true)
    expect(recordingState().active).toBeNull()
    expect(listRecordings()[0]).toMatchObject({ status: 'error', duration: 0 })
    expect(listRecordings()[0].error).toContain('启动超时')
    expect(vi.getTimerCount()).toBe(0)

    const retry = startRecording(input)
    await vi.advanceTimersByTimeAsync(0)
    child.stdout.write('ready\n')
    expect((await retry).status).toBe('recording')
    await stopRecording()
    expect(recordingState().active).toBeNull()
  })

  it('terminates an unresponsive helper after startup times out', async () => {
    const start = startRecording(input).catch(error => error)
    await vi.advanceTimersByTimeAsync(0)
    child.ignoreStop = true
    await vi.advanceTimersByTimeAsync(20000)
    expect((await start).message).toContain('启动超时')
    expect(child.kill).toHaveBeenCalled()
    expect(child.closed).toBe(true)
    expect(recordingState().active).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves partial audio when the helper exits before becoming ready', async () => {
    state.recovered.mockResolvedValue(1.25)
    const start = startRecording(input).catch(error => error)
    await vi.advanceTimersByTimeAsync(0)
    child.close(1)
    expect((await start).message).toContain('无法启动')
    expect(recordingState().active).toBeNull()
    expect(listRecordings()[0]).toMatchObject({ status: 'recorded', duration: 1.25 })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('accepts a split ready message and finishes both startup and stop', async () => {
    state.recovered.mockResolvedValue(2)
    const start = startRecording(input)
    await vi.advanceTimersByTimeAsync(0)
    child.stdout.write('rea')
    child.stdout.write('dy\r\n')
    const recording = await start
    const args = state.spawn.mock.calls[0][1] as string[]
    expect(JSON.parse(args[2])[0]).toMatchObject({ source: 'mic', kind: 'microphone' })
    expect(JSON.parse(args[2])[0].file).toMatch(/microphone\.wav$/)
    expect(recording.status).toBe('recording')
    expect(await stopRecording()).toMatchObject({ status: 'recorded', duration: 2, error: null })
    expect(recordingState().active).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
})
