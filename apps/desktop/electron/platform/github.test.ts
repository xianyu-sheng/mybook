import { afterEach, describe, expect, it, vi } from 'vitest'
import { publicGitHubRepos } from './github.js'
afterEach(() => vi.unstubAllGlobals())
describe('public GitHub directory import', () => {
  it('surfaces API refusal instead of claiming an empty successful import', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })))
    await expect(publicGitHubRepos('test-user')).rejects.toThrow('HTTP 401')
  })
  it('rejects partial pagination, never silently accepts page one', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ name: `repo-${i}` }))))).mockResolvedValueOnce(new Response('{}', { status: 429 })))
    await expect(publicGitHubRepos('test-user')).rejects.toThrow('未保存不完整目录')
  })
  it('uses public metadata without forwarding web-session credentials', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ name: 'project', description: 'Demo', fork: true }])))
    vi.stubGlobal('fetch', fetcher)
    expect(await publicGitHubRepos('test-user')).toMatchObject([{ name: 'project', fork: true }])
    expect(fetcher.mock.calls[0][0]).toContain('/users/test-user/repos')
    expect(fetcher.mock.calls[0][1].headers).not.toHaveProperty('Cookie')
  })
  it('distinguishes a valid empty result from malformed data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('[]')).mockResolvedValueOnce(new Response('{}')))
    expect(await publicGitHubRepos('test')).toEqual([])
    await expect(publicGitHubRepos('test')).rejects.toThrow('响应格式')
  })
})
