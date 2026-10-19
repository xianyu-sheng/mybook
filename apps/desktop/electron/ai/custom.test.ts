import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { customProviderInputSchema, customProviderModels, deleteCustomProvider, maskKey, readCustomProviders, saveCustomProvider, splitModels, toPublicProvider, type CustomProvider } from './custom.js'

const provider: CustomProvider = {
  id: 'provider-1',
  name: 'Local gateway',
  provider: 'openai',
  baseURL: 'https://gateway.test/v1',
  apiKey: 'sk-test-1234567890abcd',
  models: ['model-a', 'model-b'],
  wireApi: 'chat',
  createdAt: '2026-01-01T00:00:00.000Z',
}

describe('custom provider configuration', () => {
  it('splits model names on common separators and removes duplicates', () => {
    expect(splitModels(' model-a, model-b\nmodel-a；model-c ')).toEqual(['model-a', 'model-b', 'model-c'])
    expect(splitModels(' , \n ')).toEqual([])
  })

  it('never returns the full API key to the renderer', () => {
    const masked = maskKey(provider.apiKey)
    expect(masked).not.toBe(provider.apiKey)
    expect(masked).not.toContain('1234567890')
    expect(masked.endsWith('abcd')).toBe(true)
    expect(maskKey('short')).toBe('••••')
  })

  it('builds stable model keys and keeps the configured protocol', () => {
    const models = customProviderModels([provider])
    expect(models.map(model => model.key)).toEqual([
      'custom:provider-1',
      'custom:provider-1::model-b',
    ])
    expect(models.every(model => model.appType === 'custom' && model.apiKey === provider.apiKey)).toBe(true)
    expect(models.every(model => model.wireApi === 'chat' && model.baseURL === provider.baseURL)).toBe(true)
  })

  it('serializes public providers without credentials', () => {
    const publicValue = toPublicProvider(provider)
    const serialized = JSON.stringify(publicValue)
    expect(serialized).not.toContain(provider.apiKey)
    expect(publicValue).toMatchObject({ id: provider.id, models: provider.models, keyHint: maskKey(provider.apiKey) })
    expect('apiKey' in publicValue).toBe(false)
  })

  it('requires a name and at least one model when saving', () => {
    expect(customProviderInputSchema.safeParse({ name: '', provider: 'openai', baseURL: 'https://a.test', models: 'm' }).success).toBe(false)
    expect(customProviderInputSchema.safeParse({ name: 'A', provider: 'openai', baseURL: 'https://a.test', models: ' ' }).success).toBe(false)
    expect(customProviderInputSchema.safeParse({ name: 'A', provider: 'openai', baseURL: 'https://a.test', models: 'm' }).success).toBe(true)
  })
})

function fixture() {
  const db = new Database(':memory:')
  db.exec("CREATE TABLE settings(key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')))")
  return db
}

describe('custom provider persistence', () => {
  it('saves, updates without resending the key, and removes credentials on delete', () => {
    const db = fixture()
    const [saved] = saveCustomProvider(db, {
      name: 'My gateway', provider: 'openai', baseURL: 'https://gateway.test/v1',
      apiKey: 'sk-secret-key-1234', models: 'model-a, model-b',
    })
    expect(saved.keyHint).not.toContain('secret')
    expect(readCustomProviders(db)[0]).toMatchObject({ models: ['model-a', 'model-b'], apiKey: 'sk-secret-key-1234' })

    // 编辑时留空 API Key 应沿用旧值，且不把明文回传给前端。
    const [updated] = saveCustomProvider(db, {
      id: saved.id, name: 'Renamed', provider: 'openai', baseURL: 'https://gateway.test/v1',
      models: 'model-c',
    })
    expect(updated.name).toBe('Renamed')
    expect(updated.models).toEqual(['model-c'])
    expect(readCustomProviders(db)[0].apiKey).toBe('sk-secret-key-1234')

    db.prepare("INSERT INTO settings(key,value_json) VALUES('activeModel',?)").run(JSON.stringify(`custom:${saved.id}`))
    deleteCustomProvider(db, saved.id)
    expect(readCustomProviders(db)).toEqual([])
    expect(db.prepare("SELECT key FROM settings WHERE key='activeModel'").get()).toBeUndefined()
    db.close()
  })

  it('rejects non-http base URLs and empty keys', () => {
    const db = fixture()
    expect(() => saveCustomProvider(db, { name: 'A', provider: 'openai', baseURL: 'file:///etc/passwd', apiKey: 'k', models: 'm' })).toThrow()
    expect(() => saveCustomProvider(db, { name: 'A', provider: 'openai', baseURL: 'https://a.test', models: 'm' })).toThrow()
    db.close()
  })
})

import { configureCustomProviders, getAllModelsFromCCSwitch } from './provider.js'

describe('model registry', () => {
  it('prefers locally configured providers and keeps same-route fallbacks', () => {
    configureCustomProviders(() => [provider])
    try {
      const models = getAllModelsFromCCSwitch()
      const local = models.filter(model => model.key.startsWith('custom:provider-1'))
      expect(local.map(model => model.modelName)).toEqual(['model-a', 'model-b'])
      expect(models.slice(0, 2).map(model => model.key)).toEqual(['custom:provider-1', 'custom:provider-1::model-b'])
      expect(local[0].fallbackModels).toContain('model-b')
    } finally {
      configureCustomProviders(() => [])
    }
  })
})
