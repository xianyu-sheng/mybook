import { load } from 'cheerio'
import type { InterviewInput, ResearchItem } from '../../src/types/interview.js'

export function researchQueries(input: InterviewInput): string[] {
  const skills = input.jd.match(/\b(?:Java|Go|Python|C\+\+|Redis|MySQL|React|LLM|SQL|Kubernetes)\b/gi) || []
  return [...new Set([
    `site:nowcoder.com ${input.company} ${input.department} ${input.role} ${skills.slice(0, 2).join(' ')} 面经`,
    `site:nowcoder.com ${input.company} 面经`
  ])]
}

export function parseResearch(xml: string, company: string): ResearchItem[] {
  const $ = load(xml, { xmlMode: true })
  return $('item').toArray().flatMap(item => {
    const title = $(item).find('title').text().trim()
    const snippet = $(item).find('description').text().trim()
    const url = $(item).find('link').text().trim()
    try {
      const parsed = new URL(url)
      if (!['https:', 'http:'].includes(parsed.protocol)) return []
      // Search engines sometimes ignore terms. Reject irrelevant results instead of inventing evidence.
      if (!/面经|面试|interview/i.test(title + snippet)) return []
      const companyWords = company.toLowerCase().split(/\s+/).filter(Boolean)
      if (!companyWords.some(word => (title + snippet).toLowerCase().includes(word))) return []
      return [{ title, url, snippet: snippet.slice(0, 1800), retrieved_at: new Date().toISOString() }]
    } catch { return [] }
  })
}

export async function searchResearch(input: InterviewInput): Promise<ResearchItem[]> {
  const found = new Map<string, ResearchItem>()
  let failure = ''
  for (const query of researchQueries(input)) {
    try {
      const url = new URL('https://cn.bing.com/search')
      url.searchParams.set('q', query)
      url.searchParams.set('format', 'rss')
      const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/rss+xml,application/xml' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      for (const item of parseResearch(await response.text(), input.company)) found.set(item.url, item)
      if (found.size >= 4) break
    } catch (error: any) { failure = error.message }
  }
  if (!found.size) throw new Error(failure ? `面经搜索暂不可用：${failure}` : '未找到匹配企业的公开面经，可修改企业名称后重试')
  return [...found.values()].slice(0, 6)
}
