import { generateText, streamText } from 'ai'
import type { LanguageModel } from 'ai'
import { createHash } from 'node:crypto'
import { createModelClient, getAllModelsFromCCSwitch, type ModelDef } from './provider.js'

export function isModelUnavailable(error: any): boolean {
  if ([401, 403, 429].includes(errorStatus(error))) return false
  let detail = ''
  try {
    const raw = error?.responseBody || error?.cause?.responseBody || error?.cause?.cause?.responseBody
    const body = typeof raw === 'string' ? JSON.parse(raw) : error?.data || error?.cause?.data
    detail = `${body?.error?.code || ''} ${body?.error?.message || ''}`
  } catch { /* A gateway may return HTML. */ }
  return /model_not_found|no_available_channel|可用渠道不存在|无可用渠道|没有可用渠道|未开通模型|no available channels?|model[^\n]*(?:does not exist|not found|not available)/i.test(`${error?.message || ''} ${error?.cause?.message || ''} ${detail}`)
}

function errorStatus(error: any): number {
  for (const value of [error?.statusCode, error?.cause?.statusCode, error?.cause?.cause?.statusCode,
    error?.data?.statusCode, error?.cause?.data?.statusCode]) {
    const status = Number(value)
    if (Number.isFinite(status) && status > 0) return status
  }
  return 0
}

export class InvalidModelOutput extends Error {}
export interface GenerationProgress {
  phase: 'attempt' | 'fallback' | 'success'
  model: string
  attempt: number
  total: number
  reason?: string
}
export interface GenerationOptions {
  signal?: AbortSignal
  system: string
  prompt: string
  maxOutputTokens: number
  timeoutMs?: number
  totalTimeoutMs?: number
  idleTimeoutMs?: number
  stream?: boolean
  allowFallback?: boolean
  candidates?: ModelDef[]
  validate?: (text: string) => void
  onProgress?: (progress: GenerationProgress) => void
}

// Credential-scoped identities stay in the main process, never in IPC or reports.
const routeId = (def: ModelDef) => createHash('sha256').update(JSON.stringify([def.baseURL.replace(/\/+$/, '').replace(/\/v1$/, ''), def.apiKey])).digest('hex')
const modelId = (def: ModelDef) => `${routeId(def)}:${def.provider}:${def.wireApi || 'chat'}:${def.modelName}`
const health = new Map<string, { retryAfter: number; success: number }>()
const serviceCooldown = new Map<string, number>()
const serviceCooling = (def: ModelDef, now = Date.now()) => (serviceCooldown.get(routeId(def)) || 0) > now
export function clearGenerationHealth() { health.clear(); serviceCooldown.clear() }

