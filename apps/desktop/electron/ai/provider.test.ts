import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearLiveModelCatalog, configuredFallbacks, getCachedAvailableModels, refreshModelCatalog, resolveModelDefinition, type ModelDef } from './provider.js'

const selected: ModelDef = { key: 'selected', name: 'Configured service', provider: 'openai', modelName: 'model-a',
  apiKey: 'fixture', baseURL: 'https://example.test', appType: 'codex', isCCSwitchActive: false, fallbackModels: [], wireApi: 'responses' }
const alternate = { ...selected, key: 'alternate', modelName: 'model-b', isCCSwitchActive: true }

describe('configured model selection', () => {
  it('prefers the explicit selection and displays the same implicit default as generation', () => {
    expect(resolveModelDefinition([selected, alternate], selected.key)).toBe(selected)
    expect(resolveModelDefinition([selected, alternate], null)).toBe(alternate)
    expect(resolveModelDefinition([selected, alternate], 'removed')).toBe(alternate)
    expect(resolveModelDefinition([], null)).toBeUndefined()
  })
  it('uses only configured models with matching credentials and API', () => {
    expect(configuredFallbacks(selected, [selected, alternate, { ...alternate, baseURL: 'https://example.test/v1/' },
      { ...alternate, modelName: 'other-key', apiKey: 'other' },
      { ...alternate, modelName: 'other-api', wireApi: 'chat' },
      { ...alternate, modelName: 'other-service', baseURL: 'https://other.test' },
      { ...alternate, modelName: 'other-protocol', provider: 'anthropic' }])).toEqual(['model-b'])
  })
  it('does not invent fallback names when no compatible alternative exists', () => {
    expect(configuredFallbacks(selected, [selected])).toEqual([])
  })
})

import { modelsFromProvider } from './provider.js'
describe('complete configured registry', () => {
  it('expands Hermes catalogs while excluding image models', () => {
    const models = modelsFromProvider({ id: 'hermes', app_type: 'hermes', name: 'Service', settings_config: JSON.stringify({ api_key: 'key', base_url: 'https://example.test/v1', api_mode: 'chat_completions', model: 'primary', models: ['primary', 'backup', 'gpt-image-2', { id: 'third' }] }) })
    expect(models.map(m => m.modelName)).toEqual(['primary', 'backup', 'third'])
    expect(new Set(models.map(m => m.key)).size).toBe(3)
    expect(models.every(m => m.apiKey === 'key' && m.wireApi === 'chat')).toBe(true)
  })
  it('registers all Claude aliases', () => {
    const models = modelsFromProvider({ id: 'claude', app_type: 'claude', name: 'Service', settings_config: JSON.stringify({ env: { ANTHROPIC_API_KEY: 'key', ANTHROPIC_MODEL: 'primary', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'fast', ANTHROPIC_DEFAULT_OPUS_MODEL: 'large' } }) })
    expect(models.map(m => m.modelName)).toEqual(['primary', 'large', 'fast'])
    expect(models[0].key).toBe('claude')
  })
  it('keeps the selected Codex endpoint with mixed auth and env', () => {
    const models = modelsFromProvider({ id: 'codex', app_type: 'codex', name: 'Service', settings_config: JSON.stringify({ auth: { OPENAI_API_KEY: 'key' }, env: {}, config: 'model="actual"\nmodel_provider="custom"\n[model_providers.custom]\nbase_url="https://actual.test/v1"\nwire_api="responses"\n[model_providers.unused]\nbase_url="https://unused.test"' }) })
    expect(models[0]).toMatchObject({ apiKey: 'key', modelName: 'actual', baseURL: 'https://actual.test/v1', wireApi: 'responses' })
  })
  it('does not guess models for invalid or empty configs', () => {
    for (const config of ['invalid', '{}', '{"auth":{"OPENAI_API_KEY":"key"}}']) expect(modelsFromProvider({ id: 'empty', app_type: 'codex', name: '', settings_config: config })).toEqual([])
  })
})

describe('live model catalog', () => {
  afterEach(() => {
    clearLiveModelCatalog()
    vi.unstubAllGlobals()
  })

  const response = (status: number, body: unknown) => ({
    status,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(body),
  })

  it('filters removed model names and does not reintroduce them as fallbacks', async () => {
    const configured = { ...selected, fallbackModels: ['model-old'] }
    const stale = { ...selected, key: 'stale', modelName: 'model-old', fallbackModels: [] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(200, { data: [{ id: 'model-a' }, { id: 'model-new' }] })))
    await refreshModelCatalog([configured, stale], true)
    const available = getCachedAvailableModels([configured, stale])
    expect(available.map(model => model.modelName)).toEqual(['model-a', 'model-new'])
    expect(available[0].fallbackModels).not.toContain('model-old')
  })

  it('keeps static models when a compatible endpoint has no catalog route', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(404, { error: 'not implemented' })))
    await refreshModelCatalog([selected], true)
    expect(getCachedAvailableModels([selected])).toEqual([selected])
  })

  it('removes a route after an explicit authentication failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(403, { error: 'forbidden' })))
    await refreshModelCatalog([selected], true)
    expect(getCachedAvailableModels([selected])).toEqual([])
  })

  it('does not probe the same route again within the cache window', async () => {
    const fetch = vi.fn().mockResolvedValue(response(200, { data: [{ id: 'model-a' }] }))
    vi.stubGlobal('fetch', fetch)
    await refreshModelCatalog([selected], true)
    await refreshModelCatalog([selected])
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
