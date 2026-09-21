import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseCodingResearch, researchQueries, searchCodingResearch } from './research.js'

afterEach(() => vi.unstubAllGlobals())

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

  it('uses live source adapters and keeps direct problem links from each selected source', async () => {
    vi.stubGlobal('fetch', vi.fn(async (request: RequestInfo | URL) => {
      const url = String(request)
      if (url.includes('nowcoder.com/search')) return new Response('<html><a href="/discuss/123">字节面经</a></html>', { status: 200 })
      if (url.includes('xiaohongshu.com/search_result')) return new Response('<html><a href="/explore/abc">字节面试笔记</a></html>', { status: 200 })
      if (url.endsWith('/api/companies/')) return new Response(JSON.stringify([{ id: 1, name: '字节跳动' }]), { status: 200 })
      if (url.endsWith('/api/jobs/')) return new Response(JSON.stringify([{ id: 8, name: '大模型/AI infra/Agent开发' }]), { status: 200 })
      if (url.includes('codetop.cc/api/questions')) return new Response(JSON.stringify({ count: 1, list: [{ leetcode: { frontend_question_id: '1', title: 'Two Sum', titleCn: '两数之和', slug_title: 'two-sum', level: 1, content: '<p>给定数组</p>' } }] }), { status: 200 })
      if (url.includes('github.com/EndlessCheng')) return new Response('<html><a href="https://leetcode.cn/problems/3sum/">三数之和</a></html>', { status: 200 })
      if (url.includes('leetcode.cn/graphql')) return new Response(JSON.stringify({ data: { problemsetQuestionList: { questions: [{ frontendQuestionId: '206', titleCn: '反转链表', titleSlug: 'reverse-linked-list', difficulty: 'EASY', topicTags: [{ nameTranslated: '链表' }], extra: { topCompanyTags: [{ slug: 'bytedance' }] } }] } } }), { status: 200 })
      return new Response('', { status: 404 })
    }))
    const results = await searchCodingResearch({ company: '字节跳动', department: '飞书', role: 'Agent 工程师', jd: 'Python Agent', sources: ['nowcoder', 'xiaohongshu', 'codetop', 'leetcode', 'lingshen'] })
    expect(new Set(results.map(result => result.source))).toEqual(new Set(['nowcoder', 'xiaohongshu', 'codetop', 'leetcode', 'lingshen']))
    expect(results.filter(result => result.url.includes('/problems/')).length).toBeGreaterThanOrEqual(3)
    expect(results.find(result => result.source === 'codetop' && result.problem)?.problem?.difficulty).toBe('easy')
  })
})
