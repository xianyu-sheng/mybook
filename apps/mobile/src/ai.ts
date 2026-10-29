import { Capacitor, CapacitorHttp } from '@capacitor/core'
import type { Provider } from './types'

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

function endpoint(provider: Provider) {
  const base = provider.baseURL.replace(/\/+$/, '')
  return provider.provider === 'anthropic'
    ? `${base}/v1/messages`
    : `${base}${base.endsWith('/v1') ? '' : ''}/chat/completions`
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<{ status: number; data: any }> {
  if (Capacitor.isNativePlatform()) {
    const result = await CapacitorHttp.post({ url, headers, data: body, connectTimeout: 30000, readTimeout: 180000 })
    return { status: result.status, data: typeof result.data === 'string' ? safeJson(result.data) : result.data }
  }
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) })
  const text = await response.text()
  return { status: response.status, data: safeJson(text) }
}

function safeJson(value: string): any {
  try { return JSON.parse(value) } catch { return value }
}

export async function chat(provider: Provider, model: string, messages: ChatMessage[], maxTokens = 5000): Promise<string> {
  if (!provider.apiKey) throw new Error('还没有可用的 AI Key，请先在设置里同步或填写供应商')
  if (provider.provider === 'anthropic') {
    const system = messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n')
    const result = await postJson(endpoint(provider), {
      'Content-Type': 'application/json',
      'x-api-key': provider.apiKey,
      'anthropic-version': '2023-06-01',
    }, {
      model,
      max_tokens: maxTokens,
      system: system || undefined,
      messages: messages.filter(message => message.role !== 'system').map(message => ({ role: message.role, content: message.content })),
    })
    if (result.status < 200 || result.status >= 300) throw new Error(`AI 请求失败（HTTP ${result.status}）`)
    return String(result.data?.content?.map((item: any) => item.text || '').join('') || '')
  }

  const result = await postJson(endpoint(provider), {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${provider.apiKey}`,
  }, { model, messages, max_tokens: maxTokens, temperature: 0.3 })
  if (result.status < 200 || result.status >= 300) {
    const message = result.data?.error?.message || result.data?.message || `HTTP ${result.status}`
    throw new Error(`AI 请求失败：${String(message).slice(0, 300)}`)
  }
  return String(result.data?.choices?.[0]?.message?.content || '')
}

export function parseJson<T>(text: string): T {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(cleaned) as T } catch {
    const start = cleaned.indexOf('{'), end = cleaned.lastIndexOf('}')
    const arrayStart = cleaned.indexOf('['), arrayEnd = cleaned.lastIndexOf(']')
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)) as T
    if (arrayStart >= 0 && arrayEnd > arrayStart) return JSON.parse(cleaned.slice(arrayStart, arrayEnd + 1)) as T
    throw new Error('AI 返回的不是完整 JSON，请重试')
  }
}

export function activeProvider(providers: Provider[]): Provider | null {
  return providers[0] || null
}
