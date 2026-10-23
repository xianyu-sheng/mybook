import type { LanguageModel } from 'ai'
import { z } from 'zod'
import type { ModelDef } from './provider.js'
import { generateTextWithFallback, InvalidModelOutput, type GenerationProgress } from './generate.js'
import { selectCitations, type CitationSnapshot } from './knowledge.js'

const cardSchema = z.array(z.object({
  title: z.string().trim().min(1), brief_answer: z.string().trim().min(1),
  detail_answer: z.string().trim().min(1), tags: z.array(z.string()).default([]), sources: z.array(z.string()).default([]),
})).min(1)
export type GeneratedCard = z.infer<typeof cardSchema>[number] & { generatedModel: string; citations: CitationSnapshot[] }
export function parseCards(text: string, expected: number, previous: string[] = [], allowedRefs: readonly string[] = []) {
  try {
    const raw = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    const cards = cardSchema.parse(JSON.parse(raw))
    const titles = new Set(previous.map(title => title.trim().toLowerCase()))
    if (cards.length !== expected) throw new Error('Wrong card count')
    for (const card of cards) {
      const key = card.title.toLowerCase()
      if (titles.has(key)) throw new Error('Duplicate card')
      titles.add(key)
      const used = selectCitations(`${card.title}\n${card.brief_answer}\n${card.detail_answer}`, allowedRefs.map(ref => ({ ref, id: '', title: '' })), card.sources)
      card.sources = used.map(citation => citation.ref)
    }
    return cards
  } catch { throw new InvalidModelOutput('Card JSON is incomplete or invalid') }
}

export async function generateCards(model: LanguageModel, def: ModelDef, options: {
  context: string; citations: readonly CitationSnapshot[]; system: string; label: string; count: number
  existingTitles?: readonly string[]
  onProgress?: (progress: GenerationProgress & { completed: number; requested: number }) => void
  /** Called after a complete batch has been validated. Consumers can persist
   * it before the next model request so a later failure never loses earlier
   * cards. */
  onBatch?: (cards: GeneratedCard[]) => void | Promise<void>
}) {
  const cards: GeneratedCard[] = []
  const allowedRefs = options.citations.map(citation => citation.ref)
  const deadline = Date.now() + 360000
  while (cards.length < options.count) {
    const count = Math.min(2, options.count - cards.length)
    const titles = [...(options.existingTitles || []), ...cards.map(card => card.title)]
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error('卡片生成已达到时间上限，本次未保存不完整结果，请稍后重试。')
    const result = await generateTextWithFallback(model, def, {
      system: options.system,
      prompt: `## 知识来源\n${options.context}\n\n以「${options.label}」模式生成恰好 ${count} 张知识卡片。输出完整 JSON 数组，每项包含 title、brief_answer、detail_answer、tags、sources。详细解释控制在 200–350 字，保留原理和例子；如果知识点有可实现的核心（接口、算法、SQL、配置、并发/缓存方案等），追加一个简短的 Markdown 代码块示例，并附 1–2 个追问及「建议回答」；纯概念不必硬塞代码。只引用实际使用的来源，合法编号：${JSON.stringify(allowedRefs)}；通用补充未使用来源时 sources 可为空，不能编造编号。\n不要重复以下题目：${JSON.stringify(titles)}\n只输出 JSON，不要加说明或代码围栏。`,
      maxOutputTokens: 8000, timeoutMs: 60000, totalTimeoutMs: remaining, idleTimeoutMs: 20000, stream: true,
      validate: text => { parseCards(text, count, titles, allowedRefs) },
      onProgress: progress => options.onProgress?.({ ...progress, completed: cards.length, requested: options.count }),
    })
    const batch = parseCards(result.text, count, titles, allowedRefs).map(card => ({ ...card, generatedModel: result.usedModel,
      citations: selectCitations(`${card.title}\n${card.brief_answer}\n${card.detail_answer}`, options.citations, card.sources) }))
    cards.push(...batch)
    await options.onBatch?.(batch)
    options.onProgress?.({ phase: 'success', model: result.usedModel, attempt: 0, total: 0, completed: cards.length, requested: options.count })
  }
  return cards
}
