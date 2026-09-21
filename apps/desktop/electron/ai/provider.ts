/**
 * AI 模型管理 — 从 CC Switch 数据库自动加载 API Key
 *
 * 数据来源: ~/.cc-switch/cc-switch.db
 *   providers 表: settings_config (JSON) → 包含 ANTHROPIC_API_KEY / OPENAI_API_KEY 等
 *   settings 表: currentProviderClaude / currentProviderCodex 等
 *   provider_endpoints 表: base URL
 *
 * 用户只需在 CC Switch 中管理 API Key，KnowMind 自动读取，无需重复配置。
 */
import type { LanguageModel } from 'ai'
import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse as parseToml } from 'smol-toml'

// ---------------------------------------------------------------------------
// CC Switch 配置路径
// ---------------------------------------------------------------------------
const CC_SWITCH_DB = join(homedir(), '.cc-switch', 'cc-switch.db')
const CC_SWITCH_SETTINGS = join(homedir(), '.cc-switch', 'settings.json')

// ---------------------------------------------------------------------------
// 模型定义
// ---------------------------------------------------------------------------
export interface ModelDef {
  /** 内部唯一标识 (provider id) */
  key: string
  /** 显示名称 */
  name: string
  /** 供应商类型: anthropic / openai */
  provider: 'anthropic' | 'openai'
  /** API 发送的模型名 */
  modelName: string
  /** API Key */
  apiKey: string
  /** API Base URL */
  baseURL: string
  /** 应用类型 */
  appType: string
  /** 是否 CC Switch 中标记为当前活跃 */
  isCCSwitchActive: boolean
  /** 降级模型列表（当前模型不可用时依次尝试） */
  fallbackModels: string[]
  wireApi?: 'responses' | 'chat'
}

/**
 * CC Switch keeps a user-maintained model list. Gateways can remove models
 * without updating that list, so generation also keeps a short-lived, private
 * copy of each provider's live `/models` response. API keys never leave this
 * module and are only used by the main process request.
 */
interface LiveModelCatalog {
  checkedAt: number
  /** `undefined` means the endpoint did not expose a usable catalog. */
  modelIds?: ReadonlySet<string>
  blocked?: boolean
}

const MODEL_CATALOG_TTL = 5 * 60 * 1000
const MODEL_CATALOG_TIMEOUT = 5000
const liveCatalog = new Map<string, LiveModelCatalog>()
const NON_GENERATIVE_MODEL = /(?:image|embedding|embed|rerank|whisper|tts|dall-e|auto-review)/i

function catalogKey(def: Pick<ModelDef, 'baseURL' | 'apiKey'> & Partial<Pick<ModelDef, 'provider' | 'wireApi'>>): string {
  return createHash('sha256').update(`${def.baseURL.replace(/\/+$/, '')}\n${def.apiKey}\n${def.provider || ''}\n${def.wireApi || ''}`).digest('hex')
}

// ---------------------------------------------------------------------------
// 解析 CC Switch 数据库
// ---------------------------------------------------------------------------
interface CCProvider {
  id: string
  app_type: string
  name: string
  settings_config: string  // JSON
}

function openCCDb(): Database.Database | null {
  try {
    return new Database(CC_SWITCH_DB, { readonly: true })
  } catch {
    return null
  }
}

/** 获取 CC Switch 中所有标记为"活跃"的 provider ID（Claude + Codex） */
function getActiveProviderIds(): string[] {
  try {
    const raw = readFileSync(CC_SWITCH_SETTINGS, 'utf-8')
    const settings = JSON.parse(raw)
    const ids: string[] = []
    if (settings.currentProviderClaude) ids.push(settings.currentProviderClaude)
    if (settings.currentProviderCodex) ids.push(settings.currentProviderCodex)
    return ids
  } catch {
    return []
  }
}

/** 从 provider 的 settings_config JSON 中提取环境变量 */
function parseEnv(configJson: string): Record<string, string> {
  try {
    const config = JSON.parse(configJson)
    const env: Record<string, string> = { ...config.auth, ...config.env }

    if (config.config && typeof config.config === 'string') {
      const parsed = parseToml(config.config)
      if (typeof parsed.model === 'string' && !env.OPENAI_MODEL) env.OPENAI_MODEL = parsed.model
      const providers = parsed.model_providers as Record<string, { base_url?: unknown; wire_api?: unknown }> | undefined
      const selected = typeof parsed.model_provider === 'string' ? providers?.[parsed.model_provider] : undefined
      if (typeof selected?.base_url === 'string' && !env.OPENAI_BASE_URL) env.OPENAI_BASE_URL = selected.base_url
      if (selected?.wire_api === 'responses') env.OPENAI_WIRE_API = 'responses'
    }

    return env
  } catch {
    return {}
  }
}