// One candidate per endpoint/credential per round prevents one large catalog
// from consuming the budget before another configured service gets a chance.
function diversifyServices(candidates: ModelDef[]): ModelDef[] {
  const queues = new Map<string, ModelDef[]>()
  for (const candidate of candidates) {
    const key = routeId(candidate)
    const queue = queues.get(key) || []
    queue.push(candidate); queues.set(key, queue)
  }
  const result: ModelDef[] = []
  while (queues.size) for (const [key, queue] of queues) {
    result.push(queue.shift()!)
    if (!queue.length) queues.delete(key)
  }
  return result
}
export function generationCandidates(def: ModelDef, models: ModelDef[]): ModelDef[] {
  const seen = new Set<string>()
  const all = [def, ...models, ...def.fallbackModels.map(modelName => ({ ...def, modelName }))].filter(candidate => {
    const key = modelId(candidate)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const now = Date.now()
  const cooling = (candidate: ModelDef) => serviceCooling(candidate, now) || (health.get(modelId(candidate))?.retryAfter || 0) > now
  all.sort((a, b) => {
    const ah = health.get(modelId(a)), bh = health.get(modelId(b))
    const delay = Number(cooling(a)) - Number(cooling(b))
    if (delay) return delay
    // Recently successful alternatives lead subsequent batches after a failure.
    if (a === def) return -1
    if (b === def) return 1
    return (bh?.success || 0) - (ah?.success || 0)
  })
  return [...diversifyServices(all.filter(candidate => !cooling(candidate))), ...diversifyServices(all.filter(cooling))]
}

function connectionUnavailable(error: any) {
  // A slow model or an interrupted text stream alone does not prove that its
  // endpoint is unavailable. Only explicit transport failures cool the service.
  const codes = [error?.code, error?.cause?.code, error?.cause?.cause?.code]
  const pattern = /\b(?:ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|UND_ERR_CONNECT_TIMEOUT)\b/
  return codes.some(code => typeof code === 'string' && pattern.test(code)) || pattern.test(error?.message || '')
    || /\b(?:fetch failed|failed to fetch)\b/i.test(error?.message || '')
}

function failure(error: any): { reason: string; scope?: 'credential' | 'service'; terminal?: boolean } {
  const statusCode = errorStatus(error)
  const message = `${error?.message || ''} ${error?.cause?.message || ''} ${error?.responseBody || ''} ${error?.cause?.responseBody || ''}`
  if (/content_filter|content_policy|safety_policy|内容审核|内容安全/i.test(message)) return { reason: '内容审核未通过', terminal: true }
  if (statusCode === 401 || statusCode === 403) return { reason: '凭据或权限不可用', scope: 'credential' }
  // 402 is commonly returned by gateways for an account/model quota that is
  // exhausted (for example `insufficient_user_quota`). Treat it as scoped to
  // the current credential so another configured account can still be tried.
  // Keeping the upstream response out of `reason` prevents API keys and raw
  // provider details from leaking into the UI error.
  if (statusCode === 402) return { reason: '额度不足', scope: 'credential' }
  if (statusCode === 429) return { reason: '限流或额度不足' }
  if (isModelUnavailable(error)) return { reason: '无可用渠道' }
  if (connectionUnavailable(error)) return { reason: '连接中断', scope: 'service' }
  if (statusCode === 408) return { reason: '响应超时' }
  if (error?.name === 'TimeoutError' || /timeout|timed out/i.test(message)) return { reason: '响应超时' }
  if (error instanceof InvalidModelOutput || /AI_(?:JSONParse|TypeValidation|NoOutputGenerated|NoObjectGenerated)Error/.test(error?.name || '')) return { reason: '结果不完整或格式不符合要求' }
  if (error?.name === 'AbortError' || /abort|premature|terminated|ECONN|fetch failed|network/i.test(message)) return { reason: '连接中断' }
  if (statusCode >= 500) return { reason: '服务暂时不可用', ...([502, 503, 504].includes(statusCode) ? { scope: 'service' as const } : {}) }
  if ([400, 404, 405, 422].includes(statusCode)) return { reason: '接口或请求不兼容' }
  return { reason: '生成失败', terminal: true }
}

export async function generateTextWithFallback(
  model: LanguageModel, def: ModelDef, opts: GenerationOptions
): Promise<{ text: string; usedModel: string }> {
  const { timeoutMs = 45000, totalTimeoutMs = 180000, idleTimeoutMs = 20000, stream = false,
    allowFallback = true, candidates: configured, validate, onProgress, signal: externalSignal, ...generation } = opts
  externalSignal?.throwIfAborted()
  // getActiveModel refreshes the live model catalog before a request. Reuse
  // that cache here so stale CC Switch aliases are skipped by every caller,
  // including chat, recording analysis and card generation.
  const candidates = allowFallback ? generationCandidates(def, configured ?? getAllModelsFromCCSwitch(true)) : [def]
  const deadline = Date.now() + totalTimeoutMs
  let totalExpired = false
  const blockedCredentials = new Set<string>()
  const attempts: string[] = []
  const pending = [...candidates]
  while (pending.length) {
    if (totalExpired || Date.now() >= deadline) break
    // A failure in this task can cool a service after the initial ordering.
    // Defer its remaining models, retaining them when all other routes fail.
    let next = pending.findIndex(candidate => !blockedCredentials.has(routeId(candidate)) && !serviceCooling(candidate))
    if (next < 0) next = pending.findIndex(candidate => !blockedCredentials.has(routeId(candidate)))
    if (next < 0) break
    const [candidate] = pending.splice(next, 1)
    const controller = new AbortController()
    const cancel = () => controller.abort(externalSignal?.reason)
    externalSignal?.addEventListener('abort', cancel, { once: true })
    if (externalSignal?.aborted) cancel()
    const remaining = deadline - Date.now()
    const duration = Math.min(timeoutMs, remaining)
    const hardTimer = setTimeout(() => {
      if (remaining <= timeoutMs) totalExpired = true
      controller.abort(new DOMException('Model attempt timed out', 'TimeoutError'))
    }, duration)
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    const heartbeat = () => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => controller.abort(new DOMException('Model stream timed out', 'TimeoutError')), Math.min(idleTimeoutMs, duration))
    }
    let abortListener: () => void = () => {}
    const aborted = new Promise<never>((_, reject) => {
      abortListener = () => reject(controller.signal.reason)
      controller.signal.addEventListener('abort', abortListener, { once: true })
    })
    const progress = { model: candidate.modelName, attempt: attempts.length + 1, total: candidates.length }
    onProgress?.({ ...progress, phase: 'attempt' })
    try {
      const run = async () => {
        const client = modelId(candidate) === modelId(def) ? model : await createModelClient(candidate)
        controller.signal.throwIfAborted()
        const request = { model: client, ...generation, maxRetries: 0, abortSignal: controller.signal,
          providerOptions: candidate.wireApi === 'responses' ? { openai: { store: false, reasoningEffort: 'low' } } : undefined }
        let text = ''
        if (stream) {
          heartbeat()
          let sawFinish = false
          const result = streamText({ ...request, streamRetries: 0, onError: () => {} })
          for await (const part of result.fullStream) {
            controller.signal.throwIfAborted()
            if (part.type === 'text-delta') { text += part.text; heartbeat() }
            if (part.type === 'reasoning-delta') heartbeat()
            if (part.type === 'error') throw part.error
            if (part.type === 'abort') throw controller.signal.reason || new DOMException('Stream aborted', 'AbortError')
            if (part.type === 'finish') {
              if (part.finishReason === 'content-filter') throw new Error('content_filter')
              if (part.finishReason !== 'stop') throw new InvalidModelOutput('Incomplete model output')
              sawFinish = true
            }
          }
          // A few OpenAI-compatible gateways close a successful SSE response
          // without emitting a final `finish` event. The transport ending is
          // still be a usable completion; structured callers validate the
          // accumulated text immediately below. An abort or an idle timeout
          // is raised from the loop above and never reaches here.
          if (!sawFinish && !text.trim()) throw new InvalidModelOutput('Stream ended without completion')
        } else {
          const result = await generateText(request)
          if (result.finishReason === 'content-filter') throw new Error('content_filter')
          if (result.finishReason && result.finishReason !== 'stop') throw new InvalidModelOutput('Incomplete model output')
          text = result.text
        }
        controller.signal.throwIfAborted()
        if (!text.trim()) throw new InvalidModelOutput('Empty model output')
        validate?.(text)
        return text
      }
      const text = await Promise.race([run(), aborted])
      health.set(modelId(candidate), { retryAfter: 0, success: Date.now() })
      serviceCooldown.delete(routeId(candidate))
      onProgress?.({ ...progress, phase: 'success' })
      return { text, usedModel: candidate.modelName }
    } catch (error) {
      if (externalSignal?.aborted) throw externalSignal.reason
      const issue = failure(error)
      attempts.push(`${candidate.modelName}（${issue.reason}）`)
      if (issue.terminal) throw new Error(issue.reason === '内容审核未通过' ? issue.reason : '模型调用发生非临时错误', { cause: error })
      health.set(modelId(candidate), { retryAfter: Date.now() + 120000, success: 0 })
      if (issue.scope === 'credential') blockedCredentials.add(routeId(candidate))
      if (issue.scope === 'service') serviceCooldown.set(routeId(candidate), Date.now() + 30000)
      onProgress?.({ ...progress, phase: 'fallback', reason: issue.reason })
    } finally {
      clearTimeout(hardTimer)
      clearTimeout(idleTimer)
      controller.signal.removeEventListener('abort', abortListener)
      externalSignal?.removeEventListener('abort', cancel)
      controller.abort()
    }
  }
  const limit = totalExpired || Date.now() >= deadline ? '已到本次任务的时间上限' : '当前候选渠道均未成功'
  throw new Error(`${limit}，已自动尝试 ${attempts.length} 个模型渠道：${attempts.join('；')}。未保存不完整结果，请稍后重试。`)
}
