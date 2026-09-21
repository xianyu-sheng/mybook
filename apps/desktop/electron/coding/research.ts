import { load } from 'cheerio'
import type { CodingProblemDifficulty, CodingResearchItem } from '../../src/types/coding.js'

/** Sources are deliberately kept as a user-visible allow-list. Search snippets are leads, not verified interview questions. */
export const CODING_SOURCES = [
  { id: 'nowcoder', label: '牛客', host: 'nowcoder.com' },
  { id: 'xiaohongshu', label: '小红书', host: 'xiaohongshu.com' },
  { id: 'codetop', label: 'CodeTop', host: 'codetop.cc' },
  { id: 'leetcode', label: '力扣', host: 'leetcode.cn' },
  { id: 'lingshen', label: '灵神题单', host: 'github.com' },
] as const

const allowedHosts = new Set<string>(CODING_SOURCES.map(source => source.host))

export function skillTerms(jd: string): string[] {
  const known = [
    'Java', 'Go', 'Python', 'C++', 'Rust', 'JavaScript', 'TypeScript', 'Spring', 'Redis', 'MySQL',
    'SQL', 'Kafka', '消息队列', 'Docker', 'Kubernetes', 'Linux', '网络', '操作系统', 'JVM', '大模型',
    'LLM', 'Agent', 'RAG', '向量数据库', '机器学习', '动态规划', '二叉树', '图', '并查集', '回溯',
    '二分', '滑动窗口', '单调栈', '链表', '数组', '哈希', '系统设计'
  ]
  const lower = jd.toLowerCase()
  return known.filter(term => lower.includes(term.toLowerCase()))
}

export function researchQueries(input: { company: string; department?: string; role: string; jd?: string; sources?: string[] }): string[] {
  const sourceIds = new Set(input.sources?.length ? input.sources : CODING_SOURCES.map(source => source.id))
  const skills = skillTerms(input.jd || '').slice(0, 4).join(' ')
  const base = `${input.company} ${input.department || ''} ${input.role} ${skills}`.replace(/\s+/g, ' ').trim()
  const queries: string[] = []
  for (const source of CODING_SOURCES) {
    if (!sourceIds.has(source.id)) continue
    const suffix = source.id === 'codetop' ? '真题 题单' : source.id === 'lingshen' ? '题单 算法' : '面试题 刷题'
    queries.push(`site:${source.host} ${base} ${suffix}`)
  }
  // A broad query helps when a source has not indexed the company name yet.
  if (skills) queries.push(`site:leetcode.cn ${skills} ${input.role} 题单`)
  return [...new Set(queries)]
}

function sourceForUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw)
    if (!['http:', 'https:'].includes(parsed.protocol)) return null
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    const match = CODING_SOURCES.find(source => host === source.host || host.endsWith(`.${source.host}`))
    return match?.id || null
  } catch { return null }
}

export function normalizeResearchUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw)
    if (!['http:', 'https:'].includes(parsed.protocol)) return null
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    if (!allowedHosts.has(host) && ![...allowedHosts].some(allowed => host.endsWith(`.${allowed}`))) return null
    // Search tracking parameters do not identify a source document.
    for (const key of [...parsed.searchParams.keys()]) if (/^(utm_|spm|from|source|share_)/i.test(key)) parsed.searchParams.delete(key)
    parsed.hash = ''
    return parsed.toString()
  } catch { return null }
}

type CodingSearchInput = { company: string; department?: string; role: string; jd?: string; sources?: string[] }
type EnrichedResearchItem = CodingResearchItem & {
  problem?: {
    source_id?: string
    difficulty?: CodingProblemDifficulty
    tags?: string[]
    knowledge?: string[]
    statement?: string
    constraints?: string
    examples?: Array<Record<string, unknown> | string>
  }
}

const browserHeaders = {
  Accept: 'text/html,application/xhtml+xml,application/json,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36 Mybook/0.7',
}