/** Expand the actual configured catalog; never substitute a guessed model name. */
export function modelsFromProvider(row: CCProvider, endpointURL = '', active = false): ModelDef[] {
  let config: any
  try { config = JSON.parse(row.settings_config) } catch { return [] }
  const env = parseEnv(row.settings_config)
  const anthropic = ['claude', 'claude-desktop'].includes(row.app_type)
    || config.api_mode === 'anthropic'
  if (!anthropic && !['codex', 'hermes'].includes(row.app_type)) return []
  const apiKey = anthropic ? env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || config.api_key
    : env.OPENAI_API_KEY || config.api_key
  if (typeof apiKey !== 'string' || !apiKey.trim()) return []
  const baseURL = (anthropic ? env.ANTHROPIC_BASE_URL : env.OPENAI_BASE_URL) || config.base_url || endpointURL
    || (anthropic ? 'https://api.anthropic.com' : 'https://api.openai.com/v1')
  const names = [...new Set([
    ...(anthropic ? [env.ANTHROPIC_MODEL, env.ANTHROPIC_DEFAULT_SONNET_MODEL, env.ANTHROPIC_DEFAULT_OPUS_MODEL, env.ANTHROPIC_DEFAULT_HAIKU_MODEL, env.ANTHROPIC_REASONING_MODEL]
      : [env.OPENAI_MODEL, env.DEFAULT_MODEL, config.model]),
    ...(Array.isArray(config.models) ? config.models.map((m: any) => typeof m === 'string' ? m : m?.id) : []),
  ].filter((m): m is string => typeof m === 'string' && Boolean(m.trim())))].filter(name =>
    // Models explicitly named as image/audio/embedding/reranking models cannot generate cards.
    !/(?:image|embedding|rerank|whisper|tts|dall-e|auto-review)/i.test(name))
  return names.map((modelName, index) => ({
    key: index === 0 ? row.id : `${row.id}::${encodeURIComponent(modelName)}`,
    name: row.name || row.id, provider: anthropic ? 'anthropic' : 'openai', modelName, apiKey, baseURL,
    appType: row.app_type, isCCSwitchActive: active && index === 0, fallbackModels: [],
    wireApi: env.OPENAI_WIRE_API === 'responses' || config.api_mode === 'responses' ? 'responses' : 'chat',
  }))
}

/** 从 CC Switch DB 读取所有配置的 AI provider。`liveOnly` 只应用已经
 * 完成的实时目录缓存；实时刷新由异步的 getAvailableModelsFromCCSwitch 完成。 */
export function getAllModelsFromCCSwitch(liveOnly = false): ModelDef[] {
  const db = openCCDb()
  if (!db) {
    console.warn('[KnowMind] 无法打开 CC Switch 数据库:', CC_SWITCH_DB)
    return []
  }

  const activeIds = new Set(getActiveProviderIds())
  const models: ModelDef[] = []

  try {
    // 读取 provider_endpoints 表，构建 provider_id → url 映射
    const epRows = db.prepare(
      "SELECT provider_id, url FROM provider_endpoints"
    ).all() as { provider_id: string; url: string }[]
    const endpointMap = new Map<string, string>()
    for (const ep of epRows) {
      if (!endpointMap.has(ep.provider_id)) {
        endpointMap.set(ep.provider_id, ep.url)
      }
    }

    const rows = db.prepare(
      "SELECT id, app_type, name, settings_config FROM providers WHERE settings_config IS NOT NULL AND settings_config != '' ORDER BY sort_index"
    ).all() as CCProvider[]

    for (const row of rows) {
      models.push(...modelsFromProvider(row, endpointMap.get(row.id), activeIds.has(row.id)))
    }
  } finally {
    db.close()
  }

  const withFallbacks = models.map(model => ({ ...model, fallbackModels: configuredFallbacks(model, models) }))
  if (!liveOnly) return withFallbacks
  // Rebuild fallback names after filtering and live expansion. Otherwise a
  // stale alias removed from `/models` could be reintroduced through the old
  // fallbackModels list.
  return getCachedAvailableModels(withFallbacks)
}

/** Refresh provider catalogs before choosing a model for a real request. A
 * provider that does not support `/models` remains eligible; only explicit
 * model IDs and invalid credentials are filtered. */
