import { load } from 'cheerio'
import type { InterviewInput, ResearchItem } from '../../src/types/interview.js'

/**
 * Build several small, independent queries instead of one very long query.
 * Bing's RSS endpoint tends to ignore a `site:` filter when it is combined
 * with a company, department, role and many skills. Keeping a few focused
 * variants gives the search engine enough signal while still finding public
 * interview reports.
 */
export function researchQueries(input: InterviewInput): string[] {
  const company = input.company.trim()
  const department = input.department.trim()
  const role = input.role.trim()
  const skills = input.jd.match(/\b(?:Java|Go|Python|C\+\+|C#|Rust|Redis|MySQL|PostgreSQL|React|Vue|LLM|大模型|Agent|SQL|Kubernetes|Kafka)\b/gi) || []
  const skillHint = [...new Set(skills)].slice(0, 2).join(' ')
  return [...new Set([
    `site:nowcoder.com/discuss ${company} ${role} 面试`,
    `site:blog.nowcoder.net ${company} 面经`,
    `site:nowcoder.com/enterprise ${company} 面试`,
    `${company} ${department} ${role} ${skillHint} 面试经验`,
    `${company} 面试 面经`,
    `site:zhuanlan.zhihu.com ${company} 面试`,
    `site:blog.csdn.net ${company} 面试`
  ].map(query => query.replace(/\s+/g, ' ').trim()).filter(Boolean))]
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function cleanText(value: string): string {
  return value.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim()
}

/**
 * Public reports often use a short company name ("字节") or an English
 * alias ("ByteDance") even when the strategy contains the legal name. The
 * aliases are only used to validate a result; the result is still required
 * to contain interview-specific language.
 */
function companyAliases(company: string): string[] {
  const normalized = normalize(company)
  if (!normalized) return []
  const aliases = new Set([normalized])
  const known: Record<string, string[]> = {
    字节跳动: ['字节', 'bytedance'],
    bytedance: ['字节跳动', '字节'],
    阿里巴巴: ['阿里', 'alibaba'],
    alibaba: ['阿里巴巴', '阿里'],
    腾讯控股: ['腾讯', 'tencent'],
    腾讯: ['tencent'],
    tencent: ['腾讯'],
    百度: ['baidu'],
    baidu: ['百度'],
    美团: ['meituan'],
    meituan: ['美团'],
    拼多多: ['pdd', 'pinduoduo'],
    pinduoduo: ['拼多多', 'pdd'],
    快手: ['kuaishou'],
    kuaishou: ['快手'],
    京东: ['jd', '京东物流'],
    jd: ['京东'],
    小米: ['xiaomi'],
    xiaomi: ['小米'],
    华为: ['huawei'],
    huawei: ['华为'],
  }
  for (const alias of known[normalized] || []) aliases.add(normalize(alias))
  // Chinese reports regularly abbreviate a three-or-more-character company
  // to its first two characters (e.g. "字节跳动" → "字节").
  if (/^[\u4e00-\u9fff]{3,}$/.test(normalized)) aliases.add(normalized.slice(0, 2))
  return [...aliases].filter(Boolean)
}

function canonicalUrl(value: string): string {
  try {
    const parsed = new URL(value)
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|spm$|from$|source$|sources?sr$|share_token$|share_source$)/i.test(key)) parsed.searchParams.delete(key)
    }
    parsed.hash = ''
    return parsed.toString()
  } catch { return value }
}

/** Parse Bing RSS while rejecting official/company pages and unrelated hits. */
export function parseResearch(xml: string, company: string): ResearchItem[] {
  const $ = load(xml, { xmlMode: true })
  const aliases = companyAliases(company)
  // 校招/社招 alone describe a recruiting page, not an interview report;
  // require an explicit interview/experience signal so official job pages do
  // not become fake "面经" sources.
  const interviewSignal = /面经|面试|面试题|面试经验|一面|二面|三面|技术面|笔试|hr面|interview/i
  const result: ResearchItem[] = []
  const seen = new Set<string>()
  for (const item of $('item').toArray()) {
    const rawTitle = cleanText($(item).find('title').text())
    // Some RSS responses put the complete page excerpt in <title>. Keep a
    // readable label while retaining the original URL and snippet as the
    // evidence users can inspect.
    const title = rawTitle.length > 220 ? `${rawTitle.slice(0, 217)}…` : rawTitle
    const snippet = cleanText($(item).find('description').text())
    const rawUrl = $(item).find('link').text().trim()
    const url = canonicalUrl(rawUrl)
    if (!title || !url) continue
    try {
      const parsed = new URL(url)
      if (!['https:', 'http:'].includes(parsed.protocol)) continue
    } catch { continue }
    const searchable = normalize(`${title} ${snippet}`)
    // A report must mention both the target company (or a common alias) and
    // an interview signal. This prevents unrelated company homepages and
    // generic "byte" articles from being shown as interview evidence.
    if (!interviewSignal.test(`${title} ${snippet}`) || !aliases.some(alias => searchable.includes(alias))) continue
    if (seen.has(url)) continue
    seen.add(url)
    result.push({ title, url, snippet: snippet.slice(0, 1800), retrieved_at: new Date().toISOString() })
  }
  return result
}

