import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { memoryDb } from '../test-utils/memory-db.js'
import { createCodingService } from './service.js'

let db: Database.Database
beforeEach(() => { db = memoryDb() })
afterEach(() => db.close())

const input = (company: string) => ({ company, department: '基础架构', role: '后端工程师', jd: 'Java Redis MySQL 动态规划', tags: ['秋招'] })

describe('coding strategy service', () => {
  it('keeps progress and attempts isolated while reusing global problem metadata', () => {
    const service = createCodingService(db)
    const byte = service.plan(service.createStrategy(input('字节跳动')).id)
    const kuaishou = service.plan(service.createStrategy(input('快手')).id)
    expect(byte.problems.length).toBeGreaterThan(5)
    expect(kuaishou.problems.length).toBe(byte.problems.length)
    expect(kuaishou.problems[0].problem.id).toBe(byte.problems[0].problem.id)

    service.updateProblemStatus(byte.problems[0].id, 'mastered')
    const answer = service.saveAttempt({ strategy_problem_id: byte.problems[1].id, thought: '先用哈希表记录已经出现的值，再查补数。', language: 'Java' })
    expect(service.getAttempt(answer.id).thought).toContain('哈希表')
    const byteAgain = service.getStrategy(byte.id)
    const kuaishouAgain = service.getStrategy(kuaishou.id)
    expect(byteAgain.problems[0].status).toBe('mastered')
    expect(kuaishouAgain.problems[0].status).toBe('planned')
    expect(byteAgain.problems[1].attempts).toHaveLength(1)
    expect(kuaishouAgain.problems[1].attempts).toHaveLength(0)
    expect(db.prepare('SELECT COUNT(*) AS n FROM coding_problem').get()).toMatchObject({ n: byte.problems.length })
  })

  it('can re-plan without duplicating strategy problems or resetting progress', () => {
    const service = createCodingService(db)
    const first = service.plan(service.createStrategy(input('阿里云')).id)
    service.updateProblemStatus(first.problems[0].id, 'learning')
    const second = service.plan(first.id)
    expect(second.problems).toHaveLength(first.problems.length)
    expect(second.problems[0].status).toBe('learning')
    expect(db.prepare('SELECT COUNT(*) AS n FROM coding_strategy_problem WHERE strategy_id=?').get(first.id)).toMatchObject({ n: first.problems.length })
  })

  it('stores platform sync snapshots without changing local attempt history', async () => {
    const service = createCodingService(db)
    const strategy = service.plan(service.createStrategy(input('字节跳动')).id)
    const twoSum = strategy.problems.find(problem => problem.problem.source_id === '1')!
    const attempt = service.saveAttempt({ strategy_problem_id: twoSum.id, thought: '本地作答保留', code: 'class Solution {}' })
    db.prepare('INSERT INTO settings(key,value_json) VALUES(?,?)').run('platform_leetcode', JSON.stringify({ token: 'cookie=x', username: 'tester' }))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { recentSubmissionList: [{ id: 'sub-1', title: '两数之和', titleSlug: 'two-sum', statusDisplay: '通过', timestamp: '1' }] } }), { status: 200, headers: { 'content-type': 'application/json' } })))
    try {
      const result = await service.sync(strategy.id, 'leetcode')
      expect(result).toMatchObject({ success: true, imported: 1, matched: 1 })
      expect(service.getAttempt(attempt.id).thought).toBe('本地作答保留')
      expect(service.getStrategy(strategy.id).problems.find(problem => problem.id === twoSum.id)?.sync[0].external_id).toBe('sub-1')
    } finally { vi.unstubAllGlobals() }
  })

  it('imports only direct public problem URLs from research before planning', async () => {
    const service = createCodingService(db)
    const strategy = service.createStrategy(input('字节跳动'))
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<rss><channel><item><title>字节 两数之和 面试题</title><link>https://leetcode.cn/problems/company-two-sum/</link><description>算法题线索</description></item></channel></rss>', { status: 200 })))
    try {
      await service.search(strategy.id)
      const planned = service.plan(strategy.id)
      const imported = planned.problems.find(problem => problem.problem.canonical_key === 'leetcode:company-two-sum')
      expect(imported?.problem.title).toBe('字节 两数之和 面试题')
      expect(imported?.problem.difficulty).toBe('unknown')
    } finally { vi.unstubAllGlobals() }
  })

  it('appends newly researched problems and preserves existing progress', async () => {
    const service = createCodingService(db)
    const strategy = service.createStrategy(input('字节跳动'))
    let slug = 'company-two-sum'
    vi.stubGlobal('fetch', vi.fn(async (request: RequestInfo | URL) => {
      const url = String(request)
      if (url.includes('cn.bing.com/search')) {
        return new Response(`<rss><channel><item><title>字节公开题源 ${slug}</title><link>https://leetcode.cn/problems/${slug}/</link><description>算法题线索</description></item></channel></rss>`, { status: 200 })
      }
      return new Response('', { status: 200 })
    }))
    try {
      const first = service.plan((await service.search(strategy.id)).id)
      const firstProblem = first.problems[0]
      service.updateProblemStatus(firstProblem.id, 'mastered')
      const firstCount = first.problems.length
      slug = 'company-three-sum'
      const second = service.plan((await service.search(strategy.id)).id)
      expect(second.problems.length).toBeGreaterThan(firstCount)
      expect(second.research.some(item => item.url.endsWith('/company-two-sum/'))).toBe(true)
      expect(second.research.some(item => item.url.endsWith('/company-three-sum/'))).toBe(true)
      expect(second.problems.find(problem => problem.problem_id === firstProblem.problem_id)?.status).toBe('mastered')
    } finally { vi.unstubAllGlobals() }
  })
})
