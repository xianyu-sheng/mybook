/** GitHub web-session cookies do not authorize the REST /user/repos endpoint. */
export async function publicGitHubRepos(username: string) {
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(username)) throw new Error('无法识别 GitHub 用户名，请重新连接')
  const repos: Array<{ name: string; description: string; language: string; stars: number; topics: string[]; fork: boolean }> = []
  for (let page = 1; page <= 3; page++) {
    const response = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}/repos?sort=updated&per_page=100&page=${page}&type=owner`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Mybook' }, signal: AbortSignal.timeout(15000)
    })
    if (!response.ok) throw new Error(`GitHub 公开仓库读取失败（HTTP ${response.status}）${page > 1 ? '，未保存不完整目录' : ''}。请稍后重试，或通过项目文档/仓库 URL 导入。`)
    const batch: unknown = await response.json()
    if (!Array.isArray(batch) || batch.some(r => !r || typeof r.name !== 'string')) throw new Error('GitHub 仓库响应格式不正确，未导入数据')
    for (const repo of batch) repos.push({ name: repo.name, description: String(repo.description || ''), language: String(repo.language || ''), stars: Number(repo.stargazers_count) || 0, topics: Array.isArray(repo.topics) ? repo.topics.filter((t: unknown) => typeof t === 'string') : [], fork: Boolean(repo.fork) })
    if (batch.length < 100) return repos
  }
  throw new Error('公开仓库目录超过本次导入的 300 项上限，未保存不完整目录。请通过仓库 URL 或项目文档选择需要复习的项目。')
}
