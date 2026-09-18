import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { audioResponse } from './playback.js'

describe('seekable recording playback', () => {
  let dir: string, file: string
  const bytes = Uint8Array.from({ length: 256 }, (_, n) => n)
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'mybook-playback-'))
    file = path.join(dir, 'audio.flac')
    await writeFile(file, bytes)
  })
  afterAll(async () => { await rm(dir, { recursive: true, force: true }) })
  const request = (range?: string, method = 'GET') => new Request('https://recording.test/audio', { method, headers: range ? { Range: range } : {} })
  it('serves the full file and advertises length and byte ranges', async () => {
    const r = await audioResponse(request(), file)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-length')).toBe('256')
    expect(r.headers.get('accept-ranges')).toBe('bytes')
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(bytes)
  })
  it.each([
    ['bytes=10-19', 10, 19], ['bytes=250-', 250, 255], ['bytes=-5', 251, 255],
    ['bytes=250-900', 250, 255], ['bytes=-500', 0, 255],
  ])('supports seek request %s', async (range, start, end) => {
    const r = await audioResponse(request(range), file)
    expect(r.status).toBe(206)
    expect(r.headers.get('content-range')).toBe(`bytes ${start}-${end}/256`)
    expect(r.headers.get('content-length')).toBe(String(end - start + 1))
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(bytes.slice(start, end + 1))
  })
  it.each(['bytes=256-', 'bytes=20-10', 'bytes=-0', 'bytes=-', 'bytes=0-1,5-6', 'bytes=9007199254740999-'])('rejects invalid or unsatisfiable range %s', async range => {
    const r = await audioResponse(request(range), file)
    expect(r.status).toBe(416)
    expect(r.headers.get('content-range')).toBe('bytes */256')
    expect((await r.arrayBuffer()).byteLength).toBe(0)
  })
  it('HEAD reports full length without reading the file body', async () => {
    const r = await audioResponse(request(undefined, 'HEAD'), file)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-length')).toBe('256')
    expect((await r.arrayBuffer()).byteLength).toBe(0)
  })
})
