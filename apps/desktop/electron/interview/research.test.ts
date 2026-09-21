import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseNowcoderResearch, parseResearch, researchQueries, searchResearch } from './research.js'

afterEach(() => vi.unstubAllGlobals())

describe('public interview research', () => {
  it('uses focused queries that Bing can answer without dropping the role signal', () => {
    const queries = researchQueries({ company: '字节跳动', department: '基础架构', role: '后端工程师', jd: 'Java Redis', tags: [], search_web: true, question_count: 5 })
    expect(queries.some(query => query.includes('site:nowcoder.com/discuss') && query.includes('面试'))).toBe(true)
    expect(queries.some(query => query.includes('字节跳动') && query.includes('后端工程师'))).toBe(true)
    expect(queries.length).toBeGreaterThan(2)
  })

  it('keeps real reports, supports company aliases and rejects unrelated pages', () => {
    const xml = `<rss><channel>
      <item><title>字节后端面经：一面到终面</title><link>https://www.nowcoder.com/discuss/123?utm_source=bing</link><description>字节跳动后端开发岗位的真实面试经验。</description></item>
      <item><title>字节跳动招聘官网</title><link>https://jobs.bytedance.com/</link><description>字节跳动招聘与职位介绍。</description></item>
      <item><title>bit、byte、KB 详解</title><link>https://example.com/byte</link><description>字节单位和存储容量介绍。</description></item>
      <item><title>ByteDance interview experience</title><link>https://example.com/interview</link><description>ByteDance backend interview questions.</description></item>
      <item><title>重复面经</title><link>https://www.nowcoder.com/discuss/123?spm=tracking</link><description>字节后端面试经验。</description></item>
    </channel></rss>`
    const items = parseResearch(xml, '字节跳动')
    expect(items).toHaveLength(2)
    expect(items[0].url).toBe('https://www.nowcoder.com/discuss/123')
    expect(items.some(item => item.title.includes('ByteDance'))).toBe(true)
  })

  it('extracts direct 牛客面经 links from its server-rendered search page', () => {
    const html = `<div><a href="/discuss/42?sourceSSR=search">阿里面经：后端一面</a><p>阿里巴巴后端面试经验，包含并发和数据库问题。</p></div>`
    const items = parseNowcoderResearch(html, '阿里巴巴')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ title: '阿里面经：后端一面', url: 'https://www.nowcoder.com/discuss/42' })
  })

  it('tries several live queries and returns a relevant report when the first query is noisy', async () => {
    vi.stubGlobal('fetch', vi.fn(async (request: RequestInfo | URL) => {
      const query = new URL(String(request)).searchParams.get('q') || ''
      if (query.includes('site:nowcoder.com/discuss')) {
        return new Response('<rss><channel><item><title>字节跳动官网</title><link>https://www.bytedance.com/</link><description>公司介绍</description></item></channel></rss>', { status: 200 })
      }
      return new Response('<rss><channel><item><title>字节后端面试经验</title><link>https://blog.nowcoder.net/n/abc</link><description>字节跳动后端岗位面经，包含真实问题。</description></item></channel></rss>', { status: 200 })
    }))
    const items = await searchResearch({ company: '字节跳动', department: '', role: '后端工程师', jd: '', tags: [], search_web: true, question_count: 5 })
    expect(items.length).toBeGreaterThan(0)
    expect(items[0].url).toContain('blog.nowcoder.net')
  })
})
