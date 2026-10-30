import { Capacitor, CapacitorHttp } from '@capacitor/core'
import type { SyncPayload, SyncSettings } from './types'
import { exportPayload, mergePayload } from './db'

const ITERATIONS = 120000

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}

async function deriveKey(code: string, salt: BufferSource): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function encrypt(value: unknown, code: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(code, salt as unknown as BufferSource)
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as unknown as BufferSource }, key, new TextEncoder().encode(JSON.stringify(value)))
  return { v: 1, salt: bytesToBase64(salt), iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(data)) }
}

async function decrypt(envelope: { salt: string; iv: string; data: string }, code: string): Promise<unknown> {
  const salt = base64ToBytes(envelope.salt)
  const iv = base64ToBytes(envelope.iv)
  const key = await deriveKey(code, salt as unknown as BufferSource)
  const encrypted = base64ToBytes(envelope.data)
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as unknown as BufferSource }, key, encrypted as unknown as BufferSource)
  return JSON.parse(new TextDecoder().decode(data))
}

function syncUrl(settings: SyncSettings): string {
  let endpoint = settings.endpoint.trim()
  if (!endpoint) throw new Error('请先填写电脑端同步地址')
  if (!/^https?:\/\//i.test(endpoint)) endpoint = `http://${endpoint}`
  return `${endpoint.replace(/\/+$/, '')}/sync`
}

async function post(url: string, body: unknown): Promise<{ status: number; data: any }> {
  if (Capacitor.isNativePlatform()) {
    const result = await CapacitorHttp.post({
      url, data: body, headers: { 'Content-Type': 'application/json' },
      connectTimeout: 15000, readTimeout: 120000,
    })
    return { status: result.status, data: typeof result.data === 'string' ? safeJson(result.data) : result.data }
  }
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) })
  const text = await response.text()
  return { status: response.status, data: safeJson(text) }
}

function safeJson(value: string): any { try { return JSON.parse(value) } catch { return value } }

export async function syncNow(settings: SyncSettings): Promise<{ ok: boolean; message: string; stats?: ReturnType<typeof mergePayload> }> {
  if (!settings.code.trim()) throw new Error('请先填写电脑端显示的配对码')
  const payload = exportPayload()
  const encrypted = await encrypt(payload, settings.code.trim())
  // ts/requestId 让电脑端拒绝过期请求和重复重放；旧版电脑端会忽略这两个字段。
  const result = await post(syncUrl(settings), {
    ...encrypted,
    ts: Date.now(),
    requestId: crypto.randomUUID(),
  })
  if (result.status < 200 || result.status >= 300) {
    const message = result.data?.error || result.data?.message || `HTTP ${result.status}`
    throw new Error(`同步失败：${String(message).slice(0, 300)}`)
  }
  const incoming = await decrypt(result.data, settings.code.trim()) as SyncPayload
  if (!incoming || incoming.version !== 1) throw new Error('电脑返回的同步数据格式不兼容')
  const stats = mergePayload(incoming)
  return { ok: true, message: `同步完成：卡片 ${stats.cards}，问答 ${stats.qa}，面试 ${stats.interviews}`, stats }
}

export async function ping(settings: SyncSettings): Promise<boolean> {
  let endpoint = settings.endpoint.trim()
  if (!endpoint) throw new Error('请先填写电脑端同步地址')
  if (!/^https?:\/\//i.test(endpoint)) endpoint = `http://${endpoint}`
  const url = `${endpoint.replace(/\/+$/, '')}/health`
  if (Capacitor.isNativePlatform()) {
    const result = await CapacitorHttp.get({ url, connectTimeout: 8000, readTimeout: 8000 })
    return result.status >= 200 && result.status < 300
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) })
  return response.ok
}