async function fetchText(url: string, init: RequestInit = {}): Promise<string> {
  const response = await fetch(url, { ...init, headers: { ...browserHeaders, ...(init.headers || {}) }, signal: init.signal || AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.text()
}

async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const text = await fetchText(url, { ...init, headers: { Accept: 'application/json', ...(init.headers || {}) } })
  try { return JSON.parse(text) as T } catch { throw new Error('公开接口返回了无法解析的数据') }
}

function item(source: string, title: string, rawUrl: string, snippet: string, warning?: string, problem?: EnrichedResearchItem['problem']): EnrichedResearchItem | null {
  const url = normalizeResearchUrl(rawUrl)
  if (!url) return null
  return { source, title: title.trim().slice(0, 300) || '未命名公开题源', url, snippet: snippet.replace(/\s+/g, ' ').trim().slice(0, 1800), retrieved_at: new Date().toISOString(), warning: warning || '实时公开来源，未经企业或题源确认，不代表必考题。', problem }
}

function htmlText(raw: string): string { return load(`<div>${raw}</div>`).text().replace(/\s+/g, ' ').trim() }
function enabledSources(input: CodingSearchInput): Set<string> { return new Set(input.sources?.length ? input.sources : CODING_SOURCES.map(source => source.id)) }

function nowcoderSearchUrl(query: string): string {
  const url = new URL('https://www.nowcoder.com/search/all/')
  url.searchParams.set('query', query)
  return url.toString()
}

async function searchNowcoder(input: CodingSearchInput): Promise<EnrichedResearchItem[]> {
  const skills = skillTerms(input.jd || '').slice(0, 4).join(' ')
  const queries = [...new Set([
    `${input.company} ${input.department || ''} ${input.role} ${skills}`.replace(/\s+/g, ' ').trim(),
    `${input.company} 面经 面试题`,
  ])]
  const found = new Map<string, EnrichedResearchItem>()
  for (const query of queries) {
    const url = nowcoderSearchUrl(query)
    try {
      const html = await fetchText(url)
      const $ = load(html)
      $('a[href]').each((_, anchor) => {
        const href = $(anchor).attr('href') || ''
        if (!/(?:^|\/)discuss\/|(?:^|\/)feed\/main\/detail\/|(?:^|\/)creation\/subject\//.test(href)) return
        const absolute = new URL(href, 'https://www.nowcoder.com').toString()
        const title = $(anchor).text().replace(/\s+/g, ' ').trim()
        const context = $(anchor).parent().text().replace(/\s+/g, ' ').trim()
        const result = item('nowcoder', title || `牛客公开讨论：${query}`, absolute, context || title, '牛客实时搜索结果，请打开原文核验面经内容。')
        if (result) found.set(result.url, result)
      })
      // Always retain the actual search page, including when SSR is blocked or requires login.
      const landing = item('nowcoder', `牛客搜索：${query}`, url, '牛客公开搜索入口，可继续查看最新面经、笔试题和讨论。', '牛客搜索页实时生成；列表内容可能要求登录，请打开原文核验。')
      if (landing) found.set(landing.url, landing)
    } catch (error) {
      const landing = item('nowcoder', `牛客搜索：${query}`, url, `牛客搜索请求失败：${error instanceof Error ? error.message : String(error)}`, '牛客暂时无法返回列表，请稍后点击搜索入口重试。')
      if (landing) found.set(landing.url, landing)
    }
  }
  return [...found.values()].slice(0, 12)
}

async function searchXiaohongshu(input: CodingSearchInput): Promise<EnrichedResearchItem[]> {
  const query = `${input.company} ${input.department || ''} ${input.role} 面试`.replace(/\s+/g, ' ').trim()
  const url = new URL('https://www.xiaohongshu.com/search_result/')
  url.searchParams.set('keyword', query)
  const found: EnrichedResearchItem[] = []
  try {
    const html = await fetchText(url.toString())
    const $ = load(html)
    $('a[href]').each((_, anchor) => {
      const href = $(anchor).attr('href') || ''
      if (!/(?:^|\/)explore\//.test(href)) return
      const result = item('xiaohongshu', $(anchor).text() || '小红书公开面经', new URL(href, 'https://www.xiaohongshu.com').toString(), $(anchor).parent().text(), '小红书笔记需要在浏览器中核验，Mybook 不保存登录态。')
      if (result && !found.some(existing => existing.url === result.url)) found.push(result)
    })
  } catch {
    // The landing page below is still useful and makes the limitation visible to the user.
  }
  const landing = item('xiaohongshu', `小红书搜索：${query}`, url.toString(), '小红书公开搜索入口；未登录时通常只返回搜索壳页面。', found.length ? '小红书笔记需要在浏览器中核验，Mybook 不保存登录态。' : '小红书未登录页面没有返回笔记列表，请打开搜索入口在浏览器中核验。')
  if (landing) found.unshift(landing)
  return found.slice(0, 12)
}

interface CodeTopCompany { id: number; name: string }
interface CodeTopJob { id: number; name: string; priority?: number }
interface CodeTopQuestion { id?: number; leetcode?: { frontend_question_id?: string; title?: string; titleCn?: string; slug_title?: string; content?: string; level?: number; }; comment_count?: number }

function normalizeText(value: string): string { return value.toLowerCase().replace(/[\s·・,，/\\()（）_-]+/g, '') }
function chooseCodeTopJob(jobs: CodeTopJob[], input: CodingSearchInput): CodeTopJob | undefined {
  const haystack = `${input.role} ${input.department || ''} ${input.jd || ''}`.toLowerCase()
  const scored = jobs.map(job => {
    const words = job.name.toLowerCase().split(/[\/、\s+]+/).filter(Boolean)
    const score = words.reduce((total, word) => total + (word.length > 1 && haystack.includes(word) ? 3 : 0), 0) + (job.priority || 0) / 10
    return { job, score }
  }).sort((a, b) => b.score - a.score)
  return scored[0]?.job
}

function codeTopLevel(level: number | undefined): CodingProblemDifficulty {
  return level === 1 ? 'easy' : level === 3 ? 'hard' : level === 2 ? 'medium' : 'unknown'
}

async function searchCodeTop(input: CodingSearchInput): Promise<EnrichedResearchItem[]> {
  const [companies, jobs] = await Promise.all([
    fetchJson<CodeTopCompany[]>('https://codetop.cc/api/companies/'),
    fetchJson<CodeTopJob[]>('https://codetop.cc/api/jobs/'),
  ])
  const wanted = normalizeText(input.company)
  const company = companies.find(candidate => normalizeText(candidate.name) === wanted) || companies.find(candidate => normalizeText(candidate.name).includes(wanted) || wanted.includes(normalizeText(candidate.name)))
  if (!company) throw new Error(`CodeTop 没有找到企业“${input.company}”`)
  const job = chooseCodeTopJob(jobs, input)
  if (!job) throw new Error('CodeTop 没有可用岗位分类')
  const firstUrl = new URL('https://codetop.cc/api/questions/')
  firstUrl.searchParams.set('company', String(company.id)); firstUrl.searchParams.set('job', String(job.id)); firstUrl.searchParams.set('page', '1')
  const first = await fetchJson<{ count?: number; list?: CodeTopQuestion[] }>(firstUrl.toString())
  const pages = Math.min(5, Math.max(1, Math.ceil(Number(first.count || first.list?.length || 0) / 20)))
  const pagesData = [first, ...await Promise.all(Array.from({ length: pages - 1 }, (_, index) => {
    const pageUrl = new URL(firstUrl); pageUrl.searchParams.set('page', String(index + 2))
    return fetchJson<{ list?: CodeTopQuestion[] }>(pageUrl.toString())
  }))]
  const found: EnrichedResearchItem[] = []
  for (const page of pagesData) for (const question of page.list || []) {
    const lc = question.leetcode
    const slug = lc?.slug_title?.trim()
    if (!lc || !slug) continue
    const url = `https://leetcode.cn/problems/${slug}/`
    const title = lc.titleCn || lc.title || slug
    const tags = skillTerms(`${title} ${lc.content || ''}`)
    const result = item('codetop', `${title} · ${company.name} · ${job.name}`, url, `${htmlText(lc.content || '')}${question.comment_count ? `；CodeTop 讨论 ${question.comment_count} 条` : ''}`, 'CodeTop 实时公开高频题数据；频次和面试记录会随站点更新。', { source_id: lc.frontend_question_id || slug, difficulty: codeTopLevel(lc.level), tags, statement: htmlText(lc.content || '') })
    if (result) found.push(result)
  }
  const apiItem = item('codetop', `CodeTop：${company.name} · ${job.name}`, firstUrl.toString(), `实时读取 CodeTop 的 ${company.name} / ${job.name} 高频题列表，共 ${first.count || found.length} 道。`, 'CodeTop API 入口，可打开查看站点最新数据。')
  if (apiItem) found.unshift(apiItem)
  return found.slice(0, 42)
}

const leetcodeCompanyAliases: Array<[RegExp, string]> = [
  [/字节|bytedance|抖音|飞书|tiktok/i, 'bytedance'],
  [/微软|microsoft/i, 'microsoft'], [/阿里|淘宝|alibaba/i, 'alibaba'], [/腾讯|tencent/i, 'tencent'],
  [/美团|meituan/i, 'meituan'], [/快手|kuaishou/i, 'kuaishou'], [/百度|baidu/i, 'baidu'],
]

async function searchLeetCode(input: CodingSearchInput): Promise<EnrichedResearchItem[]> {
  const slug = leetcodeCompanyAliases.find(([pattern]) => pattern.test(input.company))?.[1]
  const companyUrl = slug ? `https://leetcode.cn/company/${slug}/` : `https://leetcode.cn/problemset/all/?search=${encodeURIComponent(input.company)}`
  const found: EnrichedResearchItem[] = []
  const page = item('leetcode', `力扣企业题库：${input.company}`, companyUrl, slug ? `力扣公开企业题库入口：${input.company}。` : `力扣公开搜索入口：${input.company}。`, '力扣企业标签和题目会实时变化，请打开原文核验。')
  if (page) found.push(page)
  if (!slug) return found
  const query = `query { problemsetQuestionList(categorySlug: "", limit: 100, skip: 0, filters: {}) { questions { frontendQuestionId titleCn titleSlug difficulty topicTags { nameTranslated } extra { topCompanyTags { slug } } } hasMore } }`
  const payload = await fetchJson<{ data?: { problemsetQuestionList?: { questions?: Array<{ frontendQuestionId?: string; titleCn?: string; titleSlug?: string; difficulty?: string; topicTags?: Array<{ nameTranslated?: string }>; extra?: { topCompanyTags?: Array<{ slug?: string }> } }> } }; errors?: Array<{ message?: string }> }>('https://leetcode.cn/graphql/', { method: 'POST', headers: { 'Content-Type': 'application/json', Referer: 'https://leetcode.cn/problemset/all/' }, body: JSON.stringify({ query }) })
  if (payload.errors?.length) throw new Error(`力扣公开题库：${payload.errors[0].message || 'GraphQL 错误'}`)
  const questions = payload.data?.problemsetQuestionList?.questions || []
  const terms = skillTerms(`${input.role} ${input.jd || ''}`).map(term => term.toLowerCase())
  const companyQuestions = questions.filter(question => question.extra?.topCompanyTags?.some(tag => tag.slug === slug))
    .sort((a, b) => {
      const score = (question: typeof a) => (question.topicTags || []).reduce((total, tag) => total + (terms.includes((tag.nameTranslated || '').toLowerCase()) ? 1 : 0), 0)
      return score(b) - score(a)
    })
  for (const question of companyQuestions.slice(0, 36)) {
    if (!question.titleSlug) continue
    const difficulty = question.difficulty === 'EASY' ? 'easy' : question.difficulty === 'HARD' ? 'hard' : 'medium'
    const tags = (question.topicTags || []).map(tag => tag.nameTranslated).filter((tag): tag is string => Boolean(tag))
    const result = item('leetcode', `${question.titleCn || question.titleSlug} · ${input.company}`, `https://leetcode.cn/problems/${question.titleSlug}/`, `力扣企业标签：${input.company}；题号 ${question.frontendQuestionId || '未知'}；标签 ${tags.join('、')}`, '力扣公开企业题库实时结果；企业标签不等同于必考承诺。', { source_id: question.frontendQuestionId || question.titleSlug, difficulty, tags })
    if (result) found.push(result)
  }
  return found
}

interface LeetCodeQuestionDetail {
  questionId?: string
  questionFrontendId?: string
  translatedTitle?: string
  translatedContent?: string
  content?: string
  difficulty?: string
  topicTags?: Array<{ name?: string; translatedName?: string }>
  exampleTestcases?: string | string[]
}

/**
 * Company lists and the LingShen index usually expose only a title and a
 * problem URL. Fetch the public LeetCode question document as a second step
 * so the local problem view contains the statement, constraints and examples
 * instead of a search-result sentence. A failed detail request is ignored;
 * the original public URL is still retained as a useful source lead.
 */
async function fetchLeetCodeDetail(slug: string): Promise<LeetCodeQuestionDetail | null> {
  const query = `query($titleSlug:String!){ question(titleSlug:$titleSlug){ questionId questionFrontendId translatedTitle translatedContent content difficulty topicTags{name translatedName} exampleTestcases } }`
  try {
    const payload = await fetchJson<{ data?: { question?: LeetCodeQuestionDetail | null }; errors?: Array<{ message?: string }> }>('https://leetcode.cn/graphql/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Referer: `https://leetcode.cn/problems/${slug}/`, 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7' },
      body: JSON.stringify({ query, variables: { titleSlug: slug } }),
      signal: AbortSignal.timeout(8000),
    })
    if (payload.errors?.length || !(payload.data?.question?.translatedContent || payload.data?.question?.content)) return null
    return payload.data.question
  } catch { return null }
}

function detailProblem(detail: LeetCodeQuestionDetail): NonNullable<EnrichedResearchItem['problem']> {
  const content = detail.translatedContent || detail.content || ''
  const $ = load(`<div>${content}</div>`)
  const plain = htmlText(content)
  const constraintsMatch = plain.match(/(?:约束|限制|提示|constraints?)\s*[:：]\s*([\s\S]*?)(?=(?:进阶|follow[- ]?up)\s*[:：]|$)/i)
  const statement = constraintsMatch ? plain.slice(0, constraintsMatch.index).trim() : plain
  const constraints = constraintsMatch?.[1]?.trim() || ''
  const examples = $('pre').toArray().map(element => $(element).text().trim()).filter(Boolean)
  const difficulty = detail.difficulty === 'EASY' ? 'easy' : detail.difficulty === 'HARD' ? 'hard' : detail.difficulty === 'MEDIUM' ? 'medium' : 'unknown'
  const tags = (detail.topicTags || []).map(tag => tag.translatedName || tag.name || '').filter(Boolean)
  return {
    source_id: detail.questionFrontendId || detail.questionId,
    difficulty,
    tags,
    knowledge: tags,
    statement: statement || plain,
    constraints,
    examples: examples.length ? examples : (Array.isArray(detail.exampleTestcases) ? detail.exampleTestcases : detail.exampleTestcases ? [detail.exampleTestcases] : []),
  }
}

async function enrichLeetCodeProblems(results: EnrichedResearchItem[]): Promise<EnrichedResearchItem[]> {
  const candidates = results
    .filter(result => /https?:\/\/leetcode\.cn\/problems\/([a-z0-9-]+)\/?$/i.test(result.url))
    .sort((a, b) => {
      const needs = (item: EnrichedResearchItem) => !item.problem?.statement || !item.problem?.constraints || !item.problem?.examples?.length
      return Number(needs(b)) - Number(needs(a))
    })
  const unique = new Map<string, EnrichedResearchItem>()
  for (const result of candidates) {
    const match = result.url.match(/\/problems\/([a-z0-9-]+)\/?$/i)
    if (match && !unique.has(match[1].toLowerCase())) unique.set(match[1].toLowerCase(), result)
  }
  // Keep refresh latency bounded even when a source returns a very large
  // topic list. The first 60 links cover the initial planned page, while any
  // remaining links can still be opened from their live source URL.
  const targets = [...unique.entries()].slice(0, 60)
  const details = await Promise.allSettled(targets.map(async ([slug, result]) => ({ slug, result, detail: await fetchLeetCodeDetail(slug) })))
  for (const settled of details) {
    if (settled.status !== 'fulfilled' || !settled.value.detail) continue
    const { result, detail } = settled.value
    const enriched = detailProblem(detail)
    result.problem = { ...result.problem, ...enriched }
    if (detail.translatedTitle && (!result.title || /未命名|题单/.test(result.title))) result.title = detail.translatedTitle
  }
  return results
}

function titleFromSlug(slug: string): string { return slug.split('-').map(word => word ? word[0].toUpperCase() + word.slice(1) : word).join(' ') }

async function searchLingShen(input: CodingSearchInput): Promise<EnrichedResearchItem[]> {
  const listUrl = 'https://github.com/EndlessCheng/codeforces-go/tree/master/leetcode'
  const html = await fetchText(listUrl)
  const $ = load(html)
  const found: EnrichedResearchItem[] = []
  const seen = new Set<string>()
  $('a[href]').each((_, anchor) => {
    const href = $(anchor).attr('href') || ''
    const match = href.match(/https?:\/\/leetcode\.cn\/problems\/([a-z0-9-]+)\/?/i) || href.match(/(?:^|\/)problems\/([a-z0-9-]+)\/?/i)
    if (!match || /\/solution\//i.test(href)) return
    const slug = match[1].toLowerCase()
    if (seen.has(slug)) return
    seen.add(slug)
    const result = item('lingshen', `${($(anchor).text() || '').trim() || titleFromSlug(slug)} · 灵神题单`, `https://leetcode.cn/problems/${slug}/`, `灵神题单公开链接；来自 GitHub EndlessCheng/codeforces-go。`, '灵神题单实时 GitHub 内容，题目难度和顺序请打开原题核验。', { source_id: slug })
    if (result) found.push(result)
  })
  const entry = item('lingshen', '灵神题单（GitHub）', listUrl, `灵神公开题单入口，${found.length} 条力扣题目链接已实时读取。`, '题单来自 GitHub；Mybook 只保存公开链接，不复制题单版权内容。')
  if (entry) found.unshift(entry)
  // Keep a useful result even if GitHub changes its rendered markup.
  if (found.length === 1) {
    const fallback = item('lingshen', '灵神题单（力扣搜索入口）', 'https://leetcode.cn/problemset/all/?search=灵神题单', `GitHub 页面暂未返回题目链接，请打开力扣搜索入口继续。`, 'GitHub 页面结构发生变化，请在浏览器中核验最新题单。')
    if (fallback) found.push(fallback)
  }
  return found.slice(0, 62)
}

export function parseCodingResearch(xml: string, company: string, enabledSources?: string[]): CodingResearchItem[] {
  const enabled = new Set(enabledSources?.length ? enabledSources : CODING_SOURCES.map(source => source.id))
  const $ = load(xml, { xmlMode: true })
  const found = new Map<string, CodingResearchItem>()
  $('item').each((_, item) => {
    const title = $(item).find('title').text().trim()
    const snippet = $(item).find('description').text().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    const url = normalizeResearchUrl($(item).find('link').text().trim())
    if (!url) return
    let source = sourceForUrl(url)
    // 灵神公开题单 commonly links back to leetcode.cn. Preserve the user's selected label
    // when LeetCode is not selected but the 灵神 source is.
    if (source === 'leetcode' && !enabled.has('leetcode') && enabled.has('lingshen')) source = 'lingshen'
    if (!source || !enabled.has(source)) return
    // Search engines occasionally return unrelated pages for a site query.
    const haystack = `${title} ${snippet}`.toLowerCase()
    const companyWords = company.toLowerCase().split(/\s+/).filter(word => word.length > 1)
    if (companyWords.length && !companyWords.some(word => haystack.includes(word)) && !/题单|算法|面试题|真题|刷题/i.test(haystack)) return
    if (!/题|算法|面试|面经|刷题|leetcode|牛客|codetop|灵神/i.test(haystack)) return
    found.set(url, { source, title: title || '未命名题源', url, snippet: snippet.slice(0, 1800), retrieved_at: new Date().toISOString(), warning: '公开搜索摘要，未经题源或企业确认，不代表必考题。' })
  })
  return [...found.values()]
}

export async function searchCodingResearch(input: CodingSearchInput): Promise<CodingResearchItem[]> {
  const enabled = enabledSources(input)
  const results = new Map<string, EnrichedResearchItem>()
  const failures: string[] = []
  const jobs: Array<[string, () => Promise<EnrichedResearchItem[]>]> = []
  if (enabled.has('nowcoder')) jobs.push(['牛客', () => searchNowcoder(input)])
  if (enabled.has('xiaohongshu')) jobs.push(['小红书', () => searchXiaohongshu(input)])
  if (enabled.has('codetop')) jobs.push(['CodeTop', () => searchCodeTop(input)])
  if (enabled.has('leetcode')) jobs.push(['力扣', () => searchLeetCode(input)])
  if (enabled.has('lingshen')) jobs.push(['灵神题单', () => searchLingShen(input)])
  const settled = await Promise.allSettled(jobs.map(([, run]) => run()))
  settled.forEach((result, index) => {
    const [label] = jobs[index]
    if (result.status === 'rejected') failures.push(`${label}：${result.reason instanceof Error ? result.reason.message : String(result.reason)}`)
    else result.value.forEach(found => results.set(found.url, found))
  })

  // Keep the old RSS parser as a narrowly scoped fallback for search engines and for
  // installations where a source has changed its public endpoint. It is never the
  // primary source anymore and strict allow-list filtering remains in place.
  const hasDirectProblem = [...results.values()].some(found => /\/problems\/[a-z0-9-]+\/?$/i.test(found.url))
  if (!hasDirectProblem) {
    for (const query of researchQueries(input)) {
      try {
        const url = new URL('https://cn.bing.com/search')
        url.searchParams.set('q', query); url.searchParams.set('format', 'rss')
        const xml = await fetchText(url.toString(), { headers: { Accept: 'application/rss+xml,application/xml' } })
        for (const found of parseCodingResearch(xml, input.company, input.sources)) results.set(found.url, found)
        if ([...results.values()].some(found => /\/problems\/[a-z0-9-]+\/?$/i.test(found.url))) break
      } catch (error) { failures.push(`公开搜索：${error instanceof Error ? error.message : String(error)}`) }
    }
  }
  if (!results.size) {
    const detail = failures.length ? `（${failures.slice(0, 3).join('；')}）` : ''
    throw new Error(`未找到匹配的公开题源${detail}。可以保留内置题单，或稍后再次搜索。`)
  }
  return (await enrichLeetCodeProblems([...results.values()])).slice(0, 120)
}

export interface BuiltinProblem {
  canonical_key: string
  source: string
  source_id: string
  source_url: string
  title: string
  difficulty: 'easy' | 'medium' | 'hard'
  tags: string[]
  knowledge: string[]
  statement: string
}

// A small offline seed makes strategy creation useful even when network search or a site changes.
// It is intentionally labelled as a public practice catalogue rather than company guarantees.
export const BUILTIN_PROBLEMS: BuiltinProblem[] = [
  { canonical_key: 'leetcode:1-two-sum', source: 'leetcode', source_id: '1', source_url: 'https://leetcode.cn/problems/two-sum/', title: '两数之和', difficulty: 'easy', tags: ['数组', '哈希'], knowledge: ['哈希表', '补数'], statement: '给定一个整数数组和目标值，返回和为目标值的两个下标。' },
  { canonical_key: 'leetcode:206-reverse-linked-list', source: 'leetcode', source_id: '206', source_url: 'https://leetcode.cn/problems/reverse-linked-list/', title: '反转链表', difficulty: 'easy', tags: ['链表'], knowledge: ['双指针', '迭代'], statement: '反转单链表并返回新的头节点。' },
  { canonical_key: 'leetcode:20-valid-parentheses', source: 'leetcode', source_id: '20', source_url: 'https://leetcode.cn/problems/valid-parentheses/', title: '有效的括号', difficulty: 'easy', tags: ['栈', '字符串'], knowledge: ['栈', '匹配'], statement: '判断括号字符串是否按正确顺序闭合。' },
  { canonical_key: 'leetcode:704-binary-search', source: 'leetcode', source_id: '704', source_url: 'https://leetcode.cn/problems/binary-search/', title: '二分查找', difficulty: 'easy', tags: ['二分', '数组'], knowledge: ['搜索区间', '循环不变量'], statement: '在有序数组中查找目标值的下标。' },
  { canonical_key: 'leetcode:53-maximum-subarray', source: 'leetcode', source_id: '53', source_url: 'https://leetcode.cn/problems/maximum-subarray/', title: '最大子数组和', difficulty: 'medium', tags: ['数组', '动态规划'], knowledge: ['状态转移', '前缀思想'], statement: '找出具有最大和的连续子数组。' },
  { canonical_key: 'leetcode:3-longest-substring-without-repeating-characters', source: 'leetcode', source_id: '3', source_url: 'https://leetcode.cn/problems/longest-substring-without-repeating-characters/', title: '无重复字符的最长子串', difficulty: 'medium', tags: ['字符串', '滑动窗口'], knowledge: ['滑动窗口', '哈希集合'], statement: '找出不含重复字符的最长子串长度。' },
  { canonical_key: 'leetcode:15-3sum', source: 'leetcode', source_id: '15', source_url: 'https://leetcode.cn/problems/3sum/', title: '三数之和', difficulty: 'medium', tags: ['数组', '双指针', '排序'], knowledge: ['排序去重', '双指针'], statement: '找出数组中和为零且不重复的三元组。' },
  { canonical_key: 'leetcode:102-binary-tree-level-order-traversal', source: 'leetcode', source_id: '102', source_url: 'https://leetcode.cn/problems/binary-tree-level-order-traversal/', title: '二叉树的层序遍历', difficulty: 'medium', tags: ['二叉树', 'BFS'], knowledge: ['队列', '分层遍历'], statement: '按层返回二叉树节点值。' },
  { canonical_key: 'leetcode:199-binary-tree-right-side-view', source: 'leetcode', source_id: '199', source_url: 'https://leetcode.cn/problems/binary-tree-right-side-view/', title: '二叉树的右视图', difficulty: 'medium', tags: ['二叉树', 'BFS'], knowledge: ['层序遍历', 'DFS'], statement: '返回从右侧看到的每层最后一个节点。' },
  { canonical_key: 'leetcode:215-kth-largest-element-in-an-array', source: 'leetcode', source_id: '215', source_url: 'https://leetcode.cn/problems/kth-largest-element-in-an-array/', title: '数组中的第K个最大元素', difficulty: 'medium', tags: ['数组', '堆', '快速选择'], knowledge: ['堆', '快速选择'], statement: '在未排序数组中找出第 k 个最大元素。' },
  { canonical_key: 'leetcode:46-permutations', source: 'leetcode', source_id: '46', source_url: 'https://leetcode.cn/problems/permutations/', title: '全排列', difficulty: 'medium', tags: ['回溯'], knowledge: ['决策树', '回溯剪枝'], statement: '返回不含重复数字数组的所有全排列。' },
  { canonical_key: 'leetcode:322-coin-change', source: 'leetcode', source_id: '322', source_url: 'https://leetcode.cn/problems/coin-change/', title: '零钱兑换', difficulty: 'medium', tags: ['动态规划'], knowledge: ['完全背包', '最优子结构'], statement: '给定硬币面额和金额，求凑成金额所需最少硬币数。' },
  { canonical_key: 'leetcode:200-number-of-islands', source: 'leetcode', source_id: '200', source_url: 'https://leetcode.cn/problems/number-of-islands/', title: '岛屿数量', difficulty: 'medium', tags: ['图', 'DFS', 'BFS'], knowledge: ['网格遍历', '连通分量'], statement: '计算二维网格中的岛屿数量。' },
  { canonical_key: 'leetcode:146-lru-cache', source: 'leetcode', source_id: '146', source_url: 'https://leetcode.cn/problems/lru-cache/', title: 'LRU缓存', difficulty: 'medium', tags: ['哈希', '链表', '设计'], knowledge: ['哈希表', '双向链表', '缓存淘汰'], statement: '设计满足 O(1) 获取和写入的 LRU 缓存。' },
  { canonical_key: 'leetcode:76-minimum-window-substring', source: 'leetcode', source_id: '76', source_url: 'https://leetcode.cn/problems/minimum-window-substring/', title: '最小覆盖子串', difficulty: 'hard', tags: ['字符串', '滑动窗口'], knowledge: ['计数窗口', '双指针'], statement: '找出包含目标字符串全部字符的最短子串。' },
  { canonical_key: 'leetcode:42-trapping-rain-water', source: 'leetcode', source_id: '42', source_url: 'https://leetcode.cn/problems/trapping-rain-water/', title: '接雨水', difficulty: 'hard', tags: ['数组', '双指针', '单调栈'], knowledge: ['前后缀最大值', '单调栈'], statement: '根据柱状图计算下雨后能接多少雨水。' },
  { canonical_key: 'leetcode:23-merge-k-sorted-lists', source: 'leetcode', source_id: '23', source_url: 'https://leetcode.cn/problems/merge-k-sorted-lists/', title: '合并K个升序链表', difficulty: 'hard', tags: ['链表', '堆', '分治'], knowledge: ['优先队列', '分治合并'], statement: '合并 k 个升序链表并返回合并后的升序链表。' },
]
