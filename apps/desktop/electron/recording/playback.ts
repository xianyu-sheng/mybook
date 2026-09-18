import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'

// Chromium needs both 206 and Content-Range for seeking. Electron's file fetch
// slices the bytes but reports 200, so forwarding its response loses seeking.
export async function audioResponse(request: Request, file: string) {
  const { size } = await stat(file)
  const headers = new Headers({ 'Content-Type': 'audio/flac', 'Accept-Ranges': 'bytes', 'Content-Length': String(size), 'Cache-Control': 'no-store' })
  if (request.method === 'HEAD') return new Response(null, { headers })
  let start = 0, end = size - 1
  const range = request.headers.get('range')
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
    const first = match?.[1] ? Number(match[1]) : null
    const last = match?.[2] ? Number(match[2]) : null
    if (match && (first !== null || last !== null) &&
        (first === null || Number.isSafeInteger(first)) && (last === null || Number.isSafeInteger(last))) {
      start = first === null ? Math.max(0, size - last!) : first
      end = first === null || last === null ? size - 1 : Math.min(last, size - 1)
    } else { start = size }
    if (start > end || start >= size || first === null && last === 0) {
      headers.set('Content-Range', `bytes */${size}`)
      headers.set('Content-Length', '0')
      return new Response(null, { status: 416, headers })
    }
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
    headers.set('Content-Length', String(end - start + 1))
  }
  if (!size) return new Response(null, { headers })
  const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array>
  return new Response(body, { status: range ? 206 : 200, headers })
}
