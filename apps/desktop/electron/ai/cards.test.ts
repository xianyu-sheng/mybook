import { describe, expect, it } from 'vitest'
import { parseCards } from './cards.js'
const card = { title: '如何处理缓存穿透？', brief_answer: '布隆过滤器', detail_answer: '结合空值缓存与过期策略。', tags: ['Redis'], sources: [] }
describe('card response validation', () => {
  it('preserves Chinese punctuation', () => { expect(parseCards(JSON.stringify([{ ...card, detail_answer: '“原文”，不是代码。' }]), 1)[0].detail_answer).toBe('“原文”，不是代码。') })
  it('accepts fenced JSON', () => { expect(parseCards('```json\n' + JSON.stringify([card]) + '\n```', 1)).toHaveLength(1) })
  it.each(['[]', '[{"title":"partial"}]', JSON.stringify([card]).slice(0, -1), '[(()=>{throw new Error()})()]'])('rejects incomplete/invalid content', text => { expect(() => parseCards(text, 1)).toThrow() })
  it('requires exact count and distinct titles', () => { expect(() => parseCards(JSON.stringify([card]), 2)).toThrow(); expect(() => parseCards(JSON.stringify([card]), 1, [card.title])).toThrow() })
  it('rejects invented source numbers in the source list and answer body', () => {
    expect(() => parseCards(JSON.stringify([{ ...card, sources: ['来源[999]'] }]), 1, [], ['来源[1]'])).toThrow()
    expect(() => parseCards(JSON.stringify([{ ...card, detail_answer: '见来源[999]' }]), 1, [], ['来源[1]'])).toThrow()
  })
  it('includes actual body references and deduplicates explicitly repeated references', () => {
    const value = parseCards(JSON.stringify([{ ...card, detail_answer: '见来源[2]', sources: ['来源[1]', '来源[1]'] }]), 1, [], ['来源[1]', '来源[2]'])
    expect(value[0].sources).toEqual(['来源[1]', '来源[2]'])
  })
})