/**
 * 牛客的 SSR search page is a useful fallback when Bing ignores Chinese
 * company names (which is especially common for Alibaba). It contains direct
 * `/discuss/<id>` links and snippets, so the app can show real reports without
 * fabricating a result from a search-engine homepage.
 */
export function parseNowcoderResearch(html: string, company: string): ResearchItem[] {
  const $ = load(html)
  const aliases = companyAliases(company)
  const interviewSignal = /面经|面试|面试题|面试经验|一面|二面|三面|技术面|笔试|hr面|interview/i
  const result: ResearchItem[] = []
  const seen = new Set<string>()
  $('a[href*="/discuss/"]').each((_, element) => {
    const anchor = $(element)
    const title = cleanText(anchor.text())
    const href = anchor.attr('href') || ''
    if (!title || !href) return
    let url = ''
    try {
      url = canonicalUrl(new URL(href, 'https://www.nowcoder.com').toString())
      if (!/^https?:$/i.test(new URL(url).protocol)) return
    } catch { return }
    const containerText = cleanText(anchor.parent().parent().text())
    const snippet = (containerText && containerText !== title ? containerText : title).slice(0, 1800)
    const searchable = normalize(`${title} ${snippet}`)
    // 牛客的全文搜索 may include a different company's report merely because
    // its body mentions the requested company. The title is the reliable
    // company label for a direct report, so require the alias there.
    if (!interviewSignal.test(`${title} ${snippet}`) || !aliases.some(alias => normalize(title).includes(alias)) || !aliases.some(alias => searchable.includes(alias)) || seen.has(url)) return
    seen.add(url)
    result.push({ title, url, snippet, retrieved_at: new Date().toISOString() })
  })
  return result
}

export async function searchResearch(input: InterviewInput): Promise<ResearchItem[]> {
  const queries = researchQueries(input)
  const found = new Map<string, ResearchItem>()
  const failures: string[] = []
  // Keep one slow/unreachable search provider from making the create flow
  // appear hung. All focused variants run under one shared deadline.
  const deadline = Date.now() + 30000
  const results = await Promise.allSettled([
    // Put the direct source first so real 牛客讨论页 win the result budget when
    // Bing returns many generic guides before its individual reports.
    (async () => {
      const remaining = Math.max(1, Math.min(10000, deadline - Date.now()))
      if (remaining <= 1) throw new Error('搜索超时')
      const url = new URL('https://www.nowcoder.com/search/all/')
      url.searchParams.set('query', `${input.company} ${input.department} ${input.role} 面经`.replace(/\s+/g, ' ').trim())
      const response = await fetch(url, {
        signal: AbortSignal.timeout(remaining),
        headers: { Accept: 'text/html', 'User-Agent': 'Mybook/0.7 (+https://github.com/xianyu-sheng/mybook)' }
      })
      if (!response.ok) throw new Error(`牛客 HTTP ${response.status}`)
      return parseNowcoderResearch(await response.text(), input.company)
    })(),
    ...queries.map(async query => {
      const remaining = Math.max(1, Math.min(10000, deadline - Date.now()))
      if (remaining <= 1) throw new Error('搜索超时')
      const url = new URL('https://cn.bing.com/search')
      url.searchParams.set('q', query)
      url.searchParams.set('format', 'rss')
      const response = await fetch(url, {
        signal: AbortSignal.timeout(remaining),
        headers: { Accept: 'application/rss+xml,application/xml', 'User-Agent': 'Mybook/0.7 (+https://github.com/xianyu-sheng/mybook)' }
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return parseResearch(await response.text(), input.company)
    })
  ])
  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const item of result.value) found.set(item.url, item)
    } else {
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason)
      if (message) failures.push(message)
    }
  }
  if (!found.size) {
    const failure = failures.find(message => message && !/aborted|timeout/i.test(message)) || failures[0]
    throw new Error(failure ? `面经搜索暂不可用：${failure}` : '未找到匹配企业的公开面经，可修改企业名称或岗位后重试')
  }
  return [...found.values()].slice(0, 8)
}
