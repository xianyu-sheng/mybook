import { load } from 'cheerio'
import type { CodingResearchItem } from '../../src/types/coding.js'

/** Sources are deliberately kept as a user-visible allow-list. Search snippets are leads, not verified interview questions. */
export const CODING_SOURCES = [
  { id: 'nowcoder', label: '牛客', host: 'nowcoder.com' },
  { id: 'xiaohongshu', label: '小红书', host: 'xiaohongshu.com' },
  { id: 'codetop', label: 'CodeTop', host: 'codetop.cc' },
  { id: 'leetcode', label: '力扣', host: 'leetcode.cn' },
  { id: 'lingshen', label: '灵神题单', host: 'leetcode.cn' },
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

export async function searchCodingResearch(input: { company: string; department?: string; role: string; jd?: string; sources?: string[] }): Promise<CodingResearchItem[]> {
  const results = new Map<string, CodingResearchItem>()
  let failure = ''
  for (const query of researchQueries(input)) {
    try {
      const url = new URL('https://cn.bing.com/search')
      url.searchParams.set('q', query)
      url.searchParams.set('format', 'rss')
      const response = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { Accept: 'application/rss+xml,application/xml', 'User-Agent': 'Mybook/0.7' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      for (const item of parseCodingResearch(await response.text(), input.company, input.sources)) results.set(item.url, item)
      if (results.size >= 12) break
    } catch (error) { failure = error instanceof Error ? error.message : String(error) }
  }
  if (!results.size && failure) throw new Error(`题源搜索暂不可用：${failure}`)
  if (!results.size) throw new Error('未找到匹配的公开题源，可以先使用内置题单规划')
  return [...results.values()].slice(0, 30)
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