export async function getAvailableModelsFromCCSwitch(force = false): Promise<ModelDef[]> {
  const configured = getAllModelsFromCCSwitch()
  if (!configured.length) return []
  await refreshModelCatalog(configured, force)
  return getCachedAvailableModels(configured)
}

export function resolveModelDefinition(models: ModelDef[], selectedKey: string | null): ModelDef | undefined {
  return models.find(model => model.key === selectedKey) || models.find(model => model.isCCSwitchActive) || models[0]
}

function apiRoot(value: string): string {
  const base = value.replace(/\/+$/, '')
  return base.endsWith('/v1') ? base : `${base}/v1`
}

function parseCatalogIds(body: unknown): string[] | undefined {
  if (!body || typeof body !== 'object') return undefined
  const data = (body as { data?: unknown }).data
  if (!Array.isArray(data)) return undefined
  const ids = data
    .map(item => item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string'
      ? (item as { id: string }).id.trim() : '')
    .filter(Boolean)
  return ids.length ? [...new Set(ids)] : undefined
}

/** Probe one provider route without turning a temporary network error into a
 * false "model unavailable" result. Only an explicit catalog (or an explicit
 * 401/403) is used to filter configured model names. */
async function refreshLiveCatalog(def: ModelDef, force = false): Promise<void> {
  const key = catalogKey(def)
  const cached = liveCatalog.get(key)
  if (!force && cached && Date.now() - cached.checkedAt < MODEL_CATALOG_TTL) return

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MODEL_CATALOG_TIMEOUT)
  try {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (def.provider === 'anthropic') {
      headers['x-api-key'] = def.apiKey
      headers['anthropic-version'] = '2023-06-01'
    } else {
      headers.Authorization = `Bearer ${def.apiKey}`
    }
    const response = await fetch(`${apiRoot(def.baseURL)}/models`, {
      method: 'GET', headers, signal: controller.signal
    })
    if (response.status === 401 || response.status === 403) {
      // This route cannot be used by this credential. Keeping the state in a
      // hash-keyed map avoids exposing either the key or upstream response.
      liveCatalog.set(key, { checkedAt: Date.now(), blocked: true, modelIds: new Set() })
      return
    }
    if (!response.ok || [404, 405, 501].includes(response.status)) {
      liveCatalog.set(key, { checkedAt: Date.now() })
      return
    }
    const raw = await response.text()
    let body: unknown
    try { body = JSON.parse(raw) } catch { body = undefined }
    const ids = parseCatalogIds(body)
    // A successful response without a standard data array is treated as an
    // unknown catalog (some compatible gateways do not implement discovery).
    liveCatalog.set(key, { checkedAt: Date.now(), modelIds: ids ? new Set(ids) : undefined })
  } catch {
    // Offline mode and transient DNS/TLS failures must not hide all configured
    // models. The normal generation fallback still reports the real failure.
    liveCatalog.set(key, { checkedAt: Date.now() })
  } finally {
    clearTimeout(timer)
  }
}

export async function refreshModelCatalog(models: ModelDef[], force = false): Promise<void> {
  const routes = new Map<string, ModelDef>()
  for (const model of models) {
    const key = catalogKey(model)
    if (!routes.has(key)) routes.set(key, model)
  }
  await Promise.allSettled([...routes.values()].map(model => refreshLiveCatalog(model, force)))
}

/** Test/support hook; it never exposes catalog contents or credentials. */
export function clearLiveModelCatalog(): void {
  liveCatalog.clear()
}

function filterLiveModels(models: ModelDef[]): ModelDef[] {
  return models.filter(model => {
    const catalog = liveCatalog.get(catalogKey(model))
    if (!catalog) return true
    if (catalog.blocked) return false
    return !catalog.modelIds || catalog.modelIds.has(model.modelName)
  })
}

/** Add text-capable IDs that the provider exposed but CC Switch did not have
 * in its hand-maintained list. This keeps the registry current without ever
 * guessing a model name when discovery is unavailable. */
function expandLiveModels(models: ModelDef[]): ModelDef[] {
  const result = [...models]
  const seen = new Set(models.map(model => `${catalogKey(model)}\n${model.modelName}`))
  for (const template of models) {
    const catalog = liveCatalog.get(catalogKey(template))
    if (!catalog?.modelIds || catalog.blocked) continue
    for (const modelName of catalog.modelIds) {
      if (!modelName || NON_GENERATIVE_MODEL.test(modelName)) continue
      const identity = `${catalogKey(template)}\n${modelName}`
      if (seen.has(identity)) continue
      seen.add(identity)
      result.push({
        ...template,
        key: `${template.key}::${encodeURIComponent(modelName)}`,
        modelName,
        isCCSwitchActive: false,
        fallbackModels: [],
      })
    }
  }
  return result
}

