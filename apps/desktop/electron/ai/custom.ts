import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { ModelDef } from './provider.js'

/**
 * 用户在本机配置的 AI 供应商。API Key 只写入本地数据库
 * (`userData/knowmind.db` 的 settings 表)，不会进入源码或导出文件。
 */
const SETTINGS_KEY = 'customProviders'
const MAX_PROVIDERS = 8
const MAX_MODELS = 10

const storedProviderSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(60),
  provider: z.enum(['openai', 'anthropic']),
  baseURL: z.string().min(1).max(500),
  apiKey: z.string().min(1).max(500),
  models: z.array(z.string().min(1).max(200)).min(1).max(MAX_MODELS),
  wireApi: z.enum(['chat', 'responses']).default('chat'),
  createdAt: z.string().optional(),
})

export type CustomProvider = z.infer<typeof storedProviderSchema>

export const customProviderInputSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  name: z.string().trim().min(1, '请填写名称').max(60),
  provider: z.enum(['openai', 'anthropic']),
  baseURL: z.string().trim().min(1, '请填写 Base URL').max(500),
  /** 编辑时留空表示沿用已保存的 Key。 */
  apiKey: z.string().trim().max(500).optional(),
  models: z.string().trim().min(1, '请填写模型名').max(800),
  wireApi: z.enum(['chat', 'responses']).optional(),
})

export type CustomProviderInput = z.input<typeof customProviderInputSchema>

export interface PublicCustomProvider {
  id: string
  name: string
  provider: 'openai' | 'anthropic'
  baseURL: string
  models: string[]
  wireApi: 'chat' | 'responses'
  keyHint: string
  createdAt: string
}

/** 模型名支持逗号/换行分隔，第一个作为默认模型，其余用于失败降级。 */
export function splitModels(value: string): string[] {
  return [...new Set(value.split(/[\n,，;；]/).map(item => item.trim()).filter(Boolean))].slice(0, MAX_MODELS)
}

export function readCustomProviders(db: Database.Database): CustomProvider[] {
  try {
    const row = db.prepare('SELECT value_json FROM settings WHERE key = ?').get(SETTINGS_KEY) as { value_json: string } | undefined
    if (!row) return []
    const parsed = JSON.parse(row.value_json)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap(item => {
      const result = storedProviderSchema.safeParse(item)
      return result.success ? [result.data] : []
    }).slice(0, MAX_PROVIDERS)
  } catch {
    return []
  }
}

function writeCustomProviders(db: Database.Database, providers: CustomProvider[]) {
  db.prepare(
    "INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at"
  ).run(SETTINGS_KEY, JSON.stringify(providers))
}

/** 列表和 IPC 返回值永远不包含明文 API Key。 */
export function maskKey(apiKey: string): string {
  if (!apiKey) return ''
  if (apiKey.length <= 6) return '••••'
  return `${apiKey.slice(0, 3)}${'•'.repeat(Math.min(8, Math.max(4, apiKey.length - 7)))}${apiKey.slice(-4)}`
}

export function toPublicProvider(provider: CustomProvider): PublicCustomProvider {
  return {
    id: provider.id,
    name: provider.name,
    provider: provider.provider,
    baseURL: provider.baseURL,
    models: provider.models,
    wireApi: provider.wireApi,
    keyHint: maskKey(provider.apiKey),
    createdAt: provider.createdAt || '',
  }
}

function assertHttpURL(value: string) {
  let url: URL
  try { url = new URL(value) } catch { throw new Error('Base URL 必须是完整的 http(s) 地址') }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Base URL 必须是完整的 http(s) 地址')
  if (!url.hostname) throw new Error('Base URL 缺少域名')
}

export function saveCustomProvider(db: Database.Database, input: unknown): PublicCustomProvider[] {
  const parsed = customProviderInputSchema.parse(input)
  assertHttpURL(parsed.baseURL)
  const models = splitModels(parsed.models)
  if (!models.length) throw new Error('请至少填写一个模型名')

  const providers = readCustomProviders(db)
  const index = parsed.id ? providers.findIndex(item => item.id === parsed.id) : -1
  if (parsed.id && index < 0) throw new Error('供应商不存在，请刷新后重试')
  const previous = index >= 0 ? providers[index] : undefined
  const apiKey = parsed.apiKey?.trim() || previous?.apiKey
  if (!apiKey) throw new Error('请填写 API Key')

  const provider: CustomProvider = {
    id: previous?.id || randomUUID(),
    name: parsed.name,
    provider: parsed.provider,
    baseURL: parsed.baseURL,
    apiKey,
    models,
    wireApi: parsed.wireApi || previous?.wireApi || 'chat',
    createdAt: previous?.createdAt || new Date().toISOString(),
  }

  if (index >= 0) providers[index] = provider
  else {
    if (providers.length >= MAX_PROVIDERS) throw new Error(`最多添加 ${MAX_PROVIDERS} 个供应商`)
    providers.push(provider)
  }
  writeCustomProviders(db, providers)
  return providers.map(toPublicProvider)
}

export function deleteCustomProvider(db: Database.Database, id: string): PublicCustomProvider[] {
  const providers = readCustomProviders(db).filter(item => item.id !== id)
  writeCustomProviders(db, providers)
  // 选中的模型被删除时回退到默认候选，避免一直提示“模型配置已不存在”。
  try {
    const row = db.prepare("SELECT value_json FROM settings WHERE key = 'activeModel'").get() as { value_json: string } | undefined
    const selected = row ? String(JSON.parse(row.value_json) || '') : ''
    if (selected === `custom:${id}` || selected.startsWith(`custom:${id}::`)) {
      db.prepare("DELETE FROM settings WHERE key = 'activeModel'").run()
    }
  } catch { /* ignore malformed legacy value */ }
  return providers.map(toPublicProvider)
}

/** 把本地供应商转换成统一的模型候选；同一供应商的多个模型可互相降级。 */
export function customProviderModels(providers: CustomProvider[]): ModelDef[] {
  return providers.flatMap(provider => provider.models.map((modelName, index) => ({
    key: index === 0 ? `custom:${provider.id}` : `custom:${provider.id}::${encodeURIComponent(modelName)}`,
    name: provider.name,
    provider: provider.provider,
    modelName,
    apiKey: provider.apiKey,
    baseURL: provider.baseURL,
    appType: 'custom',
    isCCSwitchActive: false,
    fallbackModels: [],
    wireApi: provider.wireApi,
  })))
}
