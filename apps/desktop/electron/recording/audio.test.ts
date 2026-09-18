import { describe, expect, it } from 'vitest'
import { captureArgs, captureArgsForPlatform, parseWindowsAudioDevicesJson, runProcess } from './audio.js'

describe('recording subprocesses', () => {
  it('maps each source to its own speech track without shell interpolation', () => {
    const args = captureArgs([{ source: 'mic;literal', file: '/tmp/a.flac' }, { source: 'speaker.monitor', file: '/tmp/b.flac' }])
    expect(args.filter(a => a === '-i')).toHaveLength(2)
    expect(args).toContain('mic;literal')
    expect(args.slice(args.indexOf('-map'))).toEqual(['-map', '0:a', '-ac', '1', '-ar', '16000', '-c:a', 'flac', '/tmp/a.flac', '-map', '1:a', '-ac', '1', '-ar', '16000', '-c:a', 'flac', '/tmp/b.flac'])
  })
  it('does not route Windows capture through an incomplete FFmpeg device build', () => {
    expect(() => captureArgsForPlatform('win32', [{ kind: 'microphone', source: 'id', file: 'mic.wav' }])).toThrow('原生音频助手')
  })
  it('parses native Windows endpoint JSON without shell parsing', () => {
    expect(parseWindowsAudioDevicesJson(JSON.stringify({ devices: [
      { name: '{mic}', label: 'Microphone (USB Audio)', monitor: false, muted: false, isDefault: true },
      { name: '{speaker}', label: '系统声音 · Headphones', monitor: true, muted: false, isDefault: true },
    ] }))).toEqual([
      { name: '{mic}', label: 'Microphone (USB Audio)', monitor: false, muted: false, isDefault: true },
      { name: '{speaker}', label: '系统声音 · Headphones', monitor: true, muted: false, isDefault: true },
    ])
  })
  it('handles stdout without a trailing newline', async () => {
    const rows: string[] = []
    await runProcess(process.execPath, ['-e', 'require("node:fs").writeSync(1,"complete")'], { onLine: line => rows.push(line) })
    expect(rows).toEqual(['complete'])
  })
  it('preserves Chinese text split across stdout buffers', async () => {
    const rows: string[] = []
    const output = await runProcess(process.execPath, ['-e', 'const fs=require("node:fs");const b=Buffer.from(JSON.stringify({text:"面试回答"})+"\\n");let i=0;const t=setInterval(()=>{fs.writeSync(1,b.subarray(i,i+1));if(++i===b.length)clearInterval(t)},5)'], { onLine: line => rows.push(JSON.parse(line).text) })
    expect(rows).toEqual(['面试回答'])
    expect(JSON.parse(output).text).toBe('面试回答')
  })
  it('rejects a missing executable', async () => {
    await expect(runProcess('/tmp/mybook-nonexistent-test-command', [])).rejects.toThrow()
  })
  it('kills a cancelled process even if it ignores SIGTERM', async () => {
    const controller = new AbortController()
    let ready!: () => void
    const started = new Promise<void>(resolve => { ready = resolve })
    const task = runProcess(process.execPath, ['-e', 'process.on("SIGTERM",()=>{}); require("node:fs").writeSync(1,"ready\\n"); setInterval(()=>{},1000)'], { signal: controller.signal, onLine: () => ready() })
    const result = task.catch(e => e)
    await started
    const start = Date.now()
    controller.abort(new Error('cancelled'))
    expect((await result).message).toBe('cancelled')
    expect(Date.now() - start).toBeLessThan(4000)
  })
  it('bounds a subprocess that produces no output', async () => {
    await expect(runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeout: 50 })).rejects.toThrow('超时')
  })
})