function availableWithFallbacks(models: ModelDef[]): ModelDef[] {
  return models.map(model => ({ ...model, fallbackModels: configuredFallbacks(model, models) }))
}

/** Return configured models after any cached live catalog has removed models
 * that the provider explicitly says do not exist. */
export function getCachedAvailableModels(models: ModelDef[]): ModelDef[] {
  const available = expandLiveModels(filterLiveModels(models))
  return availableWithFallbacks(available)
}

export function configuredFallbacks(def: ModelDef, models: ModelDef[]): string[] {
  // A pricing catalog says nothing about account access. Only reuse explicitly
  // configured models with the same endpoint, credentials and wire protocol.
  return [...new Set(models.filter(model => model.provider === def.provider
    && model.apiKey === def.apiKey && apiRoot(model.baseURL) === apiRoot(def.baseURL)
    && (model.wireApi || 'chat') === (def.wireApi || 'chat') && model.modelName !== def.modelName)
    .map(model => model.modelName))]
}

export async function createModelClient(def: ModelDef): Promise<LanguageModel> {
  // CC Switch accepts an origin, while AI SDK providers expect the versioned API root.
  const resolvedBaseURL = apiRoot(def.baseURL)
  if (def.provider === 'anthropic') {
    const { createAnthropic } = await import('@ai-sdk/anthropic')
    const client = createAnthropic({
      apiKey: def.apiKey,
      baseURL: resolvedBaseURL
    })
    return client(def.modelName)
  }

  if (def.wireApi === 'responses') {
    const { createOpenAI } = await import('@ai-sdk/openai')
    return createOpenAI({ apiKey: def.apiKey, baseURL: resolvedBaseURL }).responses(def.modelName)
  }

  const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible')
  const modelName = def.modelName || 'gpt-4o'

  const api = createOpenAICompatible({
    name: 'custom',
    apiKey: def.apiKey,
    baseURL: resolvedBaseURL,
    fetch: async (url, init) => {
      const start = Date.now()
      let resp: Response
      try {
        resp = await fetch(url, init)
      } catch (fetchErr: any) {
        console.error('[KnowMind] fetch 失败:', fetchErr.message || fetchErr)
        throw fetchErr
      }
      if (!resp.ok || resp.status >= 400) {
        const body = await resp.clone().text()
        console.error(`[KnowMind] API error ${resp.status}:`, body.substring(0, 1000))
      }
      const elapsed = Date.now() - start
      if (elapsed > 5000) {
        console.warn(`[KnowMind] API 请求耗时 ${elapsed}ms: ${url}`)
      }
      return resp
    }
  })

  return api.languageModel(modelName)
}

// ---------------------------------------------------------------------------
// 获取当前活跃模型
// ---------------------------------------------------------------------------
const ACTIVE_MODEL_KEY = 'activeModel'

export async function getActiveModel(db: Database.Database): Promise<{ model: LanguageModel; def: ModelDef }> {
  const configuredModels = getAllModelsFromCCSwitch()
  if (configuredModels.length === 0) {
    throw new Error(
      '未发现可用的 AI 模型。请在 CC Switch 中配置至少一个 Provider 的 API Key。\n\n' +
      'CC Switch 数据位置: ~/.cc-switch/cc-switch.db'
    )
  }

  const allModels = await getAvailableModelsFromCCSwitch()
  if (allModels.length === 0) {
    throw new Error('CC Switch 中配置的模型均未通过实时目录检查，可能已下架、未开通或凭据无效。请刷新模型列表或检查 CC Switch 配置。')
  }

  // 从 KnowMind 设置读取用户选择的模型
  let selectedKey: string | null = null
  try {
    const row = db.prepare('SELECT value_json FROM settings WHERE key = ?').get(ACTIVE_MODEL_KEY) as any
    if (row) selectedKey = JSON.parse(row.value_json)
  } catch { /* ignore */ }

  // 优先使用用户选择的模型，否则用 CC Switch 当前活跃的，再不然用第一个
  const def = resolveModelDefinition(allModels, selectedKey)!

  const model = await createModelClient(def)
  return { model, def }
}
