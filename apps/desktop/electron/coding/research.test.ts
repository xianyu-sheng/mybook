import { describe, expect, it } from 'vitest'
import { parseCodingResearch, researchQueries } from './research.js'

describe('coding public research', () => {
  it('only keeps allow-listed sources and de-duplicates tracking URLs', () => {
    const xml = `<rss><channel>
      <item><title>字节后端面试题 单调栈</title><link>https://codetop.cc/so?utm_source=bing</link><description>公开题单</description></item>
      <item><title>重复题单</title><link>https://codetop.cc/so?spm=abc</link><description>算法题</description></item>
      <item><title>无关页面</title><link>https://example.com/a</link><description>面试题</description></item>
    </channel></rss>`
    const items = parseCodingResearch(xml, '字节')
    expect(items).toHaveLength(1)
    expect(items[0].source).toBe('codetop')
    expect(items[0].warning).toContain('未经')
  })

  it('includes selected source domains and JD skill terms in queries', () => {
    const queries = researchQueries({ company: '字节', role: '后端', jd: 'Java Redis 动态规划', sources: ['nowcoder'] })
    expect(queries.some(query => query.includes('site:nowcoder.com'))).toBe(true)
    expect(queries.some(query => query.includes('Java') && query.includes('Redis'))).toBe(true)
    expect(queries.every(query => !query.includes('xiaohongshu.com'))).toBe(true)
  })
})
