import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LanguageModel } from 'ai'
import type { ModelDef } from './provider.js'
import { clearGenerationHealth, generateTextWithFallback, generationCandidates, InvalidModelOutput } from './generate.js'
import { parseInterviewFeedback, parseSourceSummary } from './structured.js'
const mocks = vi.hoisted(() => ({ generate: vi.fn(), stream: vi.fn(), client: vi.fn(), registry: vi.fn() }))
vi.mock('ai', () => ({ generateText: mocks.generate, streamText: mocks.stream }))
vi.mock('./provider.js', () => ({ createModelClient: mocks.client, getAllModelsFromCCSwitch: mocks.registry }))
const model = 'primary-client' as LanguageModel
const def: ModelDef = { key: 'primary', name: 'Test', provider: 'anthropic', modelName: 'primary', apiKey: 'secret-A', baseURL: 'https://one.test', appType: 'claude', isCCSwitchActive: true, fallbackModels: [] }
const backup: ModelDef = { ...def, key: 'backup', modelName: 'backup', provider: 'openai', apiKey: 'secret-B', baseURL: 'https://two.test/v1', wireApi: 'responses' }
const opts = { system: 'test', prompt: 'test', maxOutputTokens: 100, timeoutMs: 200, totalTimeoutMs: 1000 }
const unavailable = Object.assign(new Error('分组 cn-models 下模型 deepseek-v4-pro 的可用渠道不存在（retry）'), { statusCode: 503 })
const stream = (parts: any[]) => ({ fullStream: (async function* () { yield* parts })() })
beforeEach(() => { vi.resetAllMocks(); clearGenerationHealth(); mocks.registry.mockReturnValue([def, backup]); mocks.client.mockResolvedValue('backup-client') })
describe('generation routing', () => {
  it('rejects an already cancelled request without contacting a model', async () => {
    const controller = new AbortController()
    controller.abort(new Error('user cancelled'))
    await expect(generateTextWithFallback(model, def, { ...opts, signal: controller.signal })).rejects.toThrow('user cancelled')
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it('cancels a stalled request without falling back', async () => {
    const controller = new AbortController()
    mocks.generate.mockImplementationOnce(() => new Promise(() => {}))
    const task = generateTextWithFallback(model, def, { ...opts, signal: controller.signal })
    controller.abort(new Error('user cancelled'))
    await expect(task).rejects.toThrow('user cancelled')
    expect(mocks.generate).toHaveBeenCalledTimes(1)
    expect(mocks.client).not.toHaveBeenCalled()
  })
  it('uses another channel with its own credentials, protocol and deadline', async () => {
    mocks.generate.mockRejectedValueOnce(unavailable).mockResolvedValueOnce({ text: 'ok' })
    expect(await generateTextWithFallback(model, def, opts)).toEqual({ text: 'ok', usedModel: 'backup' })
    expect(mocks.client).toHaveBeenCalledWith(backup)
    expect(mocks.generate.mock.calls[1][0].providerOptions.openai.store).toBe(false)
    expect(mocks.generate.mock.calls[0][0].abortSignal).not.toBe(mocks.generate.mock.calls[1][0].abortSignal)
  })
  it.each([429, 502, 503, 404])('continues after HTTP %s', async statusCode => {
    mocks.generate.mockRejectedValueOnce(Object.assign(new Error('service error'), { statusCode })).mockResolvedValueOnce({ text: 'ok' })
    expect((await generateTextWithFallback(model, def, opts)).usedModel).toBe('backup')
  })
  it('skips a rejected credential while using another credential', async () => {
    mocks.registry.mockReturnValue([def, { ...def, key: 'same-key', modelName: 'same-key' }, backup])
    mocks.generate.mockRejectedValueOnce(Object.assign(new Error('invalid key'), { statusCode: 401 })).mockResolvedValueOnce({ text: 'ok' })
    expect((await generateTextWithFallback(model, def, opts)).usedModel).toBe('backup')
    expect(mocks.client).toHaveBeenCalledTimes(1)
  })
  it('skips an exhausted credential while using another credential', async () => {
    mocks.registry.mockReturnValue([def, { ...def, key: 'same-key', modelName: 'same-key' }, backup])
    const quotaError = Object.assign(new Error('insufficient_user_quota: secret-A'), { statusCode: 402 })
    mocks.generate.mockRejectedValueOnce(quotaError).mockResolvedValueOnce({ text: 'ok' })
    expect((await generateTextWithFallback(model, def, opts)).usedModel).toBe('backup')
    // The sibling sharing the exhausted credential is skipped.
    expect(mocks.client).toHaveBeenCalledTimes(1)
    expect(mocks.client).toHaveBeenCalledWith(backup)
  })
  it('reports quota exhaustion without exposing the upstream response', async () => {
    const quotaError = Object.assign(new Error('insufficient_user_quota: secret-A'), { statusCode: 402 })
    mocks.generate.mockRejectedValue(quotaError)
    await expect(generateTextWithFallback(model, def, opts)).rejects.toThrow('额度不足')
    await expect(generateTextWithFallback(model, def, opts)).rejects.not.toThrow('secret-A')
  })
  it('switches after timeout even if the SDK ignores abort', async () => {
    mocks.generate.mockImplementationOnce(() => new Promise(() => {})).mockResolvedValueOnce({ text: 'ok' })
    const progress = vi.fn()
    expect((await generateTextWithFallback(model, def, { ...opts, timeoutMs: 15, onProgress: progress })).usedModel).toBe('backup')
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'fallback', reason: '响应超时' }))
  })
  it('bounds total time across attempts', async () => {
    mocks.generate.mockImplementation(() => new Promise(() => {}))
    await expect(generateTextWithFallback(model, def, { ...opts, timeoutMs: 100, totalTimeoutMs: 15 })).rejects.toThrow('时间上限')
    expect(mocks.generate).toHaveBeenCalledTimes(1)
  })
  it('discards partial text after stream abort', async () => {
    mocks.stream.mockReturnValueOnce(stream([{ type: 'text-delta', text: 'partial' }, { type: 'abort' }]))
      .mockReturnValueOnce(stream([{ type: 'text-delta', text: 'complete' }, { type: 'finish', finishReason: 'stop' }]))
    expect((await generateTextWithFallback(model, def, { ...opts, stream: true })).text).toBe('complete')
  })
  it('detects an idle stream', async () => {
    mocks.stream.mockReturnValueOnce({ fullStream: (async function* () { yield { type: 'text-delta', text: 'partial' }; await new Promise(() => {}) })() })
      .mockReturnValueOnce(stream([{ type: 'text-delta', text: 'complete' }, { type: 'finish', finishReason: 'stop' }]))
    expect((await generateTextWithFallback(model, def, { ...opts, stream: true, idleTimeoutMs: 15 })).text).toBe('complete')
  })
  it.each(['length', 'error'])('retries an incomplete %s finish', async finishReason => {
    mocks.stream.mockReturnValueOnce(stream([{ type: 'text-delta', text: 'partial' }, { type: 'finish', finishReason }]))
      .mockReturnValueOnce(stream([{ type: 'text-delta', text: 'ok' }, { type: 'finish', finishReason: 'stop' }]))
    expect((await generateTextWithFallback(model, def, { ...opts, stream: true })).text).toBe('ok')
  })
  it('validates inside the retry boundary', async () => {
    mocks.generate.mockResolvedValueOnce({ text: 'bad' }).mockResolvedValueOnce({ text: 'ok' })
    expect((await generateTextWithFallback(model, def, { ...opts, validate: text => { if (text === 'bad') throw new InvalidModelOutput('bad') } })).text).toBe('ok')
  })
  it.each([
    { valid: JSON.stringify({ summary: '有效摘要', keyTopics: ['并发'], suggestedQuestions: ['如何加锁？'] }), validate: (text: string) => { parseSourceSummary(text) } },
    { valid: JSON.stringify({ score: 80, feedback: '说明边界', reference_answer: '使用业务键', knowledge: '幂等', next_question: '如何加锁？' }), validate: (text: string) => { parseInterviewFeedback(text, false) } },
  ])('falls back on schema-invalid summary/interview output', async ({ valid, validate }) => {
    mocks.stream.mockReturnValueOnce(stream([{ type: 'text-delta', text: '{}' }, { type: 'finish', finishReason: 'stop' }]))
      .mockReturnValueOnce(stream([{ type: 'text-delta', text: valid }, { type: 'finish', finishReason: 'stop' }]))
    expect(await generateTextWithFallback(model, def, { ...opts, stream: true, validate })).toEqual({ text: valid, usedModel: 'backup' })
    expect(mocks.stream).toHaveBeenCalledTimes(2)
  })
  it('tries more than three candidates', async () => {
    mocks.registry.mockReturnValue(Array.from({ length: 5 }, (_, i) => ({ ...backup, modelName: `m${i}` })))
    mocks.generate.mockRejectedValueOnce(unavailable).mockRejectedValueOnce(unavailable).mockRejectedValueOnce(unavailable)
      .mockRejectedValueOnce(unavailable).mockResolvedValueOnce({ text: 'ok' })
    expect((await generateTextWithFallback(model, def, opts)).usedModel).toBe('m3')
  })
  it('deduplicates requests but retains distinct protocols', () => {
    expect(generationCandidates(def, [def, { ...def, key: 'copy' }, backup, { ...backup, wireApi: 'chat' }])).toHaveLength(3)
  })
  it('avoids a failed primary for the next batch', async () => {
    mocks.generate.mockRejectedValueOnce(unavailable).mockResolvedValueOnce({ text: 'ok' })
    await generateTextWithFallback(model, def, opts)
    expect(generationCandidates(def, [def, backup])[0]).toBe(backup)
  })
  it('retains every registered model but reaches a different service before forty stalled siblings spend the budget', async () => {
    const siblings = Array.from({ length: 40 }, (_, i) => ({ ...def, key: `same-${i}`, modelName: `same-${i}` }))
    mocks.registry.mockReturnValue([def, ...siblings, backup])
    mocks.client.mockImplementation(async (candidate: ModelDef) => candidate.modelName as LanguageModel)
    mocks.generate.mockImplementation(({ model: client }: { model: LanguageModel }) => client === 'backup'
      ? Promise.resolve({ text: 'healthy service' }) : new Promise(() => {}))
    const candidates = generationCandidates(def, [def, ...siblings, backup])
    expect(candidates).toHaveLength(42)
    expect(candidates.slice(0, 2)).toEqual([def, backup])
    expect((await generateTextWithFallback(model, def, { ...opts, timeoutMs: 15, totalTimeoutMs: 120 })).usedModel).toBe('backup')
    expect(mocks.generate).toHaveBeenCalledTimes(2)
    expect(mocks.client).toHaveBeenCalledTimes(1)
  })
  it('diversifies by both endpoint and credentials, keeping a healthy selected model first', () => {
    const sibling = { ...def, modelName: 'same-service' }
    const otherCredential = { ...def, apiKey: 'another-key', modelName: 'other-credential' }
    expect(generationCandidates(def, [sibling, otherCredential, backup])).toEqual([def, otherCredential, backup, sibling])
  })
  it.each([
    Object.assign(new Error('Bad gateway'), { statusCode: 502 }),
    Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }),
  ])('defers remaining models of an explicitly unavailable service within the current request', async error => {
    const same = { ...def, modelName: 'same-service' }
    const other = { ...backup, modelName: 'other-service-second-model' }
    mocks.registry.mockReturnValue([def, same, backup, other])
    mocks.generate.mockRejectedValueOnce(error).mockRejectedValueOnce(unavailable).mockResolvedValueOnce({ text: 'ok' })
    expect((await generateTextWithFallback(model, def, opts)).usedModel).toBe(other.modelName)
    expect(mocks.client.mock.calls.map(call => call[0].modelName)).toEqual(['backup', other.modelName])
    expect(generationCandidates(def, [same, backup, other])).toContain(same)
  })
  it('does not cool a whole service because one model returns no_available_channel with HTTP 503', async () => {
    const same = { ...def, modelName: 'healthy-sibling' }
    const other = { ...backup, modelName: 'other-service-second-model' }
    mocks.registry.mockReturnValue([def, same, backup, other])
    mocks.generate.mockRejectedValueOnce(unavailable).mockRejectedValueOnce(new InvalidModelOutput('bad JSON')).mockResolvedValueOnce({ text: 'ok' })
    expect((await generateTextWithFallback(model, def, opts)).usedModel).toBe(same.modelName)
    expect(mocks.client.mock.calls.map(call => call[0].modelName)).toEqual(['backup', same.modelName])
  })
  it('keeps cooled services available when no other service remains and clears cooldown on success', async () => {
    const same = { ...def, modelName: 'healthy-sibling' }
    mocks.registry.mockReturnValue([def, same])
    mocks.generate.mockRejectedValueOnce(Object.assign(new Error('Service unavailable'), { statusCode: 503 })).mockResolvedValueOnce({ text: 'ok' })
    expect((await generateTextWithFallback(model, def, opts)).usedModel).toBe(same.modelName)
    expect(generationCandidates(same, [backup])[0]).toBe(same)
  })
  it('expires a short service cooldown without overriding the healthy user selection', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    try {
      mocks.generate.mockRejectedValueOnce(Object.assign(new Error('Service unavailable'), { statusCode: 503 })).mockResolvedValueOnce({ text: 'ok' })
      await generateTextWithFallback(model, def, opts)
      const selectedSibling = { ...def, modelName: 'selected-sibling' }
      expect(generationCandidates(selectedSibling, [backup])[0]).toBe(backup)
      now.mockReturnValue(1_030_001)
      expect(generationCandidates(selectedSibling, [backup])[0]).toBe(selectedSibling)
    } finally { now.mockRestore() }
  })
  it('connection testing cannot succeed via fallback', async () => {
    mocks.generate.mockRejectedValue(unavailable)
    await expect(generateTextWithFallback(model, def, { ...opts, allowFallback: false })).rejects.toThrow('1 个模型渠道')
    expect(mocks.client).not.toHaveBeenCalled()
  })
  it('does not expose upstream credential errors', async () => {
    mocks.generate.mockRejectedValue(Object.assign(new Error('secret-A secret-B'), { statusCode: 503 }))
    await expect(generateTextWithFallback(model, def, opts)).rejects.toThrow('2 个模型渠道')
    await expect(generateTextWithFallback(model, def, opts)).rejects.not.toThrow('secret')
  })
  it('does not bypass content filtering', async () => {
    mocks.generate.mockResolvedValue({ text: '', finishReason: 'content-filter' })
    await expect(generateTextWithFallback(model, def, opts)).rejects.toThrow('内容审核')
    expect(mocks.client).not.toHaveBeenCalled()
  })
})
